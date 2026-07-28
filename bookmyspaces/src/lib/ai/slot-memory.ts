// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/ai/slot-memory.ts
// AI Orchestration Foundation — Phase 1A. Conflict-aware merge added in the
// post-review Hardening Sprint (Critical Issue 1).
//
// Pure data-merging module. No Supabase import, no side effects, nothing
// asynchronous — every source (CRM, conversation memory, AI extraction) is
// gathered by the caller (the orchestration engine, or a future channel
// adapter) from whatever service already owns that data; this file only
// decides which value wins when more than one source has an opinion.
//
// Priority, per the approved architecture (never overwrite a higher-
// confidence value with a lower one) -- WHEN THE TIERS AGREE OR ONLY ONE
// TIER HAS A VALUE:
//   1. CRM data       — a human-confirmed value already sitting on the
//                        `leads` row. Most authoritative.
//   2. Conversation memory — a value already collected earlier in this same
//                        conversation (e.g. whatsapp_conversations.collected_*,
//                        or an equivalent already-resolved value from the
//                        Unified Conversation Platform). Not yet on the CRM
//                        record, but already confirmed by the customer this
//                        thread.
//   3. AI extraction   — this turn's regex-based extraction
//                        (src/lib/extract-lead-details.ts's extractLeadDetails()).
//                        Lowest priority — a fresh, unconfirmed guess.
//
// A slot is only ever filled by a *lower*-priority source when every
// higher-priority source left it null/empty. This is the same "safe-fill,
// never clobber" contract src/lib/whatsapp/auto-qualify.ts already uses for
// individual lead fields — generalized here to a full conversation's
// working memory instead of one field at a time.
//
// CONFLICT-AWARE MERGE (Hardening Sprint, Critical Issue 1) -- WHAT HAPPENS
// WHEN THE TIERS DISAGREE:
// The plain priority rule above has a real bug: if the CRM already says
// guestCount=50 and the customer just typed "actually we now need 150
// guests", the strict-priority rule keeps 50 forever -- a stale CRM value
// silently wins over an explicit, fresher customer correction. That is
// exactly the unacceptable behaviour the Hardening Sprint's Critical Issue 1
// calls out.
//
// Fix: before applying straight priority, every slot is checked for a
// genuine disagreement between the CRM tier and whichever "customer" tier
// (conversation, then extracted) has a value for it. If they disagree:
//   - the merged slot value becomes the CUSTOMER's value, not the stale CRM
//     one -- so this turn's reply/decision is never based on data the
//     customer just explicitly contradicted;
//   - but this is never done *silently* -- a SlotConflict entry is recorded
//     with both values preserved (crmValue and customerValue), plus a
//     recommended resolution and resolutionRequired:true, so a caller (the
//     orchestration engine, an operator UI, or a future confirmation step)
//     can surface it and get explicit confirmation before the change is
//     ever written back to the actual `leads` CRM row. This module still
//     performs no writes and no side effects of any kind -- it only reports.
// If the tiers agree (same value) or only one tier has a value, there is no
// conflict and the original strict-priority rule applies unchanged.
// ─────────────────────────────────────────────────────────────────────────────

import type { ExtractedLeadDetails } from '@/lib/extract-lead-details'

/** The slots this orchestration foundation tracks for one conversation. */
export interface SlotValues {
  eventType: string | null
  eventDate: string | null
  guestCount: number | null
  budget: string | null
  venue: string | null
  specialRequirements: string | null
}

export type SlotKey = keyof SlotValues

/** Slots required to consider a conversation "qualified" — mirrors the
 *  existing ConversationState progression (NEW_INQUIRY -> ... ->
 *  WAITING_FOR_GUEST_COUNT -> QUALIFIED in src/constants/conversation-states.ts),
 *  which already asks for exactly these three in this order before marking
 *  a lead qualified. Budget/venue/specialRequirements are valuable
 *  enrichment but were never a prerequisite for qualification in the
 *  existing state machine, so they're tracked, not required. */
export const REQUIRED_SLOTS: SlotKey[] = ['eventType', 'eventDate', 'guestCount']

