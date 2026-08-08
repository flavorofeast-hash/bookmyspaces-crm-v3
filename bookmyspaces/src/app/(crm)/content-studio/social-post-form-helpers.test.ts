import { describe, it, expect } from 'vitest'
import {
  filterConnectedAccountsForPlatform,
  toAccountIdField,
  resolveAccountIdForEdit,
  type SocialAccountForSelection,
} from './social-post-form-helpers'

// Content Studio — Account Selection fix. These test the pure logic behind
// the New Post form's Account dropdown (platform filtering, the submitted
// account_id field, and the account_id-preserving rule a future edit surface
// would reuse) — see social-post-form-helpers.ts's header comment for why
// this is plain-function testing rather than component rendering (no jsdom/
// React Testing Library configured anywhere in this repo's vitest setup).

function account(overrides: Partial<SocialAccountForSelection> & { id: string }): SocialAccountForSelection {
  return { platform: 'facebook', status: 'connected', is_active: true, ...overrides }
}

describe('filterConnectedAccountsForPlatform', () => {
  it('account dropdown filters by platform: only returns accounts matching the given platform', () => {
    const accounts = [
      account({ id: 'fb-1', platform: 'facebook' }),
      account({ id: 'ig-1', platform: 'instagram' }),
      account({ id: 'li-1', platform: 'linkedin' }),
    ]
    expect(filterConnectedAccountsForPlatform(accounts, 'facebook')).toEqual([accounts[0]])
    expect(filterConnectedAccountsForPlatform(accounts, 'instagram')).toEqual([accounts[1]])
  })

  it('no accounts disables publish: returns an empty list when nothing is connected for the platform', () => {
    const accounts = [account({ id: 'ig-1', platform: 'instagram' })]
    expect(filterConnectedAccountsForPlatform(accounts, 'facebook')).toHaveLength(0)
  })

  it('no accounts disables publish: excludes accounts that are disconnected, unhealthy, or deactivated even if the platform matches', () => {
    const accounts = [
      account({ id: 'fb-1', platform: 'facebook', status: 'token_expired' }),
      account({ id: 'fb-2', platform: 'facebook', status: 'error' }),
      account({ id: 'fb-3', platform: 'facebook', status: 'disconnected' }),
      account({ id: 'fb-4', platform: 'facebook', is_active: false }),
    ]
    expect(filterConnectedAccountsForPlatform(accounts, 'facebook')).toHaveLength(0)
  })

  it('multiple accounts: returns every connected account for the platform, e.g. two Facebook Pages', () => {
    const accounts = [
      account({ id: 'fb-1', platform: 'facebook', is_active: true }),
      account({ id: 'fb-2', platform: 'facebook', is_active: true }),
      account({ id: 'ig-1', platform: 'instagram' }),
    ]
    const result = filterConnectedAccountsForPlatform(accounts, 'facebook')
    expect(result.map((a) => a.id)).toEqual(['fb-1', 'fb-2'])
  })

  it('platform change updates list: calling with a different platform argument against the same accounts array yields a different result', () => {
    const accounts = [
      account({ id: 'fb-1', platform: 'facebook' }),
      account({ id: 'ig-1', platform: 'instagram' }),
      account({ id: 'gb-1', platform: 'google_business' }),
    ]
    const forFacebook = filterConnectedAccountsForPlatform(accounts, 'facebook').map((a) => a.id)
    const forInstagram = filterConnectedAccountsForPlatform(accounts, 'instagram').map((a) => a.id)
    const forGoogleBusiness = filterConnectedAccountsForPlatform(accounts, 'google_business').map((a) => a.id)
    expect(forFacebook).toEqual(['fb-1'])
    expect(forInstagram).toEqual(['ig-1'])
    expect(forGoogleBusiness).toEqual(['gb-1'])
  })
})

describe('toAccountIdField — account_id submitted', () => {
  it('passes the selected account id through unchanged', () => {
    expect(toAccountIdField('acc-123')).toBe('acc-123')
  })

  it('turns an empty selection into null, never an empty string (matches account_id: uuid.nullish())', () => {
    expect(toAccountIdField('')).toBeNull()
  })
})

describe('resolveAccountIdForEdit — edit preserves account_id', () => {
  it('returns the post\'s existing account_id so an edit form preloads the same selection', () => {
    expect(resolveAccountIdForEdit({ account_id: 'acc-456' })).toBe('acc-456')
  })

  it('returns an empty selection (not null/undefined) for a post with no account_id, so the dropdown falls back to its placeholder option', () => {
    expect(resolveAccountIdForEdit({ account_id: null })).toBe('')
    expect(resolveAccountIdForEdit(undefined)).toBe('')
    expect(resolveAccountIdForEdit(null)).toBe('')
  })
})
