// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/customers/loyalty.ts
// Growth Engine Epic 3 — Loyalty Foundation.
//
// FOUNDATION SCOPE: points ledger + cached balance/tier + a sync job that
// awards points for actual bookings. Does NOT implement redemption (what
// points can be spent on is a business decision this file does not make —
// see migration 035's header) or automatic tier-change notifications.
//
// Reservation revenue reuses the exact reservationRevenue()/REVENUE_
// RECOGNIZED_STATUSES definitions already established in revenue-
// intelligence.ts and lifetime-value.ts, not a new one.
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabaseAdmin } from '@/lib/supabase'
import { logJourneyEvent, JOURNEY_ACTIONS } from '@/lib/customers/journey'
import { enqueueMessage } from '@/lib/queue'
import { WHATSAPP_MESSAGES } from '@/lib/templates'
import { logger } from '@/lib/logger'
import { canSendAutomatedMessage } from '@/lib/messaging/orchestrator'

// Default earn rate — a reasonable starting point, easily changed here
// (not scattered across call sites) since it's a single constant. Exported
// so the Event Post-Experience Lifecycle (src/lib/customers/event-lifecycle.ts)
// awards event revenue at the exact same rate as reservation revenue,
// rather than a second hand-picked rate.
export const POINTS_PER_RUPEE_SPENT = 1 / 100 // 1 point per ₹100 spent

const REVENUE_RECOGNIZED_STATUSES = new Set(['confirmed', 'checked_in', 'checked_out'])

interface TierRule {
  tier_name: string
  min_points: number
}

async function resolveTier(points: number, tierRules: TierRule[]): Promise<string> {
  const sorted = [...tierRules].sort((a, b) => b.min_points - a.min_points)
  return sorted.find((t) => points >= t.min_points)?.tier_name ?? 'Bronze'
}

export interface NextTierTarget {
  tierName: string
  pointsNeeded: number
}

/**
 * Customer Loyalty & Referral Experience — "Next tier target." Smallest
 * min_points strictly above the current balance; null when already at the
 * top tier (never fabricates a target beyond the real configured rules).
 */
export function computeNextTierTarget(points: number, tierRules: TierRule[]): NextTierTarget | null {
  const next = [...tierRules]
    .filter((t) => t.min_points > points)
    .sort((a, b) => a.min_points - b.min_points)[0]
  return next ? { tierName: next.tier_name, pointsNeeded: next.min_points - points } : null
}

export interface LoyaltyAccount {
  lead_id: string
  points_balance: number
  tier: string
  updated_at: string
}

