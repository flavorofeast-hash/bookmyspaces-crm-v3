// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/analytics/marketing-ai.ts
// Phase 2 (Social + WhatsApp Growth) — Phase D: AI Marketing.
//
// Campaign ROI, Channel Performance, Customer Lifetime Value, and Revenue
// Opportunities already exist (revenue-intelligence.ts / growth-
// intelligence.ts) — this file adds exactly the genuinely missing pieces:
// WhatsApp Analytics, Customers Likely To Book, Customers Likely To Churn,
// and Next Best Action. Social Analytics reuses metrics-service.ts's
// getEngagementSummary() unchanged (composed at the route level, not
// duplicated here).
//
// Same architectural decision as growth-intelligence.ts: every score here
// is deterministic and auditable (a documented formula over real signals),
// NOT a live LLM call — this is dashboard-scale, portfolio-level scoring
// where cost/latency/determinism matter more than free-text nuance, exactly
// the precedent this codebase already established for AI Growth
// Intelligence and the AI Morning/Marketing Briefs.
//
// "Customers likely to book" reuses src/lib/ai/opportunity-score.ts's
// getOpportunityScoreForLead() (already a deterministic conversion-
// probability score) rather than inventing a second, parallel model.
// "Customers likely to churn" is genuinely new — no churn concept existed
// anywhere in this codebase before this file (confirmed by a full-codebase
// grep). "Next Best Action" derives its recommendation from the SAME
// opportunity-score components already computed for the likely-to-book
// pass, so scoring a candidate lead once serves both lists.
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabaseAdmin } from '@/lib/supabase'
import { buildSegment } from '@/lib/campaigns'
import { getOpportunityScoreForLead, type OpportunityScoreResultWithFlags } from '@/lib/ai/opportunity-score'

// ── WhatsApp Analytics ───────────────────────────────────────────────────────

export interface WhatsAppAnalytics {
  windowDays: number
  sent: number
  received: number
  delivered: number
  read: number
  failed: number
  deliveryRatePct: number | null   // delivered / sent, of messages with a known status
  readRatePct: number | null       // read / delivered
  note: string
}

/**
 * Aggregate WhatsApp send/delivery/read volume over a bounded window.
 * Delivery/read counts depend on the webhook status-persistence added in
 * this same build (Phase B) — before that, delivered/read were never
 * written back, so this would have silently undercounted; now it reflects
 * real Meta callbacks wherever WHATSAPP_ACCESS_TOKEN is configured live.
 */
export async function computeWhatsAppAnalytics(windowDays = 30): Promise<WhatsAppAnalytics> {
  const db = getSupabaseAdmin()
  const since = new Date(Date.now() - windowDays * 86400000).toISOString()

  const { data, error } = await db
    .from('whatsapp_messages')
    .select('direction, message_status')
    .gte('created_at', since)
    .limit(5000)

  if (error || !data) {
    return {
      windowDays, sent: 0, received: 0, delivered: 0, read: 0, failed: 0,
      deliveryRatePct: null, readRatePct: null,
      note: 'Could not load WhatsApp message data.',
    }
  }

  let sent = 0, received = 0, delivered = 0, read = 0, failed = 0
  for (const row of data) {
    if (row.direction === 'inbound') { received++; continue }
    sent++
    if (row.message_status === 'delivered') delivered++
    else if (row.message_status === 'read') { delivered++; read++ } // read implies delivered
    else if (row.message_status === 'failed') failed++
  }

  return {
    windowDays, sent, received, delivered, read, failed,
    deliveryRatePct: sent > 0 ? Math.round((delivered / sent) * 1000) / 10 : null,
    readRatePct: delivered > 0 ? Math.round((read / delivered) * 1000) / 10 : null,
    note: data.length >= 5000 ? 'Capped at 5,000 most-relevant rows for this window — figures may undercount on very high-volume windows.' : '',
  }
}

// ── Customers Likely To Book / Next Best Action ──────────────────────────────

export interface ScoredLead {
  leadId: string
  name: string | null
  phone: string | null
  score: number
  band: 'HIGH' | 'MEDIUM' | 'LOW'
  nextBestAction: string
  reasoning: string[]
}

const CANDIDATE_LIMIT = 40

// Branches on the real flags opportunity-score.ts already computed
// (getOpportunityScoreForLead's OpportunityScoreResultWithFlags), not on
// reasoning[]'s free text — reasoning is meant for human display, not as a
// machine-parseable contract.
function deriveNextBestAction(flags: OpportunityScoreResultWithFlags['flags'], band: 'HIGH' | 'MEDIUM' | 'LOW'): string {
  if (flags.hasAcceptedProposal) return 'Booking confirmed — focus on pre-arrival experience, not conversion.'
  if (flags.escalationRequired) return 'Needs operator attention now — resolve the open escalation.'
  if (flags.hasViewedProposal) return 'Viewed their proposal — call now to close.'
  if (flags.hasCompletedVisit && flags.hasNoProposal) return 'Completed a site visit but has no proposal — send one today.'
  if (flags.hasSentProposal) return 'Proposal sent — a follow-up nudge is due.'
  if (flags.hasNoProposal && band === 'HIGH') return 'Qualified and engaged, no proposal yet — send one.'
  if (flags.hasOnlyRejectedProposal) return 'Only rejected proposals on file — revisit with a different package/price point.'
  return 'Continue nurturing with a follow-up.'
}

