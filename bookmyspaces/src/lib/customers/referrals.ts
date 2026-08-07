// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/customers/referrals.ts
// Growth Platform Phase 2 — Referral Campaigns.
//
// WHAT EXISTS ALREADY (reused, not rebuilt): `leads.referral` (migration
// 026) is a free-text field captured at lead creation — "how did you hear
// about us" style — but nothing anywhere reads it back out or attributes a
// new lead to the specific existing customer who referred them. There is no
// referral-code table anywhere in this codebase (confirmed by a full-repo
// grep before writing this file), and building one (+ a redemption/credit
// ledger) is a bigger product decision (what reward, how issued) than this
// pass makes on its own.
//
// WHAT THIS ADDS: a lightweight, honest best-effort match — every lead's
// phone number IS already a natural, zero-setup "referral code" (operators
// can just say "share your number with friends"). This module scans
// `leads.referral` free text for a 10-digit phone number and matches it
// against existing leads' `phone` column (both normalized to last-10-digits
// so country-code prefixes never cause a false miss/match). A referral text
// that doesn't contain a recognizable phone number (e.g. "friend told me",
// "saw on Instagram") is correctly NOT counted as an attributed referral —
// this never guesses.
//
// PERFORMANCE CONTRACT: one bounded fetch of leads + proposals, matching
// done in-memory — same "fetch once, reduce in JS" pattern as
// revenue-intelligence.ts, not a query per lead.
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabaseAdmin } from '@/lib/supabase'
import { logJourneyEvent, JOURNEY_ACTIONS } from '@/lib/customers/journey'

// ─────────────────────────────────────────────────────────────────────────────
// Growth Engine Epic 2 — Referral Codes + Rewards foundation (migration 034).
// Adds a proper short, shareable code per lead — backward compatible with
// the phone-text matching below, which remains a supported fallback (per
// explicit instruction), not replaced.
// ─────────────────────────────────────────────────────────────────────────────

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no 0/O/1/I — avoids ambiguous chars when read aloud/typed

function generateCode(length = 6): string {
  let code = ''
  for (let i = 0; i < length; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
  return code
}

/** Returns this lead's referral code, creating one on first request (lazy — most leads never need one). */
export async function getOrCreateReferralCode(leadId: string): Promise<string> {
  const db = getSupabaseAdmin()

  const { data: existing } = await db.from('referral_codes').select('code').eq('lead_id', leadId).maybeSingle()
  if (existing?.code) return existing.code

  // Small retry loop for the (very unlikely) case of a code collision —
  // UNIQUE(code) makes a collision fail the insert rather than silently
  // overwrite someone else's code.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateCode()
    const { data, error } = await db.from('referral_codes').insert({ lead_id: leadId, code }).select('code').single()
    if (!error && data) return data.code
    if (error && error.code !== '23505') throw error // 23505 = unique_violation; anything else is a real failure
  }
  throw new Error('Failed to generate a unique referral code after 5 attempts')
}

/** Builds a shareable referral link. Reuses the existing campaign-landing-page capture path (POST /api/campaigns/track already reads `?ref=`) unchanged — no new public route. */
export function buildReferralLink(code: string, landingSlug = 'refer'): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || 'https://www.bookmyspaces.in'
  return `${base.replace(/\/$/, '')}/${landingSlug}?ref=${encodeURIComponent(code)}`
}

function last10Digits(raw: string | null | undefined): string | null {
  if (!raw) return null
  const digits = raw.replace(/\D/g, '')
  if (digits.length < 10) return null
  return digits.slice(-10)
}

// Pulls every run of 10+ digits out of free text and returns each as its
// last-10-digits form — a referral note might contain other numbers (e.g.
// "call me at..."), so every candidate is tried against the phone map
// rather than assuming the first digit run found is the right one.
function extractPhoneCandidates(text: string): string[] {
  const matches = text.match(/\d[\d\s-]{8,}\d/g) ?? []
  const candidates = matches
    .map((m) => last10Digits(m))
    .filter((d): d is string => !!d)
  return Array.from(new Set(candidates))
}

interface LeadRow {
  id: string
  name: string | null
  phone: string | null
  referral: string | null
  created_at: string
}

