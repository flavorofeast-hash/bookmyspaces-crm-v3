import { describe, it, expect, vi, beforeEach } from 'vitest'

// Customer Loyalty & Referral Experience — tests for the customer-facing
// notification logic added to awardPoints() (notifyLoyaltyUpdate,
// computeNextTierTarget) and the new computeRevenueByLoyaltyTier()
// analytics function. Reuses the same per-table mock-router pattern as
// event-lifecycle.test.ts / referrals.build-invitation.test.ts.

interface Lead {
  id: string
  name: string | null
  phone: string | null
  whatsapp_opted_in: boolean | null
}

const state = {
  leads: new Map<string, Lead>(),
  tierRules: [
    { tier_name: 'Bronze', min_points: 0 },
    { tier_name: 'Silver', min_points: 500 },
    { tier_name: 'Gold', min_points: 2000 },
    { tier_name: 'VIP', min_points: 5000 },
  ],
  accounts: new Map<string, { lead_id: string; points_balance: number; tier: string }>(),
  transactionInsertError: null as { code: string; message: string } | null,
  reservations: [] as Array<{ customer_id: string | null; status: string | null; final_room_rate: number | null; meal_plan_charge: number | null }>,
  proposals: [] as Array<{ lead_id: string | null; accepted_at: string | null; total_price: number | null }>,
}

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))
vi.mock('@/lib/queue', () => ({ enqueueMessage: vi.fn().mockResolvedValue('queued-id') }))
vi.mock('@/lib/messaging/orchestrator', () => ({ canSendAutomatedMessage: vi.fn().mockResolvedValue(true) }))
vi.mock('@/lib/customers/journey', () => ({
  JOURNEY_ACTIONS: {
    VIP_REACHED: 'vip_tier_reached',
    LOYALTY_TIER_UPGRADED: 'loyalty_tier_upgraded',
    LOYALTY_POINTS_AWARDED: 'loyalty_points_awarded',
    REPEAT_BOOKING: 'repeat_booking_reached',
  },
  logJourneyEvent: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table === 'loyalty_transactions') {
        return {
          insert: () => Promise.resolve({ error: state.transactionInsertError }),
          select: () => ({
            eq: () => Promise.resolve({ data: [] }),
          }),
        }
      }
      if (table === 'loyalty_tier_rules') {
        return { select: () => Promise.resolve({ data: state.tierRules }) }
      }
      if (table === 'loyalty_accounts') {
        return {
          // Supports both call shapes used across loyalty.ts: a chained
          // .eq(...).maybeSingle() single-row lookup (awardPoints/
          // getLoyaltyAccount) and a plain awaited select-all (this mock's
          // `then` makes the returned builder itself awaitable) used by
          // computeRevenueByLoyaltyTier/computeLoyaltyOverview.
          select: () => ({
            eq: (_col: string, val: string) => ({
              maybeSingle: () => Promise.resolve({ data: state.accounts.get(val) ?? null }),
            }),
            then: (resolve: (v: { data: Array<{ lead_id: string; points_balance: number; tier: string }> }) => void) =>
              resolve({ data: Array.from(state.accounts.values()) }),
          }),
          upsert: (row: { lead_id: string; points_balance: number; tier: string }) => ({
            select: () => ({
              single: () => {
                state.accounts.set(row.lead_id, row)
                return Promise.resolve({ data: row, error: null })
              },
            }),
          }),
        }
      }
      if (table === 'leads') {
        return {
          select: () => ({
            eq: (_col: string, val: string) => ({
              maybeSingle: () => Promise.resolve({ data: state.leads.get(val) ?? null }),
            }),
          }),
        }
      }
      if (table === 'reservations') {
        return { select: () => Promise.resolve({ data: state.reservations }) }
      }
      if (table === 'proposals') {
        return { select: () => Promise.resolve({ data: state.proposals }) }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }),
}))

import { awardPoints, computeNextTierTarget, computeRevenueByLoyaltyTier, getLoyaltyAccount } from './loyalty'
import { enqueueMessage } from '@/lib/queue'
import { logJourneyEvent } from '@/lib/customers/journey'

beforeEach(() => {
  state.leads = new Map()
  state.accounts = new Map()
  state.transactionInsertError = null
  state.reservations = []
  state.proposals = []
  vi.clearAllMocks()
})

describe('computeNextTierTarget', () => {
  const rules = [
    { tier_name: 'Bronze', min_points: 0 },
    { tier_name: 'Silver', min_points: 500 },
    { tier_name: 'Gold', min_points: 2000 },
  ]

  it('returns the smallest tier strictly above the current balance', () => {
    expect(computeNextTierTarget(100, rules)).toEqual({ tierName: 'Silver', pointsNeeded: 400 })
  })

  it('returns null once already at (or above) the top configured tier', () => {
    expect(computeNextTierTarget(2000, rules)).toBeNull()
    expect(computeNextTierTarget(9999, rules)).toBeNull()
  })
})