export const EMPTY_SLOTS: SlotValues = {
  eventType: null,
  eventDate: null,
  guestCount: null,
  budget: null,
  venue: null,
  specialRequirements: null,
}

export type SlotSourceName = 'crm' | 'conversation' | 'extracted'

/** One merge input per priority tier. Every field optional/partial — a
 *  caller passes only what it actually has for that tier. */
export interface SlotSources {
  /** Highest priority — human-confirmed data already on the `leads` row. */
  crm?: Partial<SlotValues>
  /** Mid priority — already collected earlier in this conversation. */
  conversation?: Partial<SlotValues>
  /** Lowest priority — this turn's regex extraction. */
  extracted?: Partial<SlotValues>
}

/** A source that can hold the "customer's own current word" for a slot -- everything except CRM. */
export type CustomerTierName = Exclude<SlotSourceName, 'crm'>

export type ConflictResolution = 'use_customer_value_pending_confirmation'

/** One detected disagreement between the CRM tier and a customer-supplied tier for a single slot. */
export interface SlotConflict {
  slot: SlotKey
  /** The value already on the CRM (`leads`) row -- preserved, untouched, exactly as supplied. */
  crmValue: string | number
  /** The value the customer supplied this conversation (conversation memory, or this turn's extraction). */
  customerValue: string | number
  /** Which non-CRM tier actually supplied customerValue. */
  customerValueSource: CustomerTierName
  /** What this module recommends the caller do -- never applied to the CRM automatically. */
  recommendedResolution: ConflictResolution
  /** Always true today (the only outcome this module produces for a real conflict) -- kept as an
   *  explicit field, not an implied constant, so a caller can branch on it without knowing that. */
  resolutionRequired: true
}

export interface SlotMergeResult {
  slots: SlotValues
  /** Which tier actually supplied each slot's final value — null if no tier had it. */
  filledBy: Record<SlotKey, SlotSourceName | null>
  /** Required slots (REQUIRED_SLOTS) still null after merging every tier. */
  missingSlots: SlotKey[]
  /** True once every required slot has a value. */
  isQualified: boolean
  /** Every CRM-vs-customer disagreement found this merge. See file header ("Conflict-aware merge"). */
  conflicts: SlotConflict[]
  /** True iff conflicts.length > 0 -- convenience for callers that only need to branch, not inspect. */
  hasConflicts: boolean
}

function hasValue(v: unknown): boolean {
  if (v === null || v === undefined) return false
  if (typeof v === 'string') return v.trim().length > 0
  if (typeof v === 'number') return !Number.isNaN(v)
  return true
}

/** True when two already-present slot values genuinely disagree (not just formatted differently
 *  in a way that's still the same value, e.g. matching numbers or case/whitespace-insensitive strings). */
function valuesConflict(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' || typeof b === 'number') {
    return Number(a) !== Number(b)
  }
  return String(a).trim().toLowerCase() !== String(b).trim().toLowerCase()
}

/**
 * Merge the three priority tiers into one slot set, conflict-aware.
 *
 * For each slot: if the CRM tier and the highest-priority customer tier that
 * has a value (conversation, then extracted) actually disagree, the
 * customer's value wins (never the stale CRM one) and a SlotConflict is
 * recorded. Otherwise, the original strict priority rule applies unchanged
 * — the first tier (crm -> conversation -> extracted, in order) that has a
 * real value wins, and a lower-priority tier never overwrites a
 * higher-priority tier's already-filled value.
 */