interface ProposalRow {
  lead_id: string | null
  accepted_at: string | null
  total_price: number | null
}

export interface ReferrerStat {
  referrerId: string
  referrerName: string
  referrerPhone: string | null
  referredCount: number
  referredRevenue: number
}

export interface ReferralPerformance {
  totalLeadsWithReferralText: number
  attributedReferrals: number
  unattributedReferralText: number
  topReferrers: ReferrerStat[]
  note: string
}

interface ReferralCodeRow {
  lead_id: string
  code: string
}

// Exposed so syncReferralRewards() (below) can reuse the exact same
// referrer/referred pairing this function computes, instead of a second,
// possibly-drifting implementation.
async function computeReferralMatches(): Promise<{ pairs: Array<{ referrer: LeadRow; referredId: string }>; leadsWithReferralText: LeadRow[] }> {
  const db = getSupabaseAdmin()

  const [leadsResult, codesResult] = await Promise.all([
    db.from('leads').select('id, name, phone, referral, created_at'),
    db.from('referral_codes').select('lead_id, code'),
  ])

  const leads = (leadsResult.data ?? []) as unknown as LeadRow[]
  const codes = (codesResult.data ?? []) as unknown as ReferralCodeRow[]

  const leadById = new Map(leads.map((l) => [l.id, l]))
  const leadByPhone = new Map<string, LeadRow>()
  for (const l of leads) {
    const key = last10Digits(l.phone)
    if (key && !leadByPhone.has(key)) leadByPhone.set(key, l)
  }
  // Case-insensitive code lookup — codes are generated uppercase, but a
  // referred lead may have typed/pasted it in lowercase.
  const leadByCode = new Map<string, LeadRow>()
  for (const c of codes) {
    const referrer = leadById.get(c.lead_id)
    if (referrer) leadByCode.set(c.code.toUpperCase(), referrer)
  }

  const leadsWithReferralText = leads.filter((l) => l.referral && l.referral.trim().length > 0)
  const pairs: Array<{ referrer: LeadRow; referredId: string }> = []

  for (const referredLead of leadsWithReferralText) {
    const text = referredLead.referral!.trim()

    // Priority 1: exact referral-code match (unambiguous). Codes are 6
    // chars from a no-lookalike alphabet, so a whole-word match is checked
    // rather than a substring match to avoid a coincidental 6-char run
    // inside unrelated free text.
    const codeMatch = text
      .toUpperCase()
      .split(/[^A-Z0-9]+/)
      .map((token) => leadByCode.get(token))
      .find((found) => found && found.id !== referredLead.id)

    if (codeMatch) {
      pairs.push({ referrer: codeMatch, referredId: referredLead.id })
      continue
    }

    // Priority 2 (fallback, backward compatible): phone-number match —
    // unchanged from the original implementation.
    const candidates = extractPhoneCandidates(text)
    const phoneMatch = candidates
      .map((c) => leadByPhone.get(c))
      .find((found) => found && found.id !== referredLead.id)

    if (phoneMatch) pairs.push({ referrer: phoneMatch, referredId: referredLead.id })
  }

  return { pairs, leadsWithReferralText }
}

