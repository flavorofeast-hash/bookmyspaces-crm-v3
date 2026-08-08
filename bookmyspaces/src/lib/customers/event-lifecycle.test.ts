import { describe, it, expect, vi, beforeEach } from 'vitest'

interface ProposalRow {
  id: string
  lead_id: string | null
  client_name: string | null
  client_phone: string | null
  event_date: string
  event_type: string | null
  venue: string | null
  total_price: number | null
  status: string
  reservation_id: string | null
  leads: { whatsapp_opted_in: boolean | null } | null
}

const state = {
  proposals: [] as ProposalRow[],
  insertedReviewRequestProposalIds: new Set<string>(),
  reviewRequestInsertShouldThrow: false,
  proposalsQueryShouldThrowForDate: null as string | null,
  alreadySentWithinResult: false,
  awardPointsResult: { awarded: true, account: null } as { awarded: boolean; account: null },
  loyaltyAccount: null as { lead_id: string; points_balance: number; tier: string; updated_at: string } | null,
}

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))

vi.mock('@/lib/queue', () => ({ enqueueMessage: vi.fn().mockResolvedValue('queued-id') }))
vi.mock('@/lib/messaging/orchestrator', () => ({ canSendAutomatedMessage: vi.fn().mockResolvedValue(true) }))

vi.mock('@/lib/customers/journey', () => ({
  JOURNEY_ACTIONS: {
    REVIEW_REQUESTED: 'review_requested',
    REVIEW_COMPLETED: 'review_completed',
    REFERRAL_ATTRIBUTED: 'referral_attributed',
    REPEAT_BOOKING: 'repeat_booking_reached',
    VIP_REACHED: 'vip_tier_reached',
    EVENT_THANK_YOU_SENT: 'event_thank_you_sent',
    EVENT_REFERRAL_INVITED: 'event_referral_invited',
    EVENT_LOYALTY_AWARDED: 'event_loyalty_awarded',
  },
  logJourneyEvent: vi.fn().mockResolvedValue(undefined),
  alreadySentWithin: vi.fn(() => Promise.resolve(state.alreadySentWithinResult)),
}))

vi.mock('@/lib/customers/loyalty', () => ({
  POINTS_PER_RUPEE_SPENT: 1 / 100,
  awardPoints: vi.fn(() => Promise.resolve(state.awardPointsResult)),
  getLoyaltyAccount: vi.fn(() => Promise.resolve(state.loyaltyAccount)),
}))

vi.mock('@/lib/customers/referrals', () => ({
  buildReferralInvitationMessage: vi.fn((lead: { id: string; name?: string | null }) =>
    Promise.resolve({ message: `Referral invite for ${lead.name ?? 'guest'}`, referralCode: 'ABC123', referralLink: 'https://www.bookmyspaces.in/refer?ref=ABC123' })
  ),
}))

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table === 'proposals') {
        let filtered = [...state.proposals]
        const builder: Record<string, unknown> = {}
        builder.select = () => builder
        builder.eq = (col: string, val: unknown) => {
          if (col === 'event_date' && state.proposalsQueryShouldThrowForDate === val) {
            throw new Error('simulated proposals query outage')
          }
          filtered = filtered.filter((r) => (r as unknown as Record<string, unknown>)[col] === val)
          return builder
        }
        builder.is = (col: string, val: unknown) => {
          filtered = filtered.filter((r) => (val === null ? (r as unknown as Record<string, unknown>)[col] == null : (r as unknown as Record<string, unknown>)[col] === val))
          return builder
        }
        builder.not = (col: string, op: string, val: unknown) => {
          if (op === 'is' && val === null) filtered = filtered.filter((r) => (r as unknown as Record<string, unknown>)[col] != null)
          return builder
        }
        builder.limit = (_n: number) => Promise.resolve({ data: filtered, error: null })
        return builder
      }
      if (table === 'review_requests') {
        return {
          insert: (row: { proposal_id: string }) => {
            if (state.reviewRequestInsertShouldThrow) throw new Error('simulated insert outage')
            if (state.insertedReviewRequestProposalIds.has(row.proposal_id)) {
              return Promise.resolve({ error: { code: '23505', message: 'duplicate key' } })
            }
            state.insertedReviewRequestProposalIds.add(row.proposal_id)
            return Promise.resolve({ error: null })
          },
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }),
}))

