// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/analytics/revenue-intelligence.ts
// Revenue Intelligence (Priority 2) — Sales Funnel, Revenue Forecast,
// Proposal Analytics, Booking Analytics, Customer Analytics, Sales
// Productivity.
//
// PERFORMANCE CONTRACT: every section below is computed from a small, FIXED
// number of bulk queries fetched once by buildRevenueIntelligence() — never
// one query per lead/proposal/reservation/customer. Grouping, joining, and
// aggregation all happen in-memory on the already-fetched row arrays. This
// is the same "fetch once, reduce in JS" pattern already used throughout
// this codebase (dashboard/revenue/route.ts, dashboard/stats/route.ts) —
// not true SQL-side GROUP BY, but NOT N+1 either: query count stays
// constant regardless of how many leads/proposals/reservations exist.
// True SQL-side aggregation (views/RPCs) would require a new migration
// applied to a production database this sandbox cannot reach or verify
// against, so this route stays consistent with the rest of the codebase's
// verifiable, already-proven query style instead.
//
// AUDIT FINDINGS THIS MODULE BUILDS ON (reuse, not rebuild):
//   - leads.lead_stage is live and reliable (ISS-KANBAN-001 consolidation —
//     see src/app/(crm)/kanban/page.tsx's header comment) — the funnel is
//     built on it directly.
//   - stage_transitions (migration 019, this same pass) completes an
//     already-written-but-silently-failing write path in
//     lead-stage-manager.ts's transitionStage() — "average time between
//     stages" degrades to null until that migration is live, never fakes a
//     number.
//   - Reservation revenue-recognition status set and double-counting-safe
//     "reservation revenue that never became a proposal" logic are reused
//     unchanged from src/app/api/dashboard/revenue/route.ts (Priority 4)
//     and src/lib/customers/lifetime-value.ts.
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabaseAdmin } from '@/lib/supabase'
import { normalizeToEventType, EVENT_TYPE_LABELS } from '@/lib/events/event-types'

const REVENUE_RECOGNIZED_STATUSES = new Set(['confirmed', 'checked_in', 'checked_out'])
const CANCELLED_STATUSES = new Set(['cancelled', 'no_show'])

// ─── Row shapes (only the columns we select) ──────────────────────────────────

interface LeadRow {
  id: string
  lead_stage: string | null
  ai_score: number | null
  estimated_revenue: number | null
  assigned_to: string | null
  created_at: string
  last_contacted_at: string | null
  follow_up_count: number | null
  next_follow_up_at: string | null
  event_type: string | null
  source: string | null
}

interface ProposalRow {
  id: string
  lead_id: string | null
  status: string | null
  total_price: number | null
  sent_at: string | null
  accepted_at: string | null
  created_at: string
  created_by: string | null
  event_type: string | null
  venue: string | null
  hall: string | null
  package_id: string | null
  package_name: string | null
}

// Direct Event Sales Engine, Section 6 — Event Revenue Dashboard.
// Campaign attribution reuses message_queue (Campaign Scheduler's own send
// log — migration 002's `metadata` JSONB + `lead_id` columns, populated by
// scheduleCampaignSend()'s `metadata: {campaign_id, lead_id}`, see
// campaign-scheduler.ts) rather than a new attribution table.
interface CampaignSendRow {
  lead_id: string | null
  metadata: { campaign_id?: string } | null
}

interface CampaignNameRow {
  id: string
  name: string
}

// Business-strategy expansion, Phase 6 — "AI Recommendation Success Rate".
// Reuses ai_interaction_log (migration 012) — the same audit table
// runEventSalesAdvisor() already writes to (see operator-assistant.ts) —
// rather than a new tracking table. `summary` is the JSON-stringified
// EventSalesAdvisorResult; only `recommendation.packageId` is read back out
// of it here.
interface AIRecommendationLogRow {
  lead_id: string | null
  summary: string | null
}

interface ReservationRow {
  id: string
  customer_id: string | null
  proposal_id: string | null
  status: string | null
  final_room_rate: number | null
  meal_plan_charge: number | null
  room_count: number | null
  check_in_date: string
  check_out_date: string
  created_at: string
}

interface StageTransitionRow {
  lead_id: string
  from_stage: string | null
  to_stage: string
  created_at: string
}

// ─── Shared fetch ──────────────────────────────────────────────────────────────

