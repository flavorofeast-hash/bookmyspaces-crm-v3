// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/chief-of-staff/executive-brief-service.ts
// Version 3.0 — AI Chief of Staff.
//
// THIS FILE IS AN ORCHESTRATION LAYER, NOT A NEW ANALYTICS ENGINE.
// Every number here is either read verbatim from an existing service or is
// a documented, disclosed COMPOSITE of existing service outputs. Nothing in
// this file re-queries a table that revenue-intelligence.ts/founder-brief-
// service.ts/opportunity-score.ts/proposal-intelligence.ts already fetch,
// except two narrow, genuinely new gaps neither existing service covers
// (see "NEW QUERIES" below) — both are read-only, bounded, and produce
// input for a pure function (computeProposalUrgency) that already exists.
//
// REUSED VERBATIM (see docs/business/AI_CHIEF_OF_STAFF.md's Dependency Map
// for the full table):
//   - buildFounderBrief() (src/lib/founder/founder-brief-service.ts) —
//     Today's Opportunities, Revenue Pipeline, Today's Schedule, Morning
//     Brief narrative, Lost Revenue Summary, and the full RevenueIntelligence
//     result (funnel, forecast, proposalAnalytics, bookingAnalytics,
//     customerAnalytics, eventSales, channelPerformance, campaignPerformance,
//     marketingBrief).
//   - computeProposalUrgency() (src/lib/proposal-intelligence.ts) — the
//     existing, pure "is this proposal at risk / what should we do about
//     it" engine, already used by /api/proposals/intelligence. Called here
//     against a bounded, freshly-fetched set of open proposals — see
//     "NEW QUERIES" below for why a fresh call, not the persisted
//     `proposals.urgency_score` column, is used.
//
// NEW QUERIES (disclosed, not duplication — nothing existing already
// returns this):
//   1. Open proposals (status sent/viewed, not yet accepted/rejected) with
//      full lead context, for computeProposalUrgency(). No existing
//      service exports "ranked urgent proposals" as an importable
//      function — /api/proposals/intelligence's GET returns ALL proposals
//      sorted by their PERSISTED urgency_score column, which is only
//      updated when something calls its PATCH handler (not a standing
//      recompute), so it can be stale. This module recomputes fresh via
//      the same pure function instead of trusting a possibly-stale column.
//   2. user_profiles with role IN ('admin','manager') — the "who is the
//      Founder-tier audience" query, needed once (Notifications). No
//      existing service already answers "who should be notified."
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabaseAdmin } from '@/lib/supabase'
import { buildFounderBrief, type FounderBrief, type Opportunity } from '@/lib/founder/founder-brief-service'
import type { RevenueIntelligence } from '@/lib/analytics/revenue-intelligence'
import { computeProposalUrgency, type LeadSnapshot, type ProposalSnapshot, type ProposalUrgencyResult } from '@/lib/proposal-intelligence'

// ─── Shared: open-proposal urgency (feeds both Priorities and Predictive Insights) ──

export interface UrgentProposal {
  proposalId: string
  proposalNumber: string | null
  leadId: string | null
  clientName: string | null
  totalPrice: number | null
  viewedCount: number
  urgency: ProposalUrgencyResult
}

interface OpenProposalRow {
  id: string
  proposal_number: string | null
  lead_id: string | null
  client_name: string | null
  status: ProposalSnapshot['status']
  total_price: number | null
  package_name: string | null
  guest_count: number | null
  event_type: string | null
  sent_at: string | null
  first_viewed_at: string | null
  last_viewed_at: string | null
  followed_up_at: string | null
  viewed_count: number | null
  engagement_score: number | null
  created_at: string
  leads: {
    id: string
    name: string | null
    phone: string | null
    email: string | null
    event_type: string | null
    event_date: string | null
    guest_count: number | null
    budget: string | null
    venue: string | null
    ai_score: number | null
    lead_temperature: string | null
    urgency_level: string | null
    lead_stage: string | null
    estimated_revenue: number | null
    score_breakdown: Record<string, unknown> | null
  } | null
}

const OPEN_PROPOSAL_LIMIT = 60

