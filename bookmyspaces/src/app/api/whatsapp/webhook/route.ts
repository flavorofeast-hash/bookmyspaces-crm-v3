// src/app/api/whatsapp/webhook/route.ts
// Meta Cloud API webhook — verification + inbound message handling

import { NextRequest, NextResponse } from 'next/server'
import { sendWhatsAppText }          from '@/lib/whatsapp/send-message'
import { getSupabaseAdmin }          from '@/lib/supabase'
import { verifySignature }           from '@/lib/whatsapp/verify-signature'
import { handleInboundMessage, recordMessage } from '@/lib/conversations/unified-conversation-service'
import { logger } from '@/lib/logger'
import { checkRateLimit, clientIpFrom } from '@/lib/rate-limit'

export const dynamic    = 'force-dynamic'
export const runtime    = 'nodejs'
export const maxDuration = 30

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)

  const mode      = searchParams.get('hub.mode')
  const token     = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')

  const verifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN

  if (!verifyToken) {
    logger.error('whatsapp-webhook', 'WHATSAPP_WEBHOOK_VERIFY_TOKEN is not set. Add it in Vercel -> Project -> Settings -> Environment Variables, then redeploy.')
    return new NextResponse('Server configuration error', { status: 500 })
  }

  const cleanVerifyToken   = verifyToken.trim()
  const cleanTokenFromMeta = (token ?? '').trim()

  if (mode === 'subscribe' && cleanVerifyToken === cleanTokenFromMeta) {
    if (!challenge) {
      return new NextResponse('Bad Request: missing challenge', { status: 400 })
    }
    return new NextResponse(challenge, {
      status:  200,
      headers: { 'Content-Type': 'text/plain' },
    })
  }

  return new NextResponse('Forbidden', { status: 403 })
}

export async function POST(request: NextRequest) {
  // RC hardening: the social webhook (api/social/webhook/[platform]) already had
  // IP rate-limiting alongside its signature check; this route only had the
  // signature check. Added for parity/defense-in-depth — matters most when
  // WHATSAPP_APP_SECRET is unset (signatureCheck === 'unconfigured' below, which
  // logs a warning but does not reject) or misconfigured, where this becomes the
  // only backstop against a flood of forged requests.
  const rl = checkRateLimit(`whatsapp-webhook:${clientIpFrom(request)}`, { limit: 120, windowMs: 60_000 })
  if (!rl.allowed) {
    return new NextResponse('Too Many Requests', { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } })
  }

  const rawBody = await request.text()
  const signatureCheck = verifySignature(rawBody, request.headers.get('x-hub-signature-256'))

  if (signatureCheck === 'unconfigured') {
    logger.warn('whatsapp-webhook', 'WHATSAPP_APP_SECRET not set — signature NOT verified. Configure it to enable ISS-004 enforcement.')
  } else if (signatureCheck === 'invalid') {
    logger.error('whatsapp-webhook', 'Rejected: invalid X-Hub-Signature-256 (forged or misconfigured request).')
    return new NextResponse('Forbidden', { status: 403 })
  }

  let body: WhatsAppWebhookPayload

  try {
    body = JSON.parse(rawBody)
  } catch {
    return new NextResponse('Bad Request', { status: 400 })
  }

  if (body.object !== 'whatsapp_business_account') {
    return new NextResponse('OK', { status: 200 })
  }

  try {
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (change.field !== 'messages') continue

        const value = change.value

        for (const status of value.statuses ?? []) {
          logger.info('whatsapp-webhook', 'Status update', {
            id:        status.id,
            status:    status.status,
            recipient: status.recipient_id,
            errors:    status.errors ?? null,
          })
        }

        for (const message of value.messages ?? []) {
          const contact    = value.contacts?.find(c => c.wa_id === message.from)
          const senderName = contact?.profile?.name ?? 'Unknown'
          await handleIncomingMessage(message, senderName)
        }
      }
    }
  } catch (err) {
    logger.error('whatsapp-webhook', 'Error processing payload', err)
  }

  return new NextResponse('OK', { status: 200 })
}

async function handleIncomingMessage(
  message:    WhatsAppMessage,
  senderName: string
) {
  const from = message.from

  try {
    if (message.type === 'text') {
      const text  = message.text?.body ?? ''
      const reply = await buildAutoReply(text, senderName)

      await sendWhatsAppText(from, reply)

      await persistConversation(from, senderName, text, reply)

      // V3 Day 5 — mirror this exchange into the Unified Conversation
      // Platform (Day 4's handleInboundMessage pipeline) alongside the
      // legacy `conversations` write above, which stays canonical for the
      // live CRM UI until a real cutover. Fire-and-forget and fully
      // isolated: a failure here (e.g. migration 012 not yet applied in
      // this environment) must never affect the WhatsApp reply already
      // sent, so it's caught here rather than by the outer try/catch.
      syncToUnifiedConversationPlatform(from, text, reply, message.id).catch(err => {
        logger.error('whatsapp-webhook', 'Unified Conversation Platform sync failed (non-fatal)', err, { phone: from })
      })
    }
  } catch (err) {
    logger.error('whatsapp-webhook', 'Error handling message', err, { phone: from })
  }
}