interface RawData {
  leads: LeadRow[]
  proposals: ProposalRow[]
  reservations: ReservationRow[]
  reservationsDegraded: boolean
  stageTransitions: StageTransitionRow[]
  stageTransitionsDegraded: boolean
  activeInventoryCount: number
  campaignSends: CampaignSendRow[]
  campaignSendsDegraded: boolean
  campaignNames: CampaignNameRow[]
  aiRecommendations: AIRecommendationLogRow[]
  aiRecommendationsDegraded: boolean
}

async function fetchRawData(sinceISO: string): Promise<RawData> {
  const db = getSupabaseAdmin()

  const [
    leadsResult, proposalsResult, reservationsResult, stageTransitionsResult,
    inventoryResult, campaignSendsResult, campaignNamesResult, aiRecommendationsResult,
  ] = await Promise.all([
    db.from('leads').select('id, lead_stage, ai_score, estimated_revenue, assigned_to, created_at, last_contacted_at, follow_up_count, next_follow_up_at, event_type, source'),
    db.from('proposals').select('id, lead_id, status, total_price, sent_at, accepted_at, created_at, created_by, event_type, venue, hall, package_id, package_name'),
    db.from('reservations').select('id, customer_id, proposal_id, status, final_room_rate, meal_plan_charge, room_count, check_in_date, check_out_date, created_at'),
    db.from('stage_transitions').select('lead_id, from_stage, to_stage, created_at').gte('created_at', sinceISO),
    db.from('inventory_items').select('id', { count: 'exact', head: true }).eq('is_active', true),
    db.from('message_queue').select('lead_id, metadata').eq('status', 'sent').not('lead_id', 'is', null),
    db.from('broadcast_campaigns').select('id, name'),
    db.from('ai_interaction_log').select('lead_id, summary').eq('interaction_type', 'event_sales_advisor').not('lead_id', 'is', null),
  ])

  return {
    leads: (leadsResult.data ?? []) as unknown as LeadRow[],
    proposals: (proposalsResult.data ?? []) as unknown as ProposalRow[],
    reservations: reservationsResult.error ? [] : (reservationsResult.data ?? []) as unknown as ReservationRow[],
    reservationsDegraded: reservationsResult.error !== null,
    stageTransitions: stageTransitionsResult.error ? [] : (stageTransitionsResult.data ?? []) as unknown as StageTransitionRow[],
    stageTransitionsDegraded: stageTransitionsResult.error !== null,
    activeInventoryCount: inventoryResult.count ?? 0,
    campaignSends: campaignSendsResult.error ? [] : (campaignSendsResult.data ?? []) as unknown as CampaignSendRow[],
    campaignSendsDegraded: campaignSendsResult.error !== null,
    campaignNames: campaignNamesResult.error ? [] : (campaignNamesResult.data ?? []) as unknown as CampaignNameRow[],
    aiRecommendations: aiRecommendationsResult.error ? [] : (aiRecommendationsResult.data ?? []) as unknown as AIRecommendationLogRow[],
    aiRecommendationsDegraded: aiRecommendationsResult.error !== null,
  }
}

function reservationRevenue(r: ReservationRow): number {
  return (Number(r.final_room_rate) || 0) + (Number(r.meal_plan_charge) || 0)
}

function nights(r: ReservationRow): number {
  const inD = new Date(r.check_in_date).getTime()
  const outD = new Date(r.check_out_date).getTime()
  const n = Math.round((outD - inD) / 86_400_000)
  return n > 0 ? n : 0
}

// ─── 1. Sales Funnel ─────────────────────────────────────────────────────────
// Lead -> Qualified -> Proposal -> Negotiation -> Booked -> Completed.
// "Lead"/"Qualified"/"Negotiation"/"Booked" read leads.lead_stage directly
// (the live, consolidated pipeline field). "Proposal" and "Completed" are
// cross-referenced against ground-truth tables (proposals / reservations)
// rather than trusting the stage label alone, since a proposal or a
// completed stay is a fact, not a manually-set status.

export interface FunnelStage {
  stage: string
  count: number
  revenue: number
  conversionFromPreviousPct: number | null
  avgDaysInPreviousStage: number | null
}

