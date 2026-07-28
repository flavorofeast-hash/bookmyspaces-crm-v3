// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/ai/decision-table.ts
// AI Orchestration Foundation — Phase 1A. Reviewed and corrected in the
// post-review Hardening Sprint (High Issue 2).
//
// Deterministic lookup only. No LLM call, no randomness, no hidden state --
// decideNextAction() is a pure function: same input, same output, every
// time. Input is Conversation State + Missing Slots + Intent + Confidence
// (plus a small amount of already-known context listed below); output is
// exactly one of the 13 actions from the approved architecture.
//
// Rules are evaluated in order and the first match wins -- this keeps the
// table auditable as a single ordered list instead of scattered
// conditionals (the same failure mode the earlier audit found in the live
// WhatsApp webhook's inline buildAutoReply()). Every rule is one line with
// a one-line reason string attached, so a decision can always be explained.
//
// This file does not call orchestrator.ts's regex handoff detection itself
// (that would duplicate logic that already exists there) -- the caller
// (orchestration-engine.ts) is expected to run orchestrator.ts's
// evaluateHandoff() first and pass the result in as `handoffReason`. Rule 1
// below simply obeys whatever that existing, already-tested module decided.
//
// HARDENING SPRINT REVIEW (High Issue 2) — what changed and why:
// The independent architecture review's instruction was "review every
// rule; guarantee rules requiring complete information never execute while
// mandatory slots are still missing; remove unreachable rules; document
// every rule." A full walk of the original 14-entry table found two real
// defects, both fixed below:
//
//   1. The original "ask for missing info" rule only fired inside
//      COLLECTING_STATES (NEW_INQUIRY / WAITING_FOR_*). Any conversation
//      sitting in a non-collecting state (e.g. QUALIFIED) with slots that
//      were, for whatever reason, actually still incomplete this turn
//      (e.g. the caller's crmSlots/conversationSlots didn't include
//      something expected) could fall through to a rule that DOES require
//      complete information -- generate_quotation, check_room_availability,
//      recommend_package, etc. -- and act on incomplete data. Fixed by
//      dropping the COLLECTING_STATES restriction: missing required slots
//      now always route to collect_missing_information first, regardless
//      of conversation state. This makes the old "intent unclear and slots
//      still missing -> ask_question" rule impossible to ever reach (by
//      the time any later rule runs, missingSlots is now guaranteed empty)
//      -- that rule was removed as genuinely unreachable dead code rather
//      than left in place. `ask_question` remains a valid, registered
//      OrchestrationAction (tool-registry.ts) for a future rule or manual
//      use; it is simply not produced by this table today.
//
//   2. The original final two rules were, in order: "slots complete + no
//      CRM record -> create_lead", then "slots complete + CRM record
//      exists -> update_lead", then a stated "default: answer
//      conversationally -> answer_immediately". Every one of the six
//      defined intents besides 'unclear' already has its own dedicated
//      rule earlier in the table (availability_check, price_request,
//      ready_to_book, site_visit_request, comparison_shopping,
//      hesitation) -- so by construction, execution only ever reaches
//      these final rules when intent is 'unclear' AND slots are complete.
//      `leadExists` is always either true or false, so the create_lead /
//      update_lead pair is exhaustive over every remaining case -- meaning
//      the stated "default: answer conversationally" rule could never
//      actually run; it was permanently shadowed. That is a real product
//      defect, not a harmless redundancy: a fully-qualified customer
//      saying something conversational ("thanks!", "sounds good") got a
//      silent, identical CRM re-write and no reply at all, every single
//      time. Fixed by keeping create_lead (a CRM record must exist once
//      slots are complete -- that guarantee is still enforced), but
//      retiring the blanket update_lead fallback in favour of the
//      conversational default, so a qualified customer with nothing
//      structured to act on gets an actual reply. `update_lead` remains a
//      valid, registered OrchestrationAction; it is available for the
//      re-sync trigger candidate on Phase 1B's backlog once slot conflicts
//      (slot-memory.ts's Critical Issue 1 work) can hint that a
//      genuinely-changed value needs writing back, rather than firing on
//      every unrelated turn as it did before.
// ─────────────────────────────────────────────────────────────────────────────

import { ConversationState } from '@/constants/conversation-states'
import type { SlotKey } from '@/lib/ai/slot-memory'
import type { Intent } from '@/lib/ai/intent-detector'
import type { HandoffReason } from '@/lib/ai/orchestrator'

export type OrchestrationAction =
  | 'handoff_to_human'
  | 'collect_missing_information'
  | 'ask_question'
  | 'check_room_availability'
  | 'check_banquet_availability'
  | 'generate_quotation'
  | 'recommend_package'
  | 'generate_proposal'
  | 'notify_staff'
  | 'schedule_follow_up'
  | 'create_lead'
  | 'update_lead'
  | 'answer_immediately'

export type InventoryCategory = 'room' | 'banquet' | 'unknown'

