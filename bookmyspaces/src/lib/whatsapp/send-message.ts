import { getSupabaseAdmin } from '@/lib/supabase'
import { MessageDirection, MessageStatus, SourceChannel } from '@/constants/conversation-states'
import { normalizePhone } from './normalize-phone'
import { isMetaConfigured } from './meta-configured'
import { mirrorWhatsAppOutbound } from '@/lib/conversations/whatsapp-unified-sync'
import { logger } from '@/lib/logger'
import type {
  WASendTextRequest,
  WASendTemplateRequest,
  WASendResponse,
  SendMessageResult,
  TemplateParam,
  BroadcastRecipient,
} from '@/types/whatsapp'

const WA_API_VERSION = 'v23.0'
const MAX_RETRIES    = 2
const RETRY_DELAY_MS = 500

async function callWhatsAppAPI(
  payload: WASendTextRequest | WASendTemplateRequest
): Promise<WASendResponse> {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID
  const accessToken   = process.env.WHATSAPP_ACCESS_TOKEN

  if (!phoneNumberId || !accessToken) {
    throw new Error('Missing WHATSAPP_PHONE_NUMBER_ID or WHATSAPP_ACCESS_TOKEN env vars')
  }

  const url = `https://graph.facebook.com/${WA_API_VERSION}/${phoneNumberId}/messages`

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const errBody = await res.text()
    throw new Error(`WhatsApp API error ${res.status}: ${errBody}`)
  }

  return res.json() as Promise<WASendResponse>
}

export async function sendWhatsAppText(
  to: string,
  body: string,
  opts: {
    leadId?: string | null
    conversationId?: string | null
    conversationState?: string | null
    sourceChannel?: SourceChannel
    /**
     * V3 Phase 3 — Unified Conversation Platform mirror. 'ai' (default) or
     * 'human' records this outbound send in unified_messages; null skips
     * (used by the Unified Inbox dispatcher, which records first itself).
     */
    unifiedMirror?: 'ai' | 'human' | null
  } = {}
): Promise<SendMessageResult> {
  if (!isMetaConfigured()) {
    console.info('[WA Send] Meta not configured — send skipped (mock mode)')
    return { success: false, error: 'not_configured' }
  }

  to = normalizePhone(to)
  const supabase = getSupabaseAdmin()

  const { data: logRow } = await supabase
    .from('whatsapp_messages')
    .insert({
      phone: to,
      lead_id: opts.leadId ?? null,
      conversation_id: opts.conversationId ?? null,
      source_channel: opts.sourceChannel ?? SourceChannel.UNKNOWN,
      direction: MessageDirection.OUTBOUND,
      message_type: 'text',
      message_text: body,
      message_status: MessageStatus.PENDING,
      conversation_state: opts.conversationState ?? null,
      raw_payload: { to, body },
    })
    .select('id')
    .single()

  const logId = logRow?.id ?? null

  const payload: WASendTextRequest = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: { body },
  }

  let lastError: string | null = null

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await callWhatsAppAPI(payload)
      const waMessageId = response.messages?.[0]?.id ?? null

      if (logId) {
        await supabase
          .from('whatsapp_messages')
          .update({
            message_status: MessageStatus.SENT,
            whatsapp_message_id: waMessageId,
          })
          .eq('id', logId)
      }

      // V3 Phase 3 — mirror into the Unified Conversation Platform.
      // Fire-and-forget, never fatal (same contract as the website-chat
      // mirror in api/chat/route.ts): a mirror failure must not fail a
      // send that already succeeded.
      if (opts.unifiedMirror !== null) {
        mirrorWhatsAppOutbound({
          phone: to,
          text: body,
          senderType: opts.unifiedMirror ?? 'ai',
          externalMessageId: waMessageId,
        }).catch(err2 => {
          logger.error('whatsapp-send', 'Unified mirror failed (non-fatal)', err2, { phone: to })
        })
      }

      return { success: true, waMessageId: waMessageId ?? undefined }
    } catch (err: unknown) {
      lastError = err instanceof Error ? err.message : String(err)
      logger.error('whatsapp-send', `Attempt ${attempt + 1} failed`, lastError, { phone: to })

      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)))
      }
    }
  }

  if (logId) {
    await supabase
      .from('whatsapp_messages')
      .update({ message_status: MessageStatus.FAILED })
      .eq('id', logId)
  }

  logger.error('whatsapp-send', 'All retries failed', lastError, { phone: to })
  return { success: false, error: lastError ?? 'Unknown error' }
}

export async function sendWhatsAppTemplate(
  to: string,
  templateName: string,
  languageCode: string,
  components: WASendTemplateRequest['template']['components'],
  opts: {
    leadId?: string | null
    conversationId?: string | null
    sourceChannel?: SourceChannel
  } = {}
): Promise<SendMessageResult> {
  if (!isMetaConfigured()) {
    console.info('[WA Send] Meta not configured — template send skipped (mock mode)')
    return { success: false, error: 'not_configured' }
  }

  to = normalizePhone(to)
  const supabase = getSupabaseAdmin()

  const { data: logRow } = await supabase
    .from('whatsapp_messages')
    .insert({
      phone: to,
      lead_id: opts.leadId ?? null,
      conversation_id: opts.conversationId ?? null,
      source_channel: opts.sourceChannel ?? SourceChannel.UNKNOWN,
      direction: MessageDirection.OUTBOUND,
      message_type: 'template',
      template_name: templateName,
      message_status: MessageStatus.PENDING,
      raw_payload: { to, templateName, languageCode },
    })
    .select('id')
    .single()

  const logId = logRow?.id ?? null

  const payload: WASendTemplateRequest = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'template',
    template: { name: templateName, language: { code: languageCode }, components },
  }

  try {
    const response = await callWhatsAppAPI(payload)
    const waMessageId = response.messages?.[0]?.id ?? null

    if (logId) {
      await supabase
        .from('whatsapp_messages')
        .update({ message_status: MessageStatus.SENT, whatsapp_message_id: waMessageId })
        .eq('id', logId)
    }

    return { success: true, waMessageId: waMessageId ?? undefined }
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err)
    if (logId) {
      await supabase
        .from('whatsapp_messages')
        .update({ message_status: MessageStatus.FAILED })
        .eq('id', logId)
    }
    return { success: false, error: errMsg }
  }
}

export async function sendWhatsAppTemplateSimple(
  to: string,
  templateName: string,
  params: TemplateParam[] = [],
  opts: {
    leadId?: string | null
    conversationId?: string | null
    sourceChannel?: SourceChannel
  } = {}
): Promise<SendMessageResult> {
  const components: WASendTemplateRequest['template']['components'] =
    params.length > 0
      ? [{ type: 'body', parameters: params.map(p => ({ type: 'text', text: p.value })) }]
      : []

  return sendWhatsAppTemplate(to, templateName, 'en', components, opts)
}

export async function sendBroadcastCampaign(
  recipients: BroadcastRecipient[],
  templateName: string,
  broadcastName: string
): Promise<{ success: number; failed: number }> {
  if (!isMetaConfigured()) {
    console.info(`[WA Send] Meta not configured — broadcast "${broadcastName}" skipped (mock mode)`)
    return { success: 0, failed: recipients.length }
  }

  let success = 0
  let failed = 0

  for (const r of recipients) {
    const result = await sendWhatsAppTemplateSimple(r.whatsappNumber, templateName, r.customParams)
    if (result.success) success++
    else failed++
    await new Promise(res => setTimeout(res, 120))
  }

  return { success, failed }
}