function computeFunnel(data: RawData): { stages: FunnelStage[]; degraded: boolean } {
  const { leads, proposals, reservations, stageTransitions, stageTransitionsDegraded } = data

  const leadIds = new Set(leads.map((l) => l.id))
  const proposalLeadIds = new Set(proposals.map((p) => p.lead_id).filter((id): id is string => !!id))
  const completedCustomerIds = new Set(
    reservations.filter((r) => r.status === 'checked_out').map((r) => r.customer_id).filter((id): id is string => !!id)
  )

  const QUALIFIED_OR_BEYOND = new Set(['QUALIFIED', 'NEGOTIATING', 'PROPOSAL_SENT', 'VISIT_SCHEDULED', 'CONFIRMED'])
  const NEGOTIATION_OR_BEYOND = new Set(['NEGOTIATING', 'PROPOSAL_SENT', 'VISIT_SCHEDULED', 'CONFIRMED'])

  const leadStageOf = new Map(leads.map((l) => [l.id, l.lead_stage]))

  const stageBuckets: Array<{ stage: string; leadIds: Set<string> }> = [
    { stage: 'Lead', leadIds },
    { stage: 'Qualified', leadIds: new Set(leads.filter((l) => l.lead_stage && QUALIFIED_OR_BEYOND.has(l.lead_stage)).map((l) => l.id)) },
    { stage: 'Proposal', leadIds: proposalLeadIds },
    { stage: 'Negotiation', leadIds: new Set(leads.filter((l) => l.lead_stage && NEGOTIATION_OR_BEYOND.has(l.lead_stage)).map((l) => l.id)) },
    { stage: 'Booked', leadIds: new Set(leads.filter((l) => l.lead_stage === 'CONFIRMED').map((l) => l.id)) },
    { stage: 'Completed', leadIds: completedCustomerIds },
  ]

  // Revenue by stage: accepted-proposal revenue attributed to the lead's
  // furthest-reached stage bucket, plus reservation revenue for Completed.
  const acceptedRevenueByLead = new Map<string, number>()
  for (const p of proposals) {
    if (p.accepted_at && p.lead_id) {
      acceptedRevenueByLead.set(p.lead_id, (acceptedRevenueByLead.get(p.lead_id) ?? 0) + (Number(p.total_price) || 0))
    }
  }
  const completedRevenueByCustomer = new Map<string, number>()
  for (const r of reservations) {
    if (r.status === 'checked_out' && r.customer_id) {
      completedRevenueByCustomer.set(r.customer_id, (completedRevenueByCustomer.get(r.customer_id) ?? 0) + reservationRevenue(r))
    }
  }

  // Average days spent in the PREVIOUS stage before reaching this one —
  // computed from stage_transitions (migration 019). Null (not zero) when
  // the table isn't live yet or has no data for a stage, so the UI can
  // distinguish "no data yet" from "zero days."
  const transitionsByLead = new Map<string, StageTransitionRow[]>()
  for (const t of stageTransitions) {
    if (!transitionsByLead.has(t.lead_id)) transitionsByLead.set(t.lead_id, [])
    transitionsByLead.get(t.lead_id)!.push(t)
  }
  Array.from(transitionsByLead.values()).forEach((list) => list.sort((a, b) => a.created_at.localeCompare(b.created_at)))

  function avgDaysToReach(targetStages: Set<string>): number | null {
    if (stageTransitionsDegraded) return null
    const durations: number[] = []
    for (const list of Array.from(transitionsByLead.values())) {
      for (let i = 0; i < list.length; i++) {
        if (targetStages.has(list[i].to_stage)) {
          // Duration since the lead's earliest known transition (proxy for "entered the funnel").
          const enteredAt = new Date(list[0].created_at).getTime()
          const reachedAt = new Date(list[i].created_at).getTime()
          const days = (reachedAt - enteredAt) / 86_400_000
          if (days >= 0) durations.push(days)
          break
        }
      }
    }
    if (durations.length === 0) return null
    return Math.round((durations.reduce((s, d) => s + d, 0) / durations.length) * 10) / 10
  }

  const avgDaysMap: Record<string, number | null> = {
    Qualified: avgDaysToReach(new Set(['QUALIFIED'])),
    Proposal: null, // proposals aren't a lead_stage transition target — no transition event to key off
    Negotiation: avgDaysToReach(new Set(['NEGOTIATING'])),
    Booked: avgDaysToReach(new Set(['CONFIRMED'])),
    Completed: null, // completion is a reservation-status event, not a stage_transitions entry
  }

  const stages: FunnelStage[] = stageBuckets.map((bucket, i) => {
    const revenue = bucket.stage === 'Completed'
      ? Array.from(bucket.leadIds).reduce((s, id) => s + (completedRevenueByCustomer.get(id) ?? 0), 0)
      : Array.from(bucket.leadIds).reduce((s, id) => s + (acceptedRevenueByLead.get(id) ?? 0), 0)

    const prevCount = i > 0 ? stageBuckets[i - 1].leadIds.size : null
    const conversionFromPreviousPct = prevCount && prevCount > 0
      ? Math.round((bucket.leadIds.size / prevCount) * 1000) / 10
      : null

    return {
      stage: bucket.stage,
      count: bucket.leadIds.size,
      revenue,
      conversionFromPreviousPct,
      avgDaysInPreviousStage: avgDaysMap[bucket.stage] ?? null,
    }
  })

  void leadStageOf // kept for readability/future use; avoids unused-var noise in strict lint
  return { stages, degraded: stageTransitionsDegraded }
}