describe('awardPoints — customer notification', () => {
  it('sends a WhatsApp loyalty update and logs a journey event on an actual earn', async () => {
    state.leads.set('lead_1', { id: 'lead_1', name: 'Priya', phone: '9876543210', whatsapp_opted_in: true })

    const result = await awardPoints({ leadId: 'lead_1', points: 100, reason: 'Booking revenue', referenceType: 'reservation', referenceId: 'res_1' })

    expect(result.awarded).toBe(true)
    expect(enqueueMessage).toHaveBeenCalledWith(expect.objectContaining({
      phone: '9876543210',
      metadata: expect.objectContaining({ journey: 'loyalty_update', lead_id: 'lead_1' }),
    }))
    expect(logJourneyEvent).toHaveBeenCalledWith('lead_1', 'loyalty_points_awarded', expect.any(String), expect.objectContaining({ pointsEarned: 100, balance: 100 }))
  })

  it('does not notify a lead with no phone on file', async () => {
    state.leads.set('lead_2', { id: 'lead_2', name: 'No Phone', phone: null, whatsapp_opted_in: true })

    await awardPoints({ leadId: 'lead_2', points: 100, reason: 'Booking revenue' })

    expect(enqueueMessage).not.toHaveBeenCalled()
  })

  it('respects WhatsApp opt-out', async () => {
    state.leads.set('lead_3', { id: 'lead_3', name: 'Opted Out', phone: '9000000000', whatsapp_opted_in: false })

    await awardPoints({ leadId: 'lead_3', points: 100, reason: 'Booking revenue' })

    expect(enqueueMessage).not.toHaveBeenCalled()
  })

  it('never notifies on a manual deduction (negative points)', async () => {
    state.leads.set('lead_4', { id: 'lead_4', name: 'Deducted', phone: '9111111111', whatsapp_opted_in: true })
    state.accounts.set('lead_4', { lead_id: 'lead_4', points_balance: 500, tier: 'Silver' })

    await awardPoints({ leadId: 'lead_4', points: -100, reason: 'Manual correction' })

    expect(enqueueMessage).not.toHaveBeenCalled()
  })

  it('logs LOYALTY_TIER_UPGRADED (not VIP_REACHED) on a non-VIP tier transition', async () => {
    state.leads.set('lead_5', { id: 'lead_5', name: 'Riser', phone: '9222222222', whatsapp_opted_in: true })
    state.accounts.set('lead_5', { lead_id: 'lead_5', points_balance: 400, tier: 'Bronze' })

    await awardPoints({ leadId: 'lead_5', points: 200, reason: 'Booking revenue' }) // 600 -> Silver

    expect(logJourneyEvent).toHaveBeenCalledWith('lead_5', 'loyalty_tier_upgraded', expect.any(String), expect.objectContaining({ tier: 'Silver' }))
    expect(logJourneyEvent).not.toHaveBeenCalledWith('lead_5', 'vip_tier_reached', expect.any(String), expect.anything())
  })

  it('logs VIP_REACHED on the transition into VIP, unchanged from before this pass', async () => {
    state.leads.set('lead_6', { id: 'lead_6', name: 'VIP Bound', phone: '9333333333', whatsapp_opted_in: true })
    state.accounts.set('lead_6', { lead_id: 'lead_6', points_balance: 4900, tier: 'Gold' })

    await awardPoints({ leadId: 'lead_6', points: 200, reason: 'Booking revenue' }) // 5100 -> VIP

    expect(logJourneyEvent).toHaveBeenCalledWith('lead_6', 'vip_tier_reached', expect.any(String), expect.anything())
  })

  it('is a safe no-op on a duplicate (unique_violation) award attempt — no second notification', async () => {
    state.transactionInsertError = { code: '23505', message: 'duplicate key' }
    state.leads.set('lead_7', { id: 'lead_7', name: 'Dup', phone: '9444444444', whatsapp_opted_in: true })

    const result = await awardPoints({ leadId: 'lead_7', points: 100, reason: 'Booking revenue', referenceType: 'reservation', referenceId: 'res_dup' })

    expect(result.awarded).toBe(false)
    expect(enqueueMessage).not.toHaveBeenCalled()
  })

  it('never throws past a notification failure — the award itself still succeeds', async () => {
    state.leads.set('lead_8', { id: 'lead_8', name: 'Fails', phone: '9555555555', whatsapp_opted_in: true })
    vi.mocked(enqueueMessage).mockRejectedValueOnce(new Error('queue outage'))

    const result = await awardPoints({ leadId: 'lead_8', points: 100, reason: 'Booking revenue' })

    expect(result.awarded).toBe(true)
  })
})

describe('getLoyaltyAccount', () => {
  it('returns null for a lead with no loyalty account yet', async () => {
    expect(await getLoyaltyAccount('nobody')).toBeNull()
  })
})

describe('computeRevenueByLoyaltyTier', () => {
  it('sums revenue-recognized reservation + accepted-proposal revenue per current tier', async () => {
    state.accounts.set('lead_a', { lead_id: 'lead_a', points_balance: 1000, tier: 'Silver' })
    state.accounts.set('lead_b', { lead_id: 'lead_b', points_balance: 6000, tier: 'VIP' })
    state.reservations = [
      { customer_id: 'lead_a', status: 'checked_out', final_room_rate: 10_000, meal_plan_charge: 2_000 },
      { customer_id: 'lead_b', status: 'confirmed', final_room_rate: 50_000, meal_plan_charge: 0 },
      { customer_id: 'lead_a', status: 'cancelled', final_room_rate: 99_999, meal_plan_charge: 0 }, // not revenue-recognized
    ]
    state.proposals = [
      { lead_id: 'lead_b', accepted_at: '2026-01-01', total_price: 25_000 },
      { lead_id: 'unknown_lead', accepted_at: '2026-01-01', total_price: 999_999 }, // no loyalty account — excluded
    ]

    const result = await computeRevenueByLoyaltyTier()

    const byTier = new Map(result.map((r) => [r.tier, r]))
    expect(byTier.get('Silver')).toEqual({ tier: 'Silver', revenue: 12_000, accountCount: 1 })
    expect(byTier.get('VIP')).toEqual({ tier: 'VIP', revenue: 75_000, accountCount: 1 })
  })

  it('returns an empty array when there are no loyalty accounts', async () => {
    expect(await computeRevenueByLoyaltyTier()).toEqual([])
  })
})
