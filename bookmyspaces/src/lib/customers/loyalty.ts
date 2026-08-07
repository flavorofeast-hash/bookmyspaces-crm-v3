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

// Default earn rate — a reasonable starting point, easily changed here
// (not scattered across call sites) since it's a single constant.
const POINTS_PER_RUPEE_SPENT = 1 / 100 // 1 point per ₹100 spent

const REVENUE_RECOGNIZED_STATUSES = new Set(['confirmed', 'checked_in', 'checked_out'])

interface TierRule {
  tier_name: string
  min_points: number
}

async function resolveTier(points: number, tierRules: TierRule[]): Promise<string> {
  const sorted = [...tierRules].sort((a, b) => b.min_points - a.min_points)
  return sorted.find((t) => points >= t.min_points)?.tier_name ?? 'Bronze'
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

  // Growth Engine Epic 4 (Customer Journey Engine) — best-effort, only on
  // the actual transition into VIP (never re-logged on subsequent awards).
  if (tier === 'VIP' && previousTier !== 'VIP') {
    await logJourneyEvent(params.leadId, JOURNEY_ACTIONS.VIP_REACHED, `Reached VIP loyalty tier (${newBalance.toLocaleString('en-IN')} points)`, { points: newBalance })
  }

  return { awarded: true, account: account as unknown as LoyaltyAccount }
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
