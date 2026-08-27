import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Regression coverage for the fix that made discovery strictly user-initiated:
// this route must NEVER call Google's Business Profile discovery APIs
// (accounts.list / locations.list) -- only the OAuth token endpoint. The
// fetch mock below throws on any URL other than the token endpoint, so a
// regression that re-adds an automatic discovery call fails loudly here
// instead of silently burning Google's easily-exhausted quota again.

const state = {
  authOk: true,
  existingRow: null as { value: Record<string, unknown> } | null,
  upserts: [] as unknown[],
  saveError: null as { message: string } | null,
}

vi.mock('@/lib/auth-guard', () => ({
  requireRole: () =>
    Promise.resolve(
      state.authOk
        ? { ok: true, user: { id: 'u1', email: 'staff@bookmyspaces.in' } }
        : { ok: false, response: new Response('no', { status: 401 }) }
    ),
}))

vi.mock('@/lib/google/gbp-oauth-state', () => ({
  decodeGbpOAuthState: (raw: string) => (raw === 'valid-state' ? { userId: 'u1' } : null),
}))

vi.mock('@/lib/google/gbp-crypto', () => ({
  encryptGbpToken: (plain: string) => `enc:${plain}`,
}))

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table !== 'settings') throw new Error(`unexpected table: ${table}`)
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: state.existingRow }),
            }),
          }),
        }),
        upsert: (v: unknown) => {
          state.upserts.push(v)
          return Promise.resolve({ error: state.saveError })
        },
      }
    },
  }),
}))

import { GET } from './route'

function makeRequest(query: string) {
  return { url: `https://crm.bookmyspaces.in/api/google/gbp/callback?${query}` } as unknown as Parameters<typeof GET>[0]
}

const ORIGINAL_FETCH = global.fetch

beforeEach(() => {
  state.authOk = true
  state.existingRow = null
  state.upserts = []
  state.saveError = null
  process.env.GOOGLE_GBP_CLIENT_ID = 'client-id'
  process.env.GOOGLE_GBP_CLIENT_SECRET = 'client-secret'
  process.env.GOOGLE_GBP_REDIRECT_URI = 'https://crm.bookmyspaces.in/api/google/gbp/callback'

  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('mybusinessaccountmanagement') || url.includes('mybusinessbusinessinformation')) {
      throw new Error(`REGRESSION: callback route must never call Google discovery APIs, but called ${url}`)
    }
    if (url === 'https://oauth2.googleapis.com/token') {
      return new Response(
        JSON.stringify({
          access_token: 'access-token-value',
          refresh_token: 'refresh-token-value',
          expires_in: 3600,
          scope: 'https://www.googleapis.com/auth/business.manage',
          token_type: 'Bearer',
        }),
        { status: 200 }
      )
    }
    throw new Error(`unexpected fetch to ${url}`)
  }) as unknown as typeof fetch
})

afterEach(() => {
  global.fetch = ORIGINAL_FETCH
})

describe('GET /api/google/gbp/callback', () => {
  it('exchanges the code for tokens and stores them WITHOUT calling any Google discovery API', async () => {
    const res = await GET(makeRequest('code=auth-code&state=valid-state'))
    expect(res.status).toBe(307) // redirect
    expect(res.headers.get('location')).toContain('gbp_connected=1')

    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect(String((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0])).toBe('https://oauth2.googleapis.com/token')

    expect(state.upserts).toHaveLength(1)
    const saved = (state.upserts[0] as { value: Record<string, unknown> }).value
    expect(saved.access_token_enc).toBe('enc:access-token-value')
    // No locations/discovery_diagnostic key is written by this route at all.
    expect(saved).not.toHaveProperty('locations')
    expect(saved).not.toHaveProperty('discovery_diagnostic')
  })

  it('preserves locations and discovery_diagnostic from a prior sync across a reconnect', async () => {
    state.existingRow = {
      value: {
        connected_at: '2026-08-20T00:00:00Z',
        locations: [{ externalId: 'accounts/1/locations/2', displayName: 'Skyline Serenity' }],
        discovery_diagnostic: { accountsHttpStatus: 200, accountsError: null, accountCount: 1, perAccount: [], totalLocationCount: 1, attemptedAt: '2026-08-20T00:00:00Z' },
        last_discovery_attempt_at: '2026-08-20T00:00:00Z',
        consecutive_quota_errors: 0,
      },
    }
    const res = await GET(makeRequest('code=auth-code&state=valid-state'))
    expect(res.status).toBe(307)
    expect(global.fetch).toHaveBeenCalledTimes(1) // still only the token exchange

    const saved = (state.upserts[0] as { value: Record<string, unknown> }).value
    expect(saved.locations).toEqual([{ externalId: 'accounts/1/locations/2', displayName: 'Skyline Serenity' }])
    expect(saved.consecutive_quota_errors).toBe(0)
    expect(saved.access_token_enc).toBe('enc:access-token-value') // token itself is still refreshed
  })

  it('rejects an invalid/forged state without ever calling Google', async () => {
    const res = await GET(makeRequest('code=auth-code&state=forged-state'))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('gbp_error=invalid_state')
    expect(global.fetch).not.toHaveBeenCalled()
  })
})
