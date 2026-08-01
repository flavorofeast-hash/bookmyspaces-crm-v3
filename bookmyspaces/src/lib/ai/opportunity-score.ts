// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/ai/opportunity-score.ts
// AI Sales Executive (Priority 1) — "AI Opportunity Score".
// Sprint 2 (Revenue Conversion Engine) — reused as the "Revenue Probability"
// score for the Visit -> Proposal Draft pipeline. Per the Sprint 2 brief
// ("if existing lead scoring can be reused, extend it — do not create
// duplicate logic"), this is that extension: no second, parallel scoring
// module was written. lead-scorer.ts was considered and rejected as the
// extension target because it is a different, intake-time concern (see its
// own header) — it scores a lead once from static fields at creation time,
// and does not take engagement/downstream signals at all.
//
// A single 0-100 sales-priority / conversion-probability score per lead,
// combining signals that already exist elsewhere in the codebase rather
// than inventing new ones:
//   - Qualification    -> leads.ai_score (src/lib/lead-scorer.ts, now live —
//                        see src/lib/whatsapp/auto-qualify.ts). This already
//                        blends event type, guest count, date urgency,
//                        budget, and source, so "budget fit" and "timeline"
//                        are NOT re-derived as separate components here —
//                        that would double-count the same signal.
//   - Proposal status  -> proposals.status/accepted_at for this lead.
//   - Follow-up history -> leads.follow_up_count / escalation_required.
//   - Customer history / CLV / repeat customer -> src/lib/customers/
//                        lifetime-value.ts's computeLifetimeValue(), reused
//                        unchanged (same double-counting-safe revenue logic
//                        already shipped for the Customer Profile page).
//   - Site visit engagement (Sprint 2) -> follow_ups (type='site_visit',
//                        status='completed') for this lead — a completed
//                        in-person visit is one of the strongest revenue
//                        signals this business has, per the Sprint 2 brief.
//   - Proposal engagement (Sprint 2) -> proposals.first_viewed_at for this
//                        lead (migration 010, written by
//                        POST /api/proposals/track-view) — a customer who
//                        has opened their proposal is meaningfully more
//                        likely to convert than one who hasn't.
//
// Deterministic and transparent by design (same reasoning as lead-scorer.ts):
// a "reasoning" array documents exactly how every point was awarded, so this
// is auditable by a human, not an opaque LLM guess — appropriate for
// something that will drive sales-team prioritization.
//
// WEIGHTS ARE AN ENGINEERING DEFAULT, NOT A CLAIMED BUSINESS POLICY: the
// seven component weights (30/15/10/10/5 + 15/15, see below) are a
// reasonable starting split that keeps qualification (the most-validated,
// most-tested existing signal) as the largest single component, while
// giving the two new Sprint 2 engagement signals real weight (15 each) —
// the whole point of Sprint 2 is that a completed visit and a viewed
// proposal should visibly move an opportunity's priority. If the business
// wants different weighting, that's a tuning decision for whoever owns
// sales process, not something this module claims final authority over.
// Sprint 1's existing five components were rebalanced (not removed) to make
// room for the two new ones so the total still sums to 100 — this changes
// the numeric score for existing callers (the Customer Profile page), which
// is the intended, minimal effect of "extend the existing score," not a
// silent behavior change to hide.
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabaseAdmin } from '@/lib/supabase'
import { computeLifetimeValue } from '@/lib/customers/lifetime-value'

export interface OpportunityScoreInput {
  aiScore: number | null              // leads.ai_score, 0-100
  hasAcceptedProposal: boolean
  hasSentProposal: boolean            // sent but not (yet) accepted
  hasOnlyRejectedProposal: boolean
  hasNoProposal: boolean
  escalationRequired: boolean
  followUpCount: number
  clvTotalRevenue: number
  isRepeatCustomer: boolean
  hasCompletedVisit: boolean          // Sprint 2 — follow_ups type='site_visit' status='completed'
  hasViewedProposal: boolean          // Sprint 2 — proposals.first_viewed_at is not null
}

