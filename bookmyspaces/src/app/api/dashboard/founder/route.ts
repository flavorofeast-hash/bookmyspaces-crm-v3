// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/app/api/dashboard/founder/route.ts
// Sprint 3A — Founder Dashboard.
//
// Composes five existing (or minimally-extended) sources into one owner-
// facing view — this route deliberately contains almost no computation of
// its own; every number is reused from something that already exists:
//   - Today's Opportunities  -> getOpportunityScoreForLead() (opportunity-
//                                score.ts, Sprint 2's "Revenue Probability")
//                                + computeIntelligence() (lead-intelligence.ts,
//                                extracted unchanged from HotLeadDashboard.tsx
//                                this sprint) for Next Action.
//   - Revenue Pipeline        -> buildRevenueIntelligence().funnel
//                                (revenue-intelligence.ts) for Leads/
//                                Negotiation/Bookings; three small, genuinely
//                                new counts for Visits/Draft/Sent proposals,
//                                since the existing funnel collapses those
//                                into one "Proposal" bucket and nothing else
//                                computes that finer split.
//   - Today's Schedule        -> listSiteVisitsForDate() (site-visit-
//                                service.ts) unchanged; leads.next_follow_up_at
//                                (the same column stats/route.ts already
//                                reads for "follow-ups due"); proposals with
//                                status draft/generated as the closest real
//                                proxy for "proposal reviews" — see the
//                                proposalReviewsNote below, this is a
//                                disclosed substitution, not an invented
//                                feature (no "proposal review" scheduling
//                                concept exists anywhere in this codebase —
//                                follow_ups.type='proposal' has zero writers).
//   - AI Morning Brief        -> composed entirely from the sections above
//                                (top opportunities, visit count, proposal
//                                activity derived in-memory from the SAME
//                                proposals fetch used for the pipeline
//                                counts) — no new AI call, no new
//                                calculation. src/lib/ai-summary.ts's
//                                generateDailySummary() was considered and
//                                rejected as the reuse target: it's dormant
//                                (zero callers anywhere), keys off the
//                                legacy 1-10 ai_score/status convention this
//                                codebase has since moved on from
//                                (lead_stage / 0-100 ai_score), and fixing
//                                that drift is a redesign this sprint's brief
//                                explicitly rules out ("build only, do not
//                                redesign").
//   - Lost Revenue Summary    -> leads.lead_stage='LOST' (estimated_revenue)
//                                and proposals.status IN ('rejected','expired')
//                                (total_price) — both real, live columns.
//                                The requested reason taxonomy (No Follow-up/
//                                No Response/Price/Capacity/Other) has NO
//                                backing data anywhere in this codebase
//                                (confirmed: no lost_reason/rejection_reason
//                                column exists on leads or proposals —
//                                revenue-intelligence.ts's own
//                                ProposalAnalytics type already documents
//                                this exact gap: lostProposalReasonsAvailable:
//                                false). Only "No Follow-up" is reported,
//                                using the one real derivable proxy
//                                (follow_up_count === 0 at time of loss); the
//                                other four reasons are explicitly reported
//                                as unavailable, per "no placeholder data —
//                                identify the gap instead of inventing it."
//
// Query cost note (see MASTER_ARCHITECTURE.md's "no N+1" performance
// posture): getOpportunityScoreForLead() is a per-lead function (itself a
// small fixed number of queries). Reusing it here means the query count for
// Today's Opportunities scales with the candidate count, not O(1) — bounded
// deliberately to a maximum of OPPORTUNITY_CANDIDATE_LIMIT leads (12) to
// keep this bounded and predictable rather than unbounded. This is a real,
// disclosed tradeoff of reusing the existing per-lead scorer as-is instead
// of writing a second, bulk-optimized scoring implementation (which the
// "do not duplicate logic" rule argues against) — flagged in the Sprint 3A
// report's Remaining Gaps, not hidden.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth-guard'
import { getOpportunityScoreForLead } from '@/lib/ai/opportunity-score'
import { computeIntelligence, type LeadIntelligenceInput } from '@/lib/leads/lead-intelligence'
import { buildRevenueIntelligence } from '@/lib/analytics/revenue-intelligence'
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
  estimated_revenue: number | null
  ai_score: number | null
  lead_temperature: LeadIntelligenceInput['lead_temperature']
  lead_stage: LeadIntelligenceInput['lead_stage']
  escalation_required: boolean | null
  last_contacted_at: string | null
  next_follow_up_at: string | null
  created_at: string
}

interface RecentProposalRow {
  id: string
  lead_id: string | null
  client_name: string | null
  status: string | null
  total_price: number | null
  created_at: string
  sent_at: string | null
  first_viewed_at: string | null
}

