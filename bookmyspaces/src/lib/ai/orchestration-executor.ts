// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/ai/orchestration-executor.ts
// Phase 1B, Step 5 (audit/PHASE_1B_IMPLEMENTATION_BACKLOG.md,
// audit/PHASE_1B_STEP5_READINESS_REVIEW.md).
//
// The one genuinely new business-logic file this phase needs --
// orchestration-engine.ts's own header says it plainly: "it never calls
// that function -- executing the chosen tool is left entirely to the
// caller." This file is that caller. Nothing imports it yet -- confirmed
// by grep at the end of this step's report. orchestrate() remains
// completely unwired from every channel adapter, and this file is not
// wired to anything live either.
//
// ─── CANONICAL ORCHESTRATION RESULT CONTRACT ───────────────────────────────
// action-arguments.ts (Step 4) produces exactly one of four kinds. This
// file treats all four as the canonical interface -- never collapsed,
// never inferred, each documented at its own handling site below:
//
//   tool_call      -- a real tool-registry.ts function is ready to call
//                     with result.args. This file calls it (active mode
//                     only) via getTool(result.action).fn(...result.args).
//                     Only answer_immediately's tool (chatWithAI) returns
//                     an already-approved, ready-to-send customer string;
//                     every other action's return value is raw business
//                     data (availability rows, package prices, a lead
//                     record, a queue id, void) -- this file does NOT
//                     format that into new customer-facing copy. That is a
//                     product/copy decision, not an engineering one, and is
//                     explicitly out of this step's scope (see the
//                     `unavailable` entry below for the same principle
//                     applied to its most visible case).
//   template_reply -- an existing, already-approved MESSAGES template
//                     (auto-responder.ts, exported Step 3) is the reply,
//                     verbatim. No tool call. This file sends it as-is.
//   downgraded     -- today, always generate_proposal -> notify_staff. This
//                     file recurses into result.result (itself one of the
//                     four kinds) and acts on THAT, while recording that a
//                     downgrade occurred. Never re-decided, never silently
//                     dropped.
//   unavailable    -- Step 4 could not build real arguments for this
//                     action with the data available today (e.g. no
//                     resolvable inventory item id). Per this step's
//                     EXPLICIT instruction: this file does NOT invent a
//                     customer-facing behavior for this case. Current
//                     behavior is preserved -- no reply is sent, no UI or
//                     messaging is fabricated, replyText stays null and no
//                     side effect is applied. What SHOULD happen here is
//                     recorded as an open Step 6 rollout decision (see
//                     audit/PHASE_1B_STEP5_REPORT.md), not resolved by this
//                     file.
//
// CONSUMER RESPONSIBILITY, per kind (for whoever eventually wires a live
// caller to this file in a later, separately-approved step):
//   tool_call      -- caller may trust replyText when non-null; must not
//                     assume the underlying tool's raw return value (not
//                     exposed by ExecutorResult) means anything customer-facing.
//   template_reply -- caller may always trust replyText when this kind
//                     produced one; it is pre-approved copy.
//   downgraded     -- caller should treat this exactly like whatever kind
//                     the recursion bottomed out at -- sideEffectsApplied
//                     records the downgrade itself for observability.
//   unavailable    -- caller MUST NOT assume "no reply" means "nothing to
//                     do here." This is the one case this step deliberately
//                     leaves as an open product decision -- see Risks in
//                     the Step 5 readiness review and the Step 5 report.
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabaseAdmin } from '@/lib/supabase'
import { getTool } from '@/lib/ai/tool-registry'
import { checkAndApplyHandoff } from '@/lib/ai/orchestrator'
import { recordMessage } from '@/lib/conversations/unified-conversation-service'
import { buildActionArguments, type ActionArgumentsResult, type ActionArgumentsContext } from '@/lib/ai/action-arguments'
import type { OrchestrationSuccess } from '@/lib/ai/orchestration-engine'
import type { OrchestrationAction } from '@/lib/ai/decision-table'
import type { SlotConflict } from '@/lib/ai/slot-memory'
import type { ChannelType } from '@/types/conversation'

// ─── Input / output ──────────────────────────────────────────────────────────

