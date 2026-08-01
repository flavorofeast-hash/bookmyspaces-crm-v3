export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

import { NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import {
  chatWithAI,
  extractLeadFromTag,
  extractLeadViaAI,
  mergeExtracted,
  cleanAIResponse,
  hasMinimumLeadData,
  generateConversationSummary,
  parseGuestCount,
  parseEventDate,
  sanitizeString,
  Message,
  ExtractedLeadData,
} from '@/lib/ai'
import { getSupabaseAdmin } from '@/lib/supabase'
import { syncLeadToSheets, initializeSheet } from '@/lib/sheets'
import { logger } from '@/lib/logger'
import { handleInboundMessage, recordMessage } from '@/lib/conversations/unified-conversation-service'
import { checkAndApplyHandoff, estimateConfidence } from '@/lib/ai/orchestrator'
import { normalizePhone as normalizePhoneCanonical } from '@/lib/whatsapp/normalize-phone'
import { checkRateLimit, clientIpFrom } from '@/lib/rate-limit'
import { chatCampaignContextSchema } from '@/lib/validation'
import { scheduleSiteVisit, leadHasScheduledVisit } from '@/lib/visits/site-visit-service'
import { runAutoPackageRecommendation } from '@/lib/leads/auto-package-recommendation'

export async function POST(req: NextRequest) {
  const supabaseAdmin = getSupabaseAdmin()
  const reqId = uuidv4().slice(0, 8)

  // V3 — public-route rate limit (Tier 1 #5): 20 messages/min per IP is
  // generous for a human chatting and hostile to loops/scrapers.
  const rl = checkRateLimit(`chat:${clientIpFrom(req)}`, { limit: 20, windowMs: 60_000 })
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many messages — please wait a moment.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } }
    )
  }

  try {
    const body = await req.json()
    const { message, sessionId: incomingSessionId } = body

    // Sprint 1 — Campaign Landing Page System: optional context from a
    // landing page. Best-effort/non-blocking validation — a malformed or
    // absent `context` must never fail an otherwise-valid chat message,
    // since every existing caller (widget with no campaign) omits it.
    const contextParse = chatCampaignContextSchema.safeParse(body.context)
    const context = contextParse.success ? contextParse.data : null

    if (!message || typeof message !== 'string') {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 })
    }

    const trimmedMessage = message.trim().slice(0, 2000)
    if (!trimmedMessage) {
      return NextResponse.json({ error: 'Message cannot be empty' }, { status: 400 })
    }

    const sessionId =
      incomingSessionId && /^[0-9a-f-]{36}$/.test(incomingSessionId)
        ? incomingSessionId
        : uuidv4()

    logger.info('chat', `[${reqId}] Request received`, { sessionId, messageLen: trimmedMessage.length })

    const { data: existingConv, error: convFetchError } = await supabaseAdmin
      .from('conversations')
      .select('id, messages, lead_id, extracted_phone')
      .eq('session_id', sessionId)
      .maybeSingle()

    if (convFetchError) {
      logger.error('chat', `[${reqId}] Conversation fetch error`, convFetchError)
    }

    const existingMessages: Message[] = Array.isArray(existingConv?.messages)
      ? (existingConv!.messages as Message[]).slice(-18)
      : []

    const conversationId: string | null = existingConv?.id || null
    const existingLeadId: string | null = existingConv?.lead_id || null

    const messagesForAI: Message[] = [
      ...existingMessages,
      { role: 'user' as const, content: trimmedMessage },
    ]

    const aiResponseRaw = await chatWithAI(
      messagesForAI,
      trimmedMessage,
      context ? { intent: context.intent, property: context.property, campaign: context.campaign } : null
    )
    const aiResponseClean = cleanAIResponse(aiResponseRaw)

    const fromTag = extractLeadFromTag(aiResponseRaw)

    let fromAI: ExtractedLeadData | null = null
    if (!hasMinimumLeadData(fromTag) && existingMessages.length >= 0) {
      const convText = messagesForAI
        .map(m => `${m.role === 'user' ? 'Customer' : 'Aria'}: ${m.content}`)
        .join('\n')
      fromAI = await extractLeadViaAI(convText)
    }

    const extracted = mergeExtracted(fromTag, fromAI)
    const hasLead = hasMinimumLeadData(extracted)

    const updatedMessages: Message[] = [
      ...messagesForAI,
      { role: 'assistant' as const, content: aiResponseClean },
    ].slice(-40)

    const convPayload: Record<string, unknown> = {
      session_id: sessionId,
      messages: updatedMessages,
      is_active: true,
    }

    if (extracted?.name) convPayload.extracted_name = extracted.name
    if (extracted?.phone) convPayload.extracted_phone = extracted.phone
    if (extracted?.email) convPayload.extracted_email = extracted.email
    if (extracted?.event_type) convPayload.extracted_event_type = extracted.event_type
    if (extracted?.event_date) convPayload.extracted_event_date = extracted.event_date
    if (extracted?.guest_count) convPayload.extracted_guest_count = extracted.guest_count
    if (extracted?.budget) convPayload.extracted_budget = extracted.budget

    let currentConversationId = conversationId

    if (conversationId) {
      const { error: updateErr } = await supabaseAdmin
        .from('conversations')
        .update(convPayload)
        .eq('id', conversationId)
      if (updateErr) logger.error('chat', `[${reqId}] Conversation UPDATE failed`, updateErr)
    } else {
      const { data: newConv, error: insertErr } = await supabaseAdmin
        .from('conversations')
        .upsert(convPayload, { onConflict: 'session_id', ignoreDuplicates: false })
        .select('id')
        .single()

      if (insertErr) {
        logger.error('chat', `[${reqId}] Conversation UPSERT failed`, insertErr)
        const { data: fallback } = await supabaseAdmin
          .from('conversations')
          .select('id')
          .eq('session_id', sessionId)
          .maybeSingle()
        if (fallback?.id) currentConversationId = fallback.id
      } else {
        currentConversationId = newConv?.id || null
      }
    }

    let leadId: string | null = existingLeadId

    // Sprint 1 — Campaign Landing Page System: a brand-new conversation
    // carrying landing-page context gets its CRM lead attached/created
    // immediately, before falling through to the existing text-extraction
    // path below. `context.leadId` is set when the landing page already
    // called POST /api/campaigns/track (the common case); the else branch
    // is a fallback so /api/chat still satisfies "automatically create CRM
    // lead" even if that call didn't happen.
    if (!existingLeadId && !leadId && context) {
      if (context.leadId) {
        leadId = context.leadId
      } else {
        const contextSeed: ExtractedLeadData = {
          name: extracted?.name ?? null,
          phone: extracted?.phone ?? null,
          email: extracted?.email ?? null,
          event_type: extracted?.event_type ?? (context.leadEventType || context.intent || null),
          event_date: extracted?.event_date ?? null,
          guest_count: extracted?.guest_count ?? null,
          budget: extracted?.budget ?? null,
          venue: extracted?.venue ?? (context.property ?? null),
        } as ExtractedLeadData
        leadId = await upsertLead(supabaseAdmin, contextSeed, null, contextSeed.phone ?? null, currentConversationId, reqId)
      }
    }

    if (hasLead) {
      leadId = await upsertLead(
        supabaseAdmin,
        extracted!,
        leadId,
        extracted?.phone || existingConv?.extracted_phone || null,
        currentConversationId,
        reqId
      )
    } else if (!leadId && currentConversationId && extracted) {
      const hasAnySignal = !!(extracted.event_type || extracted.budget || extracted.guest_count || extracted.venue)
      if (hasAnySignal) {
        leadId = await upsertLead(supabaseAdmin, extracted, null, null, currentConversationId, reqId)
      }
    }

    // RC2 readiness validation — Journey 6 ("customer wants a proposal
    // immediately") gap: every OTHER lead-capture entry point (POST
    // /api/leads, WhatsApp/social via captureLeadWithJourney) already calls
    // this same self-gated function right after the lead is written, but
    // the website AI chat widget never did — a chat-only lead only ever got
    // a draft proposal via the Sprint 2 site-visit-completion trigger. Reuses
    // the identical, already-proven call (no new module): no-ops without an
    // event_type signal, no-ops if the lead already has a proposal, and
    // enforces the same Property Intelligence guard (Skyline-never-events,
    // Monurama-100-cap) documented in auto-package-recommendation.ts. Never
    // blocks the chat response on failure, same fail-open posture as the
    // site-visit scheduling side effect above.
    if (leadId && extracted?.event_type) {
      runAutoPackageRecommendation(leadId, currentConversationId).catch((err) => {
        logger.error('chat', `[${reqId}] runAutoPackageRecommendation threw`, err)
      })
    }

    if (leadId && !existingLeadId && currentConversationId) {
      await supabaseAdmin
        .from('conversations')
        .update({ lead_id: leadId })
        .eq('id', currentConversationId)
    }

    // Sprint 1.5 — AI Sales Executive: the AI (ai.ts's SYSTEM_PROMPT) asks
    // for a preferred visit date then time, and once it has both, confirms
    // the visit in its reply and includes both in the <<LEAD:...>> tag.
    // This is the deterministic half — reuses scheduleSiteVisit() exactly
    // as CRM staff's /visits/new form does, so the visit created here shows
    // up on the Operations Dashboard identically. leadHasScheduledVisit()
    // guards against re-scheduling on every subsequent turn, since the tag
    // keeps re-emitting visit_date/visit_time once known.
    const visitDateResolved = extracted?.visit_date ? (parseEventDate(extracted.visit_date) || extracted.visit_date) : null
    const visitDateValid = !!visitDateResolved && /^\d{4}-\d{2}-\d{2}$/.test(visitDateResolved)

    if (leadId && visitDateValid && extracted?.visit_time) {
      try {
        const alreadyScheduled = await leadHasScheduledVisit(leadId)
        if (!alreadyScheduled) {
          const property =
            context?.property ||
            (extracted.venue === 'monurama' ? 'Monurama Homestay'
              : extracted.venue === 'skyline' ? 'Skyline Serenity'
              : 'Monurama Homestay') // default — Monurama is the events venue this AI sells

          const scheduled = await scheduleSiteVisit({
            leadId,
            name      : extracted.name || '',
            property,
            visitDate : visitDateResolved,
            visitTime : extracted.visit_time,
            purpose   : extracted.event_type ? `${extracted.event_type} site visit` : 'Site visit',
            guestCount: parseGuestCount(extracted.guest_count),
            budget    : extracted.budget || null,
          })

          if (!scheduled) {
            logger.error('chat', `[${reqId}] AI-triggered scheduleSiteVisit failed`, { leadId })
          }
        }
      } catch (err) {
        // Never let a scheduling failure break the chat response the
        // customer is already about to receive — same fail-open posture as
        // every other best-effort side effect in this route.
        logger.error('chat', `[${reqId}] site visit scheduling threw`, err)
      }
    }

    if (updatedMessages.length > 0 && updatedMessages.length % 10 === 0 && currentConversationId) {
      const convIdForSummary = currentConversationId
      generateConversationSummary(updatedMessages)
        .then(async (summary) => {
          const { error } = await supabaseAdmin
            .from('conversations')
            .update({ summary })
            .eq('id', convIdForSummary)
          if (error) logger.error('chat', 'Summary update failed', error)
        })
        .catch(() => {})
    }

    // V3 Day 5 — mirror this exchange into the Unified Conversation
    // Platform (Day 4's handleInboundMessage pipeline), additive alongside
    // the `conversations` table writes above which stay canonical for the
    // live CRM UI until a real cutover. Fire-and-forget and fully
    // isolated: a failure here (e.g. migration 012 not yet applied in this
    // environment) must never affect the reply already computed for the
    // customer.
    syncToUnifiedConversationPlatform(sessionId, trimmedMessage, aiResponseClean, reqId).catch(err => {
      logger.error('chat', `[${reqId}] Unified Conversation Platform sync failed (non-fatal)`, err)
    })

    return NextResponse.json({ reply: aiResponseClean, sessionId, leadCaptured: hasLead })

  } catch (error) {
    logger.error('chat', `[${reqId}] Unhandled error`, error)
    return NextResponse.json(
      {
        reply: "I'm having trouble connecting right now. Please WhatsApp us at 9051459463 and we'll respond right away! 😊",
        error: 'Internal server error',
        sessionId: null,
      },
      { status: 500 }
    )
  }
}