export interface OpportunityScoreResult {
  score: number                       // 0-100
  band: 'HIGH' | 'MEDIUM' | 'LOW'
  components: {
    qualification: number             // /30
    proposalStatus: number            // /15
    followUpEngagement: number        // /10
    customerValue: number             // /10
    repeatCustomerBonus: number       // /5
    siteVisitEngagement: number       // /15 — Sprint 2
    proposalEngagement: number        // /15 — Sprint 2
  }
  reasoning: string[]
}

export function computeOpportunityScore(input: OpportunityScoreInput): OpportunityScoreResult {
  const reasoning: string[] = []

  // ── Qualification (0-30) — directly scaled from the existing ai_score ────
  const qualification = Math.round(((input.aiScore ?? 0) / 100) * 30)
  reasoning.push(`+${qualification}/30 qualification (ai_score ${input.aiScore ?? 0}/100)`)

  // ── Proposal status (0-15) ────────────────────────────────────────────────
  let proposalStatus = 6
  if (input.hasAcceptedProposal) { proposalStatus = 15; reasoning.push('+15/15 has an accepted proposal — actively converting'); }
  else if (input.hasSentProposal) { proposalStatus = 9; reasoning.push('+9/15 proposal sent, awaiting decision'); }
  else if (input.hasOnlyRejectedProposal) { proposalStatus = 1; reasoning.push('+1/15 only rejected proposals on file'); }
  else { reasoning.push('+6/15 no proposal yet — early stage'); }

  // ── Follow-up engagement (0-10) ───────────────────────────────────────────
  let followUpEngagement = 3
  if (input.escalationRequired) { followUpEngagement = 10; reasoning.push('+10/10 flagged for escalation — needs attention now'); }
  else if (input.followUpCount >= 1 && input.followUpCount <= 3) { followUpEngagement = 6; reasoning.push(`+6/10 being actively followed up (${input.followUpCount} so far)`); }
  else if (input.followUpCount > 3) { followUpEngagement = 2; reasoning.push(`+2/10 ${input.followUpCount} follow-ups with no resolution yet — may be stalling`); }
  else { reasoning.push('+3/10 no follow-up activity yet'); }

  // ── Customer value / CLV (0-10) ───────────────────────────────────────────
  let customerValue = 0
  if (input.clvTotalRevenue >= 300_000) { customerValue = 10; reasoning.push(`+10/10 lifetime value ₹${input.clvTotalRevenue.toLocaleString('en-IN')} (≥3L)`); }
  else if (input.clvTotalRevenue >= 100_000) { customerValue = 8; reasoning.push(`+8/10 lifetime value ₹${input.clvTotalRevenue.toLocaleString('en-IN')} (1-3L)`); }
  else if (input.clvTotalRevenue >= 20_000) { customerValue = 5; reasoning.push(`+5/10 lifetime value ₹${input.clvTotalRevenue.toLocaleString('en-IN')} (20k-1L)`); }
  else if (input.clvTotalRevenue > 0) { customerValue = 2; reasoning.push(`+2/10 lifetime value ₹${input.clvTotalRevenue.toLocaleString('en-IN')} (<20k)`); }
  else { reasoning.push('+0/10 no revenue history yet'); }

  // ── Repeat customer bonus (0 or 5) ────────────────────────────────────────
  const repeatCustomerBonus = input.isRepeatCustomer ? 5 : 0
  if (input.isRepeatCustomer) reasoning.push('+5/5 repeat customer bonus');

  // ── Site visit engagement (0 or 15) — Sprint 2 ────────────────────────────
  const siteVisitEngagement = input.hasCompletedVisit ? 15 : 0
  if (input.hasCompletedVisit) reasoning.push('+15/15 completed a site visit — strong buying signal');
  else reasoning.push('+0/15 no completed site visit yet');

  // ── Proposal engagement (0 or 15) — Sprint 2 ──────────────────────────────
  const proposalEngagement = input.hasViewedProposal ? 15 : 0
  if (input.hasViewedProposal) reasoning.push('+15/15 has opened/viewed a proposal');
  else reasoning.push('+0/15 no proposal view recorded yet');

  const rawScore = qualification + proposalStatus + followUpEngagement + customerValue
    + repeatCustomerBonus + siteVisitEngagement + proposalEngagement
  const score = Math.max(0, Math.min(100, rawScore))
  reasoning.push(`Total: ${rawScore} → clamped to ${score}/100`)

  const band: 'HIGH' | 'MEDIUM' | 'LOW' = score >= 70 ? 'HIGH' : score >= 40 ? 'MEDIUM' : 'LOW'

  return {
    score,
    band,
    components: {
      qualification, proposalStatus, followUpEngagement, customerValue,
      repeatCustomerBonus, siteVisitEngagement, proposalEngagement,
    },
    reasoning,
  }
}