// ─── 2. Revenue Forecast ────────────────────────────────────────────────────
// Minimum-viable, transparent forecast — NOT a statistical/ML model:
//   pipelineForecast = sum(open, undecided proposal value) x historical
//                       acceptance rate (accepted / (accepted+rejected) over
//                       the whole dataset — the same rate already computed
//                       as `acceptance_pct` on the Revenue Dashboard).
//   confirmedForecast = revenue already committed via CONFIRMED reservations
//                       that haven't completed yet (confirmed/checked_in).
// Flagged as a first-pass estimate, not a claim of statistical rigor —
// upgrading to a real time-series forecast is a legitimate follow-up, not
// something to fake confidence on here.

export interface RevenueForecast {
  openProposalValue: number
  historicalAcceptancePct: number
  pipelineForecast: number
  confirmedNotCompletedRevenue: number
  totalForecast: number
  methodologyNote: string
}

function computeForecast(data: RawData): RevenueForecast {
  const { proposals, reservations } = data

  const accepted = proposals.filter((p) => p.accepted_at !== null)
  const rejected = proposals.filter((p) => p.status === 'rejected')
  const decided = accepted.length + rejected.length
  const historicalAcceptancePct = decided > 0 ? Math.round((accepted.length / decided) * 1000) / 10 : 0

  const openProposals = proposals.filter((p) => p.accepted_at === null && p.status !== 'rejected' && p.status !== 'expired')
  const openProposalValue = openProposals.reduce((s, p) => s + (Number(p.total_price) || 0), 0)
  const pipelineForecast = Math.round(openProposalValue * (historicalAcceptancePct / 100))

  const confirmedNotCompleted = reservations.filter((r) => r.status === 'confirmed' || r.status === 'checked_in')
  const confirmedNotCompletedRevenue = confirmedNotCompleted.reduce((s, r) => s + reservationRevenue(r), 0)

  return {
    openProposalValue,
    historicalAcceptancePct,
    pipelineForecast,
    confirmedNotCompletedRevenue,
    totalForecast: pipelineForecast + confirmedNotCompletedRevenue,
    methodologyNote:
      'First-pass estimate: (open proposal value x historical acceptance rate) + revenue already committed via confirmed/checked-in reservations. Not a statistical/ML forecast — a real time-series model would need more historical volume than a first pass should assume.',
  }
}

// ─── 3. Proposal Analytics ──────────────────────────────────────────────────

export interface ProposalAnalytics {
  total: number
  acceptancePct: number
  avgProposalValue: number
  avgDaysToAcceptance: number | null
  lostProposalReasonsAvailable: false
  lostProposalReasonsNote: string
}

function computeProposalAnalytics(data: RawData): ProposalAnalytics {
  const { proposals } = data
  const accepted = proposals.filter((p) => p.accepted_at !== null)
  const rejected = proposals.filter((p) => p.status === 'rejected')
  const decided = accepted.length + rejected.length

  const avgProposalValue = proposals.length > 0
    ? Math.round(proposals.reduce((s, p) => s + (Number(p.total_price) || 0), 0) / proposals.length)
    : 0

  const acceptanceDurations = accepted
    .filter((p) => p.sent_at)
    .map((p) => (new Date(p.accepted_at!).getTime() - new Date(p.sent_at!).getTime()) / 86_400_000)
    .filter((d) => d >= 0)

  return {
    total: proposals.length,
    acceptancePct: decided > 0 ? Math.round((accepted.length / decided) * 1000) / 10 : 0,
    avgProposalValue,
    avgDaysToAcceptance: acceptanceDurations.length > 0
      ? Math.round((acceptanceDurations.reduce((s, d) => s + d, 0) / acceptanceDurations.length) * 10) / 10
      : null,
    lostProposalReasonsAvailable: false,
    lostProposalReasonsNote:
      'No rejection-reason field exists on `proposals` — nothing in the codebase captures why a proposal was lost. Adding one is a product decision (what reasons to track) this module does not make on its own.',
  }
}

// ─── 4. Booking Analytics ────────────────────────────────────────────────────

