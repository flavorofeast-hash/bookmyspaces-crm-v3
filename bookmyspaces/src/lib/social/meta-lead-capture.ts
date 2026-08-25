// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/social/meta-lead-capture.ts
// Direct Event Sales Engine, Section 1 — Facebook/Instagram Lead Ads +
// Messenger/IG-DM capture.
//
// Deliberately kept separate from meta-adapter.ts's SocialAdapter
// implementation: leadgen forms and Messenger-style DMs are Meta-specific
// concepts that don't fit the platform-agnostic SocialAdapter contract
// (comments/mentions/reviews) — see src/lib/social/types.ts's own header,
// which explicitly carves DMs out of that interface. This file is the
// Meta-specific half; a future LinkedIn/other lead-ads integration would
// get its own equivalent file, not a forced shared interface.
//
// CREDENTIAL-GATED, same pattern as meta-adapter.ts: every real Graph API
// call checks for META_PAGE_ACCESS_TOKEN first and returns a clean failure
// instead of throwing when it's absent.
// ─────────────────────────────────────────────────────────────────────────────

import { logger } from '@/lib/logger'
import { getSupabaseAdmin } from '@/lib/supabase'
import { callGraphAPI } from '@/lib/social/graph-api-client'

const GRAPH = 'https://graph.facebook.com/v23.0'

export interface LeadgenEvent {
  leadgenId: string
  formId: string | null
  pageId: string | null
  adId: string | null
  platform: 'facebook' | 'instagram'
}

export interface MessagingEvent {
  senderPsid: string
  text: string | null
  timestamp: number | null
  externalMessageId: string | null
  platform: 'facebook' | 'instagram'
  /**
   * The Page/Instagram-scoped id this message was addressed to --
   * `event.recipient.id` in Meta's Messenger-Platform-style payload. Used
   * to resolve which connected social_accounts row (which client/hotel)
   * this event belongs to (social-account-routing.ts). Multi-account
   * hardening pass -- previously discarded entirely, so every account's
   * DMs collapsed into one shared, undifferentiated channel.
   */
  recipientId: string | null
}

// ─── Leadgen idempotency (migration 029, social_leadgen_events) ───────────
// Meta integration hardening pass. Meta redelivers a leadgen webhook on any
// non-2xx response/timeout, and a captured valid payload can be replayed —
// without this, every replay re-fetched the same Graph API form data and
// re-ran captureLeadWithJourney(), inserting a duplicate `leads` row on
// every replay when the form had no phone/email to dedupe against (see
// SECURITY_AUDIT_REPORT.md finding M9). `claimLeadgenEvent` uses an atomic
// INSERT ... ON CONFLICT DO NOTHING so two concurrent deliveries of the
// same leadgen_id can't both "win" the race — the DB's UNIQUE(leadgen_id)
// constraint is the actual guarantee, this is just how the app observes it.

/**
 * Attempts to claim a leadgen_id as "being processed now." Returns true the
 * first time (caller should proceed), false on every subsequent call for
 * the same leadgen_id (caller should skip — it's a replay). Fails open
 * (returns true) on a DB error, so a database hiccup degrades to
 * "possible duplicate processing," never "leadgen event silently dropped."
 */
export async function claimLeadgenEvent(leadgenId: string, platform: 'facebook' | 'instagram'): Promise<boolean> {
  try {
    const db = getSupabaseAdmin()
    const { data, error } = await db
      .from('social_leadgen_events')
      .insert({ leadgen_id: leadgenId, platform })
      .select('id')
      .single()

    if (!error && data) return true
    // Postgres unique_violation — this leadgen_id was already claimed.
    if (error?.code === '23505') {
      logger.info('social', 'Leadgen event already processed, skipping (replay)', { leadgenId, platform })
      return false
    }
    logger.error('social', 'claimLeadgenEvent insert failed — proceeding anyway (fail open)', error, { leadgenId, platform })
    return true
  } catch (err) {
    logger.error('social', 'claimLeadgenEvent threw — proceeding anyway (fail open)', err, { leadgenId, platform })
    return true
  }
}

/** Best-effort: links a claimed leadgen event to the lead it produced/matched, once known. Never throws. */
export async function linkLeadgenEventToLead(leadgenId: string, leadId: string): Promise<void> {
  try {
    const db = getSupabaseAdmin()
    await db.from('social_leadgen_events').update({ lead_id: leadId }).eq('leadgen_id', leadgenId)
  } catch (err) {
    logger.error('social', 'linkLeadgenEventToLead failed (non-fatal)', err, { leadgenId, leadId })
  }
}

/**
 * Scans a Meta webhook payload's entry[].changes[] for 'leadgen' field
 * events (Facebook Lead Ads / Instagram Lead Forms). Defensive parsing,
 * same convention as MetaAdapter.parseWebhook() — unknown shapes yield [].
 */
