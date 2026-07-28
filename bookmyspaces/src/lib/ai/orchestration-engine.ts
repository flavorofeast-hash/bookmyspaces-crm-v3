// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/ai/orchestration-engine.ts
// AI Orchestration Foundation — Phase 1A. Hardened in the post-review
// Hardening Sprint (Critical Issues 1 & 2, High Issues 1-5, Security,
// Performance — see each step's inline reference below).
//
// This is the single entry point the approved architecture describes as
// "the brain" -- but per the explicit Phase 1A rule ("the orchestration
// engine must never contain business logic"), it does not itself decide
// anything or perform any side effect beyond the one guard check described
// below. It validates, runs the existing pipeline in order using only
// already-existing or already-built pure functions, and returns one
// structured result describing what should happen next and which real
// function would carry it out. It never calls that function -- executing
// the chosen tool is left entirely to the caller (a future channel
// adapter, in a later phase).
//
// Nothing in this file is wired to a route yet. No channel adapter
// (WhatsApp webhook, chat route, or any other) imports this module as of
// this sprint either -- per the explicit instruction not to touch them.
// This file is therefore still unreachable from any live request today.
// Customer-facing behavior is completely unchanged by this file's
// existence or by this sprint's hardening of it.
//
// Pipeline:
//   0. validateInboundMessage() -- src/lib/ai/inbound-guard.ts (Hardening
//      Sprint, NEW). Runs first, before any I/O. Rejects malformed input,
//      outbound echoes, non-customer sources, replays, and duplicate
//      deliveries with a structured reason (Critical Issue 2 + High Issue 4
//      + Security) -- see OrchestrationRejection below.
//   1. extractLeadDetails()    -- src/lib/extract-lead-details.ts (existing,
//      untouched), run once, moved earlier in the pipeline (see step 3).
//   2. slotsFromExtraction() + mergeSlots() -- src/lib/ai/slot-memory.ts.
//      Conflict-aware as of this sprint's Critical Issue 1 fix: a customer
//      correction now overrides a stale CRM value instead of being
//      silently dropped, and the disagreement is reported via
//      `slots.conflicts` / `slots.hasConflicts` for a caller (a future
//      confirmation step) to act on.
//   3. intentFromSignals()     -- src/lib/ai/intent-detector.ts, reusing step 1's output.
//   4. evaluateHandoff()       -- src/lib/ai/orchestrator.ts (existing, untouched) -- pre-reply
//      regex-only triggers (human request / complaint / refund / payment issue).
//      Confidence-based escalation is deliberately NOT evaluated here: there
//      is no AI-generated reply yet at this point in the pipeline to score.
//      That remains orchestrator.ts's checkAndApplyHandoff()'s job, run by
//      the caller AFTER an answer_immediately tool invocation actually
//      produces a reply -- exactly how the existing chat route already uses
//      it. This engine does not duplicate that step.
//   5. buildAIContext()        -- src/lib/ai/context-builder.ts (existing).
//      Hardening Sprint (Performance): now runs AFTER steps 1-4 (moved from
//      first), and passed `skipExpensiveRetrieval` when this turn's
//      decision is already fully determined without it -- see
//      decisionIsPredictableWithoutBusinessContext() below. Purely a
//      performance change; buildAIContext()'s own default behavior for
//      every other caller is untouched (the flag is additive-only there too).
//   6. Derive leadExists / hasProposal / hasPackageRecommendation from the
//      AIContext just built (Hardening Sprint, High Issue 3) instead of
//      requiring the caller to pass duplicate state -- an explicit override
//      is still honoured if supplied, but is no longer required.
//   7. decideNextAction()      -- src/lib/ai/decision-table.ts.
//   8. getTool()               -- src/lib/ai/tool-registry.ts.
// ─────────────────────────────────────────────────────────────────────────────

import { buildAIContext } from '@/lib/ai/context-builder'
import { extractLeadDetails } from '@/lib/extract-lead-details'
import { evaluateHandoff, type HandoffReason } from '@/lib/ai/orchestrator'
import type { AISettings } from '@/lib/settings/settings-service'
import type { AIContext } from '@/types/ai-context'
import type { ChannelType, MessageDirection, MessageSenderType } from '@/types/conversation'
import { ConversationState } from '@/constants/conversation-states'
import {
  mergeSlots,
  slotsFromExtraction,
  type SlotKey,
  type SlotMergeResult,
  type SlotValues,
} from '@/lib/ai/slot-memory'
import { intentFromSignals, type DetectIntentResult } from '@/lib/ai/intent-detector'
import { decideNextAction, type DecisionResult, type InventoryCategory } from '@/lib/ai/decision-table'
import { getTool, type ToolRegistry } from '@/lib/ai/tool-registry'
import type { OrchestrationAction } from '@/lib/ai/decision-table'
import { validateInboundMessage, type RejectionReason } from '@/lib/ai/inbound-guard'

