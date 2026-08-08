import { describe, it, expect, vi, beforeEach } from 'vitest'

// Focused test for buildReferralInvitationMessage() — the helper extracted
// from marketing-automations/route.ts's runReferralRequest() so the new
// Event Post-Experience Lifecycle (event-lifecycle.ts) can send an
// identical referral invitation without a second implementation. Full
// coverage of getOrCreateReferralCode()'s collision-retry behavior is out
// of scope here (pre-existing, untested code this change does not modify);
// this only verifies the new composition wires the three pieces together
// correctly.

const state = {
  existingCode: null as string | null,
}

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table !== 'referral_codes') throw new Error(`unexpected table ${table}`)
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: state.existingCode ? { code: state.existingCode } : null, error: null }),
          }),
        }),
        insert: (row: { code: string }) => ({
          select: () => ({
            single: () => Promise.resolve({ data: { code: row.code }, error: null }),
          }),
        }),
      }
    },
  }),
}))

import { buildReferralInvitationMessage, buildReferralLink } from './referrals'

beforeEach(() => {
  state.existingCode = null
  vi.clearAllMocks()
  delete process.env.NEXT_PUBLIC_APP_URL
})

describe('buildReferralInvitationMessage', () => {
  it('reuses an existing referral code rather than generating a new one', async () => {
    state.existingCode = 'EXISTNG'
    const result = await buildReferralInvitationMessage({ id: 'lead_1', name: 'Priya' })

    expect(result.referralCode).toBe('EXISTNG')
    expect(result.referralLink).toBe(buildReferralLink('EXISTNG'))
    expect(result.message).toContain('EXISTNG')
    expect(result.message).toContain('Priya')
  })

  it('generates a new code on first request and includes it in both the link and the message', async () => {
    const result = await buildReferralInvitationMessage({ id: 'lead_2', name: null })

    expect(result.referralCode).toHaveLength(6)
    expect(result.referralLink).toContain(result.referralCode)
    expect(result.message).toContain(result.referralLink)
  })
})
