// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/app/api/dashboard/founder/route.ts
// Sprint 3A — Founder Dashboard. "What should the owner do today to
// maximize revenue?"
//
// This route contains almost no computation of its own — it composes
// existing services and formats their output. The one genuinely new
// per-request logic here is: ranking a bounded candidate set of open leads
// by opportunity score, and merging three already-computed lists into one
// timeline. Every aggregate NUMBER (pipeline counts/revenue, lost revenue)
// is computed inside revenue-intelligence.ts, not here — see that file's
// "Pipeline Breakdown"/"Lost Revenue Summary" sections (added this sprint)
// for why: this route used to run its own separate proposals/follow_ups
// queries and reduce them itself, which was a second, parallel aggregation
// layer duplicating what revenue-intelligence.ts already owns. That has
// been removed; this route now reads revenueIntelligence.pipelineBreakdown/
// lostRevenue/recentProposals directly.
//
//   - Today's Opportunities  -> getOpportunityScoreForLead() (opportunity-
//                                score.ts, Sprint 2's "Revenue Probability")
//                                + computeIntelligence() (lead-intelligence.ts,
//                                extracted unchanged from HotLeadDashboard.tsx)
//                                for Next Action. Property is the linked
//                                proposal's venue (revenueIntelligence.
//                                recentProposals) when one exists, else the
//                                lead's own venue field — same "prefer the
//                                more concrete, already-committed value"
//                                precedence already used for Expected Revenue.
//   - Revenue Pipeline        -> revenueIntelligence.pipelineBreakdown,
//                                verbatim. No local aggregation.
//   - Today's Schedule        -> one merged, time-sorted timeline built from
//                                listSiteVisitsForDate() (site-visit-
//                                service.ts, unchanged), leads.
//                                next_follow_up_at (same column dashboard/
//                                stats/route.ts already reads for "follow-ups
//                                due"), and revenueIntelligence.recentProposals
//                                filtered to draft/generated (the closest real
//                                proxy for "proposal reviews" — disclosed, not
//                                invented: follow_ups.type='proposal' has
//                                never been written by any code path in this
//                                codebase, so there is no real "review
//                                scheduled at time X" to sort by; these are
//                                listed at the end of the timeline as backlog,
//                                not given a fake time).
//   - AI Morning Brief        -> composed entirely from the sections above,
//                                zero new calculation, zero new AI call —
//                                deterministic template string plus the same
//                                structured data the other cards already show.
//                                ai-summary.ts's generateDailySummary() was
//                                evaluated and rejected: dormant (zero
//                                callers), keyed to the legacy 1-10 ai_score/
//                                status convention this codebase has moved
//                                on from — fixing that drift is a redesign,
//                                out of this sprint's "build only" scope.
//   - Lost Revenue Summary    -> revenueIntelligence.lostRevenue, verbatim.
//                                Reason breakdown beyond "No Follow-up"
//                                renders as "Insufficient data" in the UI —
//                                see lostRevenue.reasonBreakdownAvailable.
//
// Query cost note (MASTER_ARCHITECTURE.md's "no N+1" posture):
// getOpportunityScoreForLead() is a per-lead function; reusing it here means
// query count scales with candidate count, not O(1). Bounded to
// OPPORTUNITY_CANDIDATE_LIMIT (12) to keep this predictable — a disclosed
// tradeoff of reusing the existing per-lead scorer as-is rather than writing
// a second, bulk-optimized implementation.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth-guard'
import { getOpportunityScoreForLead } from '@/lib/ai/opportunity-score'
import { computeIntelligence, type LeadIntelligenceInput } from '@/lib/leads/lead-intelligence'
import { buildRevenueIntelligence, type ProposalRow } from '@/lib/analytics/revenue-intelligence'
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

function istDayRangeISO(): { start: string; end: string; dateLabel: string } {
  const now = new Date()
  const dateLabel = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
  return { start: `${dateLabel}T00:00:00+05:30`, end: `${dateLabel}T23:59:59+05:30`, dateLabel }
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response

  const db = getSupabaseAdmin()
  const { dateLabel: today, start: todayStart, end: todayEnd } = istDayRangeISO()
  const windowDays = Number(req.nextUrl.searchParams.get('days')) || 90
  const recentSinceISO = new Date(Date.now() - 2 * 86_400_000).toISOString() // 48h, for brief "activity"

  try {
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
      // Single source for the pipeline counts, lost-revenue totals, and the
      // recent proposals list every other section below reads from — see
      // file header.
      buildRevenueIntelligence(windowDays),
    ])

    if (openLeadsResult.error) throw openLeadsResult.error
    if (followUpsDueResult.error) {
      logger.error('dashboard/founder', 'followUpsDue query failed (degraded, not fatal)', followUpsDueResult.error)
    }

    const openLeads = (openLeadsResult.data ?? []) as unknown as OpenLeadRow[]
    const followUpsDue = (followUpsDueResult.data ?? []) as unknown as FollowUpDueRow[]
    const recentProposals: ProposalRow[] = revenueIntelligence.recentProposals

    // ── Section 1: Today's Opportunities ────────────────────────────────────
    // Latest proposal per lead, from revenueIntelligence.recentProposals —
    // no extra query.
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

    type TimelineItem = {
      type: 'site_visit' | 'follow_up' | 'proposal_review'
      time: string | null   // ISO time-of-day when known; null for undated backlog items (proposal reviews)
      title: string
      subtitle: string
      meta: Record<string, unknown>
    }

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
      if (a.time && !b.time) return -1   // timed items first
      if (!a.time && b.time) return 1
      return 0                            // undated backlog items keep their relative (most-recent-first) order
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

    return NextResponse.json({
      today,
      todaysOpportunities: opportunities,
      revenuePipeline,
      todaysSchedule,
      morningBrief,
      lostRevenue,
    })
  } catch (error) {
    logger.error('dashboard/founder', 'GET failed', error)
    return NextResponse.json({ error: 'Failed to load founder dashboard' }, { status: 500 })
  }
}
