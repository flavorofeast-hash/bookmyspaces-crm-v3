// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/ai/orchestrator.ts
// V3 Phase 4 — AI Orchestrator: confidence + human-handoff policy.
//
// The master spec's handoff triggers, as code: explicit human request,
// complaint/dispute, refund, payment issue, low AI confidence. Thresholds
// and the master switch live in settings.ai (settings-service) — tunable
// from the Settings page without a deploy.
//
// This module decides and flags; it does not talk to customers. Escalation
// marks the unified conversation (status='escalated', ai_active=false) and
// writes ai_interaction_log, which the Unified Inbox surfaces (Escalated
// filter). It never blocks or breaks the reply path that calls it —
// callers fire-and-forget.
//
// Confidence: the model APIs used here don't return calibrated confidence,
// so estimateConfidence() is a deliberately conservative heuristic over
// the reply text (fallback/uncertainty markers). It exists so low-quality
// replies get flagged for humans — not as a precision instrument. Real
// logprob/graded confidence can replace it behind the same interface.
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabaseAdmin } from '@/lib/supabase'
import { getSettingsSection, type AISettings } from '@/lib/settings/settings-service'
import { logger } from '@/lib/logger'

export type HandoffReason =
  | 'customer_requested_human'
  | 'complaint'
  | 'refund_request'
  | 'payment_issue'
  | 'low_confidence'

export interface HandoffDecision {
  escalate: boolean
  reason: HandoffReason | null
}

// Word-boundary patterns; Hindi/Bengali romanizations included for the
// Kolkata market. Kept deliberately high-precision — a false "complaint"
// escalation costs an operator interruption.
const HUMAN_REQUEST = /\b(talk|speak|connect|chat)\s+(to|with)\s+((a|the)\s+)?(human|person|agent|manager|owner|staff|someone)\b|\b(real\s+person|human\s+agent|customer\s+care|baat\s+karni|baat\s+karna)\b/i
const COMPLAINT = /\b(complaint|complain|worst|terrible|horrible|disgusted|unacceptable|very\s+disappointed|cheated|fraud|scam)\b/i
const REFUND = /\b(refund|money\s+back|return\s+my\s+money|cancel\s+and\s+refund)\b/i
const PAYMENT_ISSUE = /\b(payment\s+(failed|issue|problem|stuck|deducted))|((paid|deducted).{0,40}(not\s+(confirmed|received|booked)))\b/i

const UNCERTAINTY_MARKERS = [
  "i'm not sure", 'i am not sure', "i don't know", 'i do not know',
  "i don't have that information", 'unable to help', 'cannot help with that',
  'connectivity issue', // the hardcoded fallback reply
]

/** Conservative reply-quality heuristic, 0..1. See file header. */
export function estimateConfidence(reply: string): number {
  const lower = reply.toLowerCase()
  if (UNCERTAINTY_MARKERS.some((m) => lower.includes(m))) return 0.3
  if (reply.trim().length < 20) return 0.5
  return 0.9
}

export function evaluateHandoff(input: {
  customerText: string
  aiConfidence: number
  settings: Pick<AISettings, 'confidenceThreshold' | 'autoHandoff'>
}): HandoffDecision {
  const text = input.customerText

  if (HUMAN_REQUEST.test(text)) return { escalate: true, reason: 'customer_requested_human' }
  if (REFUND.test(text)) return { escalate: true, reason: 'refund_request' }
  if (PAYMENT_ISSUE.test(text)) return { escalate: true, reason: 'payment_issue' }
  if (COMPLAINT.test(text)) return { escalate: true, reason: 'complaint' }

  if (input.settings.autoHandoff && input.aiConfidence < input.settings.confidenceThreshold) {
    return { escalate: true, reason: 'low_confidence' }
  }

  return { escalate: false, reason: null }
}

/**
 * Marks the unified conversation escalated + AI-paused and logs the
 * escalation. Never throws.
 */
export async function applyHandoff(input: {
  conversationId: string
  leadId?: string | null
  reason: HandoffReason
  aiConfidence?: number | null
}): Promise<void> {
  try {
    const supabase = getSupabaseAdmin()

    await supabase
      .from('unified_conversations')
      .update({ status: 'escalated', ai_active: false })
      .eq('id', input.conversationId)

    await supabase.from('ai_interaction_log').insert({
      lead_id: input.leadId ?? null,
      conversation_id: input.conversationId,
      interaction_type: 'conversation_summary',
      summary: `Escalated to human: ${input.reason}`,
      confidence_score: input.aiConfidence ?? null,
      escalated: true,
      escalation_reason: input.reason,
    })
  } catch (error) {
    logger.error('orchestrator', 'applyHandoff failed (non-fatal)', error)
  }
}

/**
 * One-call policy check used by channel pipelines after each AI exchange:
 * loads AI settings, evaluates, applies. Fire-and-forget by design.
 */
export async function checkAndApplyHandoff(input: {
  conversationId: string
  leadId?: string | null
  customerText: string
  aiReply: string
}): Promise<HandoffDecision> {
  const settings = await getSettingsSection('ai')
  const aiConfidence = estimateConfidence(input.aiReply)
  const decision = evaluateHandoff({
    customerText: input.customerText,
    aiConfidence,
    settings,
  })
  if (decision.escalate && decision.reason) {
    await applyHandoff({
      conversationId: input.conversationId,
      leadId: input.leadId ?? null,
      reason: decision.reason,
      aiConfidence,
    })
  }
  return decision
}