export interface OrchestrationInput {
  // ── Mandatory contract fields (Hardening Sprint, High Issue 4) ──────────
  // Reuses this codebase's own Unified Conversation Platform vocabulary
  // (src/types/conversation.ts) rather than inventing a parallel one.
  /** Which channel this message arrived on. */
  channel: ChannelType
  /** Must be 'inbound' to be processed at all -- see inbound-guard.ts (Critical Issue 2). */
  direction: MessageDirection
  /** Provider/channel message id -- used for duplicate-delivery detection by the caller. */
  messageId: string
  /** Unified Conversation Platform conversation id. Required key; pass null explicitly for a brand-new conversation. */
  conversationId: string | null
  /** Must be 'customer' to be processed -- 'ai'/'human' are our own output, never new input (Critical Issue 2). */
  source: MessageSenderType

  // ── Existing Phase 1A fields ─────────────────────────────────────────────
  /** Resolved lead id (src/lib/identity/resolve-identity.ts), or null for an unidentified visitor -- same contract buildAIContext() already expects. */
  leadId: string | null
  /** The customer's current message, verbatim. */
  message: string
  /** Current src/constants/conversation-states.ts state for this conversation. */
  conversationState: ConversationState
  /** src/lib/settings/settings-service.ts's AI settings -- only the two fields evaluateHandoff()/decideNextAction() actually need. */
  aiSettings: Pick<AISettings, 'confidenceThreshold' | 'autoHandoff'>
  /** Highest-priority slot tier -- values already confirmed on the `leads` row. Caller supplies this (e.g. via slot-memory.ts's slotsFromLead()); this engine does not fetch it itself. */
  crmSlots?: Partial<SlotValues>
  /** Mid-priority slot tier -- values already collected earlier in this conversation. */
  conversationSlots?: Partial<SlotValues>
  /** Passed through to decideNextAction() -- see decision-table.ts for meaning/defaults. */
  inventoryCategory?: InventoryCategory

  // ── Optional overrides (Hardening Sprint, High Issue 3) ──────────────────
  // Derived from the AIContext this engine builds when omitted -- see step 6
  // in the file header. Still honoured if a caller explicitly supplies one
  // (e.g. it just performed a write this same request and knows better than
  // whatever buildAIContext()'s read returned) -- just no longer required.
  hasPackageRecommendation?: boolean
  hasProposal?: boolean
  leadExists?: boolean

  // ── Loop-protection inputs (Hardening Sprint, Critical Issue 2) ──────────
  // Caller-computed from its own idempotency store -- see inbound-guard.ts's
  // header for why this engine does not (and should not) detect these itself.
  /** True when this exact messageId has already been processed/delivered before. */
  isDuplicateDelivery?: boolean
  /** True when this event is a replay/redelivery of a previously processed webhook payload. */
  isReplayEvent?: boolean
}

/** Structured rejection -- returned instead of ever throwing for malformed/looping input (Security: safe failures). */
export interface OrchestrationRejection {
  allowed: false
  rejectionReason: RejectionReason
  detail: string
}

export interface OrchestrationSuccess {
  allowed: true
  aiContext: AIContext
  slots: SlotMergeResult
  intent: DetectIntentResult
  handoffReason: HandoffReason | null
  decision: DecisionResult
  /** The resolved tool entry for decision.action -- includes the real function reference (tool.fn) and where it comes from. Not invoked by this engine. */
  tool: ToolRegistry[OrchestrationAction]
}

/** Discriminate on `allowed` -- `if (!result.allowed) { ...result.rejectionReason... }`. */
export type OrchestrationOutcome = OrchestrationRejection | OrchestrationSuccess

/**
 * Hardening Sprint (Performance). True when the eventual decision is
 * already fully determined by state + slots + handoff alone -- mirrors
 * decision-table.ts's own Rules 1-4 (handoff trigger / low confidence /
 * already escalated / missing required slot) exactly, since none of those
 * four outcomes' registered tools (applyHandoff, or chatWithAI asking for
 * missing info) need pricing, knowledge base, reservation history, or
 * proposal history.
 *
 * This is a deliberate, documented coupling to decision-table.ts's rule
 * ordering, not accidental duplication of its logic: if decision-table.ts's
 * first four rules are ever reordered or changed, this predicate should be
 * reviewed alongside them. Getting it wrong only costs performance (falls
 * back to building full context, exactly like before this sprint) -- it
 * never affects correctness, since decideNextAction() below always runs
 * against the real, complete decision inputs regardless of what this
 * predicate returned.
 */
