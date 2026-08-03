// src/lib/leads/pipeline-service.ts
// ─────────────────────────────────────────────────────────────────────────────
// Batched (non-N+1) data access for the derived Lead Business Pipeline.
//
// Two entry points:
//   fetchLeadsPipelinePage()   — one page of leads (Lead Management table),
//                                 with derived stage attached per row.
//   fetchPipelineDashboardStats() — pipeline-wide counts for the Dashboard.
//
// Query-count discipline (the mission's explicit performance requirement):
//   fetchLeadsPipelinePage    — always exactly 4 queries total (1 leads page +
//                                3 `.in(pageLeadIds)` lookups), regardless of
//                                how many leads exist in the table. Page size
//                                is fixed (PAGE_SIZE from the caller), so this
//                                is O(1) in total lead count — the same 4
//                                queries at 20 leads or 20,000+ leads.
//   fetchPipelineDashboardStats — never selects full `leads` rows for all
//                                leads. It queries proposals / follow_ups /
//                                reservations directly (each table is bounded
//                                by how many leads have actually reached that
//                                stage, not by total lead count), derives the
//                                per-lead winning stage in memory from those
//                                small sets, and only re-touches `leads` for
//                                two narrow `.in(id-subset)` revenue lookups
//                                plus a single `count: 'exact', head: true`
//                                total. No full-table lead scan.
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabaseAdmin } from '@/lib/supabase'
import type { Lead } from '@/modules/leads/types'
import {
  deriveBusinessStage,
  type DerivedBusinessStage,
  type ProposalForStage,
  type VisitForStage,
  type ReservationForStage,
} from './pipeline-stage'

// ─── Page fetch (Lead Management table) ────────────────────────────────────

// Row shapes for the three per-page lookups, built from the existing
// pipeline-stage.ts interfaces via intersection (adds only the FK column
// each select actually includes). Named so they can be passed as explicit
// generic arguments to groupBy() below — groupBy() infers T from two
// interdependent parameters (`rows: T[]` and `key: keyof T`), and letting
// inference run unpinned was resolving T to the bare `Record<string,
// unknown>` constraint instead of the real row type, which is why
// leadProposals/leadVisits/leadReservations (and property reads like
// `.created_at`/`.scheduled_at` on their elements) were coming back
// as `Record<string, unknown>[]` / `unknown` instead of these types.
type ProposalPipelineRow = ProposalForStage & { lead_id: string }
type VisitPipelineRow = VisitForStage & { lead_id: string }
type ReservationPipelineRow = ReservationForStage & { customer_id: string; created_at: string }

export interface LeadWithPipeline extends Lead {
  businessStage: DerivedBusinessStage
  primaryProposal: ProposalForStage | null
  proposalCount: number
  hasScheduledVisit: boolean
  hasCompletedVisit: boolean
  latestVisitStatus: string | null
  latestVisitId: string | null
  hasActiveReservation: boolean
  hasCancelledReservation: boolean
  hasAnyReservation: boolean
  reservationStatus: string | null
  reservationId: string | null
  pipelineValue: number
  /** Most recent of lead.updated_at / any proposal / any visit / any
   *  reservation touching this lead — not part of deriveBusinessStage's
   *  pure logic (that function only needs the *winning* record per rung),
   *  computed separately here from the same already-fetched rows. */
  lastActivityAt: string | null
}

export interface FetchLeadsPipelinePageParams {
  limit: number
  offset: number
  search?: string | null
  status?: string | null
  source?: string | null
}

export interface FetchLeadsPipelinePageResult {
  leads: LeadWithPipeline[]
  total: number
}