export interface ExecutorContext {
  /** 'shadow': compute + log only, nothing executed. 'active': actually call/send/record. Explicit parameter -- this file does not read settings.orchestration itself (Step 1's flag stays the caller's concern). */
  mode: 'shadow' | 'active'
  channel: ChannelType
  /** Unified Conversation Platform channel id (UUID) -- distinct from `channel`'s type string. Required for recordMessage(); null is handled gracefully (message recording is skipped, documented at the call site). */
  channelId: string | null
  conversationId: string | null
  /** The inbound unified_messages row id this decision is in response to, if known -- purely for orchestration_decisions' own FK, never required for correctness. */
  messageId?: string | null
  /** Passed straight through to buildActionArguments() -- see action-arguments.ts's own doc comment for why this can't be derived from OrchestrationSuccess. */
  message: string
  inventoryItemId?: string | null
  followUpMessage?: string
  /** Injected, channel-specific send function (e.g. sendWhatsAppText) -- not imported directly, so this file stays channel-agnostic for a future Website Chat wiring (design doc Section 4.2). Only called in active mode, and only when a replyText was actually produced. */
  send: (recipientPhone: string, text: string) => Promise<{ success: boolean }>
}

export interface ExecutorResult {
  mode: 'shadow' | 'active'
  action: OrchestrationAction
  kind: ActionArgumentsResult['kind']
  /** Non-null only for template_reply, or a tool_call whose registered tool already returns an approved customer string (today: only answer_immediately). Never synthesized from raw tool data -- see file header. Always null in shadow mode (nothing is executed to produce one). */
  replyText: string | null
  /** Human-readable log of what actually ran -- e.g. 'tool_call:notify_staff', 'downgraded:generate_proposal->notify_staff'. Empty in shadow mode. */
  sideEffectsApplied: string[]
  /** Present for unavailable/downgraded results (or their own decision.reason otherwise). */
  reason: string | null
  conflicts: SlotConflict[]
  hadConflicts: boolean
  /** True once a real orchestration_decisions row was written for this call (best-effort -- a logging failure here is non-fatal and never surfaces as a thrown error, matching this codebase's established convention). */
  decisionRecorded: boolean
}

// ─── Per-kind execution (active mode only -- see executeOrchestration) ──────

async function performToolCall(
  result: Extract<ActionArgumentsResult, { kind: 'tool_call' }>
): Promise<{ replyText: string | null; sideEffectsApplied: string[] }> {
  try {
    const tool = getTool(result.action)
    // Note: tool.fn's real parameter types vary per action; result.args was built by
    // action-arguments.ts specifically for this action (see that file's own per-action
    // builders). No eslint-disable directive here -- this project's ESLint config
    // (.eslintrc.json, "next/core-web-vitals" only) does not register the
    // @typescript-eslint plugin/rule set, so `any` is not flagged anywhere in this
    // codebase (confirmed: no other file uses an @typescript-eslint/* disable comment);
    // a disable-directive for a rule the config can't resolve produces ESLint's own
    // "Definition for rule ... was not found" error instead of suppressing anything.
    const returned = await (tool.fn as (...args: any[]) => unknown)(...result.args)

    // Only answer_immediately's registered tool (chatWithAI) returns an
    // already-approved, ready-to-send customer string -- see file header
    // "CONSUMER RESPONSIBILITY". Every other action's return value is raw
    // business data this file deliberately does not format into new copy.
    const replyText = result.action === 'answer_immediately' && typeof returned === 'string' ? returned : null

    return { replyText, sideEffectsApplied: [`tool_call:${result.action}`] }
  } catch (err) {
    // Safe failure, structured -- matches inbound-guard.ts / tool-registry.ts's
    // getTool() convention: a thrown/rejected tool.fn must never crash the
    // Executor. No reply is invented in place of the failure.
    return { replyText: null, sideEffectsApplied: [`tool_call_failed:${result.action}`] }
  }
}

function performTemplateReply(
  result: Extract<ActionArgumentsResult, { kind: 'template_reply' }>
): { replyText: string; sideEffectsApplied: string[] } {
  return { replyText: result.replyText, sideEffectsApplied: [`template_reply:${result.action}`] }
}

async function performBranch(
  result: ActionArgumentsResult
): Promise<{ replyText: string | null; sideEffectsApplied: string[] }> {
  switch (result.kind) {
    case 'tool_call':
      return performToolCall(result)

    case 'template_reply':
      return performTemplateReply(result)

    case 'downgraded': {
      // Explicit, not collapsed: recurse into the downgraded sub-result and
      // act on THAT (today, always generate_proposal -> notify_staff's own
      // result, which may itself be a tool_call or an unavailable) --
      // while still recording that a downgrade occurred, so it's never
      // silently indistinguishable from the target action having fired directly.
      const inner = await performBranch(result.result)
      return {
        replyText: inner.replyText,
        sideEffectsApplied: [`downgraded:${result.action}->${result.downgradedTo}`, ...inner.sideEffectsApplied],
      }
    }

    case 'unavailable':
      // EXPLICIT, EXPECTED NO-OP -- per this step's own instruction, this
      // is not a gap to be quietly filled in. See file header's
      // "unavailable" entry and audit/PHASE_1B_STEP5_REPORT.md's "Step 6
      // Rollout Decision Needed" section. Current behavior (no reply, no
      // invented messaging) is preserved.
      return { replyText: null, sideEffectsApplied: [] }
  }
}

