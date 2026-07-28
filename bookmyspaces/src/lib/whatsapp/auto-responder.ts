// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/whatsapp/auto-responder.ts
// Deterministic, rule-based automated response engine.
// NO open-ended GPT. NO autonomous negotiation.
// Pure state-machine → message mapping.
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabaseAdmin } from '@/lib/supabase'
import { ConversationState, SourceChannel, TERMINAL_STATES } from '@/constants/conversation-states'
import { sendWhatsAppText } from './send-message'
import { advanceConversationState } from './conversation-manager'
import type { AutoResponseContext } from '@/types/whatsapp'

// ─── Message Templates ────────────────────────────────────────────────────────
// All messages are deterministic — no AI generation.
// Edit copy here to update what users see.

// Phase 1B, Step 3 (audit/PHASE_1B_IMPLEMENTATION_BACKLOG.md,
// audit/PHASE_1B_STEP3_READINESS_REVIEW.md): exported so a future
// tool-registry entry (Step 5+) can reuse this exact customer-facing copy
// instead of duplicating it. No template's text changed by this export --
// pinned by auto-responder.test.ts. `ASK_EVENT_TYPE` is the one net-new
// addition (see its own comment below) -- everything else here is
// unchanged from before Step 3.
export const MESSAGES = {
  GREETING: (name: string | null) =>
    `👋 Hi${name ? ` ${name}` : ''}! Welcome to *BookMySpaces* 🎉\n\nWe specialise in premium event venues in Kolkata — from intimate gatherings to grand celebrations.\n\nCould you tell us what *type of event* you're planning?\n\n_(e.g. Wedding, Birthday, Corporate Event, Engagement, etc.)_`,

  // Phase 1B, Step 3 -- new template. Not used by processAutoResponse()
  // today (GREETING already asks this on a brand-new conversation) --
  // added so a future ask_question/collect_missing_information tool
  // (Step 5+) can ask for eventType alone, e.g. for a returning customer
  // who doesn't need to be re-greeted. Deliberately mirrors GREETING's own
  // question wording/tone for consistency.
  ASK_EVENT_TYPE:
    `Could you tell us what *type of event* you're planning? 🎉\n\n_(e.g. Wedding, Birthday, Corporate Event, Engagement, etc.)_`,

  ASK_EVENT_DATE:
    `Great choice! 📅\n\nWhat *date* are you thinking for your event?\n\n_(Please share the date, e.g. "15 June 2025" or "15/06/2025")_`,

  ASK_GUEST_COUNT:
    `Noted! 👥\n\nApproximately how many *guests* are you expecting?\n\n_(Share a rough number — e.g. 50, 100-150, 300+)_`,

  QUALIFIED: (name: string | null, eventType: string, guestCount: string) =>
    `Thank you${name ? ` ${name}` : ''}! 🙏\n\nHere's a summary of your inquiry:\n• *Event:* ${eventType}\n• *Guests:* ${guestCount}\n\nOur team will review this and get back to you shortly with venue options and pricing. ⚡\n\nFor faster assistance, you can also reach us at:\n📞 +91 90514 59463 | +91 70038 53624`,

  HANDOFF:
    `I've notified our team — someone will reach out to you soon! 🤝\n\nIf you need immediate help, please call us on *+91 90514 59463*.`,

  ALREADY_QUALIFIED:
    `👋 Hi again! Our team has already received your inquiry and will be in touch shortly.\n\nFor immediate help, please call *+91 90514 59463*.`,

  UNRECOGNISED_DATE:
    `I didn't quite catch the date. Could you share it again in a simple format?\n_(e.g. "15 June 2025" or "15/06/2025")_`,
}

// ─── Simple date parser ───────────────────────────────────────────────────────

function looksLikeDate(text: string): boolean {
  // Accept anything with digits that resembles a date
  return /\d/.test(text) && text.trim().length >= 4
}

// ─── Main responder ───────────────────────────────────────────────────────────