import { processEventPostExperienceLifecycle, isoDateDaysFromNow, EVENT_LIFECYCLE_CONFIG } from './event-lifecycle'
import { logJourneyEvent, alreadySentWithin } from '@/lib/customers/journey'
import { awardPoints } from '@/lib/customers/loyalty'
import { buildReferralInvitationMessage } from '@/lib/customers/referrals'
import { enqueueMessage } from '@/lib/queue'

function proposal(overrides: Partial<ProposalRow> & { id: string; event_date: string }): ProposalRow {
  return {
    lead_id: 'lead_1',
    client_name: 'Priya Sharma',
    client_phone: '9876543210',
    event_type: 'Wedding',
    venue: 'Skyline Rooftop',
    total_price: 100_000,
    status: 'accepted',
    reservation_id: null,
    leads: { whatsapp_opted_in: true },
    ...overrides,
  }
}

const THANK_YOU_DATE = isoDateDaysFromNow(-EVENT_LIFECYCLE_CONFIG.thankYouDelayDays)
const REVIEW_REQUEST_DATE = isoDateDaysFromNow(-EVENT_LIFECYCLE_CONFIG.reviewRequestDelayDays)
const REFERRAL_INVITE_DATE = isoDateDaysFromNow(-EVENT_LIFECYCLE_CONFIG.referralInviteDelayDays)

beforeEach(() => {
  state.proposals = []
  state.insertedReviewRequestProposalIds = new Set()
  state.reviewRequestInsertShouldThrow = false
  state.proposalsQueryShouldThrowForDate = null
  state.alreadySentWithinResult = false
  state.awardPointsResult = { awarded: true, account: null }
  state.loyaltyAccount = null
  vi.clearAllMocks()
})

describe('processEventPostExperienceLifecycle — configurable delays', () => {
  it('exposes env-overridable delay defaults', () => {
    expect(EVENT_LIFECYCLE_CONFIG.thankYouDelayDays).toBe(1)
    expect(EVENT_LIFECYCLE_CONFIG.reviewRequestDelayDays).toBe(3)
    expect(EVENT_LIFECYCLE_CONFIG.referralInviteDelayDays).toBe(10)
    expect(EVENT_LIFECYCLE_CONFIG.referralCooldownDays).toBe(120)
  })
})