// TS2344 fix: `T extends Record<string, unknown>` required every row type to
// satisfy an index-signature type — interfaces without one (VisitForStage-
// and ReservationForStage-based row types) don't. T doesn't need that
// constraint at all: the function only ever needs to know that `key` is a
// real key of `T`, which a second generic parameter (`K extends keyof T`)
// expresses directly, with the runtime `typeof k !== 'string'` check still
// doing the actual narrowing/validation. Same behavior, correct constraint.
// TS2558 fix: call sites supply only the first type argument (e.g.
// `groupBy<ProposalPipelineRow>(rows, 'lead_id')`) to keep T pinned to the
// real row type (see prior round's TS2802/inference-collapse fix) rather
// than letting T be inferred from context. TypeScript doesn't allow partial
// explicit type arguments without a default for the rest, so K needs one.
// Defaulting K to `keyof T` doesn't narrow away from the real key type —
// it's simply the widest valid value for K, and the runtime check on `k`
// still does the real narrowing — so this is a pure signature fix.
function groupBy<T, K extends keyof T = keyof T>(rows: T[], key: K): Record<string, T[]> {
  const out: Record<string, T[]> = {}
  for (const row of rows) {
    const k = row[key]
    if (typeof k !== 'string' || !k) continue
    if (!out[k]) out[k] = []
    out[k].push(row)
  }
  return out
}

export async function fetchLeadsPipelinePage(
  params: FetchLeadsPipelinePageParams
): Promise<FetchLeadsPipelinePageResult> {
  const db = getSupabaseAdmin()
  const { limit, offset, search, status, source } = params

  // 1. One page of leads — same filter/paging semantics as GET /api/leads,
  //    so switching a consumer over changes nothing about search/pagination.
  let query = db
    .from('leads')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + Math.max(limit, 1) - 1)

  if (status && status !== 'all') query = query.eq('status', status)
  if (source && source !== 'all') query = query.eq('source', source)
  if (search && search.trim()) {
    const safeSearch = search.trim().replace(/[,()]/g, '')
    query = query.or(
      `name.ilike.%${safeSearch}%,phone.ilike.%${safeSearch}%,email.ilike.%${safeSearch}%,event_type.ilike.%${safeSearch}%`
    )
  }

  const { data: leadsRaw, error, count } = await query
  if (error) throw error

  // Cast through `unknown` first (TS2352 — this client has no Database
  // generic, so `.select()` results don't sufficiently overlap with our own
  // interfaces for a direct `as`). Same pattern already used in
  // src/app/api/dashboard/stats/route.ts. Casting the whole array up front
  // — rather than annotating the .map() callback parameter — also avoids a
  // TS2345 mismatch between that annotation and the array's actual inferred
  // element type.
  const leadsTyped = (leadsRaw ?? []) as unknown as Lead[]
  const leads: Lead[] = leadsTyped.map((l) =>
    l.status === 'new' ? { ...l, status: 'new_inquiry' } : l
  )

  const leadIds = leads.map((l) => l.id)
  if (leadIds.length === 0) {
    return { leads: [], total: count ?? 0 }
  }

  // 2. Exactly three more queries, each scoped to THIS page's lead ids only.
  const [proposalsRes, visitsRes, reservationsRes] = await Promise.all([
    db
      .from('proposals')
      .select('id, proposal_number, share_token, status, total_price, created_at, lead_id')
      .in('lead_id', leadIds),
    db
      .from('follow_ups')
      .select('id, status, scheduled_at, lead_id')
      .eq('type', 'site_visit')
      .in('lead_id', leadIds),
    db.from('reservations').select('id, status, customer_id, created_at').in('customer_id', leadIds),
  ])

  if (proposalsRes.error) throw proposalsRes.error
  if (visitsRes.error) throw visitsRes.error
  if (reservationsRes.error) throw reservationsRes.error

  const proposalRows = (proposalsRes.data ?? []) as unknown as ProposalPipelineRow[]
  const visitRows = (visitsRes.data ?? []) as unknown as VisitPipelineRow[]
  const reservationRows = (reservationsRes.data ?? []) as unknown as ReservationPipelineRow[]

  // Explicit generic argument — see the ProposalPipelineRow/etc. comment
  // above for why relying on inference alone left these typed as
  // Record<string, unknown>[].
  const proposalsByLead = groupBy<ProposalPipelineRow>(proposalRows, 'lead_id')
  const visitsByLead = groupBy<VisitPipelineRow>(visitRows, 'lead_id')
  const reservationsByLead = groupBy<ReservationPipelineRow>(reservationRows, 'customer_id')

  const withPipeline: LeadWithPipeline[] = leads.map((lead) => {
    const leadProposals = proposalsByLead[lead.id] ?? []
    const leadVisits = visitsByLead[lead.id] ?? []
    const leadReservations = reservationsByLead[lead.id] ?? []

    const derived = deriveBusinessStage({
      lead,
      proposals: leadProposals,
      visits: leadVisits,
      reservations: leadReservations,
    })

    return {
      ...lead,
      businessStage: derived.stage,
      primaryProposal: derived.primaryProposal,
      proposalCount: derived.proposalCount,
      hasScheduledVisit: derived.hasScheduledVisit,
      hasCompletedVisit: derived.hasCompletedVisit,
      // Prefer the pending visit's id/status (what Reschedule/Complete act
      // on); fall back to the completed one only when nothing is pending.
      latestVisitStatus: (derived.scheduledVisit ?? derived.completedVisit)?.status ?? null,
      latestVisitId: (derived.scheduledVisit ?? derived.completedVisit)?.id ?? null,
      hasActiveReservation: derived.hasActiveReservation,
      hasCancelledReservation: derived.hasCancelledReservation,
      hasAnyReservation: derived.hasAnyReservation,
      reservationStatus: derived.reservationStatus,
      reservationId: derived.reservationId,
      pipelineValue: derived.primaryProposal?.total_price ?? lead.estimated_revenue ?? 0,
      lastActivityAt: latestTimestamp([
        lead.updated_at,
        ...leadProposals.map((p) => p.created_at),
        ...leadVisits.map((v) => v.scheduled_at),
        ...leadReservations.map((r) => r.created_at),
      ]),
    }
  })

  return { leads: withPipeline, total: count ?? 0 }
}

