import { describe, it, expect, vi, beforeEach } from 'vitest'

// Customer Loyalty & Referral Experience — tests for the new referral
// reward notification logic (notifyReferralRewardStatusChange, wired into
// syncReferralRewards()) and the new Referral Conversion / Referral Revenue
// fields on computeReferralPerformance(). Reuses the same per-table
// mock-router pattern as referrals.build-invitation.test.ts.

interface Lead {
  id: string
  name: string | null
  phone: string | null
  referral: string | null
  whatsapp_opted_in?: boolean | null
  created_at: string
}

const state = {
  leads: [] as Lead[],
  codes: [] as Array<{ lead_id: string; code: string }>,
  proposals: [] as Array<{ lead_id: string | null; accepted_at: string | null; total_price: number | null }>,
  reservations: [] as Array<{ customer_id: string | null; status: string | null }>,
  existingRewards: [] as Array<{ id: string; referrer_lead_id: string; referred_lead_id: string; status: string; reward_type: string | null; reward_value: number | null }>,
  insertedRewards: [] as Array<{ referrer_lead_id: string; referred_lead_id: string; status: string }>,
  updatedRewardIds: [] as string[],
  leadsByIdForNotify: new Map<string, Lead>(),
  rewardCountByReferrer: new Map<string, number>(),
}

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))
vi.mock('@/lib/queue', () => ({ enqueueMessage: vi.fn().mockResolvedValue('queued-id') }))
vi.mock('@/lib/messaging/orchestrator', () => ({ canSendAutomatedMessage: vi.fn().mockResolvedValue(true) }))
vi.mock('@/lib/customers/journey', () => ({
  JOURNEY_ACTIONS: {
    REFERRAL_ATTRIBUTED: 'referral_attributed',
    REFERRAL_REWARD_STATUS_CHANGED: 'referral_reward_status_changed',
  },
  logJourneyEvent: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table === 'leads') {
        return {
          select: (cols: string) => {
            if (cols.includes('name, phone, whatsapp_opted_in')) {
              return {
                eq: (_col: string, val: string) => ({
                  maybeSingle: () => Promise.resolve({ data: state.leadsByIdForNotify.get(val) ?? null }),
                }),
              }
            }
            return Promise.resolve({ data: state.leads })
          },
        }
      }
      if (table === 'referral_codes') {
        return { select: () => Promise.resolve({ data: state.codes }) }
      }
      if (table === 'proposals') {
        return { select: () => Promise.resolve({ data: state.proposals }) }
      }
      if (table === 'reservations') {
        return { select: () => Promise.resolve({ data: state.reservations }) }
      }
      if (table === 'referral_rewards') {
        return {
          select: (cols: string, opts?: { count?: string; head?: boolean }) => {
            if (opts?.count) {
              return {
                eq: (_col: string, val: string) => Promise.resolve({ count: state.rewardCountByReferrer.get(val) ?? 0 }),
              }
            }
            return Promise.resolve({ data: state.existingRewards })
          },
          insert: (row: { referrer_lead_id: string; referred_lead_id: string; status: string }) => {
            state.insertedRewards.push(row)
            return Promise.resolve({ error: null })
          },
          update: (_patch: Record<string, unknown>) => ({
            eq: (_col: string, id: string) => {
              state.updatedRewardIds.push(id)
              return Promise.resolve({ error: null })
            },
          }),
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }),
}))

import { computeReferralPerformance, syncReferralRewards, notifyReferralRewardStatusChange } from './referrals'
import { enqueueMessage } from '@/lib/queue'
import { logJourneyEvent } from '@/lib/customers/journey'

function lead(overrides: Partial<Lead> & { id: string }): Lead {
  return { name: 'Lead', phone: null, referral: null, created_at: '2026-01-01', ...overrides }
}

beforeEach(() => {
  state.leads = []
  state.codes = []
  state.proposals = []
  state.reservations = []
  state.existingRewards = []
  state.insertedRewards = []
  state.updatedRewardIds = []
  state.leadsByIdForNotify = new Map()
  state.rewardCountByReferrer = new Map()
  vi.clearAllMocks()
})

describe('computeReferralPerformance — Referral Conversion + Referral Revenue', () => {
  it('computes conversion rate and total revenue from attributed, booked referrals', async () => {
    state.leads = [
      lead({ id: 'referrer_1', phone: '9000000001' }),
      lead({ id: 'referred_1', referral: '9000000001' }), // booked
      lead({ id: 'referred_2', referral: '9000000001' }), // not booked
    ]
    state.proposals = [{ lead_id: 'referred_1', accepted_at: '2026-01-05', total_price: 40_000 }]

    const result = await computeReferralPerformance()

    expect(result.attributedReferrals).toBe(2)
    expect(result.referralConversionRate).toBe(50) // 1 of 2 referred leads booked
    expect(result.totalReferralRevenue).toBe(40_000)
  })

  it('reports 0% conversion and 0 revenue when there are no attributed referrals', async () => {
    state.leads = [lead({ id: 'lonely', referral: 'friend told me' })] // no phone number in text — unattributed

    const result = await computeReferralPerformance()

    expect(result.attributedReferrals).toBe(0)
    expect(result.referralConversionRate).toBe(0)
    expect(result.totalReferralRevenue).toBe(0)
  })
})

