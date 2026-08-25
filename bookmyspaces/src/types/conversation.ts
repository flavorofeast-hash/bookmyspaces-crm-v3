// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/types/conversation.ts
// V3 Day 3 — Unified Conversation Platform (Priority 2, carried over from
// Day 2's "Priorities Not Addressed" list — audit/DAY2_EXECUTION_REPORT.md).
//
// Types for the storage layer defined in migration 012
// (channels / unified_conversations / unified_conversation_channels /
// unified_messages — see supabase/migrations/012_v3_foundation_schema.sql).
// Mirrors src/lib/providers/types.ts's MessagingChannel union so the
// Provider Framework and the Unified Conversation Service agree on channel
// naming without importing across those two layers.
// ─────────────────────────────────────────────────────────────────────────────

export type ChannelType =
  | 'whatsapp'
  | 'website_chat'
  | 'facebook'
  | 'instagram'
  | 'email'
  | 'sms'
  | 'google_business'
  | 'linkedin'

export type ConversationStatus = 'open' | 'closed' | 'escalated'
export type MessageDirection = 'inbound' | 'outbound'
export type MessageSenderType = 'customer' | 'ai' | 'human'

export interface Channel {
  id: string
  channelType: ChannelType
  displayName: string
  isActive: boolean
}

export interface UnifiedConversation {
  id: string
  customerId: string | null
  status: ConversationStatus
  assignedTo: string | null
  aiActive: boolean
  lastMessageAt: string | null
  firstTouchChannelId: string | null
}

export interface UnifiedMessage {
  id: string
  conversationId: string
  channelId: string
  direction: MessageDirection
  senderType: MessageSenderType
  content: string | null
  externalMessageId: string | null
  aiConfidence: number | null
}

// ─── Service inputs/outputs ──────────────────────────────────────────────────

export interface GetOrCreateConversationInput {
  channelType: ChannelType
  /** Channel-native id: phone (E.164), PSID, session id, email address. */
  channelIdentity: string
  /** Known customer (leads.id) to attach on first creation, if already resolved. */
  customerId?: string | null
  /**
   * Pre-resolved channel row id, when the caller already knows which
   * specific channels row this belongs to (e.g. one connected Instagram
   * account among several) rather than the single shared row per
   * channelType that ensureChannel() would otherwise look up/create.
   */
  channelId?: string
}

export interface GetOrCreateConversationResult {
  conversationId: string
  channelId: string
  isNewConversation: boolean
}

export interface RecordMessageInput {
  conversationId: string
  channelId: string
  direction: MessageDirection
  senderType: MessageSenderType
  content: string | null
  externalMessageId?: string | null
  rawPayload?: Record<string, unknown> | null
  aiConfidence?: number | null
}

export interface IngestInboundMessageInput {
  channelType: ChannelType
  channelIdentity: string
  content: string
  externalMessageId?: string | null
  rawPayload?: Record<string, unknown> | null
  /** Already-resolved customer id (e.g. from resolveIdentity()) — attached to a new conversation only. */
  customerId?: string | null
}

export interface IngestInboundMessageResult {
  conversationId: string
  channelId: string
  messageId: string
  isNewConversation: boolean
}

// ─── handleInboundMessage — Priority 2 (Day 4): the single, channel-agnostic
// pipeline. See src/lib/conversations/unified-conversation-service.ts. ────

export interface HandleInboundMessageInput {
  channelType: ChannelType
  /** Channel-native id: phone (whatsapp/sms), email address (email), session id (website_chat). */
  channelIdentity: string
  content: string
  externalMessageId?: string | null
  rawPayload?: Record<string, unknown> | null
}