function decisionIsPredictableWithoutBusinessContext(args: {
  conversationState: ConversationState
  missingSlots: SlotKey[]
  handoffReason: HandoffReason | null
  confidence: number
  confidenceThreshold: number
}): boolean {
  if (args.handoffReason) return true
  if (args.confidence < args.confidenceThreshold) return true
  if (args.conversationState === ConversationState.HANDOFF_TO_OPERATOR) return true
  if (args.missingSlots.length > 0) return true
  return false
}

/**
 * Runs one inbound message through the full coordination pipeline and
 * returns what should happen next, without doing it. Never throws --
 * malformed or looping input is rejected structurally by the guard (step 0)
 * before any I/O happens; every step after that is either a pure function
 * or (buildAIContext) already fault-tolerant/degrade-on-failure by its own
 * design, so this function adds no new fallible side effects of its own.
 */
export async function orchestrate(input: OrchestrationInput): Promise<OrchestrationOutcome> {
  const {
    channel,
    direction,
    messageId,
    conversationId,
    source,
    leadId,
    message,
    conversationState,
    aiSettings,
    crmSlots,
    conversationSlots,
    inventoryCategory,
    hasPackageRecommendation: hasPackageRecommendationOverride,
    hasProposal: hasProposalOverride,
    leadExists: leadExistsOverride,
    isDuplicateDelivery,
    isReplayEvent,
  } = input

  // Step 0 -- Hardening Sprint: validate the mandatory contract and
  // loop-guard BEFORE any I/O or AI work happens at all (Critical Issue 2,
  // High Issue 4, Security). See inbound-guard.ts.
  const guard = validateInboundMessage({
    channel, direction, messageId, conversationId, source, message,
    isDuplicateDelivery, isReplayEvent,
  })
  if (!guard.allowed) {
    return {
      allowed: false,
      // guard.allowed === false guarantees rejectionReason is non-null (inbound-guard.ts's own
      // contract); the fallback is unreachable defensive code, not a real possibility.
      rejectionReason: guard.rejectionReason ?? 'missing_required_field',
      detail: guard.detail,
    }
  }

  // Step 1 -- existing service, untouched. Run once; steps 2 and 3 both
  // reuse this single result rather than re-extracting from the message.
  const extracted = extractLeadDetails(message)

  // Step 2 -- Phase 1A, conflict-aware as of this sprint (Critical Issue 1).
  const slots = mergeSlots({
    crm: crmSlots,
    conversation: conversationSlots,
    extracted: slotsFromExtraction(extracted),
  })

  // Step 3 -- Phase 1A, pure lookup over step 1's output. No second extraction, no LLM call.
  const intent = intentFromSignals(extracted.buying_signals)

  // Step 4 -- existing service, untouched. Pre-reply: only the deterministic
  // regex triggers can fire here (aiConfidence is passed as 1 -- neutral --
  // since no reply exists yet to be unconfident about).
  const handoff = evaluateHandoff({
    customerText: message,
    aiConfidence: 1,
    settings: aiSettings,
  })

  // Step 5 -- existing service. Hardening Sprint (Performance): skip the
  // four expensive sections when the decision is already fully determined
  // without them -- see decisionIsPredictableWithoutBusinessContext() above.
  const skipExpensiveRetrieval = decisionIsPredictableWithoutBusinessContext({
    conversationState,
    missingSlots: slots.missingSlots,
    handoffReason: handoff.reason,
    confidence: 1,
    confidenceThreshold: aiSettings.confidenceThreshold,
  })
  const aiContext = await buildAIContext({ leadId, query: message, conversationId, skipExpensiveRetrieval })

  // Step 6 -- Hardening Sprint, High Issue 3: derive rather than require
  // duplicate caller state. An explicit override always wins when supplied;
  // otherwise derived straight from the AIContext this engine just built.
  const leadExists = leadExistsOverride ?? aiContext.customerProfile.leadId !== null
  const hasProposal = hasProposalOverride ?? aiContext.proposalHistory.length > 0
  const hasPackageRecommendation =
    hasPackageRecommendationOverride ?? aiContext.proposalHistory.some((p) => !!p.packageName)

  // Step 7 -- Phase 1A, deterministic table lookup (reviewed this sprint -- see decision-table.ts).
  const decision = decideNextAction({
    conversationState,
    missingSlots: slots.missingSlots,
    intent: intent.intent,
    confidence: 1,
    confidenceThreshold: aiSettings.confidenceThreshold,
    handoffReason: handoff.reason,
    inventoryCategory,
    hasPackageRecommendation,
    hasProposal,
    leadExists,
  })

  // Step 8 -- Phase 1A, registry lookup (compile-time exhaustive this sprint
  // -- see tool-registry.ts). Returns the real function reference; this
  // engine does not call it.
  const tool = getTool(decision.action)

  return { allowed: true, aiContext, slots, intent, handoffReason: handoff.reason, decision, tool }
}
