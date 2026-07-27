// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/ai/opportunity-score.ts
// AI Sales Executive (Priority 1) — "AI Opportunity Score".
//
// A single 0-100 sales-priority score per lead, combining signals that
// already exist elsewhere in the codebase rather than inventing new ones:
//   - Qualification  -> leads.ai_score (src/lib/lead-scorer.ts, now live —
//                        see src/lib/whatsapp/auto-qualify.ts). This already
//                        blends event type, guest count, date urgency,
//                        budget, and source, so "budget fit" and "timeline"
//                        are NOT re-derived as separate components here —
//                        that would double-count the same signal.
//   - Proposal status -> proposals.status/accepted_at for this lead.
//   - Follow-up history -> leads.follow_up_count / escalation_required.
//   - Customer history / CLV / repeat customer -> src/lib/customers/
//                        lifetime-value.ts's computeLifetimeValue(), reused
//                        unchanged (same double-counting-safe revenue logic
//                        already shipped for the Customer Profile page).
//
// Deterministic and transparent by design (same reasoning as lead-scorer.ts):
// a "reasoning" array documents exactly how every point was awarded, so this
// is auditable by a human, not an opaque LLM guess — appropriate for
// something that will drive sales-team prioritization.
//
// WEIGHTS ARE AN ENGINEERING DEFAULT, NOT A CLAIMED BUSINESS POLICY: the
// four component weights (40/20/15/15 + 10 repeat bonus, see below) are a
// reasonable starting split that keeps qualification (the most-validated,
// most-tested existing signal) as the largest component. If the business
// wants different weighting, that's a tuning decision for whoever owns
// sales process, not something this module claims final authority over.
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
}

export interface OpportunityScoreResult {
  score: number                       // 0-100
  band: 'HIGH' | 'MEDIUM' | 'LOW'
  components: {
    qualification: number             // /40
    proposalStatus: number            // /20
    followUpEngagement: number        // /15
    customerValue: number             // /15
    repeatCustomerBonus: number       // /10
  }
  reasoning: string[]
}

export function computeOpportunityScore(input: OpportunityScoreInput): OpportunityScoreResult {
  const reasoning: string[] = []

  // ── Qualification (0-40) — directly scaled from the existing ai_score ────
  const qualification = Math.round(((input.aiScore ?? 0) / 100) * 40)
  reasoning.push(`+${qualification}/40 qualification (ai_score ${input.aiScore ?? 0}/100)`)

  // ── Proposal status (0-20) ────────────────────────────────────────────────
  let proposalStatus = 8
  if (input.hasAcceptedProposal) { proposalStatus = 20; reasoning.push('+20/20 has an accepted proposal — actively converting'); }
  else if (input.hasSentProposal) { proposalStatus = 12; reasoning.push('+12/20 proposal sent, awaiting decision'); }
  else if (input.hasOnlyRejectedProposal) { proposalStatus = 2; reasoning.push('+2/20 only rejected proposals on file'); }
  else { reasoning.push('+8/20 no proposal yet — early stage'); }

  // ── Follow-up engagement (0-15) ───────────────────────────────────────────
  let followUpEngagement = 5
  if (input.escalationRequired) { followUpEngagement = 15; reasoning.push('+15/15 flagged for escalation — needs attention now'); }
  else if (input.followUpCount >= 1 && input.followUpCount <= 3) { followUpEngagement = 8; reasoning.push(`+8/15 being actively followed up (${input.followUpCount} so far)`); }
  else if (input.followUpCount > 3) { followUpEngagement = 3; reasoning.push(`+3/15 ${input.followUpCount} follow-ups with no resolution yet — may be stalling`); }
  else { reasoning.push('+5/15 no follow-up activity yet'); }

  // ── Customer value / CLV (0-15) ───────────────────────────────────────────
  let customerValue = 0
  if (input.clvTotalRevenue >= 300_000) { customerValue = 15; reasoning.push(`+15/15 lifetime value ₹${input.clvTotalRevenue.toLocaleString('en-IN')} (≥3L)`); }
  else if (input.clvTotalRevenue >= 100_000) { customerValue = 12; reasoning.push(`+12/15 lifetime value ₹${input.clvTotalRevenue.toLocaleString('en-IN')} (1-3L)`); }
  else if (input.clvTotalRevenue >= 20_000) { customerValue = 8; reasoning.push(`+8/15 lifetime value ₹${input.clvTotalRevenue.toLocaleString('en-IN')} (20k-1L)`); }
  else if (input.clvTotalRevenue > 0) { customerValue = 4; reasoning.push(`+4/15 lifetime value ₹${input.clvTotalRevenue.toLocaleString('en-IN')} (<20k)`); }
  else { reasoning.push('+0/15 no revenue history yet'); }

  // ── Repeat customer bonus (0 or 10) ───────────────────────────────────────
  const repeatCustomerBonus = input.isRepeatCustomer ? 10 : 0
  if (input.isRepeatCustomer) reasoning.push('+10/10 repeat customer bonus');

  const rawScore = qualification + proposalStatus + followUpEngagement + customerValue + repeatCustomerBonus
  const score = Math.max(0, Math.min(100, rawScore))
  reasoning.push(`Total: ${rawScore} → clamped to ${score}/100`)

  const band: 'HIGH' | 'MEDIUM' | 'LOW' = score >= 70 ? 'HIGH' : score >= 40 ? 'MEDIUM' : 'LOW'

  return {
    score,
    band,
    components: { qualification, proposalStatus, followUpEngagement, customerValue, repeatCustomerBonus },
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

    const [leadResult, proposalsResult, clv] = await Promise.all([
      db.from('leads').select('ai_score, escalation_required, follow_up_count').eq('id', leadId).maybeSingle(),
      db.from('proposals').select('status, accepted_at').eq('lead_id', leadId),
      computeLifetimeValue(leadId),
    ])

    const lead = (leadResult.data ?? null) as unknown as LeadRow | null
    const proposals = ((proposalsResult.data ?? []) as unknown as ProposalStatusRow[])

    const hasAcceptedProposal = proposals.some((p) => p.accepted_at !== null)
    const hasSentProposal = !hasAcceptedProposal && proposals.some((p) => p.status === 'sent')
    const hasOnlyRejectedProposal = !hasAcceptedProposal && !hasSentProposal && proposals.length > 0 &&
      proposals.every((p) => p.status === 'rejected')
    const hasNoProposal = proposals.length === 0

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
    })
  } catch (err) {
    console.error(`[opportunity-score] Failed to score lead ${leadId}:`, err)
    return {
      score: 0,
      band: 'LOW',
      components: { qualification: 0, proposalStatus: 0, followUpEngagement: 0, customerValue: 0, repeatCustomerBonus: 0 },
      reasoning: ['[ERROR] Could not compute — insufficient data or a lookup failed'],
    }
  }
}
