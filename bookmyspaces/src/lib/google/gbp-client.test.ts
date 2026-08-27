import { describe, it, expect, vi, afterEach } from 'vitest'
import { discoverAccountsAndLocations } from './gbp-client'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('discoverAccountsAndLocations', () => {
  it('discovers accounts then locations, returning both results and a success diagnostic', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('mybusinessaccountmanagement')) {
        return new Response(JSON.stringify({ accounts: [{ name: 'accounts/1', accountName: 'Flavors of East' }] }), { status: 200 })
      }
      return new Response(JSON.stringify({ locations: [{ name: 'locations/2', title: 'Skyline Serenity' }] }), { status: 200 })
    }))

    const result = await discoverAccountsAndLocations('fake-token')
    expect(result.locations).toEqual([{ externalId: 'accounts/1/locations/2', displayName: 'Skyline Serenity' }])
    expect(result.diagnostic.accountsHttpStatus).toBe(200)
    expect(result.diagnostic.accountCount).toBe(1)
    expect(result.diagnostic.totalLocationCount).toBe(1)
    expect(result.diagnostic.perAccount).toEqual([{ accountName: 'accounts/1', locationsHttpStatus: 200, locationCount: 1, error: null }])
  })

  // Regression guard for the actual production bug this was built to
  // diagnose: accounts.list failing (e.g. Account Management API not
  // enabled) must surface the real Google error, not just an empty array.
  it('surfaces the real Google error when accounts.list fails, instead of a silent empty result', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      error: { code: 403, status: 'PERMISSION_DENIED', message: 'My Business Account Management API has not been used in project bookmyspaces-gbp before or it is disabled.' },
    }), { status: 403 })))

    const result = await discoverAccountsAndLocations('fake-token')
    expect(result.locations).toEqual([])
    expect(result.diagnostic.accountsHttpStatus).toBe(403)
    expect(result.diagnostic.accountsError).toEqual({
      httpStatus: 403, googleErrorStatus: 'PERMISSION_DENIED',
      googleErrorMessage: 'My Business Account Management API has not been used in project bookmyspaces-gbp before or it is disabled.',
    })
  })

  it('distinguishes "zero accounts" (no error) from an API failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ accounts: [] }), { status: 200 })))
    const result = await discoverAccountsAndLocations('fake-token')
    expect(result.locations).toEqual([])
    expect(result.diagnostic.accountsHttpStatus).toBe(200)
    expect(result.diagnostic.accountsError).toBeNull()
    expect(result.diagnostic.accountCount).toBe(0)
  })

  it('records a per-account error when locations.list fails for one account but continues with others', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('mybusinessaccountmanagement')) {
        return new Response(JSON.stringify({ accounts: [{ name: 'accounts/1' }, { name: 'accounts/2' }] }), { status: 200 })
      }
      if (url.includes('accounts/1/locations')) {
        return new Response(JSON.stringify({ error: { code: 400, status: 'INVALID_ARGUMENT', message: 'bad readMask' } }), { status: 400 })
      }
      return new Response(JSON.stringify({ locations: [{ name: 'locations/9', title: 'Monurama Homestay' }] }), { status: 200 })
    }))

    const result = await discoverAccountsAndLocations('fake-token')
    expect(result.locations).toEqual([{ externalId: 'accounts/2/locations/9', displayName: 'Monurama Homestay' }])
    expect(result.diagnostic.perAccount).toEqual([
      { accountName: 'accounts/1', locationsHttpStatus: 400, locationCount: 0, error: { httpStatus: 400, googleErrorStatus: 'INVALID_ARGUMENT', googleErrorMessage: 'bad readMask' } },
      { accountName: 'accounts/2', locationsHttpStatus: 200, locationCount: 1, error: null },
    ])
  })

  it('never throws, and reports the exception in the diagnostic, on a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
    const result = await discoverAccountsAndLocations('fake-token')
    expect(result.locations).toEqual([])
    expect(result.diagnostic.accountsError?.googleErrorMessage).toBe('network down')
  })

  it('never includes the access token anywhere in the returned result', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ accounts: [] }), { status: 200 })))
    const result = await discoverAccountsAndLocations('super-secret-token-value')
    expect(JSON.stringify(result)).not.toContain('super-secret-token-value')
  })
})