export interface DecisionInput {
  conversationState: ConversationState
  missingSlots: SlotKey[]
  intent: Intent
  /** 0..1 -- src/lib/ai/orchestrator.ts's estimateConfidence() output, when a reply already exists to score; omit/1 if nothing has been generated yet this turn. */
  confidence: number
  /** src/lib/settings/settings-service.ts's AISettings.confidenceThreshold. */
  confidenceThreshold: number
  /** Pre-computed by the caller via orchestrator.ts's evaluateHandoff() -- this table never re-implements those regex checks. */
  handoffReason?: HandoffReason | null
  /** Whether this message's inventory need looks like a room stay or a banquet/event booking. Derived upstream (e.g. from event type); 'unknown' defaults to room. */
  inventoryCategory?: InventoryCategory
  /** Whether a package has already been recommended/selected for this lead. */
  hasPackageRecommendation?: boolean
  /** Whether a proposal already exists for this lead. */
  hasProposal?: boolean
  /** Whether a CRM lead record already exists for this identity. */
  leadExists?: boolean
}

export interface DecisionResult {
  action: OrchestrationAction
  reason: string
}

export function decideNextAction(input: DecisionInput): DecisionResult {
  const {
    conversationState,
    missingSlots,
    intent,
    confidence,
    confidenceThreshold,
    handoffReason = null,
    inventoryCategory = 'unknown',
    hasPackageRecommendation = false,
    hasProposal = false,
    leadExists = true,
  } = input

  // Rule 1 -- an existing, already-computed handoff trigger (human request,
  // complaint, refund, payment issue) always wins, regardless of anything else.
  if (handoffReason) {
    return { action: 'handoff_to_human', reason: `handoff trigger: ${handoffReason}` }
  }

  // Rule 2 -- confidence below the configured threshold. Mirrors
  // orchestrator.ts's own low_confidence rule, applied here as a table entry
  // so a caller that hasn't run a reply through estimateConfidence() yet can
  // still consult this table with a conservative default.
  if (confidence < confidenceThreshold) {
    return { action: 'handoff_to_human', reason: 'confidence below threshold' }
  }

  // Rule 3 -- conversation is already escalated; stay escalated.
  if (conversationState === ConversationState.HANDOFF_TO_OPERATOR) {
    return { action: 'handoff_to_human', reason: 'conversation already escalated' }
  }

  // Rule 4 -- a required slot is missing: ask for it, REGARDLESS of
  // conversation state. (Hardening Sprint fix -- previously gated to
  // COLLECTING_STATES only; see file header.) This is the enforcement
  // point for High Issue 2's guarantee: every rule below this one may
  // assume missingSlots is empty, so no rule "requiring complete
  // information" can ever run while a mandatory slot is still missing.
  // Also the direct implementation of "never ask twice" -- missingSlots is
  // computed by slot-memory.ts's mergeSlots(), which already excludes
  // anything already known from any source (including, since the
  // Hardening Sprint's Critical Issue 1 fix, a customer's own correction
  // of a stale CRM value).
  if (missingSlots.length > 0) {
    return { action: 'collect_missing_information', reason: `missing: ${missingSlots.join(', ')}` }
  }

  // From here on, missingSlots is guaranteed empty (Rule 4 already returned
  // otherwise) -- every remaining rule may safely assume complete information.

  // Rule 5 -- customer is asking about availability.
  if (intent === 'availability_check') {
    return inventoryCategory === 'banquet'
      ? { action: 'check_banquet_availability', reason: 'availability_check intent, banquet category' }
      : { action: 'check_room_availability', reason: 'availability_check intent, room category' }
  }

  // Rule 6 -- customer is asking about price.
  if (intent === 'price_request') {
    return { action: 'generate_quotation', reason: 'price_request intent' }
  }

  // Rule 7 -- customer signals readiness to book: recommend a package
  // first if none is attached yet, otherwise move to a proposal, otherwise
  // (package and proposal both already exist) a human follow-up on next
  // steps is more useful than a duplicate proposal.
  if (intent === 'ready_to_book') {
    if (!hasPackageRecommendation) {
      return { action: 'recommend_package', reason: 'ready_to_book intent, no package yet' }
    }
    if (!hasProposal) {
      return { action: 'generate_proposal', reason: 'ready_to_book intent, package known, no proposal yet' }
    }
    return { action: 'schedule_follow_up', reason: 'ready_to_book intent, proposal already exists' }
  }

  // Rule 8 -- a site visit is a real-world logistics request; staff need
  // to coordinate it, not the AI.
  if (intent === 'site_visit_request') {
    return { action: 'notify_staff', reason: 'site_visit_request intent' }
  }

  // Rule 9 -- comparison shopping or hesitation: nothing to answer right
  // now, but worth a scheduled nudge later.
  if (intent === 'comparison_shopping' || intent === 'hesitation') {
    return { action: 'schedule_follow_up', reason: `${intent} intent` }
  }

  // Rule 10 -- every other defined intent is handled above, so reaching
  // here means intent is 'unclear' (slots are already known complete).
  // A CRM record must still exist once a lead is qualified, even if this
  // particular message itself was conversational -- ensure that before
  // falling through to a plain reply.
  if (!leadExists) {
    return { action: 'create_lead', reason: 'slots complete, no CRM record yet' }
  }

  // Rule 11 -- default: answer conversationally. Its registered tool
  // (tool-registry.ts) is chatWithAI() -- the same open-ended understanding
  // the architecture asks for, invoked exactly once, here. Reachable again
  // after the Hardening Sprint fix (see file header) -- previously always
  // shadowed by a blanket update_lead rule.
  return { action: 'answer_immediately', reason: 'no structured trigger matched' }
}