// ─── Metadata extraction (used for both shadow and active-mode logging) ────

function extractReason(result: ActionArgumentsResult, fallback: string): string | null {
  if (result.kind === 'unavailable') return result.reason
  if (result.kind === 'downgraded') return `downgraded to ${result.downgradedTo}: ${result.reason}`
  return fallback
}

// ─── orchestration_decisions logging (both modes; see Step 2's migration) ──

async function recordDecision(
  outcome: OrchestrationSuccess,
  result: ActionArgumentsResult,
  ctx: ExecutorContext,
  executed: boolean
): Promise<boolean> {
  try {
    const supabase = getSupabaseAdmin()
    const { hasConflicts, conflicts } = outcome.slots

    const { error } = await supabase.from('orchestration_decisions').insert({
      conversation_id: ctx.conversationId,
      message_id: ctx.messageId ?? null,
      mode: ctx.mode,
      action: result.action,
      reason: extractReason(result, outcome.decision.reason),
      had_conflicts: hasConflicts,
      conflicts: hasConflicts ? conflicts : null,
      executed,
    })

    return !error
  } catch {
    // Non-fatal -- a logging failure must never break the main flow, same
    // convention as syncToUnifiedConversationPlatform() in the WhatsApp
    // webhook route and applyHandoff() in orchestrator.ts.
    return false
  }
}

// ─── recordMessage + post-reply handoff (active mode only, reply-producing results only) ──

async function sendRecordAndCheckHandoff(replyText: string, ctx: ExecutorContext): Promise<void> {
  // Nothing to send to without a resolved conversation -- a brand-new
  // conversation with no id yet is a real, if rare, case this file handles
  // by skipping message recording/handoff rather than guessing an id.
  if (!ctx.conversationId || !ctx.channelId) return

  await recordMessage({
    conversationId: ctx.conversationId,
    channelId: ctx.channelId,
    direction: 'outbound',
    senderType: 'ai',
    content: replyText,
  })

  // Existing, untouched (orchestrator.ts) -- reused exactly as the current
  // chat route already uses it after every AI-generated reply.
  await checkAndApplyHandoff({
    conversationId: ctx.conversationId,
    customerText: ctx.message,
    aiReply: replyText,
  })
}

// ─── Entry point ─────────────────────────────────────────────────────────────

/**
 * Given orchestrate()'s successful outcome, builds arguments (Step 4),
 * then -- in active mode only -- actually executes the corresponding
 * branch of the canonical four-kind result, sends any produced reply,
 * records it, and runs the post-reply handoff check. In shadow mode,
 * nothing is executed at all: only a decision row is written, matching
 * the design doc's own "shadow: computed and logged only" definition.
 * Never throws -- every fallible step (tool calls, DB logging) is
 * independently safe-failed.
 */
export async function executeOrchestration(
  outcome: OrchestrationSuccess,
  ctx: ExecutorContext
): Promise<ExecutorResult> {
  const argsContext: ActionArgumentsContext = {
    outcome,
    channel: ctx.channel,
    conversationId: ctx.conversationId,
    message: ctx.message,
    inventoryItemId: ctx.inventoryItemId,
    followUpMessage: ctx.followUpMessage,
  }
  const result = await buildActionArguments(argsContext)

  let replyText: string | null = null
  let sideEffectsApplied: string[] = []

  if (ctx.mode === 'active') {
    const performed = await performBranch(result)
    replyText = performed.replyText
    sideEffectsApplied = performed.sideEffectsApplied

    if (replyText) {
      const customerPhone = outcome.aiContext.customerProfile.phone
      if (customerPhone) {
        await ctx.send(customerPhone, replyText)
      }
      await sendRecordAndCheckHandoff(replyText, ctx)
    }
  }
  // Shadow mode: performBranch() is never called -- no tool.fn invocation,
  // no send, no recordMessage, no handoff check. replyText stays null and
  // sideEffectsApplied stays empty, matching "shadow: computed and logged
  // only, nothing executed" exactly.

  const decisionRecorded = await recordDecision(outcome, result, ctx, ctx.mode === 'active' && (replyText !== null || sideEffectsApplied.length > 0))

  return {
    mode: ctx.mode,
    action: result.action,
    kind: result.kind,
    replyText,
    sideEffectsApplied,
    reason: extractReason(result, outcome.decision.reason),
    conflicts: outcome.slots.conflicts,
    hadConflicts: outcome.slots.hasConflicts,
    decisionRecorded,
  }
}
