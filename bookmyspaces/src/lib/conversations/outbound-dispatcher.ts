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
//   instagram    → sendInstagramMessage (Graph API, connected account's own
//                  token; external_message_id backfilled onto the
//                  already-recorded row on success — see the instagram case)
//   facebook     → sendFacebookMessage (Graph API, single-Page global
//                  META_PAGE_ID/META_PAGE_ACCESS_TOKEN -- same
//                  credential model as WhatsApp; external_message_id
//                  backfilled the same way as the instagram case)
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
import { sendInstagramMessage } from '@/lib/social/instagram-send'
import { sendFacebookMessage } from '@/lib/social/facebook-send'
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
  channels: { channel_type: string; config?: Record<string, unknown> | null } | { channel_type: string; config?: Record<string, unknown> | null }[] | null
}

function channelOf(link: ChannelLink): { channel_type: string; config: Record<string, unknown> | null } {
  const c = Array.isArray(link.channels) ? link.channels[0] : link.channels
  return { channel_type: c?.channel_type ?? 'unknown', config: c?.config ?? null }
}

export async function dispatchOutbound(input: {
  conversationId: string
  content: string
  senderType: 'ai' | 'human'
}): Promise<DispatchResult> {
  const supabase = getSupabaseAdmin()

  const { data: links, error } = await supabase
    .from('unified_conversation_channels')
    .select('channel_id, channel_identity, channels(channel_type, config)')
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
  const { channel_type: channelType, config } = channelOf(link)

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
    case 'instagram': {
      const igUserId = typeof config?.external_account_id === 'string' ? config.external_account_id : null
      if (!igUserId) {
        logger.error('outbound-dispatcher', 'Instagram channel row has no external_account_id in config', undefined, { channelId: link.channel_id })
        return { ok: true, messageId, delivered: false, channelType, detail: 'instagram_channel_missing_account_id' }
      }

      const result = await sendInstagramMessage(igUserId, link.channel_identity, input.content)
      if (!result.success) {
        logger.warn('outbound-dispatcher', 'Instagram send failed', { detail: result.error })
      } else if (result.externalMessageId) {
        // Backfill the external id onto the row already recorded above —
        // scoped to this case only, does not touch the WhatsApp path or
        // the shared pre-record call.
        await supabase
          .from('unified_messages')
          .update({ external_message_id: result.externalMessageId })
          .eq('id', messageId)
      }
      return {
        ok: true,
        messageId,
        delivered: !!result.success,
        channelType,
        detail: result.success ? undefined : result.error,
      }
    }
    case 'facebook': {
      const result = await sendFacebookMessage(link.channel_identity, input.content)
      if (!result.success) {
        logger.warn('outbound-dispatcher', 'Facebook Messenger send failed', { detail: result.error })
      } else if (result.externalMessageId) {
        await supabase
          .from('unified_messages')
          .update({ external_message_id: result.externalMessageId })
          .eq('id', messageId)
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
