// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/founder/founder-brief-service.ts
// Version 3.0 (AI Chief of Staff) — extraction, not new logic.
//
// buildFounderBrief() previously lived only inline inside
// src/app/api/dashboard/founder/route.ts's GET handler. Moved here unchanged
// (same queries, same composition of getOpportunityScoreForLead()/
// computeIntelligence()/listSiteVisitsForDate()/buildRevenueIntelligence(),
// same "route/service compute, page renders" split every other dashboard in
// this codebase already follows) so a SECOND caller — the new Chief of
// Staff orchestration layer — can reuse the exact same Today's Opportunities
// ranking, Revenue Pipeline, Today's Schedule, and Lost Revenue Summary
// instead of re-deriving a second, competing computation. This is the same
// "no duplicate logic" rule that already justified extracting
// computeIntelligence() out of HotLeadDashboard.tsx (see lead-intelligence.ts's
// own header) and pipelineBreakdown/lostRevenue into revenue-intelligence.ts
// (Sprint 3A revision) — applied here one level up, now that a second real
// caller exists.
//
// dashboard/founder/route.ts now just calls this and returns the same JSON
// shape as before — zero behavior change for the existing Founder Dashboard
// page. The one addition is `revenueIntelligence` on the returned object:
// the FULL RevenueIntelligence result (funnel, forecast, proposalAnalytics,
// bookingAnalytics, customerAnalytics, eventSales, channelPerformance,
// campaignPerformance, marketingBrief, etc.) that this function already
// computes internally via buildRevenueIntelligence() — exposed so the Chief
// of Staff can read it without a second, redundant fetch (10 bulk queries
// re-run for no reason). founder/route.ts's HTTP response deliberately does
// NOT forward this new field — its public API contract is unchanged.
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabaseAdmin } from '@/lib/supabase'
import { getOpportunityScoreForLead } from '@/lib/ai/opportunity-score'
import { computeIntelligence, type LeadIntelligenceInput } from '@/lib/leads/lead-intelligence'
import { buildRevenueIntelligence, type ProposalRow, type RevenueIntelligence } from '@/lib/analytics/revenue-intelligence'
import { listSiteVisitsForDate, siteVisitStatusLabel } from '@/lib/visits/site-visit-service'

const OPPORTUNITY_CANDIDATE_LIMIT = 12
const OPEN_STAGES_EXCLUDED = ['CONFIRMED', 'LOST']

interface OpenLeadRow {
  id: string
  name: string | null
  phone: string | null
  event_type: string | null
  event_date: string | null
  guest_count: number | null
  budget: string | null
  venue: string | null
  estimated_revenue: number | null
  ai_score: number | null
  lead_temperature: LeadIntelligenceInput['lead_temperature']
  lead_stage: LeadIntelligenceInput['lead_stage']
  escalation_required: boolean | null
  last_contacted_at: string | null
  next_follow_up_at: string | null
  created_at: string
}

interface FollowUpDueRow {
  id: string
  name: string | null
  phone: string | null
  next_follow_up_at: string | null
  lead_stage: string | null
  ai_score: number | null
}

export interface Opportunity {
  leadId: string
  customerName: string | null
  eventType: string | null
  eventDate: string | null
  guestCount: number | null
  property: string | null
  revenueProbability: { score: number; band: 'HIGH' | 'MEDIUM' | 'LOW' }
  expectedRevenue: number | null
  expectedRevenueSource: 'proposal' | 'estimated' | 'none'
  nextAction: { action: string; label: string; color: string }
  // Version 3.0 (Chief of Staff) — computeIntelligence() already produces
  // this (0-100 priority sort value); previously computed and discarded
  // here. Exposed additively so the Chief of Staff can rank "Today's
  // Priorities" by the SAME urgency value lead-intelligence.ts already
  // owns, instead of re-deriving priority from revenueProbability.score
  // alone (a different, narrower signal — see opportunity-score.ts).
  urgencyScore: number
}

export type TimelineItem = {
  type: 'site_visit' | 'follow_up' | 'proposal_review'
  time: string | null
  title: string
  subtitle: string
  meta: Record<string, unknown>
}

export interface FounderBrief {
  today: string
  todaysOpportunities: Opportunity[]
  revenuePipeline: RevenueIntelligence['pipelineBreakdown'] & { degraded: boolean }
  todaysSchedule: {
    timeline: TimelineItem[]
    counts: { siteVisits: number; followUps: number; proposalReviews: number }
    proposalReviewsNote: string
  }
  morningBrief: {
    date: string
    narrative: string
    topOpportunities: Opportunity[]
    potentialRevenue: number
    immediateAttentionCount: number
    proposalActivity: { sentLast48h: number; viewedLast48h: number }
    visitRemindersCount: number
    recommendedActions: string[]
  }
  lostRevenue: RevenueIntelligence['lostRevenue'] & {
    byReason: {
      noFollowUp: { count: number; value: number }
      noResponse: 'Insufficient data'
      price: 'Insufficient data'
      capacity: 'Insufficient data'
      other: 'Insufficient data'
    }
  }
  // Exposed for the Chief of Staff (Version 3.0) and any future second
  // caller — the full, already-computed Revenue Intelligence result. Not
  // part of dashboard/founder/route.ts's HTTP response (see file header).
  revenueIntelligence: RevenueIntelligence
  followUpsDue: FollowUpDueRow[]
  openLeadsCandidateCount: number
}

