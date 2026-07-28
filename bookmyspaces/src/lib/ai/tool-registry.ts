// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/ai/tool-registry.ts
// AI Orchestration Foundation — Phase 1A. Made exhaustive at compile time and
// hardened against a runtime-invalid action in the post-review Hardening
// Sprint (High Issue 1).
//
// A lookup map from each OrchestrationAction (decision-table.ts) to the real,
// already-existing function that performs it. Nothing in this file
// re-implements, wraps with new logic, or changes the behavior of any
// service it points to -- every entry is the actual imported function
// reference, re-exported under its action name. If a mapped function's
// signature ever changes, this file's exported types change with it
// automatically (they're derived via `typeof`, not hand-copied).
//
// Where more than one action legitimately shares the same underlying
// primitive, this registry reuses one entry rather than duplicating it:
//   - check_room_availability / check_banquet_availability both call
//     checkAvailability() -- the room-vs-banquet distinction is which
//     inventoryItemId the caller passes in, not two different functions.
//   - create_lead / update_lead both call captureLeadWithJourney() -- it
//     already resolves internally whether the identity is new or existing
//     (src/lib/leads/create-lead-with-journey.ts) and does the right thing
//     either way.
//   - schedule_follow_up / notify_staff both call enqueueMessage() -- the
//     Message Queue (src/lib/queue.ts) is the one real "send this WhatsApp
//     message, now or later" primitive in the codebase; a follow-up to the
//     customer and an alert to an operator are the same mechanism aimed at
//     a different phone number, decided by the caller, not by this file.
//
// Two actions -- ask_question and collect_missing_information -- have no
// dedicated exported function anywhere in the codebase today.
// src/lib/whatsapp/auto-responder.ts has a MESSAGES template object that
// would be the natural fit, but it is a module-private constant, not
// exported, and this phase's explicit rule is "do not touch existing
// services" -- so it is not exported here either. Both actions are
// registered against chatWithAI() instead: asking a clarifying or missing-
// information question in natural language is a normal (if narrowly
// scoped) use of the same conversational function already used for
// answer_immediately, and it requires no change to any existing file. This
// is a documented judgment call, not a clean 1:1 mapping -- flagged here
// and in the Phase 1A deliverables as a real gap, and a reasonable
// candidate for Phase 1B (export auto-responder.ts's templates for reuse).
// ─────────────────────────────────────────────────────────────────────────────

import { chatWithAI } from '@/lib/ai'
import { checkAvailability } from '@/lib/reservations/availability-service'
import { runAutoPackageRecommendation } from '@/lib/leads/auto-package-recommendation'
import { getActivePackagePrices } from '@/lib/pricing/pricing-service'
import { createProposalFromReservation } from '@/lib/proposals/proposal-service'
import { captureLeadWithJourney } from '@/lib/leads/create-lead-with-journey'
import { enqueueMessage } from '@/lib/queue'
import { applyHandoff } from '@/lib/ai/orchestrator'
import type { OrchestrationAction } from '@/lib/ai/decision-table'

/** One entry per registered tool: the real function, plus where it lives and why, for observability/debugging. */
export interface ToolRegistryEntry<T extends (...args: any[]) => any> {
  action: OrchestrationAction
  /** The actual existing function -- never a rewritten copy. */
  fn: T
  sourceModule: string
  sourceExport: string
  /** True where this action shares its tool with another action (documented above). */
  sharedWith?: OrchestrationAction[]
  /** Set only for the two actions with no dedicated existing function -- see file header. */
  knownGap?: string
}

function entry<T extends (...args: any[]) => any>(e: ToolRegistryEntry<T>): ToolRegistryEntry<T> {
  return e
}