interface LeadRow {
  ai_score: number | null
  escalation_required: boolean | null
  follow_up_count: number | null
}

interface ProposalStatusRow {
  status: string | null
  accepted_at: string | null
  first_viewed_at: string | null
}

/**
 * Assembles OpportunityScoreInput for a real lead from existing tables and
 * scores it. Best-effort — a failure anywhere returns a LOW-band zero score
 * with a note, never throws, matching this codebase's established
 * fault-tolerance convention for optional/enrichment features.
 */
export async function getOpportunityScoreForLead(leadId: string): Promise<OpportunityScoreResult> {
  try {
    const db = getSupabaseAdmin()

    const [leadResult, proposalsResult, clv, visitResult] = await Promise.all([
      db.from('leads').select('ai_score, escalation_required, follow_up_count').eq('id', leadId).maybeSingle(),
      db.from('proposals').select('status, accepted_at, first_viewed_at').eq('lead_id', leadId),
      computeLifetimeValue(leadId),
      // Sprint 2 — Site visit engagement signal, reusing the same
      // follow_ups/type='site_visit' shape site-visit-service.ts already
      // reads/writes; no new table, no new query pattern.
      db.from('follow_ups').select('id', { count: 'exact', head: true })
        .eq('lead_id', leadId).eq('type', 'site_visit').eq('status', 'completed'),
    ])

    const lead = (leadResult.data ?? null) as unknown as LeadRow | null
    const proposals = ((proposalsResult.data ?? []) as unknown as ProposalStatusRow[])

    const hasAcceptedProposal = proposals.some((p) => p.accepted_at !== null)
    const hasSentProposal = !hasAcceptedProposal && proposals.some((p) => p.status === 'sent')
    const hasOnlyRejectedProposal = !hasAcceptedProposal && !hasSentProposal && proposals.length > 0 &&
      proposals.every((p) => p.status === 'rejected')
    const hasNoProposal = proposals.length === 0
    const hasViewedProposal = proposals.some((p) => p.first_viewed_at !== null)
    const hasCompletedVisit = (visitResult.count ?? 0) > 0

    return computeOpportunityScore({
      aiScore: lead?.ai_score ?? null,
      hasAcceptedProposal,
      hasSentProposal,
      hasOnlyRejectedProposal,
      hasNoProposal,
      escalationRequired: lead?.escalation_required ?? false,
      followUpCount: lead?.follow_up_count ?? 0,
      clvTotalRevenue: clv.totalRevenue,
      isRepeatCustomer: clv.isRepeatCustomer,
      hasCompletedVisit,
      hasViewedProposal,
    })
  } catch (err) {
    console.error(`[opportunity-score] Failed to score lead ${leadId}:`, err)
    return {
      score: 0,
      band: 'LOW',
      components: {
        qualification: 0, proposalStatus: 0, followUpEngagement: 0, customerValue: 0,
        repeatCustomerBonus: 0, siteVisitEngagement: 0, proposalEngagement: 0,
      },
      reasoning: ['[ERROR] Could not compute — insufficient data or a lookup failed'],
    }
  }
}
