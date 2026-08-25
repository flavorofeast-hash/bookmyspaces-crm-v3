// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/conversations/unified-conversation-service.ts
// V3 Day 3 — Unified Conversation Platform (Priority 2).
//
// This is the integration gap Day 2 flagged as the largest remaining one
// (audit/DAY2_EXECUTION_REPORT.md, "Priorities Not Addressed #1"): migration
// 012 drew the schema (channels / unified_conversations /
// unified_conversation_channels / unified_messages) but nothing wired a
// Channel Adapter -> Unified Conversation Service -> Identity Resolution ->
// CRM path through it. This file is that service layer.
//
// Scope, deliberately bounded (same reasoning as Day 2's reservation
// services): business logic only, no UI, no channel adapters wired to real
// webhooks yet, no cutover of the existing `conversations` /
// `whatsapp_conversations` tables (those stay live and unchanged — see
// migration 012's own header and the architecture review Section 14
// migration strategy: backfill and migrate one feature at a time).
//
// NOT LIVE-TESTABLE YET: reads/writes channels, unified_conversations,
// unified_conversation_channels, unified_messages — all four exist only in
// the drafted supabase/migrations/012_v3_foundation_schema.sql (not applied
// — no confirmed Supabase network path in this sandbox, same constraint as
// every Day 1/2 reservation/pricing service). Correct against that schema,
// unit-tested against a mocked Supabase client, not run against a real
// database.
//
// Deliberately does NOT decide the leads-vs-customers question — that's
// already resolved (Product Owner, 2026-07-13: extend leads, see migration
// 012's header) — but does NOT auto-create leads either. `customerId` is an
// optional input, expected to come from src/lib/identity/resolve-identity.ts
// (or a future create-lead step) run by the caller/channel adapter, which
// keeps this service channel-agnostic and free of the "should I create a
// new lead" business decision.
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabaseAdmin } from '@/lib/supabase'
import { resolveIdentity, type ResolvedIdentity, type IdentityLookup } from '@/lib/identity/resolve-identity'
import { buildAIContext } from '@/lib/ai/context-builder'
import { logger } from '@/lib/logger'
import type {
  ChannelType,
  GetOrCreateConversationInput,
  GetOrCreateConversationResult,
  RecordMessageInput,
  IngestInboundMessageInput,
  IngestInboundMessageResult,
  HandleInboundMessageInput,
} from '@/types/conversation'
import type { AIContext } from '@/types/ai-context'

// ─── Channel lookup / provisioning ───────────────────────────────────────────
// `channels` is small, slow-changing configuration data (one row per
// integration, e.g. "whatsapp" / "website_chat"), not per-message. Get-or-
// create here is intentional: nothing seeds this table yet, and requiring a
// separate admin step before the first message on a new channel can be
// ingested would block the exact integration this service exists to enable.

export async function ensureChannel(channelType: ChannelType): Promise<string> {
  const supabase = getSupabaseAdmin()

  const { data: existing } = await supabase
    .from('channels')
    .select('id')
    .eq('channel_type', channelType)
    .limit(1)
    .maybeSingle()

  if (existing?.id) return existing.id

  const { data: created, error } = await supabase
    .from('channels')
    .insert({ channel_type: channelType, display_name: channelType, is_active: true })
    .select('id')
    .single()

  if (error || !created?.id) {
    throw new Error(`ensureChannel: failed to create channel row for "${channelType}": ${error?.message ?? 'no id returned'}`)
  }

  return created.id
}

// ─── Conversation lookup / provisioning ──────────────────────────────────────

async function findConversationIdByChannelIdentity(
  channelId: string,
  channelIdentity: string
): Promise<string | null> {
  const supabase = getSupabaseAdmin()

  const { data } = await supabase
    .from('unified_conversation_channels')
    .select('conversation_id')
    .eq('channel_id', channelId)
    .eq('channel_identity', channelIdentity)
    .maybeSingle()

  return data?.conversation_id ?? null
}

/**
 * Finds the existing conversation for a given (channel, channel-native
 * identity) pair — e.g. (whatsapp, "919051459463") — or creates a new
 * unified_conversations row plus its linking unified_conversation_channels
 * row. Touches last_seen_at on repeat contact from the same identity.
 */
