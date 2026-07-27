// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/leads/create-lead-with-journey.ts
// Direct Event Sales Engine, Section 1 — Social Media Lead Capture.
//
// Every new lead-capture entry point (Facebook/Instagram Lead Ads, Facebook
// Messenger, Instagram DM, and — already live — the website enquiry form at
// POST /api/leads) needs the exact same sequence: resolve identity, dedupe,
// create the lead, log it, sync to Sheets, enter Customer Journey Automation
// (welcome message), run AI qualification. POST /api/leads already does all
// of this inline; this module extracts the same sequence into a reusable
// function so the two new social entry points call ONE proven path instead
// of re-implementing lead creation a second and third time. POST /api/leads
// itself is left untouched (it already works and is already verified) —
// this is additive, not a refactor of shipped code.
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabaseAdmin } from '@/lib/supabase'
import { resolveIdentity } from '@/lib/identity/resolve-identity'
import { syncLeadToSheets } from '@/lib/sheets'
import { enqueueMessage } from '@/lib/queue'
import { WHATSAPP_MESSAGES } from '@/lib/templates'
import { qualifyLeadFromMessage } from '@/lib/whatsapp/auto-qualify'
import { runAutoPackageRecommendation } from '@/lib/leads/auto-package-recommendation'
import { logger } from '@/lib/logger'

export interface CaptureLeadInput {
  name?: string | null
  phone?: string | null
  email?: string | null
  /** leads.source value — e.g. 'facebook_lead_ads', 'instagram_lead_ads', 'facebook_messenger', 'instagram_dm'. */
  source: string
  eventType?: string | null
  /** Free text appended to leads.notes — e.g. the raw form context or a platform user id for reconciliation. */
  notes?: string | null
  /** Text to run AI qualification (extractLeadDetails + scoreLead) against, if any. */
  qualifyText?: string | null
  /** Default true when `phone` is present. Set false for channels where the platform's own reply IS the welcome (mirrors the WhatsApp-sourced-lead exclusion in POST /api/leads). */
  sendWelcome?: boolean
}

export interface CaptureLeadResult {
  leadId: string
  isNew: boolean
}

/**
 * Resolve-or-create a lead and run it through the same welcome-message +
 * AI-qualification sequence POST /api/leads uses, for a non-website capture
 * source. Never throws — a failure here must not take down a webhook.
 */
export async function captureLeadWithJourney(input: CaptureLeadInput): Promise<CaptureLeadResult | null> {
  const db = getSupabaseAdmin()

  try {
    const identity = (input.phone || input.email)
      ? await resolveIdentity({ phone: input.phone, email: input.email })
      : null

    if (identity && identity.matchedOn === 'phone') {
      // Existing lead — don't create a duplicate. Still worth a fresh
      // qualification pass (their intent may have changed) and an activity
      // log entry so the new touch is visible on the Timeline.
      await db.from('activity_logs').insert({
        lead_id: identity.leadId,
        action: 'lead_re_engaged',
        description: `Re-engaged via ${input.source}`,
        performed_by: 'system',
        metadata: { source: input.source },
      })
      if (input.qualifyText) await qualifyLeadFromMessage(identity.leadId, input.qualifyText)
      // Phase 5, Revenue Automation — re-engagement is still worth a fresh
      // package recommendation (self-gated: no-ops if a proposal already
      // exists or there's still no event_type signal).
      await runAutoPackageRecommendation(identity.leadId).catch(() => null)
      return { leadId: identity.leadId, isNew: false }
    }

    const possibleDuplicateLeadId = identity && identity.matchedOn === 'email' ? identity.leadId : null

    const { data: lead, error } = await db
      .from('leads')
      .insert({
        name: input.name || null,
        phone: input.phone || null,
        email: input.email || null,
        event_type: input.eventType || null,
        source: input.source,
        status: 'new_inquiry',
        notes: input.notes || null,
      })
      .select('*')
      .single()

    if (error || !lead) {
      logger.error('leads', `captureLeadWithJourney insert failed for source=${input.source}`, error)
      return null
    }

    await db.from('activity_logs').insert({
      lead_id: lead.id,
      action: 'lead_created',
      description: `Lead captured from ${input.source}`,
      performed_by: 'system',
      ...(possibleDuplicateLeadId && { metadata: { possible_duplicate_of: possibleDuplicateLeadId, matched_on: 'email' } }),
    })

    await syncLeadToSheets(lead).catch(() => null)

    const shouldWelcome = input.sendWelcome ?? Boolean(lead.phone)
    if (shouldWelcome && lead.phone) {
      await enqueueMessage({
        phone: lead.phone,
        message: WHATSAPP_MESSAGES.greeting(lead.name ?? undefined),
        type: 'session',
        metadata: { journey: 'welcome', lead_id: lead.id, source: input.source },
      }).catch(() => null)
    }

    await qualifyLeadFromMessage(lead.id, input.qualifyText ?? null)

    // Phase 5, Revenue Automation — Lead Created -> AI Qualification ->
    // Package Recommendation -> Proposal Suggestion. Runs after
    // qualification so leads.event_type reflects whatever qualifyText
    // extracted; no-ops cleanly if nothing could be identified.
    await runAutoPackageRecommendation(lead.id).catch(() => null)

    return { leadId: lead.id, isNew: true }
  } catch (err) {
    logger.error('leads', `captureLeadWithJourney failed for source=${input.source}`, err)
    return null
  }
}