async function fetchUrgentProposals(): Promise<{ proposals: UrgentProposal[]; degraded: boolean }> {
  try {
    const db = getSupabaseAdmin()
    const { data, error } = await db
      .from('proposals')
      .select(
        'id, proposal_number, lead_id, client_name, status, total_price, package_name, ' +
        'guest_count, event_type, sent_at, first_viewed_at, last_viewed_at, followed_up_at, ' +
        'viewed_count, engagement_score, created_at, ' +
        'leads(id, name, phone, email, event_type, event_date, guest_count, budget, venue, ai_score, lead_temperature, urgency_level, lead_stage, estimated_revenue, score_breakdown)'
      )
      .in('status', ['sent', 'viewed'])
      .order('last_viewed_at', { ascending: false, nullsFirst: false })
      .limit(OPEN_PROPOSAL_LIMIT)

    if (error) throw error
    const rows = (data ?? []) as unknown as OpenProposalRow[]

    const results: UrgentProposal[] = rows
      .filter((r) => r.leads) // computeProposalUrgency requires a lead
      .map((r) => {
        const lead: LeadSnapshot = {
          id: r.leads!.id, name: r.leads!.name, phone: r.leads!.phone, email: r.leads!.email,
          event_type: r.leads!.event_type, event_date: r.leads!.event_date, guest_count: r.leads!.guest_count,
          budget: r.leads!.budget, venue: r.leads!.venue, ai_score: r.leads!.ai_score,
          lead_temperature: r.leads!.lead_temperature, urgency_level: r.leads!.urgency_level,
          lead_stage: r.leads!.lead_stage, estimated_revenue: r.leads!.estimated_revenue,
          score_breakdown: r.leads!.score_breakdown,
        }
        const proposal: ProposalSnapshot = {
          id: r.id, status: r.status, total_price: r.total_price, package_name: r.package_name,
          guest_count: r.guest_count, event_type: r.event_type, sent_at: r.sent_at,
          first_viewed_at: r.first_viewed_at, last_viewed_at: r.last_viewed_at,
          followed_up_at: r.followed_up_at, viewed_count: r.viewed_count ?? 0,
          engagement_score: r.engagement_score ?? 0, created_at: r.created_at,
        }
        return {
          proposalId: r.id,
          proposalNumber: r.proposal_number,
          leadId: r.lead_id,
          clientName: r.client_name,
          totalPrice: r.total_price,
          viewedCount: r.viewed_count ?? 0,
          urgency: computeProposalUrgency(proposal, lead),
        }
      })
      .sort((a, b) => b.urgency.urgencyScore - a.urgency.urgencyScore)

    return { proposals: results, degraded: false }
  } catch (err) {
    console.error('[chief-of-staff] fetchUrgentProposals failed — degrading gracefully:', err)
    return { proposals: [], degraded: true }
  }
}

// ─── Business Health Score ──────────────────────────────────────────────────
// ONE 0-100 composite. Every component is read from an EXISTING calculation
// (revenue-intelligence.ts) — nothing here re-derives a metric that already
// exists elsewhere. "Response Time" (suggested in the mission brief) is
// deliberately NOT included: no aggregate, system-wide response-time metric
// exists anywhere in this codebase (only a per-lead value inside
// lead-intelligence.ts's computeIntelligence(), which isn't aggregated by
// any existing service) — adding one here would mean either inventing a new
// aggregation (against the "reuse, don't invent" rule) or scoring off a
// tiny, non-representative sample (the 12-lead Founder Dashboard candidate
// set). Excluded and disclosed, not faked.
//
// Each factor is 0-100 and independently be null ("insufficient data" —
// e.g. no decided proposals yet, no reservation history). The final score
// is the weight-normalized average of only the AVAILABLE factors: weights
// still sum to 100 across all 8 factors, but if some are unavailable the
// remaining weights are re-normalized so the score is never silently
// dragged down by missing data. `excludedFactors` discloses exactly which
// ones were left out and why, every time.

export interface BusinessHealthFactor {
  key: string
  label: string
  value: number | null // 0-100, null = insufficient data
  weight: number // out of 100
  source: string
}

export interface BusinessHealthScore {
  score: number // 0-100
  factors: BusinessHealthFactor[]
  formulaNote: string
}

