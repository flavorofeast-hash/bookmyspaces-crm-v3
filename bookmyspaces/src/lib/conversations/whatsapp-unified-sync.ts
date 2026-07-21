// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/conversations/whatsapp-unified-sync.ts
// V3 Phase 3 — WhatsApp → Unified Conversation Platform mirror.
//
// Website chat has mirrored every exchange into the unified platform since
// Day 5 (see api/chat/route.ts's syncToUnifiedConversationPlatform). This
// file gives WhatsApp the identical treatment: every inbound message and
// every outbound send is mirrored into channels/unified_conversations/
// unified_messages, additively, alongside the legacy whatsapp_* tables
// which stay canonical for the live WhatsApp UI until cutover.
//
// Same contract as the website-chat mirror: FIRE-AND-FORGET, NEVER FATAL.
// A mirror failure (e.g. migration 012 not applied) must never break the
// production WhatsApp pipeline. Callers .catch() and log; nothing here
// throws into the webhook path.
//
// Unlike website chat (identity = anonymous session id), WhatsApp knows the
// lead immediately (resolveLeadByPhone runs before the mirror), so
// customerId is passed through and unified conversations from WhatsApp are
// customer-linked from the first message.
// ─────────────────────────────────────────────────────────────────────────────

import {
  ingestInboundMessage,
  getOrCreateConversation,
  recordMessage,
} from '@/lib/conversations/unified-conversation-service'

export async function mirrorWhatsAppInbound(input: {
  phone: string
  leadId: string | null
  text: string | null
  wamid: string
  rawPayload?: Record<string, unknown>
}): Promise<void> {
  await ingestInboundMessage({
    channelType: 'whatsapp',
    channelIdentity: input.phone,
    content: input.text ?? '',
    externalMessageId: input.wamid,
    rawPayload: input.rawPayload ?? null,
    customerId: input.leadId,
  })
}

export async function mirrorWhatsAppOutbound(input: {
  phone: string
  text: string
  senderType: 'ai' | 'human'
  externalMessageId?: string | null
}): Promise<void> {
  const { conversationId, channelId } = await getOrCreateConversation({
    channelType: 'whatsapp',
    channelIdentity: input.phone,
    customerId: null,
  })

  await recordMessage({
    conversationId,
    channelId,
    direction: 'outbound',
    senderType: input.senderType,
    content: input.text,
    externalMessageId: input.externalMessageId ?? null,
  })
}