function latestTimestamp(values: (string | null | undefined)[]): string | null {
  let latest: string | null = null
  for (const v of values) {
    if (!v) continue
    if (!latest || new Date(v) > new Date(latest)) latest = v
  }
  return latest
}

// ─── Dashboard-wide aggregate stats ────────────────────────────────────────

// Row shapes for each query below, built from the existing interfaces
// (ProposalForStage/ReservationForStage from pipeline-stage.ts, Lead from
// modules/leads/types.ts) via Pick/intersection rather than any/inline
// redeclaration — each matches exactly the columns actually selected.
type ProposalStatsRow = Pick<ProposalForStage, 'status' | 'total_price' | 'created_at'> & { lead_id: string }
type VisitLeadRow = { lead_id: string }
type ReservationStatsRow = Pick<ReservationForStage, 'status'> & { customer_id: string }
type LeadRevenueRow = Pick<Lead, 'id' | 'estimated_revenue'>
type LeadCreatedRow = Pick<Lead, 'id' | 'created_at'>

export interface PipelineDashboardStats {
  total_leads: number
  new_leads: number
  proposal_draft: number
  proposal_sent: number
  won: number
  visits_scheduled: number
  confirmed: number
  pipeline_value: number
  confirmed_revenue: number
  conversion_rate: number
  average_proposal_value: number
  average_time_to_proposal_days: number | null
}

