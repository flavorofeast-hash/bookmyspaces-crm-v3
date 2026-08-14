// src/app/api/whatsapp/webhook/route.ts
// Meta Cloud API webhook — verification + inbound message handling

import { NextRequest, NextResponse } from 'next/server'
import { sendWhatsAppText }          from '@/lib/whatsapp/send-message'
import { getSupabaseAdmin }          from '@/lib/supabase'
import { verifySignature }           from '@/lib/whatsapp/verify-signature'
import { handleInboundMessage, recordMessage } from '@/lib/conversations/unified-conversation-service'
import { logger } from '@/lib/logger'
import { checkRateLimit, clientIpFrom } from '@/lib/rate-limit'
// Phase 1B, Step 6 (audit/PHASE_1B_IMPLEMENTATION_BACKLOG.md,
// audit/PHASE_1B_STEP6_REPORT.md) -- the orchestration foundation, wired
// in behind settings.orchestration.enabled (default false). See
// handleIncomingMessageViaOrchestration() below.
import { ConversationState }         from '@/constants/conversation-states'
import { getSettingsSection }        from '@/lib/settings/settings-service'
import { orchestrate }               from '@/lib/ai/orchestration-engine'
import { executeOrchestration }      from '@/lib/ai/orchestration-executor'
import { applyHandoff }              from '@/lib/ai/orchestrator'

export const dynamic    = 'force-dynamic'
export const runtime    = 'nodejs'
export const maxDuration = 30

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)

  const mode      = searchParams.get('hub.mode')
  const token     = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')

  // Go-live hardening: the documented/required var is WHATSAPP_WEBHOOK_VERIFY_TOKEN
  // (.env.example, settings page, src/lib/env.ts) — WHATSAPP_VERIFY_TOKEN is
  // accepted as a fallback alias only in case that's what got set in Vercel,
  // so a naming mismatch doesn't block go-live. Purely additive: behavior for
  // anyone with WHATSAPP_WEBHOOK_VERIFY_TOKEN set is unchanged.
  const verifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || process.env.WHATSAPP_VERIFY_TOKEN

  if (!verifyToken) {
    logger.error('whatsapp-webhook', 'Verification failed: neither WHATSAPP_WEBHOOK_VERIFY_TOKEN nor WHATSAPP_VERIFY_TOKEN is set. Add WHATSAPP_WEBHOOK_VERIFY_TOKEN in Vercel -> Project -> Settings -> Environment Variables, then redeploy.')
    return new NextResponse('Server configuration error', { status: 500 })
  }

  const cleanVerifyToken   = verifyToken.trim()
  const cleanTokenFromMeta = (token ?? '').trim()

  if (mode === 'subscribe' && cleanVerifyToken === cleanTokenFromMeta) {
    if (!challenge) {
      logger.error('whatsapp-webhook', 'Verification failed: mode/token matched but hub.challenge was missing from the request.')
      return new NextResponse('Bad Request: missing challenge', { status: 400 })
    }
    logger.info('whatsapp-webhook', 'Webhook verification succeeded — Meta subscription confirmed.')
    return new NextResponse(challenge, {
      status:  200,
      headers: { 'Content-Type': 'text/plain' },
    })
  }

  logger.error('whatsapp-webhook', 'Verification failed: hub.mode/hub.verify_token did not match expected values.', {
    modeReceived:        mode,
    modeExpected:        'subscribe',
    tokenMatched:        cleanVerifyToken === cleanTokenFromMeta,
  })
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
    logger.warn('whatsapp-webhook', 'Received webhook with unexpected object type — ignored.', { object: body.object })
    return new NextResponse('OK', { status: 200 })
  }

  // Go-live hardening: a single receipt log line, before any processing, so
  // "is Meta actually delivering webhooks to us" is answerable from logs
  // alone instead of only being visible indirectly via downstream side
  // effects (a reply sent, a lead created).
  const entryCount        = body.entry?.length ?? 0
  const messageCountTotal = (body.entry ?? []).reduce((sum, e) =>
    sum + (e.changes ?? []).reduce((s, c) => s + (c.value.messages?.length ?? 0), 0), 0)
  const statusCountTotal  = (body.entry ?? []).reduce((sum, e) =>
    sum + (e.changes ?? []).reduce((s, c) => s + (c.value.statuses?.length ?? 0), 0), 0)
  logger.info('whatsapp-webhook', 'Webhook payload received', { entryCount, messageCountTotal, statusCountTotal })

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
      const text = message.text?.body ?? ''

      // Phase 1B, Step 6 -- feature-flag-controlled rollout. Default OFF;
      // when off, this branch is never entered and behavior below is
      // byte-for-byte identical to before Step 6 existed.
      const orchestrationSettings = await getSettingsSection('orchestration')

      if (orchestrationSettings.enabled) {
        try {
          await handleIncomingMessageViaOrchestration(message, text)
          return
        } catch (err) {
          // Safe execution path (Step 6 requirement): a bug in the new
          // pipeline must never leave the customer with zero reply --
          // fall back to the existing, already-reliable path exactly as
          // if the flag were off, rather than propagating the error.
          logger.error('whatsapp-webhook', 'Orchestration path failed, falling back to legacy reply path', err, { phone: from })
        }
      }

      await runLegacyReplyPath(from, senderName, text, message.id)
    }
  } catch (err) {
    logger.error('whatsapp-webhook', 'Error handling message', err, { phone: from })
  }
}