function istDayRangeISO(offsetDays = 0): { start: string; end: string; dateLabel: string } {
  const now = new Date(Date.now() + offsetDays * 86_400_000)
  const dateLabel = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
  return { start: `${dateLabel}T00:00:00+05:30`, end: `${dateLabel}T23:59:59+05:30`, dateLabel }
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response

  const db = getSupabaseAdmin()
  const { dateLabel: today, start: todayStart, end: todayEnd } = istDayRangeISO()
  const windowDays = Number(req.nextUrl.searchParams.get('days')) || 90
  const sinceISO = new Date(Date.now() - windowDays * 86_400_000).toISOString()
  const recentSinceISO = new Date(Date.now() - 2 * 86_400_000).toISOString() // 48h, for brief "activity"

  try {
    // ── One bulk fetch each, reused across multiple sections below ─────────
    const [
      openLeadsResult,
      followUpsDueResult,
      lostLeadsResult,
      recentProposalsResult,
      visitsCountResult,
      todaysVisits,
      revenueIntelligence,
    ] = await Promise.all([
      db.from('leads')
        .select('id, name, phone, event_type, event_date, guest_count, budget, estimated_revenue, ai_score, lead_temperature, lead_stage, escalation_required, last_contacted_at, next_follow_up_at, created_at')
        .or(`lead_stage.is.null,lead_stage.not.in.(${OPEN_STAGES_EXCLUDED.join(',')})`)
        .order('ai_score', { ascending: false, nullsFirst: false })
        .limit(OPPORTUNITY_CANDIDATE_LIMIT),
      db.from('leads')
        .select('id, name, phone, next_follow_up_at, lead_stage, ai_score')
        .gte('next_follow_up_at', todayStart)
        .lte('next_follow_up_at', todayEnd)
        .order('next_follow_up_at', { ascending: true })
        .limit(50),
      db.from('leads')
        .select('id, name, estimated_revenue, follow_up_count')
        .eq('lead_stage', 'LOST')
        .gte('created_at', sinceISO),
      // Reused across Revenue Pipeline (draft/sent counts), Today's Schedule
      // (proposal reviews), AI Morning Brief (proposal activity), and Lost
      // Revenue (rejected/expired value) — one fetch, four derived views,
      // per the "fetch once, reduce in JS" convention revenue-intelligence.ts
      // itself documents as this codebase's established pattern.
      db.from('proposals')
        .select('id, lead_id, client_name, status, total_price, created_at, sent_at, first_viewed_at')
        .gte('created_at', sinceISO),
      db.from('follow_ups').select('id', { count: 'exact', head: true })
        .eq('type', 'site_visit').gte('created_at', sinceISO),
      listSiteVisitsForDate(today),
      buildRevenueIntelligence(windowDays),
    ])

    if (openLeadsResult.error) throw openLeadsResult.error
    // Secondary sections degrade to empty rather than fail the whole
    // dashboard — same "best-effort, log, don't throw" convention as
    // dashboard/operations/route.ts's occupancy section.
    for (const [label, result] of [
      ['followUpsDue', followUpsDueResult], ['lostLeads', lostLeadsResult],
      ['recentProposals', recentProposalsResult], ['visitsCount', visitsCountResult],
    ] as const) {
      if (result.error) logger.error('dashboard/founder', `${label} query failed (degraded, not fatal)`, result.error)
    }

    const openLeads = (openLeadsResult.data ?? []) as unknown as OpenLeadRow[]
    const recentProposals = (recentProposalsResult.data ?? []) as unknown as RecentProposalRow[]
    const lostLeads = (lostLeadsResult.data ?? []) as unknown as Array<{ id: string; name: string | null; estimated_revenue: number | null; follow_up_count: number | null }>

    // ── Section 1: Today's Opportunities ────────────────────────────────────
    // Latest proposal per lead, from the already-fetched recentProposals —
    // no extra query.
    const latestProposalByLead = new Map<string, RecentProposalRow>()
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

      return {
        leadId: lead.id,
        customerName: lead.name,
        eventType: lead.event_type,
        eventDate: lead.event_date,
        guestCount: lead.guest_count,
        revenueProbability: { score: opportunityScore.score, band: opportunityScore.band },
        expectedRevenue,
        expectedRevenueSource,
        nextAction: { action: intel.nextAction, label: intel.actionLabel, color: intel.actionColor },
      }
    }))

    opportunities.sort((a, b) => b.revenueProbability.score - a.revenueProbability.score)

    // ── Section 2: Revenue Pipeline ─────────────────────────────────────────
    const funnelStages = revenueIntelligence.funnel.stages
    const findStage = (name: string) => funnelStages.find((s) => s.stage === name) ?? { count: 0, revenue: 0 }

    const draftProposals = recentProposals.filter((p) => p.status === 'draft')
    const sentProposals = recentProposals.filter((p) => p.status === 'sent' || p.status === 'viewed' || p.status === 'followed_up')

    const revenuePipeline = {
      windowDays,
      leads: { count: findStage('Lead').count, revenue: findStage('Lead').revenue },
      visits: { count: visitsCountResult.count ?? 0 },
      draftProposals: { count: draftProposals.length, revenue: draftProposals.reduce((s, p) => s + (Number(p.total_price) || 0), 0) },
      sentProposals: { count: sentProposals.length, revenue: sentProposals.reduce((s, p) => s + (Number(p.total_price) || 0), 0) },
      negotiation: { count: findStage('Negotiation').count, revenue: findStage('Negotiation').revenue },
      bookings: { count: findStage('Booked').count, revenue: findStage('Booked').revenue },
      degraded: revenueIntelligence.funnel.degraded,
    }

    // ── Section 3: Today's Schedule ─────────────────────────────────────────
    const proposalReviews = recentProposals
      .filter((p) => p.status === 'draft' || p.status === 'generated')
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 20)
      .map((p) => ({ proposalId: p.id, clientName: p.client_name, status: p.status, totalPrice: p.total_price, createdAt: p.created_at }))

    const todaysSchedule = {
      siteVisits: todaysVisits.map((v) => ({
        id: v.id, time: v.scheduledAt, customerName: v.customerName, customerPhone: v.customerPhone,
        property: v.property, purpose: v.purpose, status: v.status, statusLabel: siteVisitStatusLabel(v.status),
      })),
      followUps: (followUpsDueResult.data ?? []).map((l: { id: string; name: string | null; phone: string | null; next_follow_up_at: string | null; lead_stage: string | null; ai_score: number | null }) => ({
        leadId: l.id, name: l.name, phone: l.phone, dueAt: l.next_follow_up_at, leadStage: l.lead_stage, aiScore: l.ai_score,
      })),
      proposalReviews,
      proposalReviewsNote: `No "proposal review" scheduling concept exists in this codebase (follow_ups.type='proposal' has never been written by any code path) — this list is the current draft/generated proposal backlog awaiting review, not reviews scheduled specifically for ${today}.`,
    }

    // ── Section 4: AI Morning Brief (composed, zero new calculation) ───────
    const proposalsSentRecently = recentProposals.filter((p) => p.sent_at && p.sent_at >= recentSinceISO).length
    const proposalsViewedRecently = recentProposals.filter((p) => p.first_viewed_at && p.first_viewed_at >= recentSinceISO).length
    const topOpportunities = opportunities.slice(0, 3)

    const morningBrief = {
      date: today,
      topOpportunities,
      proposalActivity: { sentLast48h: proposalsSentRecently, viewedLast48h: proposalsViewedRecently },
      visitRemindersCount: todaysSchedule.siteVisits.length,
      recommendedActions: topOpportunities.map((o) =>
        `${o.customerName ?? 'Unnamed lead'}${o.eventType ? ` (${o.eventType})` : ''} — ${o.nextAction.label} (Revenue Probability ${o.revenueProbability.score}/100)`
      ),
    }

    // ── Section 5: Lost Revenue Summary ─────────────────────────────────────
    const lostProposals = recentProposals.filter((p) => p.status === 'rejected' || p.status === 'expired')
    const lostLeadsNoFollowUp = lostLeads.filter((l) => (l.follow_up_count ?? 0) === 0)

    const lostRevenue = {
      windowDays,
      lostLeadsValue: lostLeads.reduce((s, l) => s + (Number(l.estimated_revenue) || 0), 0),
      lostLeadsCount: lostLeads.length,
      lostProposalsValue: lostProposals.reduce((s, p) => s + (Number(p.total_price) || 0), 0),
      lostProposalsCount: lostProposals.length,
      byReason: {
        noFollowUp: {
          count: lostLeadsNoFollowUp.length,
          value: lostLeadsNoFollowUp.reduce((s, l) => s + (Number(l.estimated_revenue) || 0), 0),
        },
        noResponse: null,
        price: null,
        capacity: null,
        other: null,
      },
      gapNote: 'Only "No Follow-up" is computed (proxy: follow_up_count === 0 on a LOST lead). No Response/Price/Capacity/Other are not reported (null, not zero) because no lost_reason/rejection_reason field exists on leads or proposals anywhere in this codebase — see revenue-intelligence.ts\'s ProposalAnalytics.lostProposalReasonsAvailable for the same, previously-documented gap.',
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