// Scores a bounded pool of active-pipeline leads once; callers derive both
// the "likely to book" list and each lead's Next Best Action from the same
// pass (per-lead scoring makes 4 DB round trips — see opportunity-score.ts
// — so this is intentionally bounded, not run over the whole leads table).
async function scoreActiveLeads(limit: number): Promise<ScoredLead[]> {
  const db = getSupabaseAdmin()
  const { data: leads, error } = await db
    .from('leads')
    .select('id, name, phone')
    .in('status', ['new_inquiry', 'followup_pending', 'proposal_sent', 'negotiation'])
    .order('updated_at', { ascending: false })
    .limit(limit)
  if (error || !leads) return []

  const scored = await Promise.all(
    leads.map(async (lead) => {
      const result = await getOpportunityScoreForLead(lead.id)
      return {
        leadId: lead.id,
        name: lead.name,
        phone: lead.phone,
        score: result.score,
        band: result.band,
        nextBestAction: deriveNextBestAction(result.flags, result.band),
        reasoning: result.reasoning,
      }
    })
  )
  return scored
}

export async function computeLikelyToBook(limit = 10): Promise<ScoredLead[]> {
  const scored = await scoreActiveLeads(CANDIDATE_LIMIT)
  return scored.filter((s) => s.band === 'HIGH').sort((a, b) => b.score - a.score).slice(0, limit)
}

export async function computeNextBestActions(limit = 10): Promise<ScoredLead[]> {
  const scored = await scoreActiveLeads(CANDIDATE_LIMIT)
  return scored.sort((a, b) => b.score - a.score).slice(0, limit)
}

// ── Customers Likely To Churn ─────────────────────────────────────────────────

export interface ChurnRiskEntry {
  leadId: string
  name: string | null
  phone: string | null
  riskScore: number // 0-100, higher = more at risk
  daysSinceContact: number | null
  estimatedRevenueAtStake: number
  reasons: string[]
}

/**
 * "Churn" here means a known/repeat customer (or one with a cancelled
 * booking on file) who has gone quiet — not a subscription-cancellation
 * model, which this business doesn't have data for. Two bulk candidate
 * pools (repeat customers gone dormant, and anyone with a cancelled
 * booking), merged and scored purely on contact recency — deliberately NOT
 * blended with revenue into one number, since risk and value-at-stake are
 * different questions; both are reported so a human can weigh them.
 */
export async function computeChurnRisk(limit = 10): Promise<ChurnRiskEntry[]> {
  const [dormantRepeat, cancelled] = await Promise.all([
    buildSegment({ repeat_customer: true, dormant_since_days: 45 }),
    buildSegment({ has_cancelled_booking: true }),
  ])

  const byId = new Map<string, { lead: typeof dormantRepeat[number]; reasons: Set<string> }>()
  for (const lead of dormantRepeat) {
    byId.set(lead.id, { lead, reasons: new Set(['Repeat customer gone quiet (45+ days)']) })
  }
  for (const lead of cancelled) {
    const existing = byId.get(lead.id)
    if (existing) existing.reasons.add('Has a cancelled booking on file')
    else byId.set(lead.id, { lead, reasons: new Set(['Has a cancelled booking on file']) })
  }

  const now = Date.now()
  const scored: ChurnRiskEntry[] = Array.from(byId.values()).map(({ lead, reasons }) => {
    const lastContacted = (lead as { last_contacted_at?: string | null }).last_contacted_at
    const daysSinceContact = lastContacted ? Math.floor((now - new Date(lastContacted).getTime()) / 86400000) : null
    const dormancyComponent = daysSinceContact == null ? 55 : Math.min(80, Math.round(daysSinceContact / 2))
    const cancelledBonus = reasons.has('Has a cancelled booking on file') ? 20 : 0
    const riskScore = Math.max(0, Math.min(100, dormancyComponent + cancelledBonus))

    if (daysSinceContact == null) reasons.add('No contact date on record')
    else reasons.add(`Last contacted ${daysSinceContact} days ago`)

    return {
      leadId: lead.id,
      name: lead.name,
      phone: lead.phone,
      riskScore,
      daysSinceContact,
      estimatedRevenueAtStake: (lead as { estimated_revenue?: number | null }).estimated_revenue ?? 0,
      reasons: Array.from(reasons),
    }
  })

  return scored.sort((a, b) => b.riskScore - a.riskScore).slice(0, limit)
}