export interface BookingAnalytics {
  occupancyPct: number | null
  adr: number | null
  totalBookings: number
  cancelledBookings: number
  cancellationPct: number
  revenueByMonth: Array<{ month: string; revenue: number; bookings: number }>
  repeatBookingCustomers: number
  repeatBookingPct: number
  degraded: boolean
}

function computeBookingAnalytics(data: RawData, sinceISO: string): BookingAnalytics {
  const { reservations, reservationsDegraded, activeInventoryCount } = data
  if (reservationsDegraded || reservations.length === 0) {
    return {
      occupancyPct: null, adr: null, totalBookings: 0, cancelledBookings: 0, cancellationPct: 0,
      revenueByMonth: [], repeatBookingCustomers: 0, repeatBookingPct: 0, degraded: reservationsDegraded,
    }
  }

  const inWindow = reservations.filter((r) => r.created_at >= sinceISO)
  const revenueRecognized = inWindow.filter((r) => r.status && REVENUE_RECOGNIZED_STATUSES.has(r.status))
  const cancelled = inWindow.filter((r) => r.status && CANCELLED_STATUSES.has(r.status))

  const totalNights = revenueRecognized.reduce((s, r) => s + nights(r) * (r.room_count || 1), 0)
  const totalRoomRevenue = revenueRecognized.reduce((s, r) => s + reservationRevenue(r), 0)
  const adr = totalNights > 0 ? Math.round(totalRoomRevenue / totalNights) : null

  const windowDays = Math.max(1, Math.round((Date.now() - new Date(sinceISO).getTime()) / 86_400_000))
  const availableRoomNights = activeInventoryCount * windowDays
  const occupancyPct = activeInventoryCount > 0
    ? Math.round((totalNights / availableRoomNights) * 1000) / 10
    : null

  // Revenue by month — last 6 months
  const monthBuckets: Record<string, { revenue: number; bookings: number }> = {}
  const now = new Date()
  for (const r of revenueRecognized) {
    const d = new Date(r.created_at)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    if (!monthBuckets[key]) monthBuckets[key] = { revenue: 0, bookings: 0 }
    monthBuckets[key].revenue += reservationRevenue(r)
    monthBuckets[key].bookings += 1
  }
  const revenueByMonth = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    return {
      month: d.toLocaleString('en-IN', { month: 'short', year: '2-digit' }),
      revenue: monthBuckets[key]?.revenue ?? 0,
      bookings: monthBuckets[key]?.bookings ?? 0,
    }
  })

  // Repeat booking customers — bounded in-memory grouping, not per-customer queries.
  const byCustomer = new Map<string, number>()
  for (const r of revenueRecognized) {
    if (!r.customer_id) continue
    byCustomer.set(r.customer_id, (byCustomer.get(r.customer_id) ?? 0) + 1)
  }
  const repeatBookingCustomers = Array.from(byCustomer.values()).filter((c) => c > 1).length
  const distinctCustomers = byCustomer.size

  return {
    occupancyPct,
    adr,
    totalBookings: revenueRecognized.length,
    cancelledBookings: cancelled.length,
    cancellationPct: inWindow.length > 0 ? Math.round((cancelled.length / inWindow.length) * 1000) / 10 : 0,
    revenueByMonth,
    repeatBookingCustomers,
    repeatBookingPct: distinctCustomers > 0 ? Math.round((repeatBookingCustomers / distinctCustomers) * 1000) / 10 : 0,
    degraded: false,
  }
}

// ─── 5. Customer Analytics ───────────────────────────────────────────────────
// Aggregate CLV/repeat/dormant/high-value stats computed in ONE pass over
// the already-fetched proposals+reservations (grouped by lead_id in
// memory) — deliberately NOT a loop calling computeLifetimeValue() per
// customer (that would be exactly the N+1 pattern this phase's performance
// requirement calls out). Uses the same revenue/double-counting rules as
// that module, just applied set-wise instead of per-row.

export interface CustomerAnalytics {
  totalCustomers: number
  avgCLV: number
  repeatCustomerPct: number
  newCustomersThisMonth: number
  dormantCustomers: number
  dormantThresholdDays: number
  highValueCustomers: number
  highValueThresholdINR: number
}

