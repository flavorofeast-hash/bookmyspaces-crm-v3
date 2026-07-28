// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/ai/inbound-guard.ts
// AI Orchestration Foundation — Hardening Sprint.
// Critical Issue 2 (Infinite Loop Protection) + High Issue 4 (Orchestration
// Input contract) + Security (max message length, input validation, replay
// protection hooks, safe failures, structured error responses).
//
// Pure, synchronous, no I/O — the same discipline slot-memory.ts and
// decision-table.ts already use. This module's only job is to decide,
// from data the caller already has, whether an inbound-labelled event is
// actually safe to run through the orchestration pipeline at all —
// *before* any DB or AI work happens. orchestration-engine.ts calls this
// first and short-circuits on rejection (see its own header for how that
// also serves the Hardening Sprint's Performance goal: never build a full
// AIContext for something that was never going to be processed).
//
// Reuses the channel/direction/sender vocabulary this codebase already
// has — src/types/conversation.ts's ChannelType, MessageDirection and
// MessageSenderType (already the Unified Conversation Platform's own
// contract, mirrored from src/lib/providers/types.ts's MessagingChannel) —
// rather than inventing a parallel enum, per this sprint's "reuse
// everything that already exists" rule.
//
// What this catches, per Critical Issue 2 ("the orchestration engine must
// only process inbound customer messages"):
//   - outbound AI replies             -- direction !== 'inbound'
//   - webhook echoes / operator sends -- source === 'ai' | 'human' (only
//                                         'customer' is a real inbound message)
//   - queued outbound messages        -- caught by the direction check above;
//                                         a queued message re-entering as
//                                         'inbound' would still be caught by
//                                         the source check if it carries a
//                                         non-customer sender, and by
//                                         isDuplicateDelivery if it is a
//                                         redelivery of something already sent
//   - replay events                   -- isReplayEvent === true
//   - duplicated webhook deliveries   -- isDuplicateDelivery === true
//
// This module does NOT itself detect duplicates or replays — it has no
// database access and never will (pure-function discipline, matching
// decision-table.ts's own "the caller gathers, this module only decides"
// contract). The caller (a future channel adapter) computes
// isDuplicateDelivery / isReplayEvent from its own idempotency store (e.g.
// "has this messageId already been written to unified_messages") and
// passes the boolean in. This is the "replay protection hooks" the
// Hardening Sprint's Security section asks for: the enforcement point
// exists and is wired in; the storage-backed detection is a caller
// concern, same as everywhere else pure functions sit in this codebase.
// ─────────────────────────────────────────────────────────────────────────────

import type { ChannelType, MessageDirection, MessageSenderType } from '@/types/conversation'

/** Security: bounds worst-case regex/extraction work and AI token spend on a single turn. */
export const MAX_MESSAGE_LENGTH = 4000

export type RejectionReason =
  | 'missing_required_field'
  | 'empty_message'
  | 'message_too_long'
  | 'not_inbound_direction'
  | 'non_customer_source'
  | 'replay_event'
  | 'duplicate_delivery'

export interface InboundGuardInput {
  /** Mandatory (High Issue 4). Typed loosely as `| null | undefined` here (rather than
   *  required-non-null) specifically so malformed/missing input is a normal, testable
   *  *value* this function validates and rejects structurally -- never a TypeScript-only
   *  guarantee that can't actually be relied on once real webhook JSON is involved. */
  channel: ChannelType | null | undefined
  direction: MessageDirection | null | undefined
  messageId: string | null | undefined
  /** Required key, but an explicit `null` is valid -- a brand-new conversation has no id yet.
   *  `undefined` (the key omitted entirely) is what gets rejected as missing. */
  conversationId: string | null | undefined
  source: MessageSenderType | null | undefined
  message: string | null | undefined
  /** Caller-computed: true when this exact messageId has already been processed/delivered before. */
  isDuplicateDelivery?: boolean
  /** Caller-computed: true when this event is a replay/redelivery of a previously processed webhook payload. */
  isReplayEvent?: boolean
}

export interface InboundGuardResult {
  allowed: boolean
  rejectionReason: RejectionReason | null
  /** Human-readable, safe to log -- never includes the raw message body (PII hygiene). */
  detail: string
}

/** Only 'customer' is a real inbound message. 'ai' and 'human' are always something the
 *  business itself sent -- an echo of one of those arriving as "new inbound input" is
 *  exactly the infinite-loop shape Critical Issue 2 exists to prevent. */
const NON_CUSTOMER_SOURCES: MessageSenderType[] = ['ai', 'human']

function isMissing(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === 'string' && v.trim().length === 0)
}

/**
 * Validates + loop-guards one inbound-labelled event before it is allowed
 * into the orchestration pipeline. Never throws -- always returns a
 * structured result (Security: "safe failures", "structured error
 * responses"). Checks cheapest/most-fundamental conditions first so a
 * malformed or looping event is rejected before any expensive work would
 * even be attempted.
 */
export function validateInboundMessage(input: InboundGuardInput): InboundGuardResult {
  // --- Security: mandatory-field validation (High Issue 4 contract) -----------
  if (isMissing(input.channel)) {
    return { allowed: false, rejectionReason: 'missing_required_field', detail: 'channel is required' }
  }
  if (isMissing(input.direction)) {
    return { allowed: false, rejectionReason: 'missing_required_field', detail: 'direction is required' }
  }
  if (isMissing(input.messageId)) {
    return { allowed: false, rejectionReason: 'missing_required_field', detail: 'messageId is required' }
  }
  if (input.conversationId === undefined) {
    return {
      allowed: false,
      rejectionReason: 'missing_required_field',
      detail: 'conversationId is required (pass null explicitly for a not-yet-created conversation)',
    }
  }
  if (isMissing(input.source)) {
    return { allowed: false, rejectionReason: 'missing_required_field', detail: 'source is required' }
  }
  if (isMissing(input.message)) {
    return { allowed: false, rejectionReason: 'empty_message', detail: 'message body is empty' }
  }

  // --- Security: bound input size before any regex extraction or AI call ------
  if ((input.message as string).length > MAX_MESSAGE_LENGTH) {
    return {
      allowed: false,
      rejectionReason: 'message_too_long',
      detail: `message exceeds ${MAX_MESSAGE_LENGTH} characters (${(input.message as string).length})`,
    }
  }

  // --- Critical Issue 2: infinite loop protection ------------------------------
  if (input.direction !== 'inbound') {
    return {
      allowed: false,
      rejectionReason: 'not_inbound_direction',
      detail: `direction '${input.direction}' is not inbound -- refusing to re-process an outbound message`,
    }
  }
  if (NON_CUSTOMER_SOURCES.includes(input.source as MessageSenderType)) {
    return {
      allowed: false,
      rejectionReason: 'non_customer_source',
      detail: `source '${input.source}' is not a customer message -- refusing to treat our own ${input.source} output as new inbound input`,
    }
  }
  if (input.isReplayEvent) {
    return { allowed: false, rejectionReason: 'replay_event', detail: 'event is flagged as a replay of a previously processed webhook payload' }
  }
  if (input.isDuplicateDelivery) {
    return { allowed: false, rejectionReason: 'duplicate_delivery', detail: `messageId '${input.messageId}' has already been processed` }
  }

  return { allowed: true, rejectionReason: null, detail: 'ok' }
}