// ─── Legacy reply path -- Pipeline A, unchanged behavior ───────────────────
// Extracted verbatim from what this function inlined before Step 6 (no
// logic changed) so it can also serve as Step 6's fallback target if the
// orchestration path throws, without duplicating these four lines.
async function runLegacyReplyPath(
  from:       string,
  senderName: string,
  text:       string,
  messageId:  string
): Promise<void> {
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
  syncToUnifiedConversationPlatform(from, text, reply, messageId).catch(err => {
    logger.error('whatsapp-webhook', 'Unified Conversation Platform sync failed (non-fatal)', err, { phone: from })
  })
}

// ─── Orchestration path -- Phase 1B, Step 6, flag-gated ────────────────────
// Wires the Phase 1A.1/1B orchestration foundation (orchestrate() +
// executeOrchestration()) into the live webhook for the first time. Only
// reachable when settings.orchestration.enabled === true (default false --
// src/lib/settings/settings-service.ts, Step 1). Uses the Unified
// Conversation Platform exclusively -- no legacy `conversations`/
// `whatsapp_conversations` writes (design doc Section 4.3).
async function handleIncomingMessageViaOrchestration(
  message: WhatsAppMessage,
  text:    string
): Promise<void> {
  const from = message.from
  const db   = getSupabaseAdmin()

  // Duplicate-delivery guard (Critical Issue 2, Hardening Sprint). Checked
  // directly against unified_messages.external_message_id -- an existing,
  // indexed column since migration 012 -- rather than depending on
  // migration 025's unique index, which has not been applied to any
  // environment yet (audit/PHASE_1B_STEP2_REPORT.md). A Meta redelivery of
  // an already-ingested message id is skipped entirely here: no re-ingest,
  // no second reply.
  const { data: existingMessage } = await db
    .from('unified_messages')
    .select('id')
    .eq('external_message_id', message.id)
    .limit(1)
    .maybeSingle()

  if (existingMessage) {
    logger.info('whatsapp-webhook', 'Orchestration path: duplicate delivery, skipping', { wamid: message.id })
    return
  }

  const ingest = await handleInboundMessage({
    channelType:       'whatsapp',
    channelIdentity:   from,
    content:           text,
    externalMessageId: message.id,
  })

  // Safety gate: never let this pipeline reply into a conversation a human
  // has already taken over. unified_conversations.ai_active is the
  // existing, real "is AI allowed to respond" flag (set false by
  // applyHandoff() in orchestrator.ts) -- read directly here rather than
  // widening unified-conversation-service.ts's return shape for this one
  // caller (Step 6 stays additive to that file).
  const { data: conversationRow } = await db
    .from('unified_conversations')
    .select('ai_active')
    .eq('id', ingest.conversationId)
    .maybeSingle()

  if (conversationRow?.ai_active === false) {
    logger.info('whatsapp-webhook', 'Orchestration path: conversation is human-handled (ai_active=false), skipping AI reply', { conversationId: ingest.conversationId })
    return
  }

  const aiSettings = await getSettingsSection('ai')

  const outcome = await orchestrate({
    channel:        'whatsapp',
    direction:      'inbound',
    messageId:      message.id,
    conversationId: ingest.conversationId,
    source:         'customer',
    leadId:         ingest.identity?.leadId ?? null,
    message:        text,
    // Known, documented simplification: the Unified Conversation Platform
    // does not track the WhatsApp-specific ConversationState funnel (that
    // state machine belongs to whatsapp_conversations/auto-responder.ts --
    // a different pipeline, design doc Section 2.2). NEW_INQUIRY is the
    // conservative default; the ai_active check above -- not this value --
    // is what actually guards against replying into an escalated
    // conversation.
    conversationState:   ConversationState.NEW_INQUIRY,
    aiSettings,
    isDuplicateDelivery: false, // already checked above
  })

  if (!outcome.allowed) {
    logger.info('whatsapp-webhook', 'Orchestration path: inbound rejected', { reason: outcome.rejectionReason, detail: outcome.detail })
    return
  }

  const result = await executeOrchestration(outcome, {
    mode:           'active',
    channel:        'whatsapp',
    channelId:      ingest.channelId,
    conversationId: ingest.conversationId,
    messageId:      ingest.messageId,
    message:        text,
    send: async (phone, replyText) => {
      const sendResult = await sendWhatsAppText(phone, replyText, {
        leadId:         ingest.identity?.leadId ?? null,
        conversationId: ingest.conversationId,
        // executeOrchestration() already calls recordMessage() itself
        // right after this returns -- suppress sendWhatsAppText's own
        // automatic Unified Conversation Platform mirror (send-message.ts)
        // to avoid writing two unified_messages rows for one reply.
        unifiedMirror: null,
      })
      return { success: sendResult.success }
    },
  })

  // ── Step 6 interim rollout policy: "unavailable" (APPROVED) ────────────
  // Interim-only, until the Inventory Resolver exists (design doc Section
  // 11, item 1). Deliberately left unresolved by Step 5 (see its own
  // report's "Step 6 Rollout Decision Needed") -- this is that decision,
  // applied exactly as approved: never invent availability, never promise
  // a booking, never silently fail. Every "unavailable" decision gets a
  // polite holding reply, an unconditional escalation, and a log line --
  // no exceptions, no confidence check.
  //
  // Sprint 1, Priority 1: widened to also cover `result.availabilityUnknown`
  // -- a DIFFERENT gap than `kind === 'unavailable'`. `kind === 'unavailable'`
  // means action-arguments.ts couldn't even attempt the check (no resolvable
  // inventoryItemId/eventDate). `availabilityUnknown` means the check WAS
  // attempted and checkAvailability() ran, but the query itself failed (DB
  // error) -- previously that case fell through this block entirely
  // (result.kind stayed 'tool_call', a successful, non-throwing call) and
  // produced no reply and no escalation at all. Same customer-facing
  // treatment is correct for both: in neither case do we actually know
  // whether the room/hall is free, so neither should ever be presented to
  // the customer as "unavailable" (a real, false negative) or silently
  // dropped.
  if (result.kind === 'unavailable' || result.availabilityUnknown) {
    const politeReply = "Thank you for your enquiry. We're checking availability with our team and will get back to you shortly."

    const sendResult = await sendWhatsAppText(from, politeReply, {
      leadId:         ingest.identity?.leadId ?? null,
      conversationId: ingest.conversationId,
      unifiedMirror:  null, // recorded explicitly below instead
    })

    if (sendResult.success) {
      await recordMessage({
        conversationId: ingest.conversationId,
        channelId:      ingest.channelId,
        direction:      'outbound',
        senderType:     'ai',
        content:        politeReply,
      })
    }

    // Always escalate -- not conditional on confidence, per the approved
    // policy ("Automatically escalate to a human/staff member"). Sprint 1,
    // Priority 1: now uses the dedicated 'availability_unknown' HandoffReason
    // (orchestrator.ts) instead of the 'low_confidence' placeholder this
    // block used previously -- that placeholder was an explicitly-documented
    // stand-in ("not a perfect semantic match... would be a new abstraction
    // outside this step's scope"); adding the real reason is exactly that
    // next step, not a rewrite of this block's behavior.
    await applyHandoff({
      conversationId: ingest.conversationId,
      leadId:         ingest.identity?.leadId ?? null,
      reason:         'availability_unknown',
    })

    logger.warn('whatsapp-webhook', 'Orchestration path: availability unavailable/unknown -- interim rollout policy applied (polite reply + auto-escalation)', {
      conversationId: ingest.conversationId,
      action:         result.action,
      reason:         result.reason,
      availabilityUnknown: result.availabilityUnknown,
    })
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
