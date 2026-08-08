import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchConnectedIdentity } from './oauth-service'

// Social OAuth -> Publishing credential fix, Google Business follow-up —
// fetchConnectedIdentity('google_business', ...) now discovers the
// connected Business Account's Location(s) (a second call, at OAuth-connect
// time only) so the resolved Location id can be persisted into
// social_accounts.external_account_id instead of depending on the static
// GOOGLE_BUSINESS_LOCATION_ID env var. These tests cover that discovery
// logic in isolation via a mocked global fetch.

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 400, json: async () => body } as Response
}

describe('fetchConnectedIdentity — google_business location discovery', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('single location: resolves the location resource as externalAccountId, with no additionalIdentities', async () => {
    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ accounts: [{ name: 'accounts/111', accountName: 'BookMySpaces' }] }))
      .mockResolvedValueOnce(jsonResponse({ locations: [{ name: 'locations/222', title: 'Skyline Rooftop' }] }))

    const res = await fetchConnectedIdentity('google_business', 'tok')

    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.value.externalAccountId).toBe('accounts/111/locations/222')
      expect(res.value.displayName).toBe('Skyline Rooftop')
      expect(res.value.additionalIdentities).toBeUndefined()
    }
  })

  it('multiple locations: returns the first as the primary identity and the rest under additionalIdentities', async () => {
    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ accounts: [{ name: 'accounts/111', accountName: 'BookMySpaces' }] }))
      .mockResolvedValueOnce(jsonResponse({
        locations: [
          { name: 'locations/222', title: 'Skyline Rooftop' },
          { name: 'locations/333', title: 'Monurama Banquet' },
          { name: 'locations/444' }, // no title — falls back to accountName
        ],
      }))

    const res = await fetchConnectedIdentity('google_business', 'tok')

    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.value.externalAccountId).toBe('accounts/111/locations/222')
      expect(res.value.additionalIdentities).toHaveLength(2)
      expect(res.value.additionalIdentities?.[0]).toEqual({ externalAccountId: 'accounts/111/locations/333', displayName: 'Monurama Banquet' })
      expect(res.value.additionalIdentities?.[1]).toEqual({ externalAccountId: 'accounts/111/locations/444', displayName: 'BookMySpaces' })
    }
  })

  it('no locations: fails cleanly instead of connecting an unusable account', async () => {
    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ accounts: [{ name: 'accounts/111', accountName: 'BookMySpaces' }] }))
      .mockResolvedValueOnce(jsonResponse({ locations: [] }))

    const res = await fetchConnectedIdentity('google_business', 'tok')

    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toBe('no_google_business_location_found_for_this_account')
  })

  it('no business account at all: fails before even attempting location discovery', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce(jsonResponse({ accounts: [] }))

    const res = await fetchConnectedIdentity('google_business', 'tok')

    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toBe('no_google_business_account_found')
    expect(fetchSpy).toHaveBeenCalledTimes(1) // never made the second (locations) call
  })

  it('invalid OAuth response: a malformed/error locations payload fails cleanly rather than throwing', async () => {
    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ accounts: [{ name: 'accounts/111', accountName: 'BookMySpaces' }] }))
      .mockResolvedValueOnce(jsonResponse({ error: { code: 403, message: 'permission denied' } }, false))

    const res = await fetchConnectedIdentity('google_business', 'tok')

    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toBe('no_google_business_location_found_for_this_account')
  })

  it('invalid OAuth response: a network failure during discovery resolves ok:false instead of throwing', async () => {
    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ accounts: [{ name: 'accounts/111', accountName: 'BookMySpaces' }] }))
      .mockRejectedValueOnce(new Error('network error'))

    const res = await fetchConnectedIdentity('google_business', 'tok')

    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toBe('network error')
  })

  it('calls the locations endpoint scoped to the discovered account, with a readMask', async () => {
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ accounts: [{ name: 'accounts/999', accountName: 'X' }] }))
      .mockResolvedValueOnce(jsonResponse({ locations: [{ name: 'locations/1', title: 'A' }] }))

    await fetchConnectedIdentity('google_business', 'tok')

    const secondCallUrl = String(fetchSpy.mock.calls[1][0])
    expect(secondCallUrl).toContain('accounts/999/locations')
    expect(secondCallUrl).toContain('readMask=')
  })
})