export function mergeSlots(sources: SlotSources): SlotMergeResult {
  const tiers: Array<{ name: SlotSourceName; values: Partial<SlotValues> | undefined }> = [
    { name: 'crm', values: sources.crm },
    { name: 'conversation', values: sources.conversation },
    { name: 'extracted', values: sources.extracted },
  ]
  const customerTiers: Array<{ name: CustomerTierName; values: Partial<SlotValues> | undefined }> = [
    { name: 'conversation', values: sources.conversation },
    { name: 'extracted', values: sources.extracted },
  ]

  const slots: SlotValues = { ...EMPTY_SLOTS }
  const filledBy: Record<SlotKey, SlotSourceName | null> = {
    eventType: null, eventDate: null, guestCount: null, budget: null, venue: null, specialRequirements: null,
  }
  const conflicts: SlotConflict[] = []

  for (const key of Object.keys(EMPTY_SLOTS) as SlotKey[]) {
    const crmCandidate = sources.crm?.[key]
    const crmHasValue = hasValue(crmCandidate)

    // First non-CRM tier that actually has a value for this slot -- this is
    // "what the customer is currently saying" (already-confirmed this
    // conversation, or freshly typed this turn).
    let customerCandidate: string | number | undefined
    let customerSource: CustomerTierName | null = null
    for (const tier of customerTiers) {
      const candidate = tier.values?.[key]
      if (hasValue(candidate)) {
        customerCandidate = candidate as string | number
        customerSource = tier.name
        break
      }
    }

    if (crmHasValue && customerSource && valuesConflict(crmCandidate, customerCandidate)) {
      // Genuine disagreement -- never silently keep the stale CRM value (Critical Issue 1).
      slots[key] = customerCandidate as never
      filledBy[key] = customerSource
      conflicts.push({
        slot: key,
        crmValue: crmCandidate as string | number,
        customerValue: customerCandidate as string | number,
        customerValueSource: customerSource,
        recommendedResolution: 'use_customer_value_pending_confirmation',
        resolutionRequired: true,
      })
      continue
    }

    // No conflict -- plain strict priority, first tier with a value wins.
    for (const tier of tiers) {
      const candidate = tier.values?.[key]
      if (hasValue(candidate)) {
        // @ts-expect-error -- candidate is known-compatible with SlotValues[key] per SlotSources' shape
        slots[key] = candidate
        filledBy[key] = tier.name
        break
      }
    }
  }

  const missingSlots = REQUIRED_SLOTS.filter((key) => !hasValue(slots[key]))

  return {
    slots,
    filledBy,
    missingSlots,
    isQualified: missingSlots.length === 0,
    conflicts,
    hasConflicts: conflicts.length > 0,
  }
}

/**
 * Adapts extractLeadDetails()'s output (src/lib/extract-lead-details.ts) to
 * the `extracted` tier's shape. Deliberately thin — extractLeadDetails()
 * itself is untouched and remains the single source of truth for what can
 * be extracted from free text. Note this extractor does not produce
 * eventDate, venue, or specialRequirements today (only event_type,
 * guest_count, budget, occasion, buying_signals) — this function does not
 * invent values for those; they simply stay absent from the returned
 * partial, same as the extractor's own real capability.
 */
export function slotsFromExtraction(extracted: ExtractedLeadDetails): Partial<SlotValues> {
  const partial: Partial<SlotValues> = {}
  if (hasValue(extracted.event_type)) partial.eventType = extracted.event_type
  if (hasValue(extracted.guest_count)) partial.guestCount = extracted.guest_count
  if (hasValue(extracted.budget)) partial.budget = extracted.budget
  return partial
}

/**
 * Adapts a `leads` row (or any subset of it the caller already fetched) to
 * the `crm` tier's shape. Field names match the columns already read by
 * src/lib/ai/context-builder.ts's getCustomerProfileAndPreferences() and
 * src/lib/whatsapp/conversation-manager.ts — this function does not fetch
 * anything itself, it only reshapes an object the caller already has.
 */
export function slotsFromLead(lead: {
  event_type?: string | null
  event_date?: string | null
  guest_count?: number | null
  budget?: string | null
  venue?: string | null
  special_requirements?: string | null
} | null | undefined): Partial<SlotValues> {
  if (!lead) return {}
  const partial: Partial<SlotValues> = {}
  if (hasValue(lead.event_type)) partial.eventType = lead.event_type as string
  if (hasValue(lead.event_date)) partial.eventDate = lead.event_date as string
  if (hasValue(lead.guest_count)) partial.guestCount = lead.guest_count as number
  if (hasValue(lead.budget)) partial.budget = lead.budget as string
  if (hasValue(lead.venue)) partial.venue = lead.venue as string
  if (hasValue(lead.special_requirements)) partial.specialRequirements = lead.special_requirements as string
  return partial
}
