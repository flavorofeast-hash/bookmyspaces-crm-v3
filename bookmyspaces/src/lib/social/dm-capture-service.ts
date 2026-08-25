// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/social/dm-capture-service.ts
// Direct Event Sales Engine, Section 1 — Facebook Messenger / Instagram DM
// lead capture.
//
// Per migration 014's own header ("Social DMs do NOT live here — they flow
// through the existing unified conversation platform... via channel
// adapters, same as WhatsApp/website chat"), this uses
// unified-conversation-service.ts's getOrCreateConversation()/recordMessage()
// directly — NOT src/lib/social/interaction-service.ts (that's the
// comments/mentions/reviews read-model, a different concept).
//
// Deliberately bypasses handleInboundMessage()'s convenience wrapper: that
// function's identity lookup assumes channelIdentity is always a phone or
// email (`channelType === 'email' ? {email} : {phone}`), which would
// incorrectly treat a Messenger PSID as a phone number. There's no existing
// lead-creation step in that wrapper either (by design — see its own
// header). This file supplies both correctly for the PSID case: dedupe via
// the conversation's own customer_id (no false identity match attempted),
// and lead creation via the same captureLeadWithJourney() the Lead Ads path
// uses.
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabaseAdmin } from '@/lib/supabase'
import { getOrCreateConversation, recordMessage } from '@/lib/conversations/unified-conversation-service'
import { captureLeadWithJourney } from '@/lib/leads/create-lead-with-journey'
import { qualifyLeadFromMessage } from '@/lib/whatsapp/auto-qualify'
import { runAutoPackageRecommendation } from '@/lib/leads/auto-package-recommendation'
import { logger } from '@/lib/logger'
import type { MessagingEvent } from '@/lib/social/meta-lead-capture'
import { findConnectedSocialAccount, ensureSocialAccountChannel } from '@/lib/social/social-account-routing'

export interface CaptureDMResult {
  leadId: string | null
  conversationId: string
  isNewLead: boolean
  /** true when this externalMessageId was already recorded — no work was (re-)done. */
  duplicate?: boolean
}

/**
 * One inbound Messenger/Instagram DM -> unified conversation + CRM lead
 * (created on first contact, reused on every message after via the
 * conversation's own customer_id — never re-resolved by treating the PSID
 * as a phone/email). Never throws.
 *
 * Meta integration hardening pass: replays a delivery-retried webhook (Meta
 * redelivers on any non-2xx/timeout, and a captured valid payload can be
 * replayed by an attacker — same class of gap the WhatsApp webhook's
 * orchestration path already guards against) used to re-run lead
 * qualification/package-recommendation AI calls and insert a duplicate
 * unified_messages row on every replay, with no idempotency check at all.
 * Mirrors the same dedup pattern: check external_message_id before doing
 * any work.
 */
export async function captureSocialDirectMessage(event: MessagingEvent): Promise<CaptureDMResult | null> {
  try {
    const db = getSupabaseAdmin()
    const channelType = event.platform // 'facebook' | 'instagram' — both valid ChannelType values

    if (event.externalMessageId) {
      const { data: existingMessage } = await db
        .from('unified_messages')
        .select('id, conversation_id')
        .eq('external_message_id', event.externalMessageId)
        .limit(1)
        .maybeSingle()

      if (existingMessage) {
        logger.info('social', 'captureSocialDirectMessage: duplicate delivery, skipping', {
          platform: event.platform, mid: event.externalMessageId,
        })
        return { leadId: null, conversationId: existingMessage.conversation_id, isNewLead: false, duplicate: true }
      }
    }

    // Multi-account hardening pass -- reject events for an account the CRM
    // hasn't connected (or has since deactivated) rather than silently
    // filing them into one shared, undifferentiated channel. See
    // social-account-routing.ts's header for the full "why".
    if (!event.recipientId) {
      logger.warn('social', 'captureSocialDirectMessage: event has no recipientId, cannot route to a connected account — skipping', {
        platform: event.platform,
      })
      return null
    }
    const account = await findConnectedSocialAccount(event.platform, event.recipientId)
    if (!account) {
      logger.warn('social', 'captureSocialDirectMessage: no connected/active social_accounts row for this recipient — skipping', {
        platform: event.platform, recipientId: event.recipientId,
      })
      return null
    }
    const channelId = await ensureSocialAccountChannel(event.platform, account)

    const { conversationId, isNewConversation } = await getOrCreateConversation({
      channelType,
      channelIdentity: event.senderPsid,
      customerId: null,
      channelId,
    })

    let leadId: string | null = null
    let isNewLead = false

    if (!isNewConversation) {
      const { data } = await db
        .from('unified_conversations')
        .select('customer_id')
        .eq('id', conversationId)
        .maybeSingle()
      leadId = data?.customer_id ?? null
    }

    if (leadId) {
      // Repeat contact from a known PSID — re-qualify on the latest
      // message, same as WhatsApp's process-inbound.ts does on every
      // inbound message (a lead's temperature should reflect its current
      // state, not just its first message).
      if (event.text) await qualifyLeadFromMessage(leadId, event.text)
      // Phase 5, Revenue Automation — same self-gated auto-recommendation
      // as process-inbound.ts's WhatsApp path. captureLeadWithJourney()
      // already covers the new-lead branch below.
      await runAutoPackageRecommendation(leadId).catch(() => null)
    } else {
      const captured = await captureLeadWithJourney({
        source: event.platform === 'facebook' ? 'facebook_messenger' : 'instagram_dm',
        notes: `${event.platform === 'facebook' ? 'Facebook Messenger' : 'Instagram DM'} PSID: ${event.senderPsid}`,
        qualifyText: event.text,
        // No phone/email known from a DM alone — the platform conversation
        // itself is this lead's "welcome," same reasoning as WhatsApp-
        // sourced leads in POST /api/leads not getting a duplicate greeting.
        sendWelcome: false,
      })
      if (captured) {
        leadId = captured.leadId
        isNewLead = captured.isNew
        await db.from('unified_conversations').update({ customer_id: leadId }).eq('id', conversationId)
      }
    }

    await recordMessage({
      conversationId,
      channelId,
      direction: 'inbound',
      senderType: 'customer',
      content: event.text,
      externalMessageId: event.externalMessageId,
      rawPayload: { psid: event.senderPsid, platform: event.platform },
    })

    return { leadId, conversationId, isNewLead }
  } catch (err) {
    logger.error('social', `captureSocialDirectMessage failed for ${event.platform}`, err)
    return null
  }
}
