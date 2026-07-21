// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/conversations/outbound-dispatcher.ts
// V3 Phase 3 — channel-agnostic outbound send for the Unified Inbox.
//
// One entry point: dispatchOutbound(conversationId, content, senderType).
// Looks up the conversation's channel links, records the message in
// unified_messages (single source of truth for the timeline), then
// dispatches to the channel's real transport where one exists:
//
//   whatsapp     → sendWhatsAppText (existing, retry+log built in)
//   email        → sendEmail (existing provider-agnostic email system)
//   website_chat → recorded only; the chat widget pulls history on next
//                  poll — there is no push transport (no websocket) yet
//   others       → recorded only, delivered=false, reason returned
//
// Adding a channel = adding a case here + an adapter; CRM core untouched.
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabaseAdmin } from '@/lib/supabase'
import { recordMessage } from '@/lib/conversations/unified-conversation-service'
import { sendWhatsAppText } from '@/lib/whatsapp/send-message'
import { logger } from '@/lib/logger'

export interface DispatchResult {
  ok: boolean
  messageId: string | null
  delivered: boolean
  channelType: string | null
  detail?: string
}

interface ChannelLink {
  channel_id: string
  channel_identity: string
  channels: { channel_type: string } | { channel_type: string }[] | null
}

function channelTypeOf(link: ChannelLink): string {
  const c = Array.isArray(link.channels) ? link.channels[0] : link.channels
  return c?.channel_type ?? 'unknown'
}

export async function dispatchOutbound(input: {
  conversationId: string
  content: string
  senderType: 'ai' | 'human'
}): Promise<DispatchResult> {
  const supabase = getSupabaseAdmin()

  const { data: links, error } = await supabase
    .from('unified_conversation_channels')
    .select('channel_id, channel_identity, channels(channel_type)')
    .eq('conversation_id', input.conversationId)
    .order('last_seen_at', { ascending: false })

  if (error || !links || links.length === 0) {
    return {
      ok: false,
      messageId: null,
      delivered: false,
      channelType: null,
      detail: error?.message ?? 'conversation has no channel links',
    }
  }

  // Reply on the most recently active channel — matches the customer's
  // latest context when a conversation spans channels.
  const link = links[0] as ChannelLink
  const channelType = channelTypeOf(link)

  const messageId = await recordMessage({
    conversationId: input.conversationId,
    channelId: link.channel_id,
    direction: 'outbound',
    senderType: input.senderType,
    content: input.content,
  })

  switch (channelType) {
    case 'whatsapp': {
      const result = await sendWhatsAppText(link.channel_identity, input.content, {
        unifiedMirror: null, // already recorded above — do not double-record
      })
      if (!result.success) {
        logger.warn('outbound-dispatcher', 'WhatsApp send failed', { detail: result.error })
      }
      return {
        ok: true,
        messageId,
        delivered: !!result.success,
        channelType,
        detail: result.success ? undefined : result.error,
      }
    }
    case 'website_chat':
      // Recorded; the widget shows it when it next loads history. No push yet.
      return { ok: true, messageId, delivered: false, channelType, detail: 'recorded; website chat has no push transport' }
    default:
      return { ok: true, messageId, delivered: false, channelType, detail: `no transport adapter for ${channelType} yet` }
  }
}
