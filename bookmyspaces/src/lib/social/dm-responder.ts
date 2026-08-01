// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/social/dm-responder.ts
// Version 2.0 — Omnichannel Communication Platform.
//
// THE gap this file closes: captureSocialDirectMessage() (dm-capture-
// service.ts) already resolves the customer, creates/updates the lead, and
// records the inbound message — but never generated a reply. Website chat
// (chatWithAI in src/lib/ai.ts) and WhatsApp both eventually produce an AI
// response; Facebook Messenger and Instagram DM did not, silently breaking
// this mission's core requirement ("the same AI should work across every
// channel") for two of the four required channels.
//
// Reuses, does not duplicate:
//   - chatWithAI() (src/lib/ai.ts) — the SAME SYSTEM_PROMPT (the AI
//     Hospitality Sales Consultant Policy) every other channel uses. No
//     channel-specific prompt is created here, per this mission's explicit
//     instruction.
//   - recordMessage()/getOrCreateConversation() (unified-conversation-
//     service.ts) — the same conversation/message store website chat and
//     WhatsApp's Phase 3 mirror already write into.
//   - checkAndApplyHandoff() (orchestrator.ts) — the same escalation policy
//     (human request / complaint / refund / payment issue / low confidence)
//     already enforced everywhere else; not reimplemented per-channel.
//   - the ai_active safety gate — same pattern the WhatsApp orchestration
//     path (src/app/api/whatsapp/webhook/route.ts) already uses: never
//     reply into a conversation a human has taken over.
//   - sendMetaDirectMessage() (dm-send.ts, this same Phase) for the actual
//     Graph API send.
//
// Never throws — a failure here must not break webhook processing (same
// fail-open posture as every other function in this pipeline).
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabaseAdmin } from '@/lib/supabase'
import { chatWithAI, type Message } from '@/lib/ai'
import { recordMessage } from '@/lib/conversations/unified-conversation-service'
import { checkAndApplyHandoff, estimateConfidence } from '@/lib/ai/orchestrator'
import { sendMetaDirectMessage } from '@/lib/social/dm-send'
import { logger } from '@/lib/logger'
import type { MessagingEvent } from '@/lib/social/meta-lead-capture'

export interface DMResponseResult {
  replied: boolean
  reason?: string
}

const HISTORY_LIMIT = 18 // matches chat/route.ts's own cap on conversation context

/**
 * Generates and sends an AI reply for one inbound Messenger/Instagram DM.
 * Call this right after captureSocialDirectMessage() has recorded the
 * inbound message and resolved/created the lead.
 */
export async function respondToSocialDirectMessage(
  event: MessagingEvent,
  conversationId: string,
  channelId: string,
  leadId: string | null
): Promise<DMResponseResult> {
  try {
    if (!event.text?.trim()) {
      return { replied: false, reason: 'no_text' }
    }

    const db = getSupabaseAdmin()

    // ── Safety gate: never reply into a conversation a human has taken over.
    // Identical check to the WhatsApp orchestration path (whatsapp/webhook/
    // route.ts) — unified_conversations.ai_active is the one real "is AI
    // allowed to respond" flag, set false by applyHandoff().
    const { data: conversationRow } = await db
      .from('unified_conversations')
      .select('ai_active')
      .eq('id', conversationId)
      .maybeSingle()

    if (conversationRow?.ai_active === false) {
      logger.info('social-dm-responder', 'Conversation is human-handled (ai_active=false), skipping AI reply', { conversationId })
      return { replied: false, reason: 'ai_paused' }
    }

    // ── Build conversation history for chatWithAI, same shape/limit as
    // chat/route.ts's own messagesForAI (website chat).
    const { data: history } = await db
      .from('unified_messages')
      .select('direction, sender_type, content')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .limit(HISTORY_LIMIT)

    const messagesForAI: Message[] = (history ?? [])
      .filter((m) => m.content)
      .map((m) => ({
        role: m.direction === 'inbound' ? ('user' as const) : ('assistant' as const),
        content: m.content as string,
      }))

    // The just-recorded inbound message may or may not already be in
    // `history` depending on caller ordering — append the live event text
    // if the last history entry isn't it, so chatWithAI always sees the
    // customer's latest message once, never zero times, never duplicated.
    const last = messagesForAI[messagesForAI.length - 1]
    if (!last || last.role !== 'user' || last.content !== event.text) {
      messagesForAI.push({ role: 'user', content: event.text })
    }

    // ── Generate the reply — SAME function, SAME SYSTEM_PROMPT as website
    // chat. No campaign context for a DM (that's a landing-page concept).
    const aiReplyRaw = await chatWithAI(messagesForAI, event.text, null)
    // DM channels have no equivalent of website chat's <<LEAD:...>> tag
    // convention — lead capture for this channel is already handled by
    // captureSocialDirectMessage()/qualifyLeadFromMessage() before this
    // function runs, so the raw reply is sent as-is.
    const aiReply = aiReplyRaw.trim()

    if (!aiReply) {
      return { replied: false, reason: 'empty_ai_reply' }
    }

    // ── Send it back to the customer via the platform's own Send API.
    const sendResult = await sendMetaDirectMessage(event.senderPsid, aiReply)
    if (!sendResult.ok) {
      logger.error('social-dm-responder', 'Failed to send AI reply', { error: sendResult.error, conversationId })
      return { replied: false, reason: sendResult.error }
    }

    // ── Record the outbound message in the same unified store every other
    // channel writes to — Customer Timeline Synchronization, not a new log.
    await recordMessage({
      conversationId,
      channelId,
      direction: 'outbound',
      senderType: 'ai',
      content: aiReply,
      externalMessageId: sendResult.externalMessageId ?? null,
      aiConfidence: estimateConfidence(aiReply),
    })

    // ── Reuse the existing escalation policy — never a channel-specific one.
    await checkAndApplyHandoff({
      conversationId,
      leadId,
      customerText: event.text,
      aiReply,
    })

    return { replied: true }
  } catch (err) {
    logger.error('social-dm-responder', `respondToSocialDirectMessage failed for ${event.platform}`, err)
    return { replied: false, reason: 'exception' }
  }
}