export function computeBusinessHealthScore(revenueIntelligence: RevenueIntelligence): BusinessHealthScore {
  const ri = revenueIntelligence
  const qualifiedStage = ri.funnel.stages.find((s) => s.stage === 'Qualified')
  const bookedStage = ri.funnel.stages.find((s) => s.stage === 'Booked')
  const pb = ri.pipelineBreakdown

  const pipelineHealthValue = pb.leads.count > 0
    ? Math.round(((pb.negotiation.count + pb.bookings.count) / pb.leads.count) * 1000) / 10
    : null

  const proposalConversionValue = ri.proposalAnalytics.total > 0 ? ri.proposalAnalytics.acceptancePct : null

  const channelsWithVolume = ri.channelPerformance.filter((c) => c.leads > 0)
  const totalLeadsAcrossChannels = channelsWithVolume.reduce((s, c) => s + c.leads, 0)
  const marketingPerformanceValue = totalLeadsAcrossChannels > 0
    ? Math.round((channelsWithVolume.reduce((s, c) => s + c.conversionPct * c.leads, 0) / totalLeadsAcrossChannels) * 10) / 10
    : null

  // Revenue trend: last two non-degraded months in revenueByMonth (already
  // computed by computeBookingAnalytics). Flat = 50, +/-50pp clamps the
  // score to 0-100. Null if there isn't at least one full prior month of
  // real (non-zero) revenue to compare against.
  let revenueTrendValue: number | null = null
  if (!ri.bookingAnalytics.degraded && ri.bookingAnalytics.revenueByMonth.length >= 2) {
    const months = ri.bookingAnalytics.revenueByMonth
    const prev = months[months.length - 2]
    const curr = months[months.length - 1]
    if (prev.revenue > 0) {
      const pctChange = ((curr.revenue - prev.revenue) / prev.revenue) * 100
      revenueTrendValue = Math.max(0, Math.min(100, Math.round(50 + Math.max(-50, Math.min(50, pctChange)))))
    }
  }

  const followUpDisciplineValue = ri.lostRevenue.lostLeadsCount > 0
    ? Math.round((1 - ri.lostRevenue.noFollowUp.count / ri.lostRevenue.lostLeadsCount) * 1000) / 10
    : null

  const ca = ri.customerAnalytics
  const customerEngagementValue = ca.totalCustomers > 0
    ? Math.round(((ca.repeatCustomerPct + Math.max(0, 100 - (ca.dormantCustomers / ca.totalCustomers) * 100)) / 2) * 10) / 10
    : null

  const factors: BusinessHealthFactor[] = [
    { key: 'leadQuality', label: 'Lead Quality', value: qualifiedStage?.conversionFromPreviousPct ?? null, weight: 15, source: 'Sales Funnel — Lead→Qualified conversion% (revenue-intelligence.ts computeFunnel)' },
    { key: 'pipelineHealth', label: 'Pipeline Health', value: pipelineHealthValue, weight: 15, source: 'Pipeline Breakdown — share of leads in Negotiation or Booked (revenue-intelligence.ts computePipelineBreakdown)' },
    { key: 'proposalConversion', label: 'Proposal Conversion', value: proposalConversionValue, weight: 15, source: 'Proposal Analytics — acceptance% (revenue-intelligence.ts computeProposalAnalytics)' },
    { key: 'bookingConversion', label: 'Booking Conversion', value: bookedStage?.conversionFromPreviousPct ?? null, weight: 15, source: 'Sales Funnel — Negotiation→Booked conversion% (revenue-intelligence.ts computeFunnel)' },
    { key: 'marketingPerformance', label: 'Marketing Performance', value: marketingPerformanceValue, weight: 10, source: 'Channel Performance — leads-weighted avg conversion% (revenue-intelligence.ts computeChannelPerformance, Version 2.1)' },
    { key: 'revenueTrend', label: 'Revenue Trend', value: revenueTrendValue, weight: 10, source: 'Booking Analytics — month-over-month revenue change, clamped ±50pp around a flat=50 baseline (revenue-intelligence.ts computeBookingAnalytics)' },
    { key: 'followUpDiscipline', label: 'Follow-up Discipline', value: followUpDisciplineValue, weight: 10, source: 'Lost Revenue Summary — inverse of leads lost specifically due to zero follow-ups (revenue-intelligence.ts computeLostRevenue)' },
    { key: 'customerEngagement', label: 'Customer Engagement', value: customerEngagementValue, weight: 10, source: 'Customer Analytics — avg of repeat-customer% and non-dormant% (revenue-intelligence.ts computeCustomerAnalytics)' },
  ]

  const available = factors.filter((f) => f.value !== null)
  const totalWeight = available.reduce((s, f) => s + f.weight, 0)
  const score = totalWeight > 0
    ? Math.round(available.reduce((s, f) => s + f.weight * (f.value as number), 0) / totalWeight)
    : 0

  return {
    score,
    factors,
    formulaNote: totalWeight === 100
      ? 'Weighted average of all 8 factors (weights sum to 100).'
      : `Weighted average of ${available.length}/8 available factors (weights re-normalized to ${totalWeight}/100 — ${8 - available.length} factor(s) lack sufficient data this window and were excluded, not fabricated).`,
  }
}