function computeCustomerAnalytics(data: RawData): CustomerAnalytics {
  const { leads, proposals, reservations } = data

  const acceptedByLead = new Map<string, number>()
  for (const p of proposals) {
    if (p.accepted_at && p.lead_id) acceptedByLead.set(p.lead_id, (acceptedByLead.get(p.lead_id) ?? 0) + (Number(p.total_price) || 0))
  }
  const standaloneReservationRevenueByCustomer = new Map<string, number>()
  const bookingCountByCustomer = new Map<string, number>()
  for (const r of reservations) {
    if (!r.customer_id || !r.status || !REVENUE_RECOGNIZED_STATUSES.has(r.status)) continue
    if (r.proposal_id === null) {
      standaloneReservationRevenueByCustomer.set(r.customer_id, (standaloneReservationRevenueByCustomer.get(r.customer_id) ?? 0) + reservationRevenue(r))
    }
    bookingCountByCustomer.set(r.customer_id, (bookingCountByCustomer.get(r.customer_id) ?? 0) + 1)
  }
  Array.from(acceptedByLead.keys()).forEach((leadId) => {
    bookingCountByCustomer.set(leadId, (bookingCountByCustomer.get(leadId) ?? 0) + 1)
  })

  const clvByLead = new Map<string, number>()
  const allCustomerIds = new Set(Array.from(acceptedByLead.keys()).concat(Array.from(standaloneReservationRevenueByCustomer.keys())))
  Array.from(allCustomerIds).forEach((id) => {
    clvByLead.set(id, (acceptedByLead.get(id) ?? 0) + (standaloneReservationRevenueByCustomer.get(id) ?? 0))
  })

  const customersWithRevenue = Array.from(clvByLead.values())
  const avgCLV = customersWithRevenue.length > 0
    ? Math.round(customersWithRevenue.reduce((s, v) => s + v, 0) / customersWithRevenue.length)
    : 0

  const repeatCount = Array.from(bookingCountByCustomer.values()).filter((c) => c > 1).length
  const repeatCustomerPct = allCustomerIds.size > 0 ? Math.round((repeatCount / allCustomerIds.size) * 1000) / 10 : 0

  const thisMonthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()
  const newCustomersThisMonth = leads.filter((l) => l.created_at >= thisMonthStart).length

  const DORMANT_THRESHOLD_DAYS = 60
  const dormantCutoff = new Date(Date.now() - DORMANT_THRESHOLD_DAYS * 86_400_000).toISOString()
  const dormantCustomers = leads.filter((l) => {
    const ref = l.last_contacted_at ?? l.created_at
    return ref < dormantCutoff
  }).length

  const HIGH_VALUE_THRESHOLD = 150_000
  const highValueCustomers = Array.from(clvByLead.values()).filter((v) => v >= HIGH_VALUE_THRESHOLD).length

  return {
    totalCustomers: leads.length,
    avgCLV,
    repeatCustomerPct,
    newCustomersThisMonth,
    dormantCustomers,
    dormantThresholdDays: DORMANT_THRESHOLD_DAYS,
    highValueCustomers,
    highValueThresholdINR: HIGH_VALUE_THRESHOLD,
  }
}

// ─── 6. Sales Productivity ───────────────────────────────────────────────────
// Grouped by leads.assigned_to (leads) and proposals.created_by (proposals)
// — the two "who owns this" fields that already exist. Reservations don't
// carry a salesperson field directly, so booking/revenue attribution joins
// through the reservation's customer_id -> leads.assigned_to.

export interface SalespersonStats {
  person: string
  leadsHandled: number
  proposalsCreated: number
  proposalsWon: number
  bookings: number
  revenue: number
  followUpComplianceePct: number
}

function computeSalesProductivity(data: RawData): SalespersonStats[] {
  const { leads, proposals, reservations } = data

  const assignedToByLeadId = new Map(leads.map((l) => [l.id, l.assigned_to]))
  const people = new Set<string>()
  for (const l of leads) if (l.assigned_to) people.add(l.assigned_to)
  for (const p of proposals) if (p.created_by) people.add(p.created_by)

  return Array.from(people).map((person) => {
    const personLeads = leads.filter((l) => l.assigned_to === person)
    const personProposals = proposals.filter((p) => p.created_by === person)
    const won = personProposals.filter((p) => p.accepted_at !== null)
    const personReservations = reservations.filter((r) =>
      r.status && REVENUE_RECOGNIZED_STATUSES.has(r.status) &&
      r.customer_id && assignedToByLeadId.get(r.customer_id) === person
    )

    const now = Date.now()
    const dueLeads = personLeads.filter((l) => l.next_follow_up_at)
    const compliantLeads = dueLeads.filter((l) => new Date(l.next_follow_up_at!).getTime() > now || (l.follow_up_count ?? 0) > 0)

    return {
      person,
      leadsHandled: personLeads.length,
      proposalsCreated: personProposals.length,
      proposalsWon: won.length,
      bookings: personReservations.length,
      revenue: won.reduce((s, p) => s + (Number(p.total_price) || 0), 0) + personReservations.reduce((s, r) => s + reservationRevenue(r), 0),
      followUpComplianceePct: dueLeads.length > 0 ? Math.round((compliantLeads.length / dueLeads.length) * 1000) / 10 : 100,
    }
  }).sort((a, b) => b.revenue - a.revenue)
}

