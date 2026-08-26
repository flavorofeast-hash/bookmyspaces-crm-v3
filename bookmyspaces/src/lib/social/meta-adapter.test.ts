import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import crypto from 'crypto'
import { MetaAdapter } from './adapters/meta-adapter'
import { classifySentiment } from './interaction-service'

function makeRequestWithSignature(rawBody: string, secret: string) {
  const sig = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')
  return new Request('https://crm.bookmyspaces.in/api/social/webhook/instagram', {
    method: 'POST',
    headers: { 'x-hub-signature-256': sig },
  })
}

describe('MetaAdapter.parseWebhook', () => {
  const adapter = new MetaAdapter('facebook')

  it('parses a Facebook feed comment', () => {
    const payload = {
      entry: [{
        changes: [{
          field: 'feed',
          value: {
            item: 'comment',
            comment_id: '123_456',
            post_id: '123',
            from: { id: 'u1', name: 'Priya Sharma' },
            message: 'Do you host weddings?',
          },
        }],
      }],
    }
    const out = adapter.parseWebhook(payload)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      platform: 'facebook',
      interactionType: 'comment',
      externalId: '123_456',
      externalParentId: '123',
      authorName: 'Priya Sharma',
      content: 'Do you host weddings?',
    })
  })

  it('ignores unknown change fields and malformed entries', () => {
    expect(adapter.parseWebhook({ entry: [{ changes: [{ field: 'likes', value: {} }] }] })).toHaveLength(0)
    expect(adapter.parseWebhook({})).toHaveLength(0)
    expect(adapter.parseWebhook({ entry: 'nonsense' as unknown as [] })).toHaveLength(0)
  })

  it('is not configured without env credentials and refuses to publish', async () => {
    expect(adapter.isConfigured()).toBe(false)
    const result = await adapter.publishPost({ postType: 'text', content: 'hi', media: [] })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('meta_not_configured')
  })
})

describe('MetaAdapter.publishPost (configured)', () => {
  const ORIGINAL_ENV = { ...process.env }

  beforeEach(() => {
    process.env.META_APP_SECRET = 'secret'
    process.env.META_PAGE_ACCESS_TOKEN = 'token'
    process.env.META_PAGE_ID = 'page123'
    process.env.META_IG_ID = 'ig456'
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
    vi.unstubAllGlobals()
  })

  it('publishes a text-only Facebook post to /feed', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(String(url))
      return new Response(JSON.stringify({ id: 'post_1' }), { status: 200 })
    }))
    const adapter = new MetaAdapter('facebook')
    const result = await adapter.publishPost({ postType: 'text', content: 'Hello', media: [] })
    expect(result).toEqual({ ok: true, externalPostId: 'post_1' })
    expect(calls[0]).toContain('/page123/feed')
  })

  it('publishes a Facebook image post to /photos, not /feed', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(String(url))
      return new Response(JSON.stringify({ id: 'photo_1', post_id: 'post_2' }), { status: 200 })
    }))
    const adapter = new MetaAdapter('facebook')
    const result = await adapter.publishPost({
      postType: 'image', content: 'Look', media: [{ url: 'https://x/img.jpg', type: 'image' }],
    })
    expect(result).toEqual({ ok: true, externalPostId: 'post_2' })
    expect(calls[0]).toContain('/page123/photos')
  })

  it('publishes Instagram via the two-step container + media_publish flow', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(String(url))
      if (String(url).includes('/media_publish')) {
        return new Response(JSON.stringify({ id: 'ig_post_1' }), { status: 200 })
      }
      return new Response(JSON.stringify({ id: 'creation_1' }), { status: 200 })
    }))
    const adapter = new MetaAdapter('instagram')
    const result = await adapter.publishPost({
      postType: 'image', content: 'Caption', media: [{ url: 'https://x/img.jpg', type: 'image' }],
    })
    expect(result).toEqual({ ok: true, externalPostId: 'ig_post_1' })
    expect(calls[0]).toContain('/ig456/media')
    expect(calls[1]).toContain('/ig456/media_publish')
  })

  it('refuses an Instagram post with no media', async () => {
    const adapter = new MetaAdapter('instagram')
    const result = await adapter.publishPost({ postType: 'text', content: 'No image', media: [] })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('instagram_requires_media')
  })
})

describe('MetaAdapter.verifyWebhook', () => {
  const ORIGINAL_ENV = { ...process.env }
  const SECRET = 'test-app-secret-not-real'

  beforeEach(() => {
    process.env.META_APP_SECRET = SECRET
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  // Regression guard for the raw-body/comparison-encoding harmonization
  // pass -- a genuinely correct secret + matching signature must validate,
  // via the same hex-decoded-buffer comparison verify-signature.ts (the
  // WhatsApp webhook) already uses.
  it('accepts a correctly signed payload', async () => {
    const adapter = new MetaAdapter('instagram')
    const rawBody = JSON.stringify({ entry: [{ id: '123', messaging: [] }] })
    const req = makeRequestWithSignature(rawBody, SECRET)
    expect(await adapter.verifyWebhook(req, rawBody)).toBe(true)
  })

  it('rejects a payload signed with the wrong secret', async () => {
    const adapter = new MetaAdapter('instagram')
    const rawBody = JSON.stringify({ entry: [{ id: '123', messaging: [] }] })
    const req = makeRequestWithSignature(rawBody, 'a-different-secret')
    expect(await adapter.verifyWebhook(req, rawBody)).toBe(false)
  })

  it('rejects when the raw body does not match what was signed (tampered/re-serialized)', async () => {
    const adapter = new MetaAdapter('instagram')
    const signedBody = JSON.stringify({ entry: [{ id: '123', messaging: [] }] })
    const req = makeRequestWithSignature(signedBody, SECRET)
    const tamperedBody = JSON.stringify({ entry: [{ id: '999', messaging: [] }] })
    expect(await adapter.verifyWebhook(req, tamperedBody)).toBe(false)
  })

  it('rejects a missing signature header', async () => {
    const adapter = new MetaAdapter('instagram')
    const rawBody = '{}'
    const req = new Request('https://crm.bookmyspaces.in/api/social/webhook/instagram', { method: 'POST' })
    expect(await adapter.verifyWebhook(req, rawBody)).toBe(false)
  })

  it('rejects when META_APP_SECRET is unset', async () => {
    delete process.env.META_APP_SECRET
    const adapter = new MetaAdapter('instagram')
    const rawBody = '{}'
    const req = makeRequestWithSignature(rawBody, SECRET)
    expect(await adapter.verifyWebhook(req, rawBody)).toBe(false)
  })
})

describe('classifySentiment', () => {
  it('classifies obvious cases and defaults to neutral', () => {
    expect(classifySentiment('Absolutely beautiful property, best stay ever')).toBe('positive')
    expect(classifySentiment('Worst experience, total fraud')).toBe('negative')
    expect(classifySentiment('What are your banquet timings?')).toBe('neutral')
    expect(classifySentiment(null)).toBeNull()
  })
})