// ─── Unified Conversation Platform sync (Day 5) ────────────────────────────
// Best-effort mirror of every website-chat exchange into the V3 Unified
// Conversation Platform (channels / unified_conversations /
// unified_messages — migration 012), via the same handleInboundMessage()
// pipeline Day 4 built and unit-tested. `sessionId` is passed as the
// website_chat channel identity per handleInboundMessage's documented
// contract; identity resolution against `leads.phone`/`leads.email` only
// succeeds once a phone/email has actually been extracted onto the lead
// elsewhere in this request — until then it degrades to an unidentified
// conversation, which is expected, not an error. Errors surface as a
// single caught rejection to the caller, never as a chat-API failure.
async function syncToUnifiedConversationPlatform(
  sessionId: string,
  inbound:   string,
  outbound:  string,
  reqId:     string
): Promise<void> {
  const result = await handleInboundMessage({
    channelType:       'website_chat',
    channelIdentity:   sessionId,
    content:           inbound,
    externalMessageId: reqId,
  })

  await recordMessage({
    conversationId: result.conversationId,
    channelId:      result.channelId,
    direction:      'outbound',
    senderType:     'ai',
    content:        outbound,
    aiConfidence:   estimateConfidence(outbound),
  })

  // V3 Phase 4 — AI Orchestrator handoff policy. Marks the unified
  // conversation escalated + AI-paused when the customer asks for a human,
  // raises a complaint/refund/payment issue, or the reply looks
  // low-confidence (threshold configurable in Settings → AI Engine).
  // Runs inside this already-fire-and-forget sync; never affects the reply.
  await checkAndApplyHandoff({
    conversationId: result.conversationId,
    leadId:         result.identity?.leadId ?? null,
    customerText:   inbound,
    aiReply:        outbound,
  })
}

