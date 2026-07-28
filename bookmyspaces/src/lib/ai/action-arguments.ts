// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/ai/action-arguments.ts
// Phase 1B, Step 4 (audit/PHASE_1B_IMPLEMENTATION_BACKLOG.md,
// audit/PHASE_1B_STEP4_READINESS_REVIEW.md).
//
// Pure argument-mapping layer: for each OrchestrationAction decideNextAction()
// (decision-table.ts) can produce, builds what a future Executor (Step 5,
// not built yet) needs to actually carry out that decision. Nothing in this
// file calls a real tool, sends a message, or writes to the database beyond
// the one read notify_staff's builder needs (mirroring
// notifyOperator()'s own existing notification_settings lookup,
// auto-responder.ts). Nothing imports this file yet -- confirmed by grep at
// the end of this sprint's report. orchestrate() remains completely unwired.
//
// DESIGN NOTE -- this module does not always return "arguments for
// tool-registry.ts's tool.fn" literally, and that's intentional, not a bug:
//   - `ask_question` / `collect_missing_information` are registered against
//     chatWithAI() in tool-registry.ts today (a documented stopgap -- see
//     that file's header), but this module resolves them directly to the
//     matching auto-responder.ts MESSAGES template (exported in Step 3)
//     instead of building a chatWithAI() prompt. This was the explicit,
//     approved plan in the Step 4 readiness review's own mapping table --
//     reusing exact, already-approved customer-facing copy rather than
//     asking an LLM to improvise the same funnel question.
//   - `generate_proposal` deliberately does NOT call its own registered
//     tool (createProposalFromReservation) -- there is no reservation to
//     attach to at this point in the pipeline (design doc Section 6.2,
//     already decided). It downgrades to notify_staff's own result instead.
//   - `check_room_availability` / `check_banquet_availability` safe-fail
//     (kind: 'unavailable') whenever no inventoryItemId is supplied --
//     nothing in AIContext or SlotValues carries a resolved inventory item
//     id today (design doc Section 11, item 1 -- confirmed again while
//     building this module: CustomerPreferences.preferredVenue is free
//     text, not an id). This module never guesses one.
//
// Every builder is a small, individually-testable, synchronous function
// except buildNotifyStaffArgs (the one real I/O call), matching the
// pure-function discipline slot-memory.ts and decision-table.ts already use
// in this codebase.
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabaseAdmin } from '@/lib/supabase'
import { MESSAGES } from '@/lib/whatsapp/auto-responder'
import type { OrchestrationSuccess } from '@/lib/ai/orchestration-engine'
import type { OrchestrationAction } from '@/lib/ai/decision-table'
import type { SlotKey } from '@/lib/ai/slot-memory'
import type { ChannelType } from '@/types/conversation'
import type { Message } from '@/lib/ai'
import type { HandoffReason } from '@/lib/ai/orchestrator'

// ─── Result shape ────────────────────────────────────────────────────────────

/** A real invocation of the action's registered tool.fn is ready -- args are positional, spread by the future Executor as `tool.fn(...args)`. */
export interface ToolCallResult {
  kind: 'tool_call'
  action: OrchestrationAction
  args: unknown[]
}

/** The action resolves to sending an existing, already-approved template string directly -- no tool.fn call needed. */
export interface TemplateReplyResult {
  kind: 'template_reply'
  action: OrchestrationAction
  replyText: string
}

/** Safe-fail: this action cannot be carried out with the data available today. Never a guess -- see file header. */
export interface UnavailableResult {
  kind: 'unavailable'
  action: OrchestrationAction
  reason: string
}

/** This action is deliberately redirected to a different action's result (today: generate_proposal -> notify_staff only). */
export interface DowngradedResult {
  kind: 'downgraded'
  action: OrchestrationAction
  downgradedTo: OrchestrationAction
  reason: string
  result: ActionArgumentsResult
}

export type ActionArgumentsResult = ToolCallResult | TemplateReplyResult | UnavailableResult | DowngradedResult

// ─── Input ───────────────────────────────────────────────────────────────────