export function parseLeadgenEvents(payload: Record<string, unknown>, platform: 'facebook' | 'instagram'): LeadgenEvent[] {
  const out: LeadgenEvent[] = []
  const entries = Array.isArray(payload.entry) ? payload.entry : []
  for (const entry of entries) {
    const changes = Array.isArray((entry as Record<string, unknown>).changes)
      ? ((entry as Record<string, unknown>).changes as Record<string, unknown>[])
      : []
    for (const change of changes) {
      if (String(change.field ?? '') !== 'leadgen') continue
      const value = (change.value ?? {}) as Record<string, unknown>
      const leadgenId = String(value.leadgen_id ?? '')
      if (!leadgenId) continue
      out.push({
        leadgenId,
        formId: value.form_id ? String(value.form_id) : null,
        pageId: value.page_id ? String(value.page_id) : null,
        adId: value.ad_id ? String(value.ad_id) : null,
        platform,
      })
    }
  }
  return out
}

/**
 * Scans a Meta webhook payload's entry[].messaging[] for inbound Messenger
 * / Instagram Direct messages. Ignores echoes (our own outbound sends),
 * delivery/read receipts, and postbacks — text messages only for now.
 */
export function parseMessagingEvents(payload: Record<string, unknown>, platform: 'facebook' | 'instagram'): MessagingEvent[] {
  const out: MessagingEvent[] = []
  const entries = Array.isArray(payload.entry) ? payload.entry : []
  for (const entry of entries) {
    const messaging = Array.isArray((entry as Record<string, unknown>).messaging)
      ? ((entry as Record<string, unknown>).messaging as Record<string, unknown>[])
      : []
    for (const event of messaging) {
      const message = (event.message ?? null) as Record<string, unknown> | null
      if (!message || message.is_echo) continue // skip our own outbound + non-message events (delivery/read/postback)
      const senderId = ((event.sender ?? {}) as Record<string, unknown>).id
      if (!senderId) continue
      const recipientId = ((event.recipient ?? {}) as Record<string, unknown>).id
      out.push({
        senderPsid: String(senderId),
        text: message.text ? String(message.text) : null,
        timestamp: typeof event.timestamp === 'number' ? event.timestamp : null,
        externalMessageId: message.mid ? String(message.mid) : null,
        platform,
        recipientId: recipientId ? String(recipientId) : null,
      })
    }
  }
  return out
}

export interface LeadgenDetails {
  name: string | null
  phone: string | null
  email: string | null
  raw: Record<string, unknown>
}

const NAME_FIELDS = ['full_name', 'name']
const FIRST_NAME_FIELDS = ['first_name']
const LAST_NAME_FIELDS = ['last_name']
const EMAIL_FIELDS = ['email']
const PHONE_FIELDS = ['phone_number', 'phone']

/**
 * Meta's leadgen webhook event carries only a `leadgen_id` — the actual
 * form answers require a follow-up Graph API call. Returns null when
 * unconfigured (no META_PAGE_ACCESS_TOKEN) or on any Graph error; callers
 * treat that as "nothing to capture," never a thrown exception.
 */
export async function fetchLeadgenDetails(leadgenId: string): Promise<LeadgenDetails | null> {
  const accessToken = process.env.META_PAGE_ACCESS_TOKEN
  if (!accessToken) {
    logger.info('social', 'fetchLeadgenDetails skipped — META_PAGE_ACCESS_TOKEN not configured')
    return null
  }

  const result = await callGraphAPI<{ field_data?: Array<{ name: string; values: string[] }> }>(
    `${GRAPH}/${leadgenId}?access_token=${encodeURIComponent(accessToken)}`,
    { method: 'GET' },
    'fetch-leadgen-details'
  )

  if (!result.ok || !result.data?.field_data) {
    // callGraphAPI already logged the failure (with retries) — nothing more to add here.
    return null
  }

  const byName = new Map<string, string>()
  for (const field of result.data.field_data) {
    const key = field.name?.toLowerCase()
    const value = field.values?.[0]
    if (key && value) byName.set(key, value)
  }

  const firstMatch = (keys: string[]) => keys.map((k) => byName.get(k)).find((v) => !!v) ?? null
  const first = firstMatch(FIRST_NAME_FIELDS)
  const last = firstMatch(LAST_NAME_FIELDS)
  const combinedName = [first, last].filter(Boolean).join(' ') || null
  const name = firstMatch(NAME_FIELDS) ?? combinedName

  return {
    name,
    phone: firstMatch(PHONE_FIELDS),
    email: firstMatch(EMAIL_FIELDS),
    raw: result.data as Record<string, unknown>,
  }
}