describe('notifyReferralRewardStatusChange', () => {
  it('sends a WhatsApp update including reward details and referral stats, and logs a journey event', async () => {
    state.leadsByIdForNotify.set('referrer_1', lead({ id: 'referrer_1', name: 'Amit', phone: '9876500000', whatsapp_opted_in: true }))
    state.rewardCountByReferrer.set('referrer_1', 3)

    await notifyReferralRewardStatusChange({ referrerLeadId: 'referrer_1', status: 'earned', rewardType: 'flat_credit', rewardValue: 500 })

    expect(enqueueMessage).toHaveBeenCalledWith(expect.objectContaining({
      phone: '9876500000',
      metadata: expect.objectContaining({ journey: 'referral_reward_update', lead_id: 'referrer_1', status: 'earned' }),
    }))
    const call = vi.mocked(enqueueMessage).mock.calls[0][0]
    expect(call.message).toContain('earned')
    expect(logJourneyEvent).toHaveBeenCalledWith('referrer_1', 'referral_reward_status_changed', expect.any(String), expect.objectContaining({ status: 'earned' }))
  })

  it('does not notify a referrer with no phone on file', async () => {
    state.leadsByIdForNotify.set('referrer_2', lead({ id: 'referrer_2', phone: null }))

    await notifyReferralRewardStatusChange({ referrerLeadId: 'referrer_2', status: 'earned' })

    expect(enqueueMessage).not.toHaveBeenCalled()
  })

  it('respects WhatsApp opt-out', async () => {
    state.leadsByIdForNotify.set('referrer_3', lead({ id: 'referrer_3', phone: '9111100000', whatsapp_opted_in: false }))

    await notifyReferralRewardStatusChange({ referrerLeadId: 'referrer_3', status: 'earned' })

    expect(enqueueMessage).not.toHaveBeenCalled()
  })

  it('never throws — a notification failure is swallowed (best-effort)', async () => {
    state.leadsByIdForNotify.set('referrer_4', lead({ id: 'referrer_4', phone: '9222200000', whatsapp_opted_in: true }))
    vi.mocked(enqueueMessage).mockRejectedValueOnce(new Error('queue outage'))

    await expect(notifyReferralRewardStatusChange({ referrerLeadId: 'referrer_4', status: 'earned' })).resolves.toBeUndefined()
  })
})

describe('syncReferralRewards — notification wiring', () => {
  it('notifies the referrer when a new reward is created as earned', async () => {
    state.leads = [
      lead({ id: 'referrer_1', phone: '9000000001' }),
      lead({ id: 'referred_1', referral: '9000000001' }),
    ]
    state.reservations = [{ customer_id: 'referred_1', status: 'confirmed' }]
    state.leadsByIdForNotify.set('referrer_1', lead({ id: 'referrer_1', name: 'Amit', phone: '9000000001', whatsapp_opted_in: true }))

    const result = await syncReferralRewards()

    expect(result.created).toBe(1)
    expect(state.insertedRewards).toEqual([{ referrer_lead_id: 'referrer_1', referred_lead_id: 'referred_1', status: 'earned' }])
    expect(enqueueMessage).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ status: 'earned' }) }))
  })

  it('does not notify when a new reward is only created as pending (no booking yet)', async () => {
    state.leads = [
      lead({ id: 'referrer_1', phone: '9000000001' }),
      lead({ id: 'referred_1', referral: '9000000001' }),
    ]
    // no reservations/proposals — referred lead has not booked

    const result = await syncReferralRewards()

    expect(result.created).toBe(1)
    expect(state.insertedRewards[0].status).toBe('pending')
    expect(enqueueMessage).not.toHaveBeenCalled()
  })

  it('notifies on promotion from pending to earned, carrying reward_type/reward_value through', async () => {
    state.leads = [
      lead({ id: 'referrer_1', phone: '9000000001' }),
      lead({ id: 'referred_1', referral: '9000000001' }),
    ]
    state.existingRewards = [{ id: 'reward_1', referrer_lead_id: 'referrer_1', referred_lead_id: 'referred_1', status: 'pending', reward_type: 'discount_pct', reward_value: 10 }]
    state.reservations = [{ customer_id: 'referred_1', status: 'checked_in' }]
    state.leadsByIdForNotify.set('referrer_1', lead({ id: 'referrer_1', name: 'Amit', phone: '9000000001', whatsapp_opted_in: true }))

    const result = await syncReferralRewards()

    expect(result.promoted).toBe(1)
    expect(state.updatedRewardIds).toEqual(['reward_1'])
    const call = vi.mocked(enqueueMessage).mock.calls[0][0]
    expect(call.message).toContain('discount pct')
  })

  it('does not re-notify an already-earned reward on a subsequent sync run', async () => {
    state.leads = [
      lead({ id: 'referrer_1', phone: '9000000001' }),
      lead({ id: 'referred_1', referral: '9000000001' }),
    ]
    state.existingRewards = [{ id: 'reward_1', referrer_lead_id: 'referrer_1', referred_lead_id: 'referred_1', status: 'earned', reward_type: null, reward_value: null }]
    state.reservations = [{ customer_id: 'referred_1', status: 'checked_in' }]

    const result = await syncReferralRewards()

    expect(result.created).toBe(0)
    expect(result.promoted).toBe(0)
    expect(enqueueMessage).not.toHaveBeenCalled()
  })
})