export async function fetchPipelineDashboardStats(): Promise<PipelineDashboardStats> {
  const db = getSupabaseAdmin()

  // Bounded by activity volume (proposals/visits/reservations rows), never by
  // total lead count — no `select('*')`/full-row scan over `leads` here.
  const [totalRes, proposalsRes, visitsRes, reservationsRes] = await Promise.all([
    db.from('leads').select('id', { count: 'exact', head: true }),
    db.from('proposals').select('lead_id, status, total_price, created_at'),
    db.from('follow_ups').select('lead_id').eq('type', 'site_visit').eq('status', 'pending'),
    db.from('reservations').select('customer_id, status'),
  ])

  if (totalRes.error) throw totalRes.error
  if (proposalsRes.error) throw proposalsRes.error
  if (visitsRes.error) throw visitsRes.error
  if (reservationsRes.error) throw reservationsRes.error

  const totalLeads = totalRes.count ?? 0

  // Cast through `unknown` first (TS2352 — see fetchLeadsPipelinePage's
  // header note) and do it once per query, up front, so every downstream
  // .filter()/.map() below reads a properly-typed row instead of the raw,
  // untyped Supabase result (which is also what caused the TS2345/TS2322
  // errors on individual property accesses like `r.status`/`r.customer_id`).
  const proposalRows = (proposalsRes.data ?? []) as unknown as ProposalStatsRow[]
  const visitRows = (visitsRes.data ?? []) as unknown as VisitLeadRow[]
  const reservationRows = (reservationsRes.data ?? []) as unknown as ReservationStatsRow[]

  const activeReservationLeadIds = new Set(
    reservationRows
      .filter((r) => ['confirmed', 'checked_in', 'checked_out'].includes(r.status))
      .map((r) => r.customer_id)
      .filter((id): id is string => !!id)
  )

  const proposalsByLead = groupBy<ProposalStatsRow>(proposalRows, 'lead_id')
  const acceptedLeadIds = new Set(
    Object.keys(proposalsByLead).filter((id) => proposalsByLead[id].some((p) => p.status === 'accepted'))
  )
  const sentLeadIds = new Set(
    Object.keys(proposalsByLead).filter((id) =>
      proposalsByLead[id].some((p) => ['sent', 'viewed', 'followed_up'].includes(p.status))
    )
  )
  const draftLeadIds = new Set(
    Object.keys(proposalsByLead).filter((id) =>
      proposalsByLead[id].some((p) => ['draft', 'generated'].includes(p.status))
    )
  )
  const visitLeadIds = new Set(
    visitRows.map((v) => v.lead_id).filter((id): id is string => !!id)
  )

  // Apply the SAME priority ladder as deriveBusinessStage, per lead, over
  // these small sets — never over all 20,000+ leads.
  const counted = new Set<string>()
  let confirmedCount = 0
  let wonCount = 0
  let sentCount = 0
  let draftCount = 0
  let visitCount = 0

  // TS2802 fix: Set has no for...of/spread support at this project's
  // TypeScript target without downlevelIteration (not enabled, and
  // tsconfig must not change) — use .forEach()/Array.from() instead,
  // same semantics (continue -> return).
  activeReservationLeadIds.forEach((id) => {
    confirmedCount++
    counted.add(id)
  })
  acceptedLeadIds.forEach((id) => {
    if (counted.has(id)) return
    wonCount++
    counted.add(id)
  })
  sentLeadIds.forEach((id) => {
    if (counted.has(id)) return
    sentCount++
    counted.add(id)
  })
  draftLeadIds.forEach((id) => {
    if (counted.has(id)) return
    draftCount++
    counted.add(id)
  })
  visitLeadIds.forEach((id) => {
    if (counted.has(id)) return
    visitCount++
    counted.add(id)
  })

  const newLeadsCount = Math.max(0, totalLeads - counted.size)

  // Revenue lookups — each `.in()` call is bounded by the (small) id sets
  // above, not by total lead count.
  const openPipelineIds = [
    ...Array.from(draftLeadIds),
    ...Array.from(sentLeadIds),
    ...Array.from(visitLeadIds),
    ...wonIdsNotConfirmed(acceptedLeadIds, activeReservationLeadIds),
  ]
  const confirmedIds = Array.from(activeReservationLeadIds)

  // Leads that have at least one proposal — needed to look up each lead's
  // created_at for "average time to proposal". Bounded by proposal volume,
  // never by total lead count.
  const leadIdsWithProposals = Object.keys(proposalsByLead)

  // .in() with an empty array is a valid, cheap no-op query (returns no
  // rows) — simpler and more type-stable than branching on array length.
  const [openRevenueRes, confirmedRevenueRes, leadsWithProposalsRes] = await Promise.all([
    db.from('leads').select('id, estimated_revenue').in('id', openPipelineIds),
    db.from('leads').select('id, estimated_revenue').in('id', confirmedIds),
    db.from('leads').select('id, created_at').in('id', leadIdsWithProposals),
  ])

  if (openRevenueRes.error) throw openRevenueRes.error
  if (confirmedRevenueRes.error) throw confirmedRevenueRes.error
  if (leadsWithProposalsRes.error) throw leadsWithProposalsRes.error

  // Same cast-through-`unknown` pattern as above (TS2352), reusing Lead via
  // Pick rather than redeclaring these shapes inline.
  const openRevenueRows = (openRevenueRes.data ?? []) as unknown as LeadRevenueRow[]
  const confirmedRevenueRows = (confirmedRevenueRes.data ?? []) as unknown as LeadRevenueRow[]
  const leadsWithProposalsRows = (leadsWithProposalsRes.data ?? []) as unknown as LeadCreatedRow[]

  const pipelineValue = openRevenueRows.reduce((s, r) => s + (r.estimated_revenue ?? 0), 0)
  const confirmedRevenue = confirmedRevenueRows.reduce((s, r) => s + (r.estimated_revenue ?? 0), 0)

  const conversionRate = totalLeads > 0 ? Math.round((confirmedCount / totalLeads) * 100) : 0

  // Average Proposal Value — mean total_price across every fetched proposal
  // (already in memory, no extra query).
  const proposalPrices = proposalRows
    .map((p) => p.total_price)
    .filter((v): v is number => typeof v === 'number')
  const averageProposalValue = proposalPrices.length > 0
    ? Math.round(proposalPrices.reduce((s, v) => s + v, 0) / proposalPrices.length)
    : 0

  // Average Time to Proposal — mean days between a lead's created_at and its
  // EARLIEST proposal's created_at, across leads that have at least one
  // proposal. leadCreatedById is bounded by leadIdsWithProposals.length, not
  // total lead count. Explicit tuple return type on the map callback (TS2345
  // — without it, `[l.id, l.created_at]` widens to `string[]`, not the
  // `[string, string]` tuple the Map constructor's overload expects).
  const leadCreatedById = new Map(
    leadsWithProposalsRows.map((l): [string, string] => [l.id, l.created_at])
  )
  const daysToFirstProposal: number[] = []
  for (const leadId of leadIdsWithProposals) {
    const leadCreatedAt = leadCreatedById.get(leadId)
    if (!leadCreatedAt) continue
    const earliestProposal = proposalsByLead[leadId].reduce((a, b) =>
      new Date(a.created_at) < new Date(b.created_at) ? a : b
    )
    const days = (new Date(earliestProposal.created_at).getTime() - new Date(leadCreatedAt).getTime()) / 86_400_000
    if (days >= 0) daysToFirstProposal.push(days)
  }
  const averageTimeToProposalDays = daysToFirstProposal.length > 0
    ? Math.round((daysToFirstProposal.reduce((s, d) => s + d, 0) / daysToFirstProposal.length) * 10) / 10
    : null

  return {
    total_leads: totalLeads,
    new_leads: newLeadsCount,
    proposal_draft: draftCount,
    proposal_sent: sentCount,
    won: wonCount,
    visits_scheduled: visitCount,
    confirmed: confirmedCount,
    pipeline_value: pipelineValue,
    confirmed_revenue: confirmedRevenue,
    conversion_rate: conversionRate,
    average_proposal_value: averageProposalValue,
    average_time_to_proposal_days: averageTimeToProposalDays,
  }
}

// Won leads (accepted proposal) that do NOT also have an active reservation
// — those are already counted under Confirmed and must not be double-counted
// into "open pipeline value".
function wonIdsNotConfirmed(accepted: Set<string>, confirmed: Set<string>): string[] {
  return Array.from(accepted).filter((id) => !confirmed.has(id))
}
