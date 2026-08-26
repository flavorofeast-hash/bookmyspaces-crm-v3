import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = {
  authOk: true,
  tokenResult: { ok: true, accessToken: 'fresh-token' } as { ok: true; accessToken: string } | { ok: false; error: string },
  discovered: [{ externalId: 'accounts/1/locations/2', displayName: 'Skyline Serenity' }],
  existingSettingsRow: { value: { connected_at: '2026-08-21T00:00:00Z' } } as { value: Record<string, unknown> } | null,
  saveError: null as { message: string } | null,
  lastUpdate: null as unknown,
}

vi.mock('@/lib/auth-guard', () => ({
  requireRole: () => Promise.resolve(state.authOk ? { ok: true, user: { id: 'u1' } } : { ok: false, response: new Response('no', { status: 401 }) }),
}))

vi.mock('@/lib/google/gbp-token', () => ({
  getValidGbpAccessToken: () => Promise.resolve(state.tokenResult),
}))

vi.mock('@/lib/google/gbp-client', () => ({
  discoverAccountsAndLocations: () => Promise.resolve(state.discovered),
}))

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table !== 'settings') throw new Error(`unexpected table: ${table}`)
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: state.existingSettingsRow }),
            }),
          }),
        }),
        update: (v: unknown) => ({
          eq: () => ({
            eq: () => {
              state.lastUpdate = v
              return Promise.resolve({ error: state.saveError })
            },
          }),
        }),
      }
    },
  }),
}))

import { GET } from './route'

function makeRequest(bearer?: string) {
  return new NextRequestLike('https://crm.bookmyspaces.in/api/google/gbp/sync-locations', bearer)
}
class NextRequestLike {
  headers: Headers
  constructor(_url: string, bearer?: string) {
    this.headers = new Headers(bearer ? { authorization: `Bearer ${bearer}` } : {})
  }
}

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  state.authOk = true
  state.tokenResult = { ok: true, accessToken: 'fresh-token' }
  state.discovered = [{ externalId: 'accounts/1/locations/2', displayName: 'Skyline Serenity' }]
  state.existingSettingsRow = { value: { connected_at: '2026-08-21T00:00:00Z' } }
  state.saveError = null
  state.lastUpdate = null
  process.env = { ...ORIGINAL_ENV, CRON_SECRET: 'test-cron-secret' }
})

describe('GET /api/google/gbp/sync-locations', () => {
  it('allows an authenticated staff session and returns the resynced locations', async () => {
    const res = await GET(makeRequest() as unknown as Parameters<typeof GET>[0])
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.locationCount).toBe(1)
    expect(state.lastUpdate).toMatchObject({ value: { connected_at: '2026-08-21T00:00:00Z', locations: state.discovered } })
  })

  it('allows a CRON_SECRET bearer token without a staff session (for a future scheduled job)', async () => {
    state.authOk = false
    const res = await GET(makeRequest('test-cron-secret') as unknown as Parameters<typeof GET>[0])
    expect(res.status).toBe(200)
  })

  it('rejects when neither a staff session nor a valid CRON_SECRET is present', async () => {
    state.authOk = false
    const res = await GET(makeRequest('wrong-secret') as unknown as Parameters<typeof GET>[0])
    expect(res.status).toBe(401)
  })

  it('returns 404 when GBP is not connected', async () => {
    state.tokenResult = { ok: false, error: 'not_connected' }
    const res = await GET(makeRequest() as unknown as Parameters<typeof GET>[0])
    expect(res.status).toBe(404)
  })

  it('returns 502 when the token could not be refreshed', async () => {
    state.tokenResult = { ok: false, error: 'refresh_failed' }
    const res = await GET(makeRequest() as unknown as Parameters<typeof GET>[0])
    expect(res.status).toBe(502)
  })
})