// ─── Unified Conversation Platform sync (Day 5) ────────────────────────────
// Best-effort mirror of every inbound/outbound WhatsApp message into the V3
// Unified Conversation Platform (channels / unified_conversations /
// unified_messages — migration 012), via the same handleInboundMessage()
// pipeline Day 4 built and unit-tested. This is additive, not a
// replacement: persistConversation() above keeps writing the live
// `conversations` table the current CRM UI reads from. Errors surface as a
// single caught rejection to the caller, never as a webhook failure —
// safe to run whether or not migration 012 has been applied yet.
async function syncToUnifiedConversationPlatform(
  phone:              string,
  inbound:            string,
  outbound:           string,
  externalMessageId:  string
): Promise<void> {
  const result = await handleInboundMessage({
    channelType:        'whatsapp',
    channelIdentity:    phone,
    content:            inbound,
    externalMessageId,
  })

  await recordMessage({
    conversationId: result.conversationId,
    channelId:      result.channelId,
    direction:      'outbound',
    senderType:     'ai',
    content:        outbound,
  })
}

async function persistConversation(
  phone:      string,
  senderName: string,
  inbound:    string,
  outbound:   string
): Promise<void> {
  const db        = getSupabaseAdmin()
  const sessionId = `wa_${phone}`
  const now       = new Date().toISOString()

  const { data: lead } = await db
    .from('leads')
    .select('id')
    .eq('phone', phone)
    .maybeSingle()

  const leadId = lead?.id ?? null

  const { data: existing } = await db
    .from('conversations')
    .select('id, messages')
    .eq('session_id', sessionId)
    .maybeSingle()

  const prevMessages: ConversationMessage[] =
    Array.isArray(existing?.messages) ? existing.messages : []

  const newMessages: ConversationMessage[] = [
    ...prevMessages,
    { role: 'user',      content: inbound,  timestamp: now },
    { role: 'assistant', content: outbound, timestamp: now },
  ]

  if (existing?.id) {
    await db
      .from('conversations')
      .update({
        messages:   newMessages,
        updated_at: now,
        ...(leadId && { lead_id: leadId }),
      })
      .eq('id', existing.id)
  } else {
    await db
      .from('conversations')
      .insert({
        session_id:      sessionId,
        channel:         'whatsapp',
        lead_id:         leadId,
        messages:        newMessages,
        extracted_name:  senderName !== 'Unknown' ? senderName : null,
        extracted_phone: phone,
        is_active:       true,
      })
  }

  if (leadId) {
    await db
      .from('leads')
      .update({
        last_contacted_at:       now,
        whatsapp_last_message_at: now,
        updated_at:               now,
      })
      .eq('id', leadId)
  }
}

async function buildAutoReply(text: string, name: string): Promise<string> {
  const lower = text.toLowerCase()

  if (lower.includes('book') || lower.includes('availability')) {
    return `Hi ${name}! 🏡 Please share your check-in/out dates, number of guests, and property preference (Skyline Serenity or MonuRama) and we'll confirm availability right away!`
  }
  if (lower.includes('price') || lower.includes('rate')) {
    return await buildPricingReply(name)
  }
  if (lower.includes('cancel')) {
    return `Hi ${name}! For cancellations see https://www.bookmyspaces.in/cancellation.html or call +91 90514 59463.`
  }
  return `Hi ${name}! 🏡 Thanks for reaching out to Book My Space. Our team will respond shortly. Call us at +91 90514 59463 or visit www.bookmyspaces.in`
}

async function buildPricingReply(name: string): Promise<string> {
  const fallback = `Hi ${name}! Rooms at Skyline Serenity start from ₹999/night, and our rooftop event packages at MonuRama start from ₹42,000. Share your dates and guest count for a precise quote!`

  try {
    const db = getSupabaseAdmin()
    const { data: packages, error } = await db
      .from('packages')
      .select('name, base_price, is_popular, max_guests, duration_hours')
      .eq('is_active', true)
      .order('tier', { ascending: true })

    if (error || !packages || packages.length === 0) {
      return fallback
    }

    const lines = packages.map((p: { name: string; base_price: number; is_popular: boolean; max_guests: number; duration_hours: number }) => {
      const price = Number(p.base_price || 0).toLocaleString('en-IN')
      const popular = p.is_popular ? ' ⭐ Most Popular' : ''
      return `• ${p.name} — ₹${price} (up to ${p.max_guests} guests, ${p.duration_hours}hrs)${popular}`
    })

    return [
      `Hi ${name}! Here are our current rooftop event packages at MonuRama:`,
      ...lines,
      '',
      `Rooms at Skyline Serenity start from ₹999/night.`,
      `Share your event date and guest count for a precise quote!`,
    ].join('\n')
  } catch (err) {
    logger.error('whatsapp-webhook', 'buildPricingReply failed, using fallback copy', err)
    return fallback
  }
}

interface ConversationMessage {
  role:      'user' | 'assistant'
  content:   string
  timestamp: string
}

interface WhatsAppMessage {
  from:      string
  id:        string
  timestamp: string
  type:      string
  text?:     { body: string }
}

interface WhatsAppContact {
  profile: { name: string }
  wa_id:   string
}

interface WhatsAppStatusUpdate {
  id:           string
  status:       'sent' | 'delivered' | 'read' | 'failed'
  timestamp:    string
  recipient_id: string
  errors?:      Array<{ code: number; title: string }>
}

interface WhatsAppValue {
  messaging_product: 'whatsapp'
  metadata:          { display_phone_number: string; phone_number_id: string }
  contacts?:         WhatsAppContact[]
  messages?:         WhatsAppMessage[]
  statuses?:         WhatsAppStatusUpdate[]
}

interface WhatsAppWebhookPayload {
  object: string
  entry:  Array<{
    id:      string
    changes: Array<{ value: WhatsAppValue; field: string }>
  }>
}
