// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/social/interaction-service.ts
// V3 Phase 5 — Unified Social Inbox business logic.
//
// Ingest path (webhooks → here): idempotent on (platform, external_id),
// sentiment: cheap keyword pass, upgradeable to model-scored behind the
// same column.
//
// Sprint 3 (Social CRM) additive extension: intent classification
// (enquiry/complaint/booking_intent/spam, reusing extract-lead-details.ts's
// already-built regex extraction — no duplicate buying-signal logic), and
// best-effort auto-lead-linking via linkInteractionToLead() below. Author
// name match is still deliberately NOT attempted for linking (too
// imprecise) — linkage happens when a phone/email surfaces in the
// interaction content (captureLeadWithJourney's own phone/email dedup), or
// via a same-author-on-this-platform reuse of a PRIOR interaction's
// customer_id (see linkInteractionToLead) so a repeat commenter with no
// contact info never gets a second lead.
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabaseAdmin } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { extractLeadDetails } from '@/lib/extract-lead-details'
import { captureLeadWithJourney } from '@/lib/leads/create-lead-with-journey'
import type { NormalizedInteraction } from '@/lib/social/types'

const NEGATIVE = /\b(worst|terrible|horrible|bad|dirty|rude|scam|fraud|cheated|disappointed|refund|complaint)\b/i
const POSITIVE = /\b(great|amazing|excellent|beautiful|lovely|wonderful|best|fantastic|recommended|awesome)\b/i

export function classifySentiment(text: string | null): 'positive' | 'neutral' | 'negative' | null {
  if (!text) return null
  if (NEGATIVE.test(text)) return 'negative'
  if (POSITIVE.test(text)) return 'positive'
  return 'neutral'
}

export type InteractionIntent = 'enquiry' | 'complaint' | 'booking_intent' | 'spam'

// Keyword-based, same "cheap pass now, upgradeable to model-scored behind
// the same column" convention classifySentiment above already established
// — not a new architectural pattern.
const SPAM = /\b(follow[\s-]*for[\s-]*follow|f4f\b|dm\s*(me\s*)?for\s*(promo|collab|shoutout)|check\s*(my|out)\s*(bio|profile|page)|click\s*(the\s*)?link|https?:\/\/|www\.[a-z0-9-]+\.[a-z]{2,}|bit\.ly|make\s*money\s*(fast|online)|work\s*from\s*home|forex\s*trading|crypto\s*(investment|trading)|onlyfans)\b/i

const COMPLAINT = /\b(refund|complaint|complain(ed|ing)?|scam|fraud|cheated|worst\s*(experience|service|hotel|stay)?|terrible|horrible|disgusting|unacceptable|rude\s*staff|never\s*(coming\s*back|again)|disappointed|food\s*poisoning|unhygienic|dirty\s*room)\b/i

const ENQUIRY_HINT = /\b(interested|tell me more|more details|more info|how much|price|cost|rate|package|available|availability|book|booking|visit|enquiry|inquire|inquiry)\b/i

/**
 * Classifies the operator-facing intent of an inbound social interaction.
 * Priority order: spam > complaint > booking_intent > enquiry > null (no
 * discernible intent — e.g. a plain compliment with no ask). Reuses
 * extractLeadDetails()'s already-built, unit-tested buying-signal
 * extraction (src/lib/extract-lead-details.ts) rather than re-implementing
 * a second buying-intent regex table.
 */
export function classifyInteractionIntent(text: string | null): InteractionIntent | null {
  if (!text || !text.trim()) return null
  if (SPAM.test(text)) return 'spam'
  if (COMPLAINT.test(text)) return 'complaint'

  const { buying_signals } = extractLeadDetails(text)
  if (buying_signals.includes('READY_TO_BOOK')) return 'booking_intent'
  if (buying_signals.length > 0 || ENQUIRY_HINT.test(text) || text.includes('?')) return 'enquiry'

  return null
}

const PHONE_RE = /(?:\+?91[\s-]?)?[6-9]\d{9}\b/
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/