export const toolRegistry = {
  answer_immediately: entry({
    action: 'answer_immediately',
    fn: chatWithAI,
    sourceModule: 'src/lib/ai.ts',
    sourceExport: 'chatWithAI',
  }),

  ask_question: entry({
    action: 'ask_question',
    fn: chatWithAI,
    sourceModule: 'src/lib/ai.ts',
    sourceExport: 'chatWithAI',
    sharedWith: ['collect_missing_information', 'answer_immediately'],
    knownGap: 'No dedicated exported question-template function exists yet; auto-responder.ts\'s MESSAGES object is the natural source but is module-private. See file header.',
  }),

  collect_missing_information: entry({
    action: 'collect_missing_information',
    fn: chatWithAI,
    sourceModule: 'src/lib/ai.ts',
    sourceExport: 'chatWithAI',
    sharedWith: ['ask_question', 'answer_immediately'],
    knownGap: 'Same as ask_question -- see file header.',
  }),

  check_room_availability: entry({
    action: 'check_room_availability',
    fn: checkAvailability,
    sourceModule: 'src/lib/reservations/availability-service.ts',
    sourceExport: 'checkAvailability',
    sharedWith: ['check_banquet_availability'],
  }),

  check_banquet_availability: entry({
    action: 'check_banquet_availability',
    fn: checkAvailability,
    sourceModule: 'src/lib/reservations/availability-service.ts',
    sourceExport: 'checkAvailability',
    sharedWith: ['check_room_availability'],
  }),

  recommend_package: entry({
    action: 'recommend_package',
    fn: runAutoPackageRecommendation,
    sourceModule: 'src/lib/leads/auto-package-recommendation.ts',
    sourceExport: 'runAutoPackageRecommendation',
  }),

  generate_quotation: entry({
    action: 'generate_quotation',
    fn: getActivePackagePrices,
    sourceModule: 'src/lib/pricing/pricing-service.ts',
    sourceExport: 'getActivePackagePrices',
  }),

  generate_proposal: entry({
    action: 'generate_proposal',
    fn: createProposalFromReservation,
    sourceModule: 'src/lib/proposals/proposal-service.ts',
    sourceExport: 'createProposalFromReservation',
  }),

  create_lead: entry({
    action: 'create_lead',
    fn: captureLeadWithJourney,
    sourceModule: 'src/lib/leads/create-lead-with-journey.ts',
    sourceExport: 'captureLeadWithJourney',
    sharedWith: ['update_lead'],
  }),

  update_lead: entry({
    action: 'update_lead',
    fn: captureLeadWithJourney,
    sourceModule: 'src/lib/leads/create-lead-with-journey.ts',
    sourceExport: 'captureLeadWithJourney',
    sharedWith: ['create_lead'],
  }),

  schedule_follow_up: entry({
    action: 'schedule_follow_up',
    fn: enqueueMessage,
    sourceModule: 'src/lib/queue.ts',
    sourceExport: 'enqueueMessage',
    sharedWith: ['notify_staff'],
  }),

  notify_staff: entry({
    action: 'notify_staff',
    fn: enqueueMessage,
    sourceModule: 'src/lib/queue.ts',
    sourceExport: 'enqueueMessage',
    sharedWith: ['schedule_follow_up'],
    knownGap: 'No dedicated "notification service" export exists -- notifyOperator() in auto-responder.ts is module-private, and src/app/api/notifications/route.ts is an API route (in-app read/mark-read), not an importable service. enqueueMessage() is the closest real, reusable "deliver this to someone" primitive. See file header.',
  }),

  handoff_to_human: entry({
    action: 'handoff_to_human',
    fn: applyHandoff,
    sourceModule: 'src/lib/ai/orchestrator.ts',
    sourceExport: 'applyHandoff',
  }),
} satisfies Record<OrchestrationAction, ToolRegistryEntry<any>>
// ^ Hardening Sprint, High Issue 1: `satisfies Record<OrchestrationAction, ...>`
// makes this exhaustive AT COMPILE TIME, not just via the runtime test below.
// If decision-table.ts's OrchestrationAction union ever gains a new action
// without a matching entry added here, `tsc` fails the build immediately --
// `as const` alone (the previous approach) only fixed the *value* types, it
// never actually checked every action was present. `satisfies` (unlike a
// plain type annotation) also keeps each entry's literal/narrowed type, so
// `toolRegistry.answer_immediately.fn` etc. still resolve to their real
// function signatures, not the widened `ToolRegistryEntry<any>` shape.

export type ToolRegistry = typeof toolRegistry

/**
 * Look up a tool entry by action. Exhaustive over OrchestrationAction at
 * compile time (the `satisfies` check above). The runtime guard below is
 * defensive-only -- it protects against a value that only *claims* to be an
 * OrchestrationAction at the type level (e.g. an unvalidated string cast, or
 * a decision-table bug that returns something outside the union) rather
 * than dereferencing `.fn` on `undefined` and failing with an opaque
 * TypeError somewhere downstream. Security: safe failure with a structured,
 * loggable error instead of a silent bad lookup.
 */
export function getTool<A extends OrchestrationAction>(action: A): ToolRegistry[A] {
  const found = toolRegistry[action]
  if (!found) {
    throw new Error(`tool-registry: no registered tool for action "${String(action)}" -- this should be unreachable if OrchestrationAction and toolRegistry stay in sync`)
  }
  return found
}

/** All actions currently missing a dedicated existing function -- for the Phase 1A deliverables and future Phase 1B planning. */
export function listKnownGaps(): Array<{ action: OrchestrationAction; gap: string }> {
  return (Object.values(toolRegistry) as Array<ToolRegistryEntry<any>>)
    .filter((e) => e.knownGap)
    .map((e) => ({ action: e.action, gap: e.knownGap as string }))
}