// ─── Today's Priorities ──────────────────────────────────────────────────────
// Ranked using EXISTING signals only: opportunity-score.ts's Revenue
// Probability + lead-intelligence.ts's urgencyScore (via founder-brief-
// service.ts's todaysOpportunities), proposal-intelligence.ts's
// computeProposalUrgency() (via fetchUrgentProposals above), and
// founder-brief-service.ts's followUpsDue. No new scoring logic — this
// function only ranks and formats, using each source's own number.

export interface PriorityItem {
  id: string
  title: string
  reason: string
  urgencyScore: number
  category: 'opportunity' | 'proposal' | 'follow_up'
  expectedRevenue: number | null
  leadId: string | null
  proposalId: string | null
}

function fmtINR(n: number): string {
  return `₹${Math.round(n).toLocaleString('en-IN')}`
}

export function computeTodaysPriorities(founderBrief: FounderBrief, urgentProposals: UrgentProposal[], limit = 10): PriorityItem[] {
  const items: PriorityItem[] = []

  for (const o of founderBrief.todaysOpportunities) {
    items.push({
      id: `opportunity:${o.leadId}`,
      title: `${o.nextAction.label} — ${o.customerName ?? 'Unnamed lead'}`,
      reason: [
        o.eventType ? `${o.eventType} enquiry` : 'Open lead',
        o.guestCount ? `${o.guestCount} guests` : null,
        `Revenue Probability ${o.revenueProbability.score}/100 (${o.revenueProbability.band})`,
        o.expectedRevenue != null ? `Expected ${fmtINR(o.expectedRevenue)}` : null,
      ].filter(Boolean).join('. ') + '.',
      urgencyScore: o.urgencyScore,
      category: 'opportunity',
      expectedRevenue: o.expectedRevenue,
      leadId: o.leadId,
      proposalId: null,
    })
  }

  for (const p of urgentProposals) {
    if (!p.urgency.followUpRequired && !p.urgency.resendRecommended && !p.urgency.escalationRequired) continue
    items.push({
      id: `proposal:${p.proposalId}`,
      title: `${p.urgency.actionLabel} — Proposal${p.proposalNumber ? ` #${p.proposalNumber}` : ''}${p.clientName ? ` (${p.clientName})` : ''}`,
      reason: `${p.viewedCount > 0 ? `Viewed ${p.viewedCount} time${p.viewedCount === 1 ? '' : 's'}. ` : ''}${p.urgency.recommendation}`,
      urgencyScore: p.urgency.urgencyScore,
      category: 'proposal',
      expectedRevenue: p.totalPrice,
      leadId: p.leadId,
      proposalId: p.proposalId,
    })
  }

  const opportunityLeadIds = new Set(founderBrief.todaysOpportunities.map((o) => o.leadId))
  for (const f of founderBrief.followUpsDue) {
    if (opportunityLeadIds.has(f.id)) continue // already represented above, don't double-list the same lead
    items.push({
      id: `follow_up:${f.id}`,
      title: `Follow Up — ${f.name ?? 'Unnamed lead'}`,
      reason: `Follow-up due today${f.lead_stage ? ` — ${f.lead_stage}` : ''}.`,
      urgencyScore: f.ai_score ?? 40,
      category: 'follow_up',
      expectedRevenue: null,
      leadId: f.id,
      proposalId: null,
    })
  }

  return items.sort((a, b) => b.urgencyScore - a.urgencyScore).slice(0, limit)
}