/**
 * Sprint 3 (Social CRM) — "Automatically create CRM Leads. Merge with
 * existing customers. Never create duplicates." Best-effort, never throws
 * (a linking failure must not fail interaction ingestion). Three paths, in
 * order:
 *   1. A phone/email is extractable from the content → captureLeadWithJourney
 *      (its existing resolveIdentity phone/email dedup applies — reuses an
 *      existing lead rather than creating a duplicate).
 *   2. No contact info, but this author (same platform + author_external_id)
 *      already has an earlier interaction linked to a lead → reuse that
 *      lead_id (logs a re-engagement activity), never a new lead.
 *   3. No contact info and no prior link, and intent is 'enquiry' or
 *      'booking_intent' → create one contact-less lead for this author, so
 *      the NEXT interaction from the same author finds it via path 2.
 * 'spam' interactions and casual comments/positive remarks with no
 * enquiry/booking signal never create a lead.
 *
 * Never sends a welcome message (sendWelcome: false) — a public comment is
 * not an opt-in DM, and this codebase's standing rule is no autonomous
 * customer-facing send without an explicit human action.
 */
async function linkInteractionToLead(
  interactionId: string,
  interaction: NormalizedInteraction,
  intent: InteractionIntent
): Promise<void> {
  const supabase = getSupabaseAdmin()
  const content = interaction.content ?? ''
  const phoneMatch = content.match(PHONE_RE)?.[0] ?? null
  const emailMatch = content.match(EMAIL_RE)?.[0] ?? null
  const source = `${interaction.platform}_${interaction.interactionType}`
  const notes = content ? `Social ${interaction.interactionType} on ${interaction.platform}: "${content.slice(0, 300)}"` : null

  let leadId: string | null = null

  if (phoneMatch || emailMatch) {
    const result = await captureLeadWithJourney({
      name: interaction.authorName ?? null,
      phone: phoneMatch,
      email: emailMatch,
      source,
      notes,
      qualifyText: content,
      sendWelcome: false,
    })
    leadId = result?.leadId ?? null
  } else if (interaction.authorExternalId) {
    const { data: priorLinked } = await supabase
      .from('social_interactions')
      .select('customer_id')
      .eq('platform', interaction.platform)
      .eq('author_external_id', interaction.authorExternalId)
      .not('customer_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (priorLinked?.customer_id) {
      leadId = priorLinked.customer_id
      await supabase.from('activity_logs').insert({
        lead_id: leadId,
        action: 'lead_re_engaged',
        description: `Re-engaged via ${source}`,
        performed_by: 'system',
        metadata: { source, content: content.slice(0, 300) },
      })
    } else if (intent === 'enquiry' || intent === 'booking_intent') {
      const result = await captureLeadWithJourney({
        name: interaction.authorName ?? null,
        source,
        notes,
        qualifyText: content,
        sendWelcome: false,
      })
      leadId = result?.leadId ?? null
    }
  }

  if (leadId) {
    await supabase.from('social_interactions').update({ customer_id: leadId }).eq('id', interactionId)
  }
}

export async function ingestInteraction(interaction: NormalizedInteraction): Promise<{ ok: boolean; id?: string; duplicate?: boolean }> {
  const supabase = getSupabaseAdmin()

  const { data: existing } = await supabase
    .from('social_interactions')
    .select('id')
    .eq('platform', interaction.platform)
    .eq('external_id', interaction.externalId)
    .maybeSingle()

  if (existing?.id) return { ok: true, id: existing.id, duplicate: true }

  const intent = classifyInteractionIntent(interaction.content)

  const { data, error } = await supabase
    .from('social_interactions')
    .insert({
      platform: interaction.platform,
      interaction_type: interaction.interactionType,
      external_id: interaction.externalId,
      external_parent_id: interaction.externalParentId ?? null,
      author_name: interaction.authorName ?? null,
      author_external_id: interaction.authorExternalId ?? null,
      content: interaction.content,
      sentiment: classifySentiment(interaction.content),
      intent,
      status: 'new',
      raw_payload: interaction.rawPayload ?? null,
    })
    .select('id')
    .single()

  if (error || !data) {
    logger.error('social', 'ingestInteraction insert failed', error)
    return { ok: false }
  }

  if (intent && intent !== 'spam') {
    await linkInteractionToLead(data.id, interaction, intent).catch((err) =>
      logger.error('social', 'linkInteractionToLead failed', err)
    )
  }

  return { ok: true, id: data.id }
}