export interface ActionArgumentsContext {
  /** orchestrate()'s own successful outcome -- decision, slots, aiContext, handoffReason, tool. */
  outcome: OrchestrationSuccess
  channel: ChannelType
  conversationId: string | null
  /**
   * The customer's current message, verbatim. NOT retrievable from
   * OrchestrationSuccess -- OrchestrationInput.message is not carried
   * through to the outcome (confirmed while building this module, see
   * PHASE_1B_STEP4_REPORT.md). The caller already has this value (it's
   * what it passed into orchestrate() in the first place), so it's
   * supplied here rather than this module re-deriving or guessing it.
   * Used as answer_immediately's chatWithAI() `userQuery` argument.
   */
  message: string
  /** Caller-resolved inventory item id for the two availability actions. Absent/null means "unresolved" -- this module never guesses one (see file header). */
  inventoryItemId?: string | null
  /** Required only for schedule_follow_up -- this module does not invent new customer-facing copy; the actual follow-up text is a caller/product decision. */
  followUpMessage?: string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ASK_TEMPLATE_BY_SLOT: Record<SlotKey, string | null> = {
  eventType: MESSAGES.ASK_EVENT_TYPE,
  eventDate: MESSAGES.ASK_EVENT_DATE,
  guestCount: MESSAGES.ASK_GUEST_COUNT,
  // Never appear in missingSlots (slot-memory.ts's REQUIRED_SLOTS is exactly
  // [eventType, eventDate, guestCount]) -- listed for exhaustiveness, not
  // because this module expects to hit them.
  budget: null,
  venue: null,
  specialRequirements: null,
}

function conversationHistoryToMessages(ctx: ActionArgumentsContext): Message[] {
  // ConversationHistoryEntry's role is already typed as 'user' | 'assistant'
  // (types/ai-context.ts) -- no further narrowing needed, just reshaping.
  return ctx.outcome.aiContext.conversationHistory.map((e) => ({ role: e.role, content: e.content }))
}

/** leads.source value for a lead created/updated via this pipeline -- a plain, traceable, non-invented label (channel-derived), not a guess at marketing attribution. */
function sourceForChannel(channel: ChannelType): string {
  return `orchestration_${channel}`
}

// ─── Per-action builders ─────────────────────────────────────────────────────

function buildHandoffToHumanArgs(ctx: ActionArgumentsContext): ToolCallResult | UnavailableResult {
  const { outcome, conversationId } = ctx
  const reason: HandoffReason | null = outcome.handoffReason

  if (!reason) {
    // Reachable today only via decision-table.ts Rule 3 (conversation already
    // in HANDOFF_TO_OPERATOR state) or Rule 2 (confidence < threshold) --
    // orchestrate() always passes confidence=1 (its own documented "neutral,
    // no reply yet" convention), so Rule 2 cannot fire through this pipeline
    // today; Rule 3 can. Neither has a corresponding HandoffReason literal
    // (orchestrator.ts's own closed union), and applyHandoff() requires one.
    // Never invented here -- a genuine gap surfaced while building this
    // module (see PHASE_1B_STEP4_REPORT.md), not solved by this step.
    return {
      kind: 'unavailable',
      action: 'handoff_to_human',
      reason: `decision-table.ts produced handoff_to_human via "${outcome.decision.reason}" with no HandoffReason set -- applyHandoff() cannot be called without inventing one`,
    }
  }

  return {
    kind: 'tool_call',
    action: 'handoff_to_human',
    args: [{
      conversationId: conversationId ?? '',
      leadId: outcome.aiContext.customerProfile.leadId,
      reason,
    }],
  }
}

function buildAskTemplateArgs(
  action: 'ask_question' | 'collect_missing_information',
  ctx: ActionArgumentsContext
): TemplateReplyResult | UnavailableResult {
  const missing = ctx.outcome.slots.missingSlots
  if (missing.length === 0) {
    // ask_question is never actually produced by decideNextAction() today
    // (design doc Section 11, item 5) -- this is its only realistic path.
    return {
      kind: 'unavailable',
      action,
      reason: `${action} has no missing slot to ask about -- decision-table.ts has no other trigger for this action today (see design doc Section 11, item 5)`,
    }
  }

  const template = ASK_TEMPLATE_BY_SLOT[missing[0]]
  if (!template) {
    return {
      kind: 'unavailable',
      action,
      reason: `no MESSAGES template mapped for slot "${missing[0]}"`,
    }
  }

  return { kind: 'template_reply', action, replyText: template }
}

function buildCheckAvailabilityArgs(
  action: 'check_room_availability' | 'check_banquet_availability',
  ctx: ActionArgumentsContext
): ToolCallResult | UnavailableResult {
  if (!ctx.inventoryItemId) {
    return {
      kind: 'unavailable',
      action,
      reason: 'no inventoryItemId resolvable from available data -- slot memory only carries a free-text venue string, not an id (design doc Section 11, item 1); never guessed',
    }
  }

  const eventDate = ctx.outcome.slots.slots.eventDate
  if (!eventDate) {
    return { kind: 'unavailable', action, reason: 'eventDate is not known -- cannot check availability without a date' }
  }

  // checkAvailability() takes a check-in and check-out date; slot memory
  // tracks a single eventDate today (no separate duration/checkout slot),
  // so both are set to the same date -- a same-day event, the only case
  // this module can honestly represent without inventing a duration.
  return {
    kind: 'tool_call',
    action,
    args: [ctx.inventoryItemId, eventDate, eventDate],
  }
}

function buildGenerateQuotationArgs(): ToolCallResult {
  // getActivePackagePrices() takes no arguments -- confirmed against
  // src/lib/pricing/pricing-service.ts while building this module (the
  // original design doc's Section 6 assumed guestCount/eventType filter
  // arguments; that assumption was wrong and is corrected here, not carried
  // forward -- see PHASE_1B_STEP4_REPORT.md).
  return { kind: 'tool_call', action: 'generate_quotation', args: [] }
}

function buildRecommendPackageArgs(ctx: ActionArgumentsContext): ToolCallResult | UnavailableResult {
  const leadId = ctx.outcome.aiContext.customerProfile.leadId
  if (!leadId) {
    return { kind: 'unavailable', action: 'recommend_package', reason: 'no leadId -- runAutoPackageRecommendation() requires one' }
  }
  return { kind: 'tool_call', action: 'recommend_package', args: [leadId, ctx.conversationId] }
}

function buildNotifyStaffArgs(ctx: ActionArgumentsContext): Promise<ToolCallResult | UnavailableResult> {
  return (async () => {
    const supabase = getSupabaseAdmin()
    const { data: setting } = await supabase
      .from('notification_settings')
      .select('value')
      .eq('key', 'daily_summary_whatsapp')
      .maybeSingle()

    const operatorPhone = setting?.value
    if (!operatorPhone) {
      return { kind: 'unavailable' as const, action: 'notify_staff' as const, reason: 'no operator WhatsApp number configured (notification_settings.daily_summary_whatsapp)' }
    }

    const profile = ctx.outcome.aiContext.customerProfile
    const slots = ctx.outcome.slots.slots
    // Same message shape as auto-responder.ts's notifyOperator() -- reused,
    // not reinvented, per this project's "reuse everything that exists" rule.
    const message =
      `🔔 *New Inquiry* [${ctx.channel}]\n\n` +
      `👤 *Name:* ${profile.name ?? 'Unknown'}\n` +
      `📱 *Phone:* ${profile.phone ?? 'Unknown'}\n` +
      `🎉 *Event:* ${slots.eventType ?? 'Unknown'}\n` +
      `👥 *Guests:* ${slots.guestCount ?? 'Unknown'}\n\n` +
      `Reply to this lead in the CRM dashboard.`

    return {
      kind: 'tool_call' as const,
      action: 'notify_staff' as const,
      args: [{ phone: `91${operatorPhone}`, message, type: 'session' as const }],
    }
  })()
}

function buildGenerateProposalArgs(ctx: ActionArgumentsContext): Promise<DowngradedResult> {
  // Deliberate, already-approved exception (design doc Section 6.2): no
  // reservation exists at this point in the pipeline, so this action never
  // attempts createProposalFromReservation() -- it always downgrades to
  // notify_staff's own result instead.
  return buildNotifyStaffArgs(ctx).then((result) => ({
    kind: 'downgraded' as const,
    action: 'generate_proposal' as const,
    downgradedTo: 'notify_staff' as const,
    reason: 'no reservation exists yet to attach a proposal to -- routed to staff instead (design doc Section 6.2)',
    result,
  }))
}

function buildCreateOrUpdateLeadArgs(
  action: 'create_lead' | 'update_lead',
  ctx: ActionArgumentsContext
): ToolCallResult {
  const profile = ctx.outcome.aiContext.customerProfile
  const slots = ctx.outcome.slots.slots

  return {
    kind: 'tool_call',
    action,
    args: [{
      name: profile.name,
      phone: profile.phone,
      email: profile.email,
      source: sourceForChannel(ctx.channel),
      eventType: slots.eventType,
      qualifyText: null,
      sendWelcome: false, // an AI reply is already the welcome on this pipeline -- captureLeadWithJourney() must not also send its own
    }],
  }
}

function buildScheduleFollowUpArgs(ctx: ActionArgumentsContext): ToolCallResult | UnavailableResult {
  const phone = ctx.outcome.aiContext.customerProfile.phone
  if (!phone) {
    return { kind: 'unavailable', action: 'schedule_follow_up', reason: 'no customer phone on file' }
  }
  if (!ctx.followUpMessage) {
    // This module does not invent new customer-facing copy -- see file header.
    return { kind: 'unavailable', action: 'schedule_follow_up', reason: 'no followUpMessage supplied by caller' }
  }
  return { kind: 'tool_call', action: 'schedule_follow_up', args: [{ phone, message: ctx.followUpMessage, type: 'session' as const }] }
}

function buildAnswerImmediatelyArgs(ctx: ActionArgumentsContext): ToolCallResult {
  const history = conversationHistoryToMessages(ctx)
  // Matches chatWithAI()'s existing call pattern exactly (src/lib/ai.ts) --
  // prior history as `messages`, the current turn as `userQuery`. No
  // transformation needed beyond that -- this is the one action whose
  // tool.fn already expects exactly this shape.
  return { kind: 'tool_call', action: 'answer_immediately', args: [history, ctx.message] }
}

// ─── Dispatch ────────────────────────────────────────────────────────────────

/**
 * Builds the arguments (or documented alternative -- see file header) for
 * whatever action orchestrate() decided on. Never throws. Returns a
 * `Promise` uniformly (even for the synchronous builders) so callers don't
 * need to special-case which actions happen to need I/O today.
 */
export async function buildActionArguments(ctx: ActionArgumentsContext): Promise<ActionArgumentsResult> {
  const action = ctx.outcome.decision.action

  switch (action) {
    case 'handoff_to_human':
      return buildHandoffToHumanArgs(ctx)
    case 'ask_question':
    case 'collect_missing_information':
      return buildAskTemplateArgs(action, ctx)
    case 'check_room_availability':
    case 'check_banquet_availability':
      return buildCheckAvailabilityArgs(action, ctx)
    case 'generate_quotation':
      return buildGenerateQuotationArgs()
    case 'recommend_package':
      return buildRecommendPackageArgs(ctx)
    case 'generate_proposal':
      return buildGenerateProposalArgs(ctx)
    case 'create_lead':
    case 'update_lead':
      return buildCreateOrUpdateLeadArgs(action, ctx)
    case 'notify_staff':
      return buildNotifyStaffArgs(ctx)
    case 'schedule_follow_up':
      return buildScheduleFollowUpArgs(ctx)
    case 'answer_immediately':
      return buildAnswerImmediatelyArgs(ctx)
    default: {
      // Exhaustiveness guard, same discipline as tool-registry.ts's getTool().
      const _exhaustive: never = action
      return { kind: 'unavailable', action: _exhaustive as OrchestrationAction, reason: `no argument builder registered for action "${String(action)}"` }
    }
  }
}
