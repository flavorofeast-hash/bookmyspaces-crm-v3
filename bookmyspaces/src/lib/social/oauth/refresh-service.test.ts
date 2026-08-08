import { describe, it, expect, vi, beforeEach } from 'vitest'

// Social OAuth -> Publishing credential fix — tests for
// resolvePublishCredentials() (the resolver publish-service.ts calls for a
// post's SELECTED social_accounts row) and a light regression check that
// refactoring refreshExpiringAccounts() to share renewAndPersistAccountToken()
// did not change its externally-observable behavior.
//
// Uses the REAL token-cipher.ts (AES-256-GCM) round-trip rather than mocking
// it — SOCIAL_TOKEN_ENCRYPTION_KEY is set below to a valid 32-byte base64
// key before any encrypt/decrypt call, so "decrypted correctly" and "invalid
// token" scenarios exercise the actual cipher, not a stub.

process.env.SOCIAL_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64')

interface AccountRow {
  id: string
  platform: string
  external_account_id: string | null
  access_token_encrypted: string | null
  refresh_token_encrypted: string | null
  token_expires_at: string | null
  status: string
  is_active: boolean
}

const state = {
  row: null as AccountRow | null,
  // Candidate list for refreshExpiringAccounts()'s own multi-.eq()/.not()/
  // .lte() query (a different shape than the single-row .maybeSingle()
  // lookups resolvePublishCredentials uses).
  candidateRows: [] as AccountRow[],
  // Simulates a concurrent renewal already having won the optimistic-
  // concurrency race on the persist update (0 rows matched).
  simulateRaceLoss: false,
  raceWinnerAccessTokenEncrypted: null as string | null,
  updates: [] as Array<{ patch: Record<string, unknown>; eqCount: number }>,
}

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table !== 'social_accounts') throw new Error(`unexpected table: ${table}`)
      return {
        // One flexible builder covers both call shapes used in this file:
        //  - resolvePublishCredentials(): .select(cols).eq('id', x).maybeSingle()
        //  - refreshExpiringAccounts():   .select(cols).eq().eq().not().lte() (awaited directly, array result)
        select: (cols: string) => {
          const builder: Record<string, unknown> = {}
          builder.eq = () => builder
          builder.not = () => builder
          builder.lte = () => builder
          builder.order = () => builder
          builder.maybeSingle = () => {
            // The post-race-loss refetch only asks for access_token_encrypted.
            if (cols === 'access_token_encrypted') {
              return Promise.resolve({
                data: state.raceWinnerAccessTokenEncrypted ? { access_token_encrypted: state.raceWinnerAccessTokenEncrypted } : null,
                error: null,
              })
            }
            return Promise.resolve({ data: state.row, error: null })
          }
          builder.then = (resolve: (v: { data: AccountRow[]; error: null }) => void) => {
            resolve({ data: state.candidateRows, error: null })
          }
          return builder
        },
        update: (patch: Record<string, unknown>) => {
          let eqCount = 0
          const chain: Record<string, unknown> = {}
          chain.eq = () => {
            eqCount++
            return chain
          }
          chain.select = () => ({
            maybeSingle: () => {
              state.updates.push({ patch, eqCount })
              // eqCount === 2 => the optimistic-concurrency persist update
              // (.eq('id',...).eq('token_expires_at',...)) — simulate a lost
              // race by returning 0 matched rows when configured to.
              if (eqCount >= 2 && state.simulateRaceLoss) return Promise.resolve({ data: null, error: null })
              if (state.row) Object.assign(state.row, patch)
              return Promise.resolve({ data: { id: state.row?.id ?? 'acct_1' }, error: null })
            },
          })
          // markAccountUnhealthy's update (single .eq, no .select) is
          // directly awaited.
          chain.then = (resolve: (v: { error: null }) => void) => {
            state.updates.push({ patch, eqCount })
            if (state.row) Object.assign(state.row, patch)
            resolve({ error: null })
          }
          return chain
        },
      }
    },
  }),
}))

const mockRefreshAccessToken = vi.fn()
const mockRenewMetaLongLivedToken = vi.fn()
vi.mock('./oauth-service', () => ({
  refreshAccessToken: (...args: [string, string]) => mockRefreshAccessToken(...args),
  renewMetaLongLivedToken: (...args: [string]) => mockRenewMetaLongLivedToken(...args),
}))

import { resolvePublishCredentials, refreshExpiringAccounts } from './refresh-service'
import { encryptToken, decryptToken } from '@/lib/social/token-cipher'

function accountRow(overrides: Partial<AccountRow> = {}): AccountRow {
  return {
    id: 'acct_1',
    platform: 'linkedin',
    external_account_id: 'urn:li:person:abc',
    access_token_encrypted: encryptToken('real-linkedin-token'),
    refresh_token_encrypted: encryptToken('real-refresh-token'),
    token_expires_at: new Date(Date.now() + 3600_000).toISOString(), // not expired
    status: 'connected',
    is_active: true,
    ...overrides,
  }
}

beforeEach(() => {
  state.row = null
  state.simulateRaceLoss = false
  state.raceWinnerAccessTokenEncrypted = null
  state.updates = []
  mockRefreshAccessToken.mockReset()
  mockRenewMetaLongLivedToken.mockReset()
})