// ─── 7. Event Revenue Dashboard ─────────────────────────────────────────────
// Direct Event Sales Engine, Section 6. Reuses this module's existing
// "accepted proposal value = recognized revenue" convention (same unit
// computeFunnel/computeCustomerAnalytics already use) rather than inventing
// a second revenue definition — a proposal's total_price counts once it has
// accepted_at set. Event-type/venue/package breakdowns are scoped to
// proposals that carry an event_type (i.e. actual event proposals, not
// room-only ones); lead-source/campaign breakdowns intentionally cover ALL
// proposals, since "which channel drives revenue" is a cross-cutting
// acquisition question, not an events-only one.

export interface RevenueBreakdownRow {
  key: string
  proposals: number
  accepted: number
  revenue: number
}

export interface AIRecommendationSuccess {
  totalRecommendations: number
  recommendationsWithPackage: number
  bookedMatchingRecommendation: number
  successRatePct: number
  degraded: boolean
}

export interface EventSalesDashboard {
  eventEnquiries: number
  eventProposals: number
  eventProposalsAccepted: number
  eventProposalConversionPct: number
  eventBookings: number
  eventRevenue: number
  revenueByEventType: RevenueBreakdownRow[]
  revenueByVenue: RevenueBreakdownRow[]
  revenueByHall: RevenueBreakdownRow[]
  revenueByPackage: RevenueBreakdownRow[]
  revenueByLeadSource: RevenueBreakdownRow[]
  revenueByCampaign: RevenueBreakdownRow[]
  campaignAttributionDegraded: boolean
  aiRecommendationSuccess: AIRecommendationSuccess
}

// Business-strategy expansion, Phase 6 — "AI Recommendation Success Rate".
// A recommendation "succeeds" when the package the AI Event Sales Advisor
// named for a lead (recommendation.packageId, parsed back out of
// ai_interaction_log.summary) matches the package_id on that SAME lead's
// eventually-accepted proposal. Recommendations with no packageId (advisor
// declined to guess) are excluded from the denominator entirely — they were
// never a prediction to score. Rows whose summary fails to parse (e.g. a
// pre-migration-024 row that predates the wider slice) are skipped, not
// counted as failures — an unreadable row isn't evidence of a wrong
// recommendation.
function computeAIRecommendationSuccess(data: RawData): AIRecommendationSuccess {
  const { aiRecommendations, aiRecommendationsDegraded, proposals } = data
  if (aiRecommendationsDegraded) {
    return { totalRecommendations: 0, recommendationsWithPackage: 0, bookedMatchingRecommendation: 0, successRatePct: 0, degraded: true }
  }

  const acceptedPackagesByLead = new Map<string, Set<string>>()
  for (const p of proposals) {
    if (p.accepted_at && p.lead_id && p.package_id) {
      if (!acceptedPackagesByLead.has(p.lead_id)) acceptedPackagesByLead.set(p.lead_id, new Set())
      acceptedPackagesByLead.get(p.lead_id)!.add(p.package_id)
    }
  }

  let recommendationsWithPackage = 0
  let matched = 0
  for (const row of aiRecommendations) {
    if (!row.lead_id || !row.summary) continue
    let packageId: string | null = null
    try {
      const parsed = JSON.parse(row.summary) as { recommendation?: { packageId?: string | null } }
      packageId = parsed?.recommendation?.packageId ?? null
    } catch {
      continue
    }
    if (!packageId) continue
    recommendationsWithPackage += 1
    if (acceptedPackagesByLead.get(row.lead_id)?.has(packageId)) matched += 1
  }

  return {
    totalRecommendations: aiRecommendations.length,
    recommendationsWithPackage,
    bookedMatchingRecommendation: matched,
    successRatePct: recommendationsWithPackage > 0 ? Math.round((matched / recommendationsWithPackage) * 1000) / 10 : 0,
    degraded: false,
  }
}

function groupProposalRevenue(proposals: ProposalRow[], keyFn: (p: ProposalRow) => string): RevenueBreakdownRow[] {
  const buckets = new Map<string, RevenueBreakdownRow>()
  for (const p of proposals) {
    const key = keyFn(p)
    if (!buckets.has(key)) buckets.set(key, { key, proposals: 0, accepted: 0, revenue: 0 })
    const b = buckets.get(key)!
    b.proposals += 1
    if (p.accepted_at) {
      b.accepted += 1
      b.revenue += Number(p.total_price) || 0
    }
  }
  return Array.from(buckets.values()).sort((a, b) => b.revenue - a.revenue)
}