/** Awards (or deducts, with a negative `points`) points and keeps loyalty_accounts in sync. Idempotent per (reference_type, reference_id) when both are given — a duplicate award attempt is a safe no-op. */
export async function awardPoints(params: {
  leadId: string
  points: number
  reason: string
  referenceType?: string
  referenceId?: string
}): Promise<{ awarded: boolean; account: LoyaltyAccount | null }> {
  const db = getSupabaseAdmin()

  const { error: insertError } = await db.from('loyalty_transactions').insert({
    lead_id: params.leadId,
    points_delta: params.points,
    reason: params.reason,
    reference_type: params.referenceType || 'manual',
    reference_id: params.referenceId || null,
  })

  if (insertError) {
    // 23505 = unique_violation on idx_loyalty_transactions_reservation_award —
    // this reservation was already awarded points; not an error, just a no-op.
    if (insertError.code === '23505') return { awarded: false, account: await getLoyaltyAccount(params.leadId) }
    throw insertError
  }

  const [{ data: tierRules }, { data: existingAccount }] = await Promise.all([
    db.from('loyalty_tier_rules').select('tier_name, min_points'),
    db.from('loyalty_accounts').select('points_balance, tier').eq('lead_id', params.leadId).maybeSingle(),
  ])

  const newBalance = (existingAccount?.points_balance ?? 0) + params.points
  const previousTier = existingAccount?.tier ?? 'Bronze'
  const tier = await resolveTier(newBalance, (tierRules ?? []) as unknown as TierRule[])

  const { data: account, error: upsertError } = await db
    .from('loyalty_accounts')
    .upsert({ lead_id: params.leadId, points_balance: newBalance, tier, updated_at: new Date().toISOString() }, { onConflict: 'lead_id' })
    .select('*')
    .single()
  if (upsertError) throw upsertError

  const tierChanged = tier !== previousTier

  // Growth Engine Epic 4 (Customer Journey Engine) — best-effort, only on
  // the actual transition into VIP (never re-logged on subsequent awards).
  // Unchanged from before this pass — kept as its own specific action name.
  if (tier === 'VIP' && previousTier !== 'VIP') {
    await logJourneyEvent(params.leadId, JOURNEY_ACTIONS.VIP_REACHED, `Reached VIP loyalty tier (${newBalance.toLocaleString('en-IN')} points)`, { points: newBalance })
  } else if (tierChanged) {
    // Customer Loyalty & Referral Experience — generalizes the VIP-only log
    // above to every other tier transition (Bronze->Silver->Gold), so the
    // Timeline shows every upgrade, not just the top tier.
    await logJourneyEvent(params.leadId, JOURNEY_ACTIONS.LOYALTY_TIER_UPGRADED, `Upgraded to ${tier} loyalty tier (${newBalance.toLocaleString('en-IN')} points)`, { tier, points: newBalance })
  }

  // Customer Loyalty & Referral Experience — "Notify customers after every
  // eligible booking/event" + "Notify on tier upgrades" + "Include loyalty
  // information in thank-you messages" (this IS that notification for the
  // reservation/event/manual-award paths; event-lifecycle.ts's thank-you
  // WhatsApp message fires separately and this arrives right after it,
  // rather than being spliced into that template's own string). Only for
  // an actual earn (never a manual deduction) and only best-effort — a
  // notification failure must never fail the points award itself.
  if (params.points > 0) {
    try {
      await notifyLoyaltyUpdate({
        leadId: params.leadId,
        pointsEarned: params.points,
        balance: newBalance,
        tier,
        upgradedTo: tierChanged ? tier : null,
        tierRules: (tierRules ?? []) as unknown as TierRule[],
      })
    } catch (err) {
      logger.error('loyalty', 'notifyLoyaltyUpdate failed', err, { leadId: params.leadId })
    }
  }

  return { awarded: true, account: account as unknown as LoyaltyAccount }
}

/**
 * Sends the customer-facing WhatsApp update and skips silently (never
 * throws past this point) when the lead has no phone or has opted out —
 * same respect-opt-out convention as event-lifecycle.ts's optedIn() guard.
 * Extracted from awardPoints() so it has one call site regardless of which
 * caller (reservation sync, event-lifecycle, manual adjustment) triggered
 * the award.
 */
async function notifyLoyaltyUpdate(params: {
  leadId: string
  pointsEarned: number
  balance: number
  tier: string
  upgradedTo: string | null
  tierRules: TierRule[]
}): Promise<void> {
  const db = getSupabaseAdmin()
  const { data: lead } = await db.from('leads').select('name, phone, whatsapp_opted_in').eq('id', params.leadId).maybeSingle()
  if (!lead?.phone || lead.whatsapp_opted_in === false) return
  if (!(await canSendAutomatedMessage(params.leadId, 'loyalty_update'))) return

  const nextTarget = computeNextTierTarget(params.balance, params.tierRules)

  await enqueueMessage({
    phone: lead.phone,
    message: WHATSAPP_MESSAGES.loyaltyPointsUpdate({
      name: lead.name ?? undefined,
      pointsEarned: params.pointsEarned,
      balance: params.balance,
      tier: params.tier,
      upgradedTo: params.upgradedTo,
      nextTierName: nextTarget?.tierName ?? null,
      pointsToNextTier: nextTarget?.pointsNeeded ?? null,
    }),
    type: 'session',
    metadata: { journey: 'loyalty_update', lead_id: params.leadId, tier: params.tier, upgraded: !!params.upgradedTo },
  })

  await logJourneyEvent(params.leadId, JOURNEY_ACTIONS.LOYALTY_POINTS_AWARDED, `Loyalty update sent (${params.pointsEarned} pts, balance ${params.balance}, ${params.tier} tier)`, {
    pointsEarned: params.pointsEarned, balance: params.balance, tier: params.tier,
  })
}