// ─── Predictive Insights ─────────────────────────────────────────────────────
// Every value is read directly from an existing computed field, or is a
// single, disclosed arithmetic composition of two existing fields (e.g.
// Likely Bookings = forecast ÷ avg proposal value). Never a fabricated
// number — "Insufficient data" is returned wherever the underlying
// calculation doesn't exist or has no real data to work from.

export interface PredictiveInsights {
  expectedRevenue: { value: number; note: string }
  revenueAtRisk: { value: number; note: string }
  likelyBookings: { value: number; note: string } | { value: null; note: 'Insufficient data' }
  highValueCustomers: { count: number; thresholdINR: number }
  customersNeedingAttention: { count: number; thresholdDays: number }
  campaignsLikelyToPerform: { name: string; conversionPct: number } | { name: null; note: 'Insufficient data' }
  packagesLikelyToSell: { name: string; revenue: number } | { name: null; note: 'Insufficient data' }
}

export function computePredictiveInsights(revenueIntelligence: RevenueIntelligence, urgentProposals: UrgentProposal[]): PredictiveInsights {
  const ri = revenueIntelligence

  const revenueAtRiskValue = urgentProposals
    .filter((p) => p.urgency.followUpRequired || p.urgency.resendRecommended || p.urgency.escalationRequired)
    .reduce((s, p) => s + (p.totalPrice ?? 0), 0)

  const likelyBookings = ri.proposalAnalytics.avgProposalValue > 0
    ? { value: Math.round(ri.forecast.pipelineForecast / ri.proposalAnalytics.avgProposalValue), note: 'Pipeline forecast ÷ average proposal value (revenue-intelligence.ts) — a rough count estimate, not a per-deal prediction.' }
    : ({ value: null, note: 'Insufficient data' } as const)

  const namedCampaigns = ri.campaignPerformance.rows.filter((c) => c.key !== 'Organic / No Campaign' && !c.key.startsWith('Attribution Unavailable') && c.leads >= 3)
  const topCampaign = [...namedCampaigns].sort((a, b) => b.conversionPct - a.conversionPct)[0]
  const campaignsLikelyToPerform = topCampaign
    ? { name: topCampaign.key, conversionPct: topCampaign.conversionPct }
    : ({ name: null, note: 'Insufficient data' } as const)

  const topPackage = ri.eventSales.revenueByPackage[0]
  const packagesLikelyToSell = topPackage && topPackage.revenue > 0
    ? { name: topPackage.key, revenue: topPackage.revenue }
    : ({ name: null, note: 'Insufficient data' } as const)

  return {
    expectedRevenue: { value: ri.forecast.totalForecast, note: ri.forecast.methodologyNote },
    revenueAtRisk: { value: revenueAtRiskValue, note: 'Sum of open proposals (sent/viewed, not yet accepted) flagged by proposal-intelligence.ts as needing follow-up, a resend, or escalation.' },
    likelyBookings,
    highValueCustomers: { count: ri.customerAnalytics.highValueCustomers, thresholdINR: ri.customerAnalytics.highValueThresholdINR },
    customersNeedingAttention: { count: ri.customerAnalytics.dormantCustomers, thresholdDays: ri.customerAnalytics.dormantThresholdDays },
    campaignsLikelyToPerform,
    packagesLikelyToSell,
  }
}

// ─── AI Recommendations ──────────────────────────────────────────────────────
// Specific, named, grounded in real IDs/names — never generic. Reuses
// marketingBrief's own budget/business recommendations (already specific)
// and adds lead/proposal-specific ones from the real top priority items.