describe('processEventPostExperienceLifecycle — thank you + loyalty', () => {
  it('sends a thank-you and awards loyalty points for an event completed yesterday (default delay)', async () => {
    state.proposals = [proposal({ id: 'p1', event_date: THANK_YOU_DATE, total_price: 100_000 })]

    const result = await processEventPostExperienceLifecycle()

    expect(result.eventThankYou).toBe(1)
    expect(enqueueMessage).toHaveBeenCalledWith(expect.objectContaining({
      phone: '9876543210',
      metadata: expect.objectContaining({ journey: 'event_thank_you', lead_id: 'lead_1', proposalId: 'p1' }),
    }))
    expect(result.eventLoyaltyAwarded).toBe(1)
    expect(awardPoints).toHaveBeenCalledWith(expect.objectContaining({
      leadId: 'lead_1',
      points: 1000, // ₹100,000 * 1/100
      referenceType: 'proposal',
      referenceId: 'p1',
    }))
    expect(logJourneyEvent).toHaveBeenCalledWith('lead_1', 'event_thank_you_sent', expect.any(String), expect.objectContaining({ proposalId: 'p1' }))
    expect(logJourneyEvent).toHaveBeenCalledWith('lead_1', 'event_loyalty_awarded', expect.any(String), expect.objectContaining({ proposalId: 'p1', points: 1000 }))
  })

  it('does not message a guest who opted out of WhatsApp', async () => {
    state.proposals = [proposal({ id: 'p2', event_date: THANK_YOU_DATE, leads: { whatsapp_opted_in: false } })]

    const result = await processEventPostExperienceLifecycle()

    expect(result.eventThankYou).toBe(0)
    expect(enqueueMessage).not.toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ journey: 'event_thank_you' }) }))
  })

  it('handles a Supabase embed returned as an array (to-one relation edge case), same as the reservation branch\'s properties(name) handling', async () => {
    state.proposals = [proposal({ id: 'p9', event_date: THANK_YOU_DATE, leads: [{ whatsapp_opted_in: true }] as unknown as { whatsapp_opted_in: boolean } })]

    const result = await processEventPostExperienceLifecycle()

    expect(result.eventThankYou).toBe(1)
  })

  it('does not message a guest with no lead attached (cannot verify opt-out)', async () => {
    state.proposals = [proposal({ id: 'p3', event_date: THANK_YOU_DATE, leads: null })]

    const result = await processEventPostExperienceLifecycle()

    expect(result.eventThankYou).toBe(0)
  })

  it('skips a proposal with no phone number', async () => {
    state.proposals = [proposal({ id: 'p4', event_date: THANK_YOU_DATE, client_phone: null })]

    const result = await processEventPostExperienceLifecycle()

    expect(result.eventThankYou).toBe(0)
  })

  it('does not award loyalty points for a zero/negative-revenue event', async () => {
    state.proposals = [proposal({ id: 'p5', event_date: THANK_YOU_DATE, total_price: 0 })]

    const result = await processEventPostExperienceLifecycle()

    expect(result.eventLoyaltyAwarded).toBe(0)
    expect(awardPoints).not.toHaveBeenCalled()
  })

  it('does not log a loyalty journey event when awardPoints reports a duplicate no-op', async () => {
    state.awardPointsResult = { awarded: false, account: null }
    state.proposals = [proposal({ id: 'p6', event_date: THANK_YOU_DATE })]

    const result = await processEventPostExperienceLifecycle()

    expect(result.eventLoyaltyAwarded).toBe(0)
    expect(logJourneyEvent).not.toHaveBeenCalledWith('lead_1', 'event_loyalty_awarded', expect.any(String), expect.anything())
  })

  it('ignores an accepted proposal that was already converted into a room reservation', async () => {
    state.proposals = [proposal({ id: 'p7', event_date: THANK_YOU_DATE, reservation_id: 'res_1' })]

    const result = await processEventPostExperienceLifecycle()

    expect(result.eventThankYou).toBe(0)
    expect(result.eventLoyaltyAwarded).toBe(0)
  })

  it('ignores a proposal that is not yet accepted', async () => {
    state.proposals = [proposal({ id: 'p8', event_date: THANK_YOU_DATE, status: 'sent' })]

    const result = await processEventPostExperienceLifecycle()

    expect(result.eventThankYou).toBe(0)
  })
})

describe('processEventPostExperienceLifecycle — review request', () => {
  it('sends a review request and persists a review_requests row keyed on proposal_id', async () => {
    state.proposals = [proposal({ id: 'p10', event_date: REVIEW_REQUEST_DATE })]

    const result = await processEventPostExperienceLifecycle()

    expect(result.eventReviewRequests).toBe(1)
    expect(state.insertedReviewRequestProposalIds.has('p10')).toBe(true)
    expect(logJourneyEvent).toHaveBeenCalledWith('lead_1', 'review_requested', expect.any(String), expect.objectContaining({ proposalId: 'p10' }))
  })

  it('is idempotent — a duplicate review_requests insert (23505) still counts the request but does not error', async () => {
    state.proposals = [proposal({ id: 'p11', event_date: REVIEW_REQUEST_DATE })]
    state.insertedReviewRequestProposalIds.add('p11') // simulate an already-existing row from a prior run

    const result = await processEventPostExperienceLifecycle()

    expect(result.eventReviewRequests).toBe(1)
  })

  it('does not request a review from an opted-out guest', async () => {
    state.proposals = [proposal({ id: 'p12', event_date: REVIEW_REQUEST_DATE, leads: { whatsapp_opted_in: false } })]

    const result = await processEventPostExperienceLifecycle()

    expect(result.eventReviewRequests).toBe(0)
  })

  it('still counts the request when the review_requests insert throws unexpectedly (best-effort, never blocks the send)', async () => {
    state.reviewRequestInsertShouldThrow = true
    state.proposals = [proposal({ id: 'p13', event_date: REVIEW_REQUEST_DATE })]

    const result = await processEventPostExperienceLifecycle()

    expect(result.eventReviewRequests).toBe(1)
  })
})