export async function getLoyaltyAccount(leadId: string): Promise<LoyaltyAccount | null> {
  const db = getSupabaseAdmin()
  const { data } = await db.from('loyalty_accounts').select('*').eq('lead_id', leadId).maybeSingle()
  return (data as unknown as LoyaltyAccount) ?? null
}

interface ReservationRow {
  id: string
  customer_id: string | null
  status: string | null
  final_room_rate: number | null
  meal_plan_charge: number | null
}

/**
 * Awards points for every revenue-recognized reservation that hasn't been
 * awarded yet (checked via the reservation-award unique index, not a
 * second lookup query — a duplicate insert simply no-ops). Explicit,
 * operator/cron-triggered — never runs as a side effect of a read.
 */
export async function syncLoyaltyPointsFromBookings(): Promise<{ awarded: number; totalPoints: number }> {
  const db = getSupabaseAdmin()

  const [reservationsResult, existingAwardsResult] = await Promise.all([
    db.from('reservations').select('id, customer_id, status, final_room_rate, meal_plan_charge').in('status', Array.from(REVENUE_RECOGNIZED_STATUSES)),
    // Growth Engine Epic 4 — count of ALREADY-awarded bookings per lead,
    // so a lead crossing from 1 to 2+ awarded bookings in this run can be
    // logged as a repeat-booking journey event exactly once.
    db.from('loyalty_transactions').select('lead_id').eq('reference_type', 'reservation'),
  ])

  const rows = (reservationsResult.data ?? []) as unknown as ReservationRow[]
  const bookingCountByLead = new Map<string, number>()
  for (const t of (existingAwardsResult.data ?? []) as unknown as Array<{ lead_id: string }>) {
    bookingCountByLead.set(t.lead_id, (bookingCountByLead.get(t.lead_id) ?? 0) + 1)
  }

  let awarded = 0
  let totalPoints = 0

  for (const r of rows) {
    if (!r.customer_id) continue
    const revenue = (Number(r.final_room_rate) || 0) + (Number(r.meal_plan_charge) || 0)
    if (revenue <= 0) continue
    const points = Math.round(revenue * POINTS_PER_RUPEE_SPENT)
    if (points <= 0) continue

    const result = await awardPoints({
      leadId: r.customer_id,
      points,
      reason: `Booking revenue (₹${revenue.toLocaleString('en-IN')})`,
      referenceType: 'reservation',
      referenceId: r.id,
    })
    if (result.awarded) {
      awarded++
      totalPoints += points
      const priorCount = bookingCountByLead.get(r.customer_id) ?? 0
      bookingCountByLead.set(r.customer_id, priorCount + 1)
      if (priorCount === 1) {
        // Growth Engine Epic 4 — this booking just made it the 2nd for this lead.
        await logJourneyEvent(r.customer_id, JOURNEY_ACTIONS.REPEAT_BOOKING, 'Reached a second (repeat) booking', { reservationId: r.id })
      }
    }
  }

  return { awarded, totalPoints }
}

export interface LoyaltyOverview {
  totalAccounts: number
  totalPointsIssued: number
  byTier: Array<{ tier: string; count: number }>
  topEarners: Array<{ leadId: string; leadName: string | null; points: number; tier: string }>
}