export async function computeReferralPerformance(): Promise<ReferralPerformance> {
  const db = getSupabaseAdmin()

  const [{ pairs, leadsWithReferralText }, proposalsResult] = await Promise.all([
    computeReferralMatches(),
    db.from('proposals').select('lead_id, accepted_at, total_price'),
  ])

  const proposals = (proposalsResult.data ?? []) as unknown as ProposalRow[]

  const revenueByLead = new Map<string, number>()
  for (const p of proposals) {
    if (p.lead_id && p.accepted_at) {
      revenueByLead.set(p.lead_id, (revenueByLead.get(p.lead_id) ?? 0) + (Number(p.total_price) || 0))
    }
  }

  const referredByReferrer = new Map<string, { referrer: LeadRow; referredIds: Set<string> }>()
  for (const { referrer, referredId } of pairs) {
    if (!referredByReferrer.has(referrer.id)) {
      referredByReferrer.set(referrer.id, { referrer, referredIds: new Set() })
    }
    referredByReferrer.get(referrer.id)!.referredIds.add(referredId)
  }
  const attributedReferrals = pairs.length

  const topReferrers: ReferrerStat[] = Array.from(referredByReferrer.values())
    .map(({ referrer, referredIds }) => ({
      referrerId: referrer.id,
      referrerName: referrer.name || 'Unnamed lead',
      referrerPhone: referrer.phone,
      referredCount: referredIds.size,
      referredRevenue: Array.from(referredIds).reduce((sum, id) => sum + (revenueByLead.get(id) ?? 0), 0),
    }))
    .sort((a, b) => b.referredRevenue - a.referredRevenue || b.referredCount - a.referredCount)

  return {
    totalLeadsWithReferralText: leadsWithReferralText.length,
    attributedReferrals,
    unattributedReferralText: leadsWithReferralText.length - attributedReferrals,
    topReferrers,
    note: 'Referral attribution matches a referral code first (exact match — see Referral Codes), falling back to a phone number found in the lead\'s `referral` free-text field for leads referred before codes existed. Referral text matching neither is not attributed to anyone — never guessed.',
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Referral Rewards sync (Growth Engine Epic 2) — an explicit, idempotent
// write path (never triggered as a side effect of the read-only functions
// above). Creates a 'pending' referral_rewards row for every currently-
// attributed referral pair that doesn't have one yet (UNIQUE(referrer_lead_id,
// referred_lead_id) makes the upsert safe to re-run), and promotes 'pending'
// rows to 'earned' once the referred lead has an actual booking (accepted
// proposal or revenue-recognized reservation) — reusing the exact "booking"
// definition already established in revenue-intelligence.ts's
// computeAdvancedSegmentSets(), not a new one. Never touches 'redeemed'/
// 'cancelled' rows — those are explicit operator decisions via PATCH.
// ─────────────────────────────────────────────────────────────────────────────

const REVENUE_RECOGNIZED_STATUSES = new Set(['confirmed', 'checked_in', 'checked_out'])

interface ReservationBookingRow {
  customer_id: string | null
  status: string | null
}

export async function syncReferralRewards(): Promise<{ created: number; promoted: number }> {
  const db = getSupabaseAdmin()

  const [{ pairs }, existingResult, reservationsResult, proposalsResult] = await Promise.all([
    computeReferralMatches(),
    db.from('referral_rewards').select('id, referrer_lead_id, referred_lead_id, status'),
    db.from('reservations').select('customer_id, status'),
    db.from('proposals').select('lead_id, accepted_at'),
  ])

  const existing = (existingResult.data ?? []) as unknown as Array<{ id: string; referrer_lead_id: string; referred_lead_id: string; status: string }>
  const existingByPair = new Map(existing.map((r) => [`${r.referrer_lead_id}:${r.referred_lead_id}`, r]))

  const bookedLeadIds = new Set<string>()
  for (const r of (reservationsResult.data ?? []) as unknown as ReservationBookingRow[]) {
    if (r.customer_id && r.status && REVENUE_RECOGNIZED_STATUSES.has(r.status)) bookedLeadIds.add(r.customer_id)
  }
  for (const p of (proposalsResult.data ?? []) as unknown as ProposalRow[]) {
    if (p.lead_id && p.accepted_at) bookedLeadIds.add(p.lead_id)
  }

  let created = 0
  let promoted = 0

  for (const { referrer, referredId } of pairs) {
    const key = `${referrer.id}:${referredId}`
    const row = existingByPair.get(key)

    if (!row) {
      const { error } = await db.from('referral_rewards').insert({
        referrer_lead_id: referrer.id,
        referred_lead_id: referredId,
        status: bookedLeadIds.has(referredId) ? 'earned' : 'pending',
      })
      if (!error) {
        created++
        // Growth Engine Epic 4 — journey event, best-effort.
        await logJourneyEvent(referrer.id, JOURNEY_ACTIONS.REFERRAL_ATTRIBUTED, 'Successfully referred a new customer', { referredLeadId: referredId })
      }
      continue
    }

    if (row.status === 'pending' && bookedLeadIds.has(referredId)) {
      const { error } = await db.from('referral_rewards').update({ status: 'earned', updated_at: new Date().toISOString() }).eq('id', row.id)
      if (!error) promoted++
    }
  }

  return { created, promoted }
}