describe('processEventPostExperienceLifecycle — referral invitation', () => {
  it('sends a referral invitation and logs it under the shared cooldown action name', async () => {
    state.proposals = [proposal({ id: 'p20', event_date: REFERRAL_INVITE_DATE })]

    const result = await processEventPostExperienceLifecycle()

    expect(result.eventReferralInvitations).toBe(1)
    expect(buildReferralInvitationMessage).toHaveBeenCalledWith({ id: 'lead_1', name: 'Priya Sharma' })
    expect(logJourneyEvent).toHaveBeenCalledWith('lead_1', 'event_referral_invited', expect.any(String), expect.objectContaining({ proposalId: 'p20', referralCode: 'ABC123' }))
    expect(logJourneyEvent).toHaveBeenCalledWith('lead_1', 'whatsapp_referral_request_sent', expect.any(String), expect.objectContaining({ proposalId: 'p20' }))
  })

  it('does not double-invite a lead already asked within the cooldown window (shared with the repeat-customer segment automation)', async () => {
    state.alreadySentWithinResult = true
    state.proposals = [proposal({ id: 'p21', event_date: REFERRAL_INVITE_DATE })]

    const result = await processEventPostExperienceLifecycle()

    expect(result.eventReferralInvitations).toBe(0)
    expect(buildReferralInvitationMessage).not.toHaveBeenCalled()
  })

  it('checks the cooldown using the shared 120-day default', async () => {
    state.proposals = [proposal({ id: 'p22', event_date: REFERRAL_INVITE_DATE })]

    await processEventPostExperienceLifecycle()

    expect(alreadySentWithin).toHaveBeenCalledWith('lead_1', 'whatsapp_referral_request_sent', 120)
  })

  it('does not invite an opted-out guest', async () => {
    state.proposals = [proposal({ id: 'p23', event_date: REFERRAL_INVITE_DATE, leads: { whatsapp_opted_in: false } })]

    const result = await processEventPostExperienceLifecycle()

    expect(result.eventReferralInvitations).toBe(0)
  })
})

describe('processEventPostExperienceLifecycle — stage isolation', () => {
  it('a failure in one stage does not block the other two', async () => {
    state.proposalsQueryShouldThrowForDate = REVIEW_REQUEST_DATE
    state.proposals = [
      proposal({ id: 'p30', event_date: THANK_YOU_DATE }),
      proposal({ id: 'p31', lead_id: 'lead_2', client_name: 'Rahul Das', client_phone: '9123456780', event_date: REFERRAL_INVITE_DATE }),
    ]

    const result = await processEventPostExperienceLifecycle()

    expect(result.eventThankYou).toBe(1)
    expect(result.eventReferralInvitations).toBe(1)
    expect(result.eventReviewRequests).toBe(0) // the stage that hit the simulated outage
  })

  it('processes multiple independent events in the same run without cross-contamination', async () => {
    state.proposals = [
      proposal({ id: 'p40', lead_id: 'lead_a', client_phone: '9000000001', event_date: THANK_YOU_DATE }),
      proposal({ id: 'p41', lead_id: 'lead_b', client_phone: '9000000002', event_date: REVIEW_REQUEST_DATE }),
      proposal({ id: 'p42', lead_id: 'lead_c', client_phone: '9000000003', event_date: REFERRAL_INVITE_DATE }),
    ]

    const result = await processEventPostExperienceLifecycle()

    expect(result.eventThankYou).toBe(1)
    expect(result.eventReviewRequests).toBe(1)
    expect(result.eventReferralInvitations).toBe(1)
  })
})
