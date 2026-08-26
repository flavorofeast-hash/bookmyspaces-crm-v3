// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/social/social-ai-reply.ts
// Connects any social DM channel's already-working inbound pipeline to the
// EXISTING AI layer -- no new AI system, no new prompt, no new conversation
// engine. Originally built (and proven end-to-end in production) as
// Instagram-only; renamed here to reflect that it has zero Instagram-
// specific logic and is now also used by Facebook Messenger. This is a
// thin composition of already-channel-agnostic pieces, the same category
// as WhatsApp's runLegacyReplyPath() (src/app/api/whatsapp/webhook/
// route.ts) and website chat's /api/chat/route.ts, both of which
// independently compose chatWithAI/cleanAIResponse the same way.
//
// One real difference from WhatsApp's composition, deliberate: history is
// read from unified_messages (the Unified Conversation Platform), not a
// legacy phone-keyed `conversations` table -- neither Instagram nor
// Facebook Messenger has ever used that legacy table, and unified_messages
// is the correct, already-existing source of truth for both.
//
// Idempotency: this is only ever called by dm-capture-service.ts for a
// message it has already determined is NOT a duplicate delivery (its own
// external_message_id dedup check runs first, channel-agnostic) -- no
// separate dedup logic needed here.
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabaseAdmin } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { chatWithAI, cleanAIResponse, type Message as AIMessage } from '@/lib/ai'
import { evaluateHandoff, estimateConfidence } from '@/lib/ai/orchestrator'
import { formatMessage } from '@/lib/messaging/format-message'
import { getSettingsSection } from '@/lib/settings/settings-service'
import { dispatchOutbound } from '@/lib/conversations/outbound-dispatcher'

/**
 * Generates and sends the AI reply for one already-recorded inbound social
 * DM (Instagram or Facebook Messenger). Never throws -- a failure here
 * must not affect the inbound capture that already succeeded (same
 * non-fatal philosophy as WhatsApp's own AI-call failure handling).
 */
export async function triggerSocialAIReply(input: {
  conversationId: string
  customerText: string | null
}): Promise<void> {
  // Attachment-only messages (no text) have nothing for the AI to respond
  // to -- same gating WhatsApp's handleIncomingMessage applies (only
  // message.type === 'text' reaches buildReply()).
  if (!input.customerText) return

  try {
    const db = getSupabaseAdmin()

    // History already includes this turn's inbound message -- dm-capture-
    // service.ts's recordMessage() ran before this function is called.
    const { data: history } = await db
      .from('unified_messages')
      .select('direction, content')
      .eq('conversation_id', input.conversationId)
      .order('created_at', { ascending: true })
      .limit(20)

    const messagesForAI: AIMessage[] = (history ?? [])
      .filter((m): m is { direction: string; content: string } => typeof m.content === 'string' && m.content.length > 0)
      .map((m) => ({ role: m.direction === 'inbound' ? 'user' : 'assistant', content: m.content }))

    const raw = await chatWithAI(messagesForAI, input.customerText)
    const cleanReply = cleanAIResponse(raw)

    const aiSettings = await getSettingsSection('ai')
    const decision = evaluateHandoff({
      customerText: input.customerText,
      aiConfidence: estimateConfidence(cleanReply),
      settings: aiSettings,
    })
    const reply = formatMessage({ body: cleanReply, includeHandover: decision.escalate })

    const result = await dispatchOutbound({ conversationId: input.conversationId, content: reply, senderType: 'ai' })
    if (!result.delivered) {
      logger.warn('social-ai-reply', 'AI reply recorded but not delivered', {
        conversationId: input.conversationId, channelType: result.channelType, detail: result.detail,
      })
    }
  } catch (err) {
    logger.error('social-ai-reply', 'AI reply pipeline failed (non-fatal, inbound capture unaffected)', err, {
      conversationId: input.conversationId,
    })
  }
}
