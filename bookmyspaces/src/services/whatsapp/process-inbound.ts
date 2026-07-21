// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/services/whatsapp/process-inbound.ts
// Orchestrates a single inbound WhatsApp message through the full pipeline:
//   1. Idempotency check (UNIQUE whatsapp_message_id)
//   2. Source detection
//   3. Lead resolution (find or create)
//   4. Conversation get/create
//   5. Inbound message logging
//   6. Auto-response engine
//   7. CRM timeline update
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabaseAdmin } from '@/lib/supabase'
import { detectSourceChannel } from '@/lib/whatsapp/detect-source'
import { resolveLeadByPhone } from '@/lib/whatsapp/lead-resolver'
import { getOrCreateConversation } from '@/lib/whatsapp/conversation-manager'
import { processAutoResponse } from '@/lib/whatsapp/auto-responder'
import { MessageDirection, MessageStatus, SourceChannel } from '@/constants/conversation-states'
import type { WAInboundMessage, WAContact, ProcessInboundResult } from '@/types/whatsapp'
import { mirrorWhatsAppInbound } from '@/lib/conversations/whatsapp-unified-sync'

export async function processInboundMessage(
  message: WAInboundMessage,
  contact: WAContact | undefined,
  rawPayload: Record<string, unknown>
): Promise<ProcessInboundResult> {
  const supabase = getSupabaseAdmin()

  const phone    = message.from                    // E.164 without +
  const wamid    = message.id                      // WhatsApp Message ID
  const text     = message.text?.body ?? null
  const msgType  = message.type ?? 'unknown'
  const contactName = contact?.profile?.name ?? null

  // ── 1. Idempotency check ──────────────────────────────────────────────────
  // If we've already processed this wamid, skip silently and return success.
  const { data: existing } = await supabase
    .from('whatsapp_messages')
    .select('id, lead_id, conversation_id')
    .eq('whatsapp_message_id', wamid)
    .maybeSingle()

  if (existing) {
    console.log(`[WA Inbound] Duplicate wamid ${wamid} — skipping`)
    return {
      success: true,
      leadId: existing.lead_id,
      conversationId: existing.conversation_id,
      messageId: existing.id,
      responsesSent: 0,
    }
  }

  // ── 2. Detect source channel ──────────────────────────────────────────────
  const channel = detectSourceChannel(message as Parameters<typeof detectSourceChannel>[0])

  // ── 3. Resolve lead ───────────────────────────────────────────────────────
  let lead: Awaited<ReturnType<typeof resolveLeadByPhone>>
  try {
    lead = await resolveLeadByPhone(phone, channel, contactName)
  } catch (err) {
    console.error(`[WA Inbound] Lead resolution failed for ${phone}:`, err)
    return { success: false, leadId: null, conversationId: null, messageId: null, responsesSent: 0, error: String(err) }
  }

  // ── 4. Get or create conversation ─────────────────────────────────────────
  let conversation: Awaited<ReturnType<typeof getOrCreateConversation>>
  try {
    conversation = await getOrCreateConversation(phone, lead.id, channel)
  } catch (err) {
    console.error(`[WA Inbound] Conversation error for ${phone}:`, err)
    return { success: false, leadId: lead.id, conversationId: null, messageId: null, responsesSent: 0, error: String(err) }
  }

  // ── 5. Log inbound message ────────────────────────────────────────────────
  const { data: msgLog, error: msgError } = await supabase
    .from('whatsapp_messages')
    .insert({
      lead_id: lead.id,
      conversation_id: conversation.id,
      phone,
      source_channel: channel,
      direction: MessageDirection.INBOUND,
      message_type: msgType,
      message_text: text,
      message_status: MessageStatus.DELIVERED,  // we received it — mark delivered
      whatsapp_message_id: wamid,
      conversation_state: conversation.current_state,
      raw_payload: rawPayload,
    })
    .select('id')
    .single()

  if (msgError) {
    // Non-fatal — continue with auto-response even if log fails
    console.error(`[WA Inbound] Message log failed for ${wamid}:`, msgError.message)
  }

  // ── 6. CRM activity log ───────────────────────────────────────────────────
  await supabase.from('activity_logs').insert({
    lead_id: lead.id,
    action: 'whatsapp_message_received',
    description: text
      ? `WhatsApp message: "${text.substring(0, 80)}${text.length > 80 ? '…' : ''}"`
      : `WhatsApp ${msgType} received`,
    performed_by: 'whatsapp_bot',
    channel: 'whatsapp',
    metadata: { channel, wamid, state: conversation.current_state },
  })

  // Update lead last_contacted_at
  await supabase
    .from('leads')
    .update({ last_contacted_at: new Date().toISOString() })
    .eq('id', lead.id)

  // ── 6.5 Mirror into the Unified Conversation Platform (V3 Phase 3) ───────
  // Additive alongside the whatsapp_* writes above, which stay canonical
  // for the live WhatsApp UI until cutover. Fire-and-forget: a mirror
  // failure (e.g. migration 012 not applied) never breaks the webhook.
  mirrorWhatsAppInbound({
    phone,
    leadId: lead.id,
    text,
    wamid,
    rawPayload,
  }).catch(err => {
    console.error(`[WA Inbound] unified mirror failed (non-fatal) for ${wamid}:`, err)
  })

  // ── 7. Trigger auto-response ──────────────────────────────────────────────
  let responsesSent = 0
  try {
    responsesSent = await processAutoResponse({
      phone,
      conversation,
      inboundText: text,
      leadId: lead.id,
      leadName: lead.name ?? contactName,
    })
  } catch (err) {
    console.error(`[WA Inbound] Auto-response error for ${phone}:`, err)
    // Non-fatal — message was still logged
  }

  return {
    success: true,
    leadId: lead.id,
    conversationId: conversation.id,
    messageId: msgLog?.id ?? null,
    responsesSent,
  }
}

// ─── Handle delivery status updates ──────────────────────────────────────────

export async function processStatusUpdate(
  wamid: string,
  status: 'sent' | 'delivered' | 'read' | 'failed'
): Promise<void> {
  const supabase = getSupabaseAdmin()

  // Map WA status → our enum
  const statusMap: Record<string, string> = {
    sent: 'sent',
    delivered: 'delivered',
    read: 'read',
    failed: 'failed',
  }

  await supabase
    .from('whatsapp_messages')
    .update({ message_status: statusMap[status] ?? status })
    .eq('whatsapp_message_id', wamid)
}