export async function getOrCreateConversation(
  input: GetOrCreateConversationInput
): Promise<GetOrCreateConversationResult> {
  const supabase = getSupabaseAdmin()
  const channelId = input.channelId ?? await ensureChannel(input.channelType)

  const existingConversationId = await findConversationIdByChannelIdentity(channelId, input.channelIdentity)

  if (existingConversationId) {
    await supabase
      .from('unified_conversation_channels')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('channel_id', channelId)
      .eq('channel_identity', input.channelIdentity)

    // BUGFIX (customer_id backfill): this branch used to return immediately
    // on every repeat contact, never looking at customer_id again. A
    // conversation created before identity could be resolved -- or via an
    // outbound-only path like mirrorWhatsAppOutbound (whatsapp-unified-sync.ts),
    // which always passes customerId: null since it has no inbound message
    // to resolve identity from -- stayed permanently unlinked from its lead,
    // even once a later inbound message resolved one. Only fills a NULL;
    // never overwrites an already-set customer_id with a different lead.
    if (input.customerId) {
      const { data: existingConv } = await supabase
        .from('unified_conversations')
        .select('customer_id')
        .eq('id', existingConversationId)
        .maybeSingle()

      const customerIdBefore = existingConv?.customer_id ?? null
      logger.info('unified-conversation', 'getOrCreateConversation: reused conversation', {
        conversationId: existingConversationId,
        leadId: input.customerId,
        customerIdBefore,
      })

      if (!customerIdBefore) {
        const { error: backfillError } = await supabase
          .from('unified_conversations')
          .update({ customer_id: input.customerId })
          .eq('id', existingConversationId)

        if (backfillError) {
          logger.error('unified-conversation', 'getOrCreateConversation: customer_id backfill failed', backfillError, {
            conversationId: existingConversationId,
            leadId: input.customerId,
          })
        } else {
          logger.info('unified-conversation', 'getOrCreateConversation: customer_id backfilled', {
            conversationId: existingConversationId,
            customerIdBefore,
            customerIdAfter: input.customerId,
          })
        }
      }
    }

    return { conversationId: existingConversationId, channelId, isNewConversation: false }
  }

  const { data: conversation, error: conversationError } = await supabase
    .from('unified_conversations')
    .insert({
      customer_id: input.customerId ?? null,
      first_touch_channel_id: channelId,
      status: 'open',
      ai_active: true,
    })
    .select('id')
    .single()

  if (conversationError || !conversation?.id) {
    throw new Error(`getOrCreateConversation: failed to create unified_conversations row: ${conversationError?.message ?? 'no id returned'}`)
  }

  const { error: linkError } = await supabase
    .from('unified_conversation_channels')
    .insert({
      conversation_id: conversation.id,
      channel_id: channelId,
      channel_identity: input.channelIdentity,
    })

  if (linkError) {
    throw new Error(`getOrCreateConversation: failed to link channel identity: ${linkError.message}`)
  }

  return { conversationId: conversation.id, channelId, isNewConversation: true }
}

// ─── Message recording ───────────────────────────────────────────────────────

export async function recordMessage(input: RecordMessageInput): Promise<string> {
  const supabase = getSupabaseAdmin()

  const { data, error } = await supabase
    .from('unified_messages')
    .insert({
      conversation_id: input.conversationId,
      channel_id: input.channelId,
      direction: input.direction,
      sender_type: input.senderType,
      content: input.content,
      external_message_id: input.externalMessageId ?? null,
      raw_payload: input.rawPayload ?? null,
      ai_confidence: input.aiConfidence ?? null,
    })
    .select('id')
    .single()

  if (error || !data?.id) {
    throw new Error(`recordMessage: failed to insert unified_messages row: ${error?.message ?? 'no id returned'}`)
  }

  await supabase
    .from('unified_conversations')
    .update({ last_message_at: new Date().toISOString() })
    .eq('id', input.conversationId)

  return data.id
}

// ─── High-level orchestration: the actual Channel Adapter entry point ──────
// This is the function a channel adapter (WhatsApp webhook, website chat,
// a future Facebook/Instagram adapter) calls on every inbound message. It's
// the concrete Channel Adapter -> Unified Conversation Service -> Identity
// Resolution -> CRM path Day 2 flagged as not built yet — identity
// resolution itself stays the caller's responsibility (via
// src/lib/identity/resolve-identity.ts), passed in as `customerId`, so this
// service doesn't have to know each channel's identifier shape (phone vs.
// email vs. PSID) beyond the opaque `channelIdentity` string.

export async function ingestInboundMessage(
  input: IngestInboundMessageInput
): Promise<IngestInboundMessageResult> {
  const { conversationId, channelId, isNewConversation } = await getOrCreateConversation({
    channelType: input.channelType,
    channelIdentity: input.channelIdentity,
    customerId: input.customerId ?? null,
  })

  const messageId = await recordMessage({
    conversationId,
    channelId,
    direction: 'inbound',
    senderType: 'customer',
    content: input.content,
    externalMessageId: input.externalMessageId ?? null,
    rawPayload: input.rawPayload ?? null,
  })

  return { conversationId, channelId, messageId, isNewConversation }
}

// ─── handleInboundMessage — the single, channel-agnostic pipeline ──────────
// V3 Day 4 — Priority 2 completion. Exactly the checklist the master spec
// asks for, each step delegated to an existing service, nothing
// reimplemented: resolve identity (src/lib/identity/resolve-identity.ts) ->
// store the message (ingestInboundMessage, above) -> retrieve history/
// reservations/proposals/preferences and build AI context in one call
// (src/lib/ai/context-builder.ts's buildAIContext(), which already does
// exactly those four retrievals) -> return one structured object.
//
// One function, not two — the same pipeline handles WhatsApp and Website
// Chat (and any future channel) identically; only `channelType` and what
// `channelIdentity` means (phone vs. email vs. session id) differ, and the
// identity lookup below is the only place that distinction matters.

export interface HandleInboundMessageResult {
  conversationId: string
  channelId: string
  messageId: string
  isNewConversation: boolean
  identity: ResolvedIdentity | null
  aiContext: AIContext
}

export async function handleInboundMessage(
  input: HandleInboundMessageInput
): Promise<HandleInboundMessageResult> {
  const lookup: IdentityLookup =
    input.channelType === 'email'
      ? { email: input.channelIdentity }
      : { phone: input.channelIdentity }

  const identity = await resolveIdentity(lookup)

  const ingestResult = await ingestInboundMessage({
    channelType: input.channelType,
    channelIdentity: input.channelIdentity,
    content: input.content,
    externalMessageId: input.externalMessageId ?? null,
    rawPayload: input.rawPayload ?? null,
    customerId: identity?.leadId ?? null,
  })

  const aiContext = await buildAIContext({
    leadId: identity?.leadId ?? null,
    query: input.content,
    conversationId: ingestResult.conversationId,
  })

  return { ...ingestResult, identity, aiContext }
}
