import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const state = {
  settingsRow: null as { value: Record<string, unknown> } | null,
  settingsError: null as { message: string } | null,
  updates: [] as unknown[],
}

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table !== 'settings') throw new Error(`unexpected table: ${table}`)
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: state.settingsRow, error: state.settingsError }),
            }),
          }),
        }),
        update: (v: unknown) => ({
          eq: () => ({
            eq: () => {
              state.updates.push(v)
              return Promise.resolve({ error: null })
            },
          }),
        }),
      }
    },
  }),
}))

vi.mock('@/lib/google/gbp-crypto', () => ({
  encryptGbpToken: (plaintext: string) => `enc:${plaintext}`,
  decryptGbpToken: (stored: string) => {
    if (stored === 'throw') throw new Error('malformed_encrypted_gbp_token')
    return stored.replace(/^enc:/, '')
  },
}))

import { getValidGbpAccessToken } from './gbp-token'

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  state.settingsRow = null
  state.settingsError = null
  state.updates = []
  process.env = { ...ORIGINAL_ENV, GOOGLE_GBP_CLIENT_ID: 'client-id', GOOGLE_GBP_CLIENT_SECRET: 'client-secret' }
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
  vi.unstubAllGlobals()
})

describe('getValidGbpAccessToken', () => {
  it('returns not_connected when no settings row exists', async () => {
    state.settingsRow = null
    const result = await getValidGbpAccessToken()
    expect(result).toEqual({ ok: false, error: 'not_connected' })
  })

  it('returns the stored access token directly when it is still valid (no refresh call made)', async () => {
    vi.stubGlobal('fetch', vi.fn())
    state.settingsRow = {
      value: {
        access_token_enc: 'enc:still-valid-token',
        refresh_token_enc: 'enc:refresh-1',
        expires_at: new Date(Date.now() + 60 * 60_000).toISOString(),
      },
    }
    const result = await getValidGbpAccessToken()
    expect(result).toEqual({ ok: true, accessToken: 'still-valid-token' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('refreshes when the stored token is expired, and persists the new one', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      access_token: 'fresh-access-token', expires_in: 3600, scope: 'business.manage', token_type: 'Bearer',
    }), { status: 200 })))
    state.settingsRow = {
      value: {
        access_token_enc: 'enc:expired-token',
        refresh_token_enc: 'enc:refresh-1',
        expires_at: new Date(Date.now() - 60_000).toISOString(),
      },
    }
    const result = await getValidGbpAccessToken()
    expect(result).toEqual({ ok: true, accessToken: 'fresh-access-token' })
    expect(state.updates).toHaveLength(1)
    expect((state.updates[0] as { value: Record<string, unknown> }).value.access_token_enc).toBe('enc:fresh-access-token')
  })

  it('refreshes when the token is within the expiry safety margin, not just fully expired', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      access_token: 'fresh-access-token', expires_in: 3600, scope: 'business.manage', token_type: 'Bearer',
    }), { status: 200 })))
    state.settingsRow = {
      value: {
        access_token_enc: 'enc:soon-to-expire-token',
        refresh_token_enc: 'enc:refresh-1',
        expires_at: new Date(Date.now() + 30_000).toISOString(), // within the 2-minute safety margin
      },
    }
    const result = await getValidGbpAccessToken()
    expect(result.ok).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('returns no_refresh_token when the access token is expired and there is no refresh token stored', async () => {
    state.settingsRow = {
      value: {
        access_token_enc: 'enc:expired-token',
        refresh_token_enc: null,
        expires_at: new Date(Date.now() - 60_000).toISOString(),
      },
    }
    const result = await getValidGbpAccessToken()
    expect(result).toEqual({ ok: false, error: 'no_refresh_token' })
  })

  it('returns not_configured when GOOGLE_GBP_CLIENT_ID/SECRET are missing', async () => {
    delete process.env.GOOGLE_GBP_CLIENT_ID
    state.settingsRow = {
      value: {
        access_token_enc: 'enc:expired-token',
        refresh_token_enc: 'enc:refresh-1',
        expires_at: new Date(Date.now() - 60_000).toISOString(),
      },
    }
    const result = await getValidGbpAccessToken()
    expect(result).toEqual({ ok: false, error: 'not_configured' })
  })

  it('returns refresh_failed (never throws) when Google rejects the refresh_token grant', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })))
    state.settingsRow = {
      value: {
        access_token_enc: 'enc:expired-token',
        refresh_token_enc: 'enc:refresh-1',
        expires_at: new Date(Date.now() - 60_000).toISOString(),
      },
    }
    const result = await getValidGbpAccessToken()
    expect(result).toEqual({ ok: false, error: 'refresh_failed' })
  })

  it('never includes the refresh token or access token in a thrown/logged error path', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
    state.settingsRow = {
      value: {
        access_token_enc: 'enc:expired-token',
        refresh_token_enc: 'enc:super-secret-refresh-token',
        expires_at: new Date(Date.now() - 60_000).toISOString(),
      },
    }
    const result = await getValidGbpAccessToken()
    expect(JSON.stringify(result)).not.toContain('super-secret-refresh-token')
  })
})