function computeEventSalesDashboard(data: RawData): EventSalesDashboard {
  const { leads, proposals, reservations, campaignSends, campaignSendsDegraded, campaignNames } = data

  const eventLeadsCount = leads.filter((l) => !!l.event_type).length
  const eventProposalsList = proposals.filter((p) => !!p.event_type)
  const eventProposalsAccepted = eventProposalsList.filter((p) => p.accepted_at !== null)
  const eventRevenue = eventProposalsAccepted.reduce((s, p) => s + (Number(p.total_price) || 0), 0)

  // Event bookings — reservations that trace back (via proposal_id) to an
  // accepted event proposal. Room-only reservations (proposal_id null, or
  // linked to a non-event proposal) are correctly excluded.
  const acceptedEventProposalIds = new Set(eventProposalsAccepted.map((p) => p.id))
  const eventBookings = reservations.filter((r) => r.proposal_id && acceptedEventProposalIds.has(r.proposal_id)).length

  const revenueByEventType = groupProposalRevenue(
    eventProposalsList,
    (p) => EVENT_TYPE_LABELS[normalizeToEventType(p.event_type)]
  )
  const revenueByVenue = groupProposalRevenue(eventProposalsList, (p) => p.venue || 'Unspecified Venue')
  const revenueByHall = groupProposalRevenue(eventProposalsList, (p) => p.hall || 'Unspecified Hall')
  const revenueByPackage = groupProposalRevenue(eventProposalsList, (p) => p.package_name || 'Custom / No Package')

  const sourceByLead = new Map(leads.map((l) => [l.id, l.source || 'Unknown']))
  const revenueByLeadSource = groupProposalRevenue(
    proposals,
    (p) => (p.lead_id && sourceByLead.get(p.lead_id)) || 'Unknown'
  )

  const campaignNameById = new Map(campaignNames.map((c) => [c.id, c.name]))
  const campaignIdByLead = new Map<string, string>()
  for (const row of campaignSends) {
    if (!row.lead_id) continue
    const cid = row.metadata?.campaign_id
    if (cid && !campaignIdByLead.has(row.lead_id)) campaignIdByLead.set(row.lead_id, cid) // first-touch attribution
  }
  const revenueByCampaign = groupProposalRevenue(proposals, (p) => {
    const cid = p.lead_id ? campaignIdByLead.get(p.lead_id) : undefined
    if (!cid) return 'Organic / No Campaign'
    return campaignNameById.get(cid) || 'Unknown Campaign'
  })

  return {
    eventEnquiries: eventLeadsCount,
    eventProposals: eventProposalsList.length,
    eventProposalsAccepted: eventProposalsAccepted.length,
    eventProposalConversionPct: eventProposalsList.length > 0
      ? Math.round((eventProposalsAccepted.length / eventProposalsList.length) * 1000) / 10
      : 0,
    eventBookings,
    eventRevenue,
    revenueByEventType,
    revenueByVenue,
    revenueByHall,
    revenueByPackage,
    revenueByLeadSource,
    revenueByCampaign,
    campaignAttributionDegraded: campaignSendsDegraded,
    aiRecommendationSuccess: computeAIRecommendationSuccess(data),
  }
}

// ─── Orchestrator ────────────────────────────────────────────────────────────

export interface RevenueIntelligence {
  funnel: { stages: FunnelStage[]; degraded: boolean }
  forecast: RevenueForecast
  proposalAnalytics: ProposalAnalytics
  bookingAnalytics: BookingAnalytics
  customerAnalytics: CustomerAnalytics
  salesProductivity: SalespersonStats[]
  eventSales: EventSalesDashboard
  windowDays: number
}

export async function buildRevenueIntelligence(windowDays = 180): Promise<RevenueIntelligence> {
  const sinceISO = new Date(Date.now() - windowDays * 86_400_000).toISOString()
  const data = await fetchRawData(sinceISO)

  return {
    funnel: computeFunnel(data),
    forecast: computeForecast(data),
    proposalAnalytics: computeProposalAnalytics(data),
    bookingAnalytics: computeBookingAnalytics(data, sinceISO),
    customerAnalytics: computeCustomerAnalytics(data),
    salesProductivity: computeSalesProductivity(data),
    eventSales: computeEventSalesDashboard(data),
    windowDays,
  }
}