export async function processAutoResponse(ctx: AutoResponseContext): Promise<number> {
  const { phone, conversation, inboundText, leadId, leadName } = ctx
  const supabase = getSupabaseAdmin()

  // Never auto-respond to terminal states
  if (TERMINAL_STATES.has(conversation.current_state as ConversationState)) {
    return 0
  }

  const text = (inboundText ?? '').trim()
  const sharedOpts = {
    leadId,
    conversationId: conversation.id,
    conversationState: conversation.current_state,
    sourceChannel: conversation.source_channel as SourceChannel,
  }

  let responsesSent = 0

  // ── State: NEW_INQUIRY ────────────────────────────────────────────────────
  // We just received the first message. Greet and ask event type.
  if (conversation.current_state === ConversationState.NEW_INQUIRY) {
    const sent = await sendWhatsAppText(
      phone,
      MESSAGES.GREETING(leadName),
      { ...sharedOpts, conversationState: ConversationState.WAITING_FOR_EVENT_TYPE }
    )
    if (sent.success) {
      responsesSent++
      await advanceConversationState(conversation.id, ConversationState.WAITING_FOR_EVENT_TYPE)
    }
    return responsesSent
  }

  // ── State: WAITING_FOR_EVENT_TYPE ─────────────────────────────────────────
  // User just sent their event type. Capture it, ask for date.
  if (conversation.current_state === ConversationState.WAITING_FOR_EVENT_TYPE) {
    if (!text) return 0

    const sent = await sendWhatsAppText(phone, MESSAGES.ASK_EVENT_DATE, {
      ...sharedOpts,
      conversationState: ConversationState.WAITING_FOR_EVENT_DATE,
    })

    if (sent.success) {
      responsesSent++
      await advanceConversationState(
        conversation.id,
        ConversationState.WAITING_FOR_EVENT_DATE,
        { collected_event_type: text }
      )

      // Also write event_type to leads table if not set
      if (leadId) {
        await supabase
          .from('leads')
          .update({ event_type: text })
          .eq('id', leadId)
          .is('event_type', null)
      }
    }
    return responsesSent
  }

  // ── State: WAITING_FOR_EVENT_DATE ─────────────────────────────────────────
  // User sent a date. Validate loosely, then ask guest count.
  if (conversation.current_state === ConversationState.WAITING_FOR_EVENT_DATE) {
    if (!text) return 0

    if (!looksLikeDate(text)) {
      // Gently ask again — don't advance state
      await sendWhatsAppText(phone, MESSAGES.UNRECOGNISED_DATE, sharedOpts)
      return 1
    }

    const sent = await sendWhatsAppText(phone, MESSAGES.ASK_GUEST_COUNT, {
      ...sharedOpts,
      conversationState: ConversationState.WAITING_FOR_GUEST_COUNT,
    })

    if (sent.success) {
      responsesSent++
      await advanceConversationState(
        conversation.id,
        ConversationState.WAITING_FOR_GUEST_COUNT,
        { collected_event_date: text }
      )

      if (leadId) {
        await supabase
          .from('leads')
          .update({ event_date: text })
          .eq('id', leadId)
      }
    }
    return responsesSent
  }

  // ── State: WAITING_FOR_GUEST_COUNT ────────────────────────────────────────
  // User provided guest count. Mark QUALIFIED, send confirmation, notify operator.
  if (conversation.current_state === ConversationState.WAITING_FOR_GUEST_COUNT) {
    if (!text) return 0

    const eventType   = conversation.collected_event_type ?? 'Event'
    const guestCount  = text

    const qualifiedMsg = MESSAGES.QUALIFIED(leadName, eventType, guestCount)
    const sent = await sendWhatsAppText(phone, qualifiedMsg, {
      ...sharedOpts,
      conversationState: ConversationState.QUALIFIED,
    })

    if (sent.success) {
      responsesSent++

      await advanceConversationState(
        conversation.id,
        ConversationState.QUALIFIED,
        { collected_guest_count: guestCount }
      )

      // Update lead with collected data
      if (leadId) {
        await supabase
          .from('leads')
          .update({
            guest_count: parseInt(guestCount.replace(/\D/g, '')) || null,
            status: 'followup_pending',
            inquiry_summary: `WhatsApp inquiry: ${eventType} for ~${guestCount} guests on ${conversation.collected_event_date ?? 'TBD'}. Source: ${conversation.source_channel}.`,
          })
          .eq('id', leadId)

        // Activity log
        await supabase.from('activity_logs').insert({
          lead_id: leadId,
          action: 'lead_qualified',
          description: `Lead qualified via WhatsApp (${conversation.source_channel}). Event: ${eventType}, Date: ${conversation.collected_event_date}, Guests: ${guestCount}`,
          performed_by: 'whatsapp_bot',
          channel: 'whatsapp',
        })
      }

      // Notify operator
      await notifyOperator(phone, leadName, eventType, guestCount, conversation.source_channel)

      // Send handoff message after short delay
      await sendWhatsAppText(phone, MESSAGES.HANDOFF, {
        ...sharedOpts,
        conversationState: ConversationState.HANDOFF_TO_OPERATOR,
      })
      responsesSent++

      await advanceConversationState(conversation.id, ConversationState.HANDOFF_TO_OPERATOR)
    }

    return responsesSent
  }

  return 0
}

// ─── Operator notification via WhatsApp ──────────────────────────────────────

// Phase 1B, Step 3: exported so a future notify_staff tool implementation
// (Step 5+) can reuse this exact operator-alert logic instead of
// duplicating it. Behavior unchanged -- same notification_settings lookup,
// same message format, same sendWhatsAppText call as before this export.
export async function notifyOperator(
  customerPhone: string,
  name: string | null,
  eventType: string,
  guestCount: string,
  channel: string
): Promise<void> {
  const supabase = getSupabaseAdmin()

  // Read operator WhatsApp number from notification_settings
  const { data: setting } = await supabase
    .from('notification_settings')
    .select('value')
    .eq('key', 'daily_summary_whatsapp')
    .maybeSingle()

  const operatorPhone = setting?.value
  if (!operatorPhone) return

  const msg =
    `🔔 *New WhatsApp Inquiry* [${channel}]\n\n` +
    `👤 *Name:* ${name ?? 'Unknown'}\n` +
    `📱 *Phone:* ${customerPhone}\n` +
    `🎉 *Event:* ${eventType}\n` +
    `👥 *Guests:* ${guestCount}\n\n` +
    `Reply to this lead in the CRM dashboard.`

  await sendWhatsAppText(`91${operatorPhone}`, msg)
}