export interface RevenueByTier {
  tier: string
  revenue: number
  accountCount: number
}

interface ProposalRevenueRow {
  lead_id: string | null
  accepted_at: string | null
  total_price: number | null
}

/**
 * Customer Loyalty & Referral Experience — "Revenue by Loyalty Tier."
 * Reuses the exact revenue-recognized reservation statuses (this file's
 * REVENUE_RECOGNIZED_STATUSES, same set as revenue-intelligence.ts/
 * lifetime-value.ts) and accepted-proposal revenue, joined in-memory
 * against each lead's CURRENT loyalty_accounts.tier — one bounded fetch
 * per table, same "fetch once, reduce in JS" contract as every other
 * analytics function in this codebase, not a query per lead.
 */
export async function computeRevenueByLoyaltyTier(): Promise<RevenueByTier[]> {
  const db = getSupabaseAdmin()
  const [{ data: accounts }, { data: reservations }, { data: proposals }] = await Promise.all([
    db.from('loyalty_accounts').select('lead_id, tier'),
    db.from('reservations').select('customer_id, status, final_room_rate, meal_plan_charge'),
    db.from('proposals').select('lead_id, accepted_at, total_price'),
  ])

  const tierByLead = new Map(((accounts ?? []) as unknown as Array<{ lead_id: string; tier: string }>).map((a) => [a.lead_id, a.tier]))

  const revenueByTier = new Map<string, number>()
  const accountCountByTier = new Map<string, number>()
  for (const tier of Array.from(tierByLead.values())) accountCountByTier.set(tier, (accountCountByTier.get(tier) ?? 0) + 1)

  const addRevenue = (leadId: string | null | undefined, amount: number) => {
    const tier = leadId ? tierByLead.get(leadId) : undefined
    if (!tier || amount <= 0) return
    revenueByTier.set(tier, (revenueByTier.get(tier) ?? 0) + amount)
  }

  for (const r of (reservations ?? []) as unknown as ReservationRow[]) {
    if (r.status && REVENUE_RECOGNIZED_STATUSES.has(r.status)) {
      addRevenue(r.customer_id, (Number(r.final_room_rate) || 0) + (Number(r.meal_plan_charge) || 0))
    }
  }
  for (const p of (proposals ?? []) as unknown as ProposalRevenueRow[]) {
    if (p.accepted_at) addRevenue(p.lead_id, Number(p.total_price) || 0)
  }

  return Array.from(accountCountByTier.keys()).map((tier) => ({
    tier,
    revenue: revenueByTier.get(tier) ?? 0,
    accountCount: accountCountByTier.get(tier) ?? 0,
  }))
}

export async function computeLoyaltyOverview(): Promise<LoyaltyOverview> {
  const db = getSupabaseAdmin()
  const { data: accounts } = await db.from('loyalty_accounts').select('lead_id, points_balance, tier')
  const rows = (accounts ?? []) as unknown as Array<{ lead_id: string; points_balance: number; tier: string }>

  const tierCounts = new Map<string, number>()
  for (const a of rows) tierCounts.set(a.tier, (tierCounts.get(a.tier) ?? 0) + 1)

  const topRows = [...rows].sort((a, b) => b.points_balance - a.points_balance).slice(0, 10)
  const leadIds = topRows.map((r) => r.lead_id)
  const { data: leads } = leadIds.length > 0 ? await db.from('leads').select('id, name').in('id', leadIds) : { data: [] }
  const nameById = new Map((leads ?? []).map((l) => [l.id, l.name]))

  return {
    totalAccounts: rows.length,
    totalPointsIssued: rows.reduce((s, a) => s + a.points_balance, 0),
    byTier: Array.from(tierCounts.entries()).map(([tier, count]) => ({ tier, count })),
    topEarners: topRows.map((r) => ({ leadId: r.lead_id, leadName: nameById.get(r.lead_id) ?? null, points: r.points_balance, tier: r.tier })),
  }
}