export function computeAIRecommendations(priorities: PriorityItem[], revenueIntelligence: RevenueIntelligence): string[] {
  const recs: string[] = []
  const topPriority = priorities[0]
  if (topPriority) recs.push(topPriority.title.replace(' — ', ': ') + (topPriority.expectedRevenue != null ? ` (${fmtINR(topPriority.expectedRevenue)} expected).` : '.'))

  const topProposal = priorities.find((p) => p.category === 'proposal' && p.id !== topPriority?.id)
  if (topProposal) recs.push(topProposal.title.replace(' — ', ': ') + '.')

  const mb = revenueIntelligence.marketingBrief
  if (mb.budgetRecommendation) recs.push(mb.budgetRecommendation)
  if (mb.businessRecommendation && mb.businessRecommendation !== mb.budgetRecommendation) recs.push(mb.businessRecommendation)

  const topPackage = revenueIntelligence.eventSales.revenueByPackage[0]
  if (topPackage && topPackage.revenue > 0) recs.push(`Promote "${topPackage.key}" — your top revenue-generating package (${fmtINR(topPackage.revenue)}).`)

  return recs.filter((r, i) => recs.indexOf(r) === i) // dedupe, preserve order
}

// ─── Business Risks & Opportunities ──────────────────────────────────────────

export function computeBusinessRisks(revenueIntelligence: RevenueIntelligence): string[] {
  const ri = revenueIntelligence
  const risks: string[] = []

  if (ri.lostRevenue.lostLeadsValue > 0) {
    risks.push(`${fmtINR(ri.lostRevenue.lostLeadsValue)} in leads lost this window (${ri.lostRevenue.lostLeadsCount} leads).`)
  }
  if (ri.lostRevenue.noFollowUp.count > 0) {
    risks.push(`${ri.lostRevenue.noFollowUp.count} leads lost specifically due to zero follow-ups (${fmtINR(ri.lostRevenue.noFollowUp.value)}).`)
  }
  if (ri.bookingAnalytics.occupancyPct !== null && ri.bookingAnalytics.occupancyPct >= 85) {
    risks.push(`Capacity is at ${ri.bookingAnalytics.occupancyPct}% — near full, confirm availability before quoting new dates.`)
  }
  const strugglingChannels = ri.channelPerformance.filter((c) => c.leads >= 5 && c.conversionPct < 5)
  for (const c of strugglingChannels.slice(0, 2)) {
    risks.push(`"${c.key}" channel is converting below 5% (${c.leads} leads, ${c.conversionPct}%).`)
  }
  if (ri.bookingAnalytics.cancellationPct >= 15 && ri.bookingAnalytics.totalBookings > 0) {
    risks.push(`Cancellation rate is ${ri.bookingAnalytics.cancellationPct}% this window.`)
  }

  return risks
}

export function computeBusinessOpportunities(revenueIntelligence: RevenueIntelligence, urgentProposals: UrgentProposal[]): string[] {
  const ri = revenueIntelligence
  const opportunities: string[] = []

  const closeableNow = urgentProposals.filter((p) => p.urgency.nextAction === 'close_deal')
  if (closeableNow.length > 0) {
    opportunities.push(`${closeableNow.length} proposal${closeableNow.length === 1 ? '' : 's'} just viewed — best time to call and close.`)
  }
  if (ri.customerAnalytics.repeatCustomerPct > 0) {
    opportunities.push(`${ri.customerAnalytics.repeatCustomerPct}% repeat-customer rate — reach out to past customers for referrals/repeat bookings.`)
  }
  const topChannel = [...ri.channelPerformance].filter((c) => c.leads >= 3).sort((a, b) => b.conversionPct - a.conversionPct)[0]
  if (topChannel) {
    opportunities.push(`"${topChannel.key}" is converting at ${topChannel.conversionPct}% — your best-performing channel this window.`)
  }
  const topEventType = ri.eventSales.revenueByEventType[0]
  if (topEventType && topEventType.revenue > 0) {
    opportunities.push(`"${topEventType.key}" is your top revenue event type (${fmtINR(topEventType.revenue)}) — lean into this in outreach and marketing.`)
  }

  return opportunities
}

// ─── Business Summaries (for the "never open five dashboards" view) ────────
// Thin, disclosed formatting over existing fields — no new numbers.

export interface ExecutiveSummaries {
  business: string
  revenue: string
  lead: string
  proposal: string
  booking: string
  marketing: string
  customer: string
  siteVisit: string
}

