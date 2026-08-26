// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/social/social-account-routing.test.ts
// The multi-account routing gate: findConnectedSocialAccount() (is this
// account even connected/active?) and ensureSocialAccountChannel()
// (one channels row per connected account, not one shared row per platform).
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = {
  socialAccountRow: null as { id: string; display_name: string; external_account_id: string } | null,
  socialAccountError: null as { message: string } | null,
  existingChannel: null as { id: string } | null,
  insertedChannel: { id: 'new-chan-1' } as { id: string } | null,
  insertError: null as { message: string } | null,
  lastChannelInsert: null as unknown,
}

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table === 'social_accounts') {
        const chain = {
          eq: () => chain,
          maybeSingle: () => Promise.resolve({ data: state.socialAccountRow, error: state.socialAccountError }),
        }
        return { select: () => chain }
      }
      if (table === 'channels') {
        return {
          select: () => ({
            eq: () => ({
              contains: () => ({
                limit: () => ({
                  maybeSingle: () => Promise.resolve({ data: state.existingChannel }),
                }),
              }),
            }),
          }),
          insert: (v: unknown) => {
            state.lastChannelInsert = v
            return { select: () => ({ single: () => Promise.resolve({ data: state.insertedChannel, error: state.insertError }) }) }
          },
        }
      }
      throw new Error(`unexpected table: ${table}`)
    },
  }),
}))

import { findConnectedSocialAccount, ensureSocialAccountChannel, resolveConnectedAccount } from './social-account-routing'

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  state.socialAccountRow = null
  state.socialAccountError = null
  state.existingChannel = null
  state.insertedChannel = { id: 'new-chan-1' }
  state.insertError = null
  state.lastChannelInsert = null
  process.env = { ...ORIGINAL_ENV }
})

describe('findConnectedSocialAccount', () => {
  it('returns the connected account when a matching active row exists', async () => {
    state.socialAccountRow = { id: 'acct-1', display_name: 'skyline.monurama', external_account_id: '17841478674706194' }
    const result = await findConnectedSocialAccount('instagram', '17841478674706194')
    expect(result).toEqual({ id: 'acct-1', displayName: 'skyline.monurama', externalAccountId: '17841478674706194' })
  })

  it('returns null when no row matches (unknown/unconnected account)', async () => {
    state.socialAccountRow = null
    const result = await findConnectedSocialAccount('instagram', 'some-other-id')
    expect(result).toBeNull()
  })

  it('returns null (fails closed) on a query error rather than throwing', async () => {
    state.socialAccountError = { message: 'connection refused' }
    const result = await findConnectedSocialAccount('instagram', '17841478674706194')
    expect(result).toBeNull()
  })
})

describe('ensureSocialAccountChannel', () => {
  const account = { id: 'acct-1', displayName: 'skyline.monurama', externalAccountId: '17841478674706194' }

  it('reuses an existing channel row scoped to this account instead of creating a duplicate', async () => {
    state.existingChannel = { id: 'existing-chan-1' }
    const channelId = await ensureSocialAccountChannel('instagram', account)
    expect(channelId).toBe('existing-chan-1')
    expect(state.lastChannelInsert).toBeNull() // no insert attempted
  })

  it('creates a new channel row keyed to this account when none exists yet', async () => {
    state.existingChannel = null
    const channelId = await ensureSocialAccountChannel('instagram', account)
    expect(channelId).toBe('new-chan-1')
    expect(state.lastChannelInsert).toMatchObject({
      channel_type: 'instagram',
      display_name: 'skyline.monurama',
      is_active: true,
      config: { external_account_id: '17841478674706194', social_account_id: 'acct-1' },
    })
  })

  it('throws when the insert fails, so a caller cannot silently proceed with an undefined channel', async () => {
    state.existingChannel = null
    state.insertedChannel = null
    state.insertError = { message: 'unique_violation' }
    await expect(ensureSocialAccountChannel('instagram', account)).rejects.toThrow('unique_violation')
  })
})

// Facebook Messenger pass — this pass deliberately uses the single-Page,
// global-env-var credential model (no Facebook Page OAuth), so the
// "do we recognize this account" gate is env-based instead of DB-based.
describe('resolveConnectedAccount', () => {
  it('instagram: delegates to findConnectedSocialAccount (DB-backed)', async () => {
    state.socialAccountRow = { id: 'acct-1', display_name: 'skyline.monurama', external_account_id: '17841478674706194' }
    const result = await resolveConnectedAccount('instagram', '17841478674706194')
    expect(result).toEqual({ id: 'acct-1', displayName: 'skyline.monurama', externalAccountId: '17841478674706194' })
  })

  it('facebook: returns a synthetic account when the recipient id matches META_PAGE_ID', async () => {
    process.env.META_PAGE_ID = 'page-123'
    const result = await resolveConnectedAccount('facebook', 'page-123')
    expect(result).toEqual({ id: 'env:facebook-page', displayName: 'Facebook Page', externalAccountId: 'page-123' })
  })

  it('facebook: returns null when the recipient id does not match META_PAGE_ID', async () => {
    process.env.META_PAGE_ID = 'page-123'
    const result = await resolveConnectedAccount('facebook', 'some-other-page-id')
    expect(result).toBeNull()
  })

  it('facebook: returns null when META_PAGE_ID is not configured', async () => {
    delete process.env.META_PAGE_ID
    const result = await resolveConnectedAccount('facebook', 'page-123')
    expect(result).toBeNull()
  })
})