describe('resolvePublishCredentials', () => {
  it('decrypts the stored token correctly and returns the external account id', async () => {
    state.row = accountRow()
    const res = await resolvePublishCredentials('acct_1', 'linkedin')
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.value.accessToken).toBe('real-linkedin-token')
      expect(res.value.externalAccountId).toBe('urn:li:person:abc')
    }
  })

  it('never leaks the raw encrypted column — only accessToken/externalAccountId are returned', async () => {
    state.row = accountRow()
    const res = await resolvePublishCredentials('acct_1', 'linkedin')
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(Object.keys(res.value).sort()).toEqual(['accessToken', 'externalAccountId'])
    }
  })

  it('fails when the account does not exist', async () => {
    state.row = null
    const res = await resolvePublishCredentials('missing', 'facebook')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toBe('social_account_not_found')
  })

  it('fails on a platform mismatch between the post and the resolved account', async () => {
    state.row = accountRow({ platform: 'facebook' })
    const res = await resolvePublishCredentials('acct_1', 'instagram')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toContain('social_account_platform_mismatch')
  })

  it('fails when the account is disconnected', async () => {
    state.row = accountRow({ status: 'disconnected' })
    const res = await resolvePublishCredentials('acct_1', 'linkedin')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toBe('social_account_not_connected')
  })

  it('fails when the account is inactive', async () => {
    state.row = accountRow({ is_active: false })
    const res = await resolvePublishCredentials('acct_1', 'linkedin')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toBe('social_account_not_connected')
  })

  it('fails cleanly when there is no access token on file', async () => {
    state.row = accountRow({ access_token_encrypted: null })
    const res = await resolvePublishCredentials('acct_1', 'linkedin')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toBe('no_access_token_on_file')
  })

  it('fails cleanly on an invalid/malformed stored token instead of throwing', async () => {
    state.row = accountRow({ access_token_encrypted: 'not-a-real-encrypted-value' })
    const res = await resolvePublishCredentials('acct_1', 'linkedin')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toContain('token_decrypt_failed')
  })

  it('proves decryptToken really is the mechanism — a token encrypted under a different plaintext decrypts to that exact plaintext, not a fixed stub', async () => {
    state.row = accountRow({ access_token_encrypted: encryptToken('another-distinct-secret') })
    const res = await resolvePublishCredentials('acct_1', 'linkedin')
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.value.accessToken).toBe('another-distinct-secret')
    expect(decryptToken(encryptToken('round-trip-check'))).toBe('round-trip-check')
  })

  it('reactively refreshes an already-expired token and persists the replacement before returning it', async () => {
    state.row = accountRow({ token_expires_at: new Date(Date.now() - 1000).toISOString() })
    mockRefreshAccessToken.mockResolvedValue({
      ok: true,
      value: { accessToken: 'brand-new-token', refreshToken: 'brand-new-refresh', expiresInSeconds: 3600 },
    })

    const res = await resolvePublishCredentials('acct_1', 'linkedin')

    expect(res.ok).toBe(true)
    if (res.ok) expect(res.value.accessToken).toBe('brand-new-token')
    expect(mockRefreshAccessToken).toHaveBeenCalledWith('linkedin', 'real-refresh-token')
    // Persisted encrypted — decrypts back to the same new token.
    expect(state.row?.access_token_encrypted).toBeTruthy()
    expect(decryptToken(state.row!.access_token_encrypted!)).toBe('brand-new-token')
    expect(state.row?.status).toBe('connected')
  })

  it('fails and does not call the adapter path when refresh itself fails (no refresh token on file)', async () => {
    state.row = accountRow({ token_expires_at: new Date(Date.now() - 1000).toISOString(), refresh_token_encrypted: null })
    const res = await resolvePublishCredentials('acct_1', 'linkedin')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toBe('no_refresh_token_on_file')
    // markAccountUnhealthy's update ran (single-eq update flipping status).
    expect(state.updates.some((u) => u.eqCount === 1 && 'status' in u.patch)).toBe(true)
  })

  it('reuses a concurrently-renewed token instead of failing when it loses the persist race', async () => {
    state.row = accountRow({ token_expires_at: new Date(Date.now() - 1000).toISOString() })
    state.simulateRaceLoss = true
    state.raceWinnerAccessTokenEncrypted = encryptToken('winner-token')
    mockRefreshAccessToken.mockResolvedValue({
      ok: true,
      value: { accessToken: 'this-callers-own-token', refreshToken: null, expiresInSeconds: 3600 },
    })

    const res = await resolvePublishCredentials('acct_1', 'linkedin')

    expect(res.ok).toBe(true)
    if (res.ok) expect(res.value.accessToken).toBe('winner-token')
  })
})

describe('refreshExpiringAccounts (regression check after extracting renewAndPersistAccountToken)', () => {
  it('still renews and persists an expiring account, tallying it under "renewed"', async () => {
    state.row = accountRow({ token_expires_at: new Date(Date.now() - 1000).toISOString() })
    state.candidateRows = [state.row]
    mockRefreshAccessToken.mockResolvedValue({
      ok: true,
      value: { accessToken: 'cron-renewed-token', refreshToken: 'cron-renewed-refresh', expiresInSeconds: 3600 },
    })

    const result = await refreshExpiringAccounts()

    expect(result).toEqual({ checked: 1, renewed: 1, failed: 0, errors: [] })
    expect(decryptToken(state.row!.access_token_encrypted!)).toBe('cron-renewed-token')
  })

  it('still counts a renewal failure under "failed" with a descriptive error', async () => {
    state.row = accountRow({ token_expires_at: new Date(Date.now() - 1000).toISOString(), refresh_token_encrypted: null })
    state.candidateRows = [state.row]

    const result = await refreshExpiringAccounts()

    expect(result.checked).toBe(1)
    expect(result.renewed).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.errors[0]).toContain('no_refresh_token_on_file')
  })
})
