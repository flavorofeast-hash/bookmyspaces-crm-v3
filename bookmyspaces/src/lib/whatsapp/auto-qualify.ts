// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/whatsapp/auto-qualify.ts
// AI Sales Executive (Priority 1) — closing an integration gap, not new
// business logic.
//
// WHAT WAS FOUND: `src/lib/lead-scorer.ts` (scoreLead — deterministic 0-100
// qualification score, HOT/WARM/COLD temperature, urgency level, estimated
// revenue, auto-tags) and `src/lib/extract-lead-details.ts`
// (extractLeadDetails — regex extraction of event type/budget/guest count/
// buying signals from free text) are both fully built and unit-tested, and
// `leads.ai_score` / `lead_temperature` / `urgency_level` / `estimated_revenue`
// / `score_breakdown` / `scored_at` / `tags` already exist as columns
// (src/modules/leads/types.ts's Lead interface documents every one of them
// as "Phase 1: Scoring"). But neither function was ever called from any
// live code path — confirmed by a full-repo grep before writing this file.
// `leads.ai_score` in production is instead only ever set by
// src/lib/scoring.ts's batchScoreLeads() (a separate, LLM-based, 1-10 scale
// scorer, manually triggered from the analytics page), and
// `lead_temperature`/`urgency_level` are NEVER written by anything.
//
// WHY THIS MATTERS COMMERCIALLY: `lead_temperature` is read extensively —
// HotLeadDashboard's sort/color/filter, the WhatsApp inbox's "Hot" filter,
// the Proposals page's urgency sort, followup-rules.ts's cadence selection
// (CADENCE_RULES is keyed BY LeadTemperature), and escalation-engine.ts's
// rules (very_high_value checks ai_score>=90, which a 1-10 scale can never
// reach; stale_hot_lead/negotiation_stale check lead_temperature==='HOT').
// All of that already-built machinery has been silently inert because the
// one field it depends on was never populated. Wiring scoreLead() in here
// activates every one of those existing features — no new UI, no new
// tables, no new business rule; the qualification MODEL itself was already
// engineered and reviewed (see lead-scorer.ts's own extensive scoring
// documentation), just never connected.
//
// SAFE-FILL, NOT OVERWRITE: extracted event_type/guest_count/budget/occasion
// only fill a currently-null field on the lead — never overwrite a value a
// human (or a more specific earlier extraction) already set. Scoring
// columns (ai_score, lead_temperature, etc.) DO get refreshed on every
// inbound message, same as scoreLead()'s own documented behavior (a lead's
// temperature should reflect its current state, not its first message) —
// VIP tags are preserved automatically by scoreLead() itself.
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabaseAdmin } from '@/lib/supabase'
import { extractLeadDetails } from '@/lib/extract-lead-details'
import { scoreLead } from '@/lib/lead-scorer'
import { logJourneyEvent } from '@/lib/customers/journey'

interface QualifyResult {
  scored: boolean
  buyingSignals: string[]
}

/**
 * Runs the existing (previously unwired) extraction + scoring pipeline for
 * one inbound message and persists the result to `leads`. Never throws —
 * callers treat qualification as best-effort, same as every other
 * non-critical step in the inbound WhatsApp pipeline.
 */
export async function qualifyLeadFromMessage(leadId: string, messageText: string | null): Promise<QualifyResult> {
  try {
    const supabase = getSupabaseAdmin()

    const { data: lead, error } = await supabase
      .from('leads')
      .select('name, phone, email, event_type, event_date, guest_count, budget, occasion, source, tags')
      .eq('id', leadId)
      .maybeSingle()

    if (error || !lead) return { scored: false, buyingSignals: [] }

    const extracted = messageText ? extractLeadDetails(messageText) : null

    // Safe-fill: only use an extracted value where the lead doesn't already have one.
    const eventType  = lead.event_type  ?? extracted?.event_type  ?? null
    const guestCount = lead.guest_count ?? extracted?.guest_count ?? null
    const budget     = lead.budget      ?? extracted?.budget      ?? null
    const occasion   = lead.occasion    ?? extracted?.occasion    ?? null

    const scoreResult = scoreLead({
      name: lead.name,
      phone: lead.phone,
      email: lead.email,
      event_type: eventType,
      event_date: lead.event_date,
      guest_count: guestCount,
      budget,
      source: lead.source,
      existing_tags: lead.tags ?? [],
    })

    const updatePayload: Record<string, unknown> = {
      ai_score: scoreResult.ai_score,
      lead_temperature: scoreResult.lead_temperature,
      urgency_level: scoreResult.urgency_level,
      estimated_revenue: scoreResult.estimated_revenue,
      score_breakdown: scoreResult.score_breakdown,
      scored_at: scoreResult.scored_at,
      tags: scoreResult.tags,
    }
    // Only fill previously-empty descriptive fields — never clobber.
    if (!lead.event_type && eventType) updatePayload.event_type = eventType
    if (!lead.guest_count && guestCount) updatePayload.guest_count = guestCount
    if (!lead.budget && budget) updatePayload.budget = budget
    if (!lead.occasion && occasion) updatePayload.occasion = occasion

    await supabase.from('leads').update(updatePayload).eq('id', leadId)

    // Phase 3 (Revenue Automation) — "Detect buying intent." extractLeadDetails()
    // already computes buying_signals on every inbound message but every
    // caller of this function (process-inbound.ts, create-lead-with-journey.ts,
    // dm-capture-service.ts, api/leads/route.ts) previously discarded the
    // returned value — confirmed by reading every call site before this
    // change. Logging it here (once, in the function that already computes
    // it) rather than at each of the four call sites reaches every channel
    // for free and makes it visible on the existing Customer Timeline with
    // zero new UI work, the same reuse decision journey.ts's own header
    // documents for its other events.
    const buyingSignals = extracted?.buying_signals ?? []
    if (buyingSignals.length > 0) {
      await logJourneyEvent(leadId, 'buying_signal_detected', `Buying intent detected: ${buyingSignals.join(', ')}`, { signals: buyingSignals })
    }

    return { scored: true, buyingSignals }
  } catch (err) {
    console.error(`[auto-qualify] Failed to qualify lead ${leadId}:`, err)
    return { scored: false, buyingSignals: [] }
  }
}