export function computeExecutiveSummaries(founderBrief: FounderBrief, healthScore: BusinessHealthScore): ExecutiveSummaries {
  const ri = founderBrief.revenueIntelligence
  const leadStage = ri.funnel.stages.find((s) => s.stage === 'Lead')

  return {
    business: `Business Health: ${healthScore.score}/100. ${founderBrief.morningBrief.narrative}`,
    revenue: `Expected forecast ${fmtINR(ri.forecast.totalForecast)} (${ri.forecast.historicalAcceptancePct}% historical acceptance rate). Lost this window: ${fmtINR(ri.lostRevenue.lostLeadsValue + ri.lostRevenue.lostProposalsValue)}.`,
    lead: `${leadStage?.count ?? 0} leads this window. ${founderBrief.openLeadsCandidateCount} currently open and ranked.`,
    proposal: `${ri.proposalAnalytics.total} proposals, ${ri.proposalAnalytics.acceptancePct}% acceptance, avg value ${fmtINR(ri.proposalAnalytics.avgProposalValue)}.`,
    booking: ri.bookingAnalytics.degraded
      ? 'Booking data is not live in this environment yet.'
      : `${ri.bookingAnalytics.totalBookings} bookings, ${ri.bookingAnalytics.occupancyPct ?? '—'}% occupancy, ${ri.bookingAnalytics.cancellationPct}% cancellation rate.`,
    marketing: `Highest revenue channel: ${ri.marketingBrief.highestRevenueChannel ?? 'Not enough data yet'}. Lowest conversion: ${ri.marketingBrief.lowestConversionChannel ?? 'Not enough data yet'}.`,
    customer: `${ri.customerAnalytics.totalCustomers} customers, ${ri.customerAnalytics.repeatCustomerPct}% repeat, ${ri.customerAnalytics.highValueCustomers} high-value, ${ri.customerAnalytics.dormantCustomers} dormant.`,
    siteVisit: `${founderBrief.todaysSchedule.counts.siteVisits} site visits today.`,
  }
}

// ─── Top-level orchestrator ──────────────────────────────────────────────────

export interface ExecutiveBrief {
  date: string
  windowDays: number
  businessHealthScore: BusinessHealthScore
  summaries: ExecutiveSummaries
  todaysPriorities: PriorityItem[]
  predictiveInsights: PredictiveInsights
  aiRecommendations: string[]
  businessRisks: string[]
  businessOpportunities: string[]
  // Passed through so the page can render existing, already-computed
  // sections (Revenue Pipeline, Today's Schedule, Marketing Dashboard
  // fields, Conversion Funnel) without a second fetch.
  founderBrief: FounderBrief
  urgentProposalsDegraded: boolean
  // Exposed so notification-producer.ts (Notifications, Version 3.0) can
  // reuse the exact same freshly-computed urgency results instead of
  // running fetchUrgentProposals() a second time.
  urgentProposals: UrgentProposal[]
}

export async function buildExecutiveBrief(windowDays = 90): Promise<ExecutiveBrief> {
  const founderBrief = await buildFounderBrief(windowDays)
  const { proposals: urgentProposals, degraded: urgentProposalsDegraded } = await fetchUrgentProposals()

  const businessHealthScore = computeBusinessHealthScore(founderBrief.revenueIntelligence)
  const todaysPriorities = computeTodaysPriorities(founderBrief, urgentProposals)
  const predictiveInsights = computePredictiveInsights(founderBrief.revenueIntelligence, urgentProposals)
  const aiRecommendations = computeAIRecommendations(todaysPriorities, founderBrief.revenueIntelligence)
  const businessRisks = computeBusinessRisks(founderBrief.revenueIntelligence)
  const businessOpportunities = computeBusinessOpportunities(founderBrief.revenueIntelligence, urgentProposals)
  const summaries = computeExecutiveSummaries(founderBrief, businessHealthScore)

  return {
    date: founderBrief.today,
    windowDays,
    businessHealthScore,
    summaries,
    todaysPriorities,
    predictiveInsights,
    aiRecommendations,
    businessRisks,
    businessOpportunities,
    founderBrief,
    urgentProposalsDegraded,
    urgentProposals,
  }
}