function istDayRangeISO(): { start: string; end: string; dateLabel: string } {
  const now = new Date()
  const dateLabel = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
  return { start: `${dateLabel}T00:00:00+05:30`, end: `${dateLabel}T23:59:59+05:30`, dateLabel }
}

export async function buildFounderBrief(windowDays = 90): Promise<FounderBrief> {
  const db = getSupabaseAdmin()
  const { dateLabel: today, start: todayStart, end: todayEnd } = istDayRangeISO()
  const recentSinceISO = new Date(Date.now() - 2 * 86_400_000).toISOString() // 48h, for brief "activity"

  const [openLeadsResult, followUpsDueResult, todaysVisits, revenueIntelligence] = await Promise.all([
    db.from('leads')
      .select('id, name, phone, event_type, event_date, guest_count, budget, venue, estimated_revenue, ai_score, lead_temperature, lead_stage, escalation_required, last_contacted_at, next_follow_up_at, created_at')
      .or(`lead_stage.is.null,lead_stage.not.in.(${OPEN_STAGES_EXCLUDED.join(',')})`)
      .order('ai_score', { ascending: false, nullsFirst: false })
      .limit(OPPORTUNITY_CANDIDATE_LIMIT),
    db.from('leads')
      .select('id, name, phone, next_follow_up_at, lead_stage, ai_score')
      .gte('next_follow_up_at', todayStart)
      .lte('next_follow_up_at', todayEnd)
      .order('next_follow_up_at', { ascending: true })
      .limit(50),
    listSiteVisitsForDate(today),
    buildRevenueIntelligence(windowDays),
  ])

  if (openLeadsResult.error) throw openLeadsResult.error
  // followUpsDueResult failing is degraded, not fatal — same tolerance the
  // original route handler used.

  const openLeads = (openLeadsResult.data ?? []) as unknown as OpenLeadRow[]
  const followUpsDue = (followUpsDueResult.data ?? []) as unknown as FollowUpDueRow[]
  const recentProposals: ProposalRow[] = revenueIntelligence.recentProposals

  // ── Section 1: Today's Opportunities ────────────────────────────────────
  const latestProposalByLead = new Map<string, ProposalRow>()
  for (const p of recentProposals) {
    if (!p.lead_id) continue
    const existing = latestProposalByLead.get(p.lead_id)
    if (!existing || p.created_at > existing.created_at) latestProposalByLead.set(p.lead_id, p)
  }

  const opportunities = await Promise.all(openLeads.map(async (lead) => {
    const opportunityScore = await getOpportunityScoreForLead(lead.id)
    const intel = computeIntelligence({
      created_at: lead.created_at,
      last_contacted_at: lead.last_contacted_at,
      ai_score: lead.ai_score,
      lead_temperature: lead.lead_temperature,
      lead_stage: lead.lead_stage,
      escalation_required: lead.escalation_required ?? false,
      next_follow_up_at: lead.next_follow_up_at,
    })
    const linkedProposal = latestProposalByLead.get(lead.id) ?? null
    const expectedRevenue = linkedProposal?.total_price ?? lead.estimated_revenue ?? null
    const expectedRevenueSource: 'proposal' | 'estimated' | 'none' =
      linkedProposal?.total_price != null ? 'proposal' : lead.estimated_revenue != null ? 'estimated' : 'none'
    const property = linkedProposal?.venue ?? lead.venue ?? null

    return {
      leadId: lead.id,
      customerName: lead.name,
      eventType: lead.event_type,
      eventDate: lead.event_date,
      guestCount: lead.guest_count,
      property,
      revenueProbability: { score: opportunityScore.score, band: opportunityScore.band },
      expectedRevenue,
      expectedRevenueSource,
      nextAction: { action: intel.nextAction, label: intel.actionLabel, color: intel.actionColor },
      urgencyScore: intel.urgencyScore,
    }
  }))

  opportunities.sort((a, b) => b.revenueProbability.score - a.revenueProbability.score)

  // ── Section 2: Revenue Pipeline — read verbatim, no local aggregation ──
  const revenuePipeline = { ...revenueIntelligence.pipelineBreakdown, degraded: revenueIntelligence.funnel.degraded }

  // ── Section 3: Today's Schedule — one merged timeline ───────────────────
  const proposalReviewRows = recentProposals
    .filter((p) => p.status === 'draft' || p.status === 'generated')
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 15)

  const timeline: TimelineItem[] = [
    ...todaysVisits.map((v): TimelineItem => ({
      type: 'site_visit', time: v.scheduledAt,
      title: v.customerName ?? 'Unnamed customer',
      subtitle: `Site visit — ${v.property ?? 'property TBD'}${v.purpose ? ` (${v.purpose})` : ''}`,
      meta: { id: v.id, customerPhone: v.customerPhone, status: v.status, statusLabel: siteVisitStatusLabel(v.status) },
    })),
    ...followUpsDue.map((f): TimelineItem => ({
      type: 'follow_up', time: f.next_follow_up_at,
      title: f.name ?? 'Unnamed lead',
      subtitle: `Follow-up due${f.lead_stage ? ` — ${f.lead_stage}` : ''}`,
      meta: { leadId: f.id, phone: f.phone, aiScore: f.ai_score },
    })),
    ...proposalReviewRows.map((p): TimelineItem => ({
      type: 'proposal_review', time: null,
      title: p.client_name ?? 'Unnamed client',
      subtitle: `Proposal awaiting review — ${p.status}`,
      meta: { proposalId: p.id, totalPrice: p.total_price },
    })),
  ].sort((a, b) => {
    if (a.time && b.time) return a.time.localeCompare(b.time)
    if (a.time && !b.time) return -1
    if (!a.time && b.time) return 1
    return 0
  })

  const todaysSchedule = {
    timeline,
    counts: { siteVisits: todaysVisits.length, followUps: followUpsDue.length, proposalReviews: proposalReviewRows.length },
    proposalReviewsNote: `No "proposal review" scheduling concept exists in this codebase (follow_ups.type='proposal' has never been written by any code path) — proposal review items are the current draft/generated backlog, not reviews scheduled specifically for ${today}, and are listed without a time.`,
  }

  // ── Section 4: AI Morning Brief — composed, zero new calculation ───────
  const proposalsSentRecently = recentProposals.filter((p) => p.sent_at && p.sent_at >= recentSinceISO).length
  const proposalsViewedRecently = recentProposals.filter((p) => p.first_viewed_at && p.first_viewed_at >= recentSinceISO).length
  const topOpportunities = opportunities.slice(0, 3)
  const immediateAttention = opportunities.filter((o) => o.nextAction.action === 'call_immediately' || o.nextAction.action === 're_engage')
  const potentialRevenue = opportunities.reduce((s, o) => s + (o.expectedRevenue ?? 0), 0)

  const narrativeLines: string[] = [`Good Morning. Here's where things stand for ${today}.`]
  narrativeLines.push(
    topOpportunities.length > 0
      ? `Today's highest priority opportunities are ${topOpportunities.map((o) => o.customerName ?? 'an unnamed lead').join(', ')}.`
      : 'There are no open opportunities to prioritize right now.'
  )
  narrativeLines.push(`Potential revenue across ${opportunities.length} open opportunities is ${potentialRevenue > 0 ? `about ₹${Math.round(potentialRevenue).toLocaleString('en-IN')}` : 'not yet estimated for most of them'}.`)
  narrativeLines.push(
    immediateAttention.length > 0
      ? `${immediateAttention.length} customer${immediateAttention.length === 1 ? '' : 's'} need immediate action: ${immediateAttention.slice(0, 5).map((o) => o.customerName ?? 'unnamed').join(', ')}.`
      : 'No customer is currently flagged for immediate action.'
  )
  narrativeLines.push(`${proposalsViewedRecently} proposal${proposalsViewedRecently === 1 ? ' was' : 's were'} viewed and ${proposalsSentRecently} sent in the last 48 hours.`)
  narrativeLines.push(`${todaysVisits.length} site visit${todaysVisits.length === 1 ? ' is' : 's are'} scheduled today.`)

  const morningBrief = {
    date: today,
    narrative: narrativeLines.join(' '),
    topOpportunities,
    potentialRevenue,
    immediateAttentionCount: immediateAttention.length,
    proposalActivity: { sentLast48h: proposalsSentRecently, viewedLast48h: proposalsViewedRecently },
    visitRemindersCount: todaysVisits.length,
    recommendedActions: topOpportunities.map((o) =>
      `${o.customerName ?? 'Unnamed lead'}${o.eventType ? ` (${o.eventType})` : ''} — ${o.nextAction.label} (Revenue Probability ${o.revenueProbability.score}/100)`
    ),
  }

  // ── Section 5: Lost Revenue Summary — read verbatim, no local aggregation ──
  const lr = revenueIntelligence.lostRevenue
  const lostRevenue = {
    windowDays: lr.windowDays,
    lostLeadsValue: lr.lostLeadsValue,
    lostLeadsCount: lr.lostLeadsCount,
    lostProposalsValue: lr.lostProposalsValue,
    lostProposalsCount: lr.lostProposalsCount,
    noFollowUp: lr.noFollowUp,
    byReason: {
      noFollowUp: lr.noFollowUp,
      noResponse: 'Insufficient data' as const,
      price: 'Insufficient data' as const,
      capacity: 'Insufficient data' as const,
      other: 'Insufficient data' as const,
    },
    reasonBreakdownAvailable: lr.reasonBreakdownAvailable,
    gapNote: lr.gapNote,
  }

  return {
    today,
    todaysOpportunities: opportunities,
    revenuePipeline,
    todaysSchedule,
    morningBrief,
    lostRevenue,
    revenueIntelligence,
    followUpsDue,
    openLeadsCandidateCount: openLeads.length,
  }
}
