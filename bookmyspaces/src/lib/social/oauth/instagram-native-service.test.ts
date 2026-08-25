// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/social/oauth/instagram-native-service.test.ts
// Covers the two diagnostic-bearing Graph calls added for the sanitized
// subscription-verification instrumentation pass: subscribeInstagramMessages
// and verifyInstagramMessagesSubscription. Stubs global fetch (same pattern
// as meta-lead-capture.test.ts) since callGraphAPI calls fetch() directly.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, afterEach } from 'vitest'
import { subscribeInstagramMessages, verifyInstagramMessagesSubscription } from './instagram-native-service'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('subscribeInstagramMessages', () => {
  it('returns ok:true with the HTTP status on a successful subscribe call', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 })))
    const result = await subscribeInstagramMessages('17841478674706194', 'fake-token-not-real')
    expect(result.ok).toBe(true)
    expect(result.httpStatus).toBe(200)
    expect(result.error).toBeNull()
  })

  it('returns ok:false with the HTTP status and a sanitized error on a failed subscribe call', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message: 'Invalid parameter' } }), { status: 400 })))
    const result = await subscribeInstagramMessages('17841478674706194', 'fake-token-not-real')
    expect(result.ok).toBe(false)
    expect(result.httpStatus).toBe(400)
    expect(result.error).toBe('Invalid parameter')
  })

  it('never includes the access token in the returned error/outcome shape', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message: 'bad' } }), { status: 400 })))
    const result = await subscribeInstagramMessages('17841478674706194', 'super-secret-token-value')
    expect(JSON.stringify(result)).not.toContain('super-secret-token-value')
  })
})

describe('verifyInstagramMessagesSubscription', () => {
  it('returns subscribed:true and the field list when messages is present', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      data: [{ subscribed_fields: ['messages'] }],
    }), { status: 200 })))
    const result = await verifyInstagramMessagesSubscription('17841478674706194', 'fake-token-not-real')
    expect(result.ok).toBe(true)
    expect(result.httpStatus).toBe(200)
    expect(result.subscribed).toBe(true)
    expect(result.subscribedFields).toEqual(['messages'])
  })

  it('returns subscribed:false when messages is absent from the subscribed fields', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      data: [{ subscribed_fields: ['comments'] }],
    }), { status: 200 })))
    const result = await verifyInstagramMessagesSubscription('17841478674706194', 'fake-token-not-real')
    expect(result.ok).toBe(true)
    expect(result.subscribed).toBe(false)
    expect(result.subscribedFields).toEqual(['comments'])
  })

  it('returns ok:false with the HTTP status on a failed verify call', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message: 'Unsupported request' } }), { status: 400 })))
    const result = await verifyInstagramMessagesSubscription('17841478674706194', 'fake-token-not-real')
    expect(result.ok).toBe(false)
    expect(result.httpStatus).toBe(400)
    expect(result.subscribed).toBe(false)
    expect(result.subscribedFields).toEqual([])
    expect(result.error).toBe('Unsupported request')
  })
})