function normalizePhoneForDedup(raw: string | null | undefined): string | null {
  if (!raw) return null
  const digits = raw.replace(/[\s\-\+\(\)]/g, '')
  const stripped = digits.replace(/^(0091|91)([6-9]\d{9})$/, '$2')
  return /^[6-9]\d{9}$/.test(stripped) ? stripped : null
}

function normalizeEmailForDedup(raw: string | null | undefined): string | null {
  if (!raw) return null
  const e = raw.trim().toLowerCase()
  return e.includes('@') ? e : null
}

async function upsertLead(
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>,
  extracted: ExtractedLeadData,
  existingLeadId: string | null,
  phone: string | null,
  conversationId: string | null,
  reqId: string
): Promise<string | null> {
  try {
    const guestCount = parseGuestCount(extracted.guest_count)
    const eventDate = parseEventDate(extracted.event_date)

    // Sprint 5 fix: store phone in the same canonical, digits-only format
    // every other channel (WhatsApp webhook, Excel import) now converges
    // on, instead of whatever raw shape the AI happened to extract from
    // free text (e.g. "+91 98765 43210"). The dedup check just below was
    // already resilient to format differences via normalizePhoneForDedup,
    // but the *stored* value wasn't — meaning a website-chat lead could
    // still fail an exact-match lookup from resolveIdentity() or a later
    // Excel import, even though this function correctly found/updated the
    // right row itself. See audit/SPRINT5_GO_LIVE_REPORT.md.
    const canonicalPhone = phone ? normalizePhoneCanonical(phone) : null

    const baseFields: Record<string, unknown> = {
      ...(extracted.name && { name: sanitizeString(extracted.name) }),
      ...(canonicalPhone && { phone: canonicalPhone }),
      ...(extracted.email && { email: sanitizeString(extracted.email) }),
      ...(extracted.event_type && { event_type: sanitizeString(extracted.event_type) }),
      ...(guestCount && { guest_count: guestCount }),
      ...(extracted.budget && { budget: sanitizeString(extracted.budget) }),
      ...(extracted.venue && { venue: sanitizeString(extracted.venue) }),
    }

    if (existingLeadId) {
      const { error } = await supabaseAdmin.from('leads').update(baseFields).eq('id', existingLeadId)
      if (error) logger.error('chat', `[${reqId}] lead update failed`, error)
      syncLeadToSheets({ id: existingLeadId }).catch(() => {})
      return existingLeadId
    }

    const normPhone = normalizePhoneForDedup(phone)
    const normEmail = normalizeEmailForDedup(sanitizeString(extracted.email))
    let dupLeadId: string | null = null
    let dupReason = ''

    // RC1 perf/correctness fix (flagged as a known risk in
    // SPRINT5_GO_LIVE_REPORT.md): try a real indexed exact match on the
    // canonical phone format first. Since Sprint 5's identity-resolution
    // fix, every NEW lead across every channel (WhatsApp, Excel import,
    // website chat) is written in this same canonical format, so this
    // covers the common case with a single indexed lookup instead of an
    // unbounded-risk scan. The bounded scan below still runs as a fallback
    // for leads whose phone predates that fix and is in some other format
    // — it's now a legacy-data safety net, not the primary path.
    if (canonicalPhone) {
      const { data: exactMatch } = await supabaseAdmin
        .from('leads').select('id').eq('phone', canonicalPhone).maybeSingle()
      if (exactMatch) { dupLeadId = exactMatch.id; dupReason = 'phone_exact' }
    }

    if (!dupLeadId && normPhone) {
      const { data: phoneRows } = await supabaseAdmin
        .from('leads').select('id, phone').not('phone', 'is', null).limit(500)
      const phoneMatch = (phoneRows ?? []).find((r: any) => normalizePhoneForDedup(r.phone) === normPhone)
      if (phoneMatch) { dupLeadId = phoneMatch.id; dupReason = 'phone' }
    }

    if (!dupLeadId && normEmail) {
      const { data: emailMatch } = await supabaseAdmin
        .from('leads').select('id').ilike('email', normEmail).maybeSingle()
      if (emailMatch) { dupLeadId = emailMatch.id; dupReason = 'email' }
    }

    if (dupLeadId) {
      await supabaseAdmin.from('leads').update(baseFields).eq('id', dupLeadId)
      syncLeadToSheets({ id: dupLeadId }).catch(() => {})
      return dupLeadId
    }

    const hasAnything = !!(
      sanitizeString(extracted.name) || phone ||
      sanitizeString(extracted.event_type) || sanitizeString(extracted.budget) ||
      parseGuestCount(extracted.guest_count) || sanitizeString(extracted.venue)
    )
    if (!hasAnything) return null

    const { data: newLead, error: insertError } = await supabaseAdmin
      .from('leads')
      .insert({
        name: sanitizeString(extracted.name),
        phone: canonicalPhone || null,
        email: sanitizeString(extracted.email),
        event_type: sanitizeString(extracted.event_type),
        guest_count: guestCount,
        budget: sanitizeString(extracted.budget),
        venue: sanitizeString(extracted.venue),
        source: 'website',
        status: 'new_inquiry',
        ...(eventDate ? { notes: `Event date: ${eventDate}` } : {}),
      })
      .select('id')
      .single()

    if (insertError || !newLead) {
      logger.error('chat', `[${reqId}] lead INSERT failed`, insertError)
      return null
    }

    Promise.resolve(supabaseAdmin.from('activity_logs').insert({
      lead_id: newLead.id,
      action: 'lead_created',
      description: 'Lead auto-created from website chatbot',
      performed_by: 'ai_chatbot',
      metadata: { conversation_id: conversationId, req_id: reqId },
    })).catch(() => {})

    initializeSheet().catch(() => {})
    syncLeadToSheets(newLead as any).catch(() => {})

    Promise.resolve(supabaseAdmin.rpc('track_event', {
      p_event_type: 'lead_created',
      p_session_id: conversationId,
      p_lead_id: newLead.id,
      p_channel: 'website',
      p_properties: { has_phone: !!phone, has_name: !!extracted.name },
    })).catch(() => {})

    return newLead.id
  } catch (err) {
    logger.error('chat', `[${reqId}] upsertLead threw`, err)
    return null
  }
}

export async function GET() {
  return NextResponse.json({ status: 'Chat API is running', timestamp: new Date().toISOString() })
}
