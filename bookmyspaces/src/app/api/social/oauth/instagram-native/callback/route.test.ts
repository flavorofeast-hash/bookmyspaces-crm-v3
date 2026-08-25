// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/app/api/social/oauth/instagram-native/callback/route.test.ts
// Covers the sanitized subscription-diagnostic persistence added to this
// callback: successful subscribe+verify, failed subscribe, failed
// verification, and that no token/secret ever reaches the persisted config.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest'

const FAKE_TOKEN = 'IGAA-fake-token-never-persisted'

const state = {
  authOk: true,
  userId: 'user-1',
  decodedState: { platform: 'instagram_native' as const, userId: 'user-1', nonce: 'n', issuedAt: Date.now() } as unknown,
  tokenExchange: { ok: true, value: { accessToken: FAKE_TOKEN, expiresInSeconds: 60 * 24 * 3600 } } as unknown,
  identity: { ok: true, value: { igUserId: '17841478674706194', username: 'skyline.monurama' } } as unknown,
  subscribe: { ok: true, httpStatus: 200, error: null } as { ok: boolean; httpStatus: number; error: string | null },
  verify: { ok: true, httpStatus: 200, subscribed: true, subscribedFields: ['messages'], error: null } as {
    ok: boolean; httpStatus: number; subscribed: boolean; subscribedFields: string[]; error: string | null
  },
}

const db = {
  upserts: [] as unknown[],
  updates: [] as unknown[],
}

vi.mock('@/lib/auth-guard', () => ({
  requireRole: () => Promise.resolve(state.authOk ? { ok: true, user: { id: state.userId } } : { ok: false, response: new Response('no', { status: 401 }) }),
}))

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => ({
      upsert: (v: unknown) => { db.upserts.push({ table, v }); return Promise.resolve({ error: null }) },
      update: (v: unknown) => {
        db.updates.push({ table, v })
        return { eq: () => ({ eq: () => Promise.resolve({ error: null }) }) }
      },
    }),
  }),
}))

vi.mock('@/lib/social/oauth/oauth-config', () => ({
  isAppBaseUrlConfigured: () => true,
  getAppBaseUrl: () => 'https://crm.bookmyspaces.in',
}))

vi.mock('@/lib/social/oauth/oauth-state', () => ({
  decodeOAuthState: () => state.decodedState,
}))

vi.mock('@/lib/social/oauth/instagram-native-service', () => ({
  exchangeInstagramNativeCode: () => Promise.resolve(state.tokenExchange),
  fetchInstagramNativeIdentity: () => Promise.resolve(state.identity),
  subscribeInstagramMessages: () => Promise.resolve(state.subscribe),
  verifyInstagramMessagesSubscription: () => Promise.resolve(state.verify),
}))

vi.mock('@/lib/social/token-cipher', () => ({
  isTokenCipherConfigured: () => true,
  encryptToken: () => 'iv:tag:ciphertext-not-the-real-token',
}))

import { GET } from './route'

function makeRequest() {
  return new NextRequestLike('https://crm.bookmyspaces.in/api/social/oauth/instagram-native/callback?code=abc123&state=signed-state')
}

// Minimal NextRequest-like shim -- route only reads req.nextUrl.searchParams.
class NextRequestLike {
  nextUrl: URL
  constructor(url: string) { this.nextUrl = new URL(url) }
}

beforeEach(() => {
  db.upserts = []
  db.updates = []
  state.authOk = true
  state.tokenExchange = { ok: true, value: { accessToken: FAKE_TOKEN, expiresInSeconds: 60 * 24 * 3600 } }
  state.identity = { ok: true, value: { igUserId: '17841478674706194', username: 'skyline.monurama' } }
  state.subscribe = { ok: true, httpStatus: 200, error: null }
  state.verify = { ok: true, httpStatus: 200, subscribed: true, subscribedFields: ['messages'], error: null }
})

describe('instagram-native OAuth callback — subscription diagnostic persistence', () => {
  it('successful subscribe + verify: redirects success and persists a sanitized subscribed diagnostic', async () => {
    const res = await GET(makeRequest() as unknown as Parameters<typeof GET>[0])
    expect(res.status).toBe(307) // NextResponse.redirect default

    expect(db.upserts).toHaveLength(1)
    expect(db.updates).toHaveLength(1)
    const persisted = db.updates[0] as { table: string; v: { config: Record<string, unknown> } }
    expect(persisted.table).toBe('social_accounts')
    expect(persisted.v.config.subscription).toMatchObject({
      subscribeOk: true,
      subscribeHttpStatus: 200,
      verifyOk: true,
      verifyHttpStatus: 200,
      subscribedFields: ['messages'],
    })
  })

  it('failed subscribe: redirects error and persists subscribeOk:false with the HTTP status', async () => {
    state.subscribe = { ok: false, httpStatus: 400, error: 'Invalid parameter' }
    const res = await GET(makeRequest() as unknown as Parameters<typeof GET>[0])
    const location = res.headers.get('location') ?? ''
    expect(location).toContain('oauth=error')
    expect(location).toContain('connected_but_subscribe_failed')

    expect(db.updates).toHaveLength(1)
    const persisted = db.updates[0] as { v: { config: Record<string, unknown> } }
    expect(persisted.v.config.subscription).toMatchObject({
      subscribeOk: false,
      subscribeHttpStatus: 400,
      verifyOk: false,
      subscribedFields: [],
    })
  })

  it('failed verification (not actually subscribed): redirects error and persists verifyOk/subscribed accurately', async () => {
    state.verify = { ok: true, httpStatus: 200, subscribed: false, subscribedFields: ['comments'], error: null }
    const res = await GET(makeRequest() as unknown as Parameters<typeof GET>[0])
    const location = res.headers.get('location') ?? ''
    expect(location).toContain('connected_but_subscription_not_confirmed')

    const persisted = db.updates[0] as { v: { config: { subscription: Record<string, unknown> } } }
    expect(persisted.v.config.subscription.subscribeOk).toBe(true)
    expect(persisted.v.config.subscription.verifyOk).toBe(true)
    expect(persisted.v.config.subscription.subscribedFields).toEqual(['comments'])
  })

  it('never persists the access token or any secret into social_accounts.config', async () => {
    await GET(makeRequest() as unknown as Parameters<typeof GET>[0])
    const allWrites = JSON.stringify([...db.upserts, ...db.updates])
    expect(allWrites).not.toContain(FAKE_TOKEN)
    expect(allWrites).not.toContain('code=abc123')
  })
})
