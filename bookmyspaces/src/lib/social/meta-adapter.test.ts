import { describe, it, expect, vi } from 'vitest'
import { MetaAdapter } from './adapters/meta-adapter'
import { classifySentiment } from './interaction-service'

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

  // Social OAuth -> Publishing credential fix — an OAuth-resolved credential
  // must let publishing succeed even with NO env vars set at all (isConfigured()
  // stays env-only/false; publishPost() must not gate on it once credentials
  // are supplied).
  it('publishes using a supplied OAuth credential even when env vars are entirely unset', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'ext_post_123' }),
    } as Response)
    try {
      expect(adapter.isConfigured()).toBe(false)
      const result = await adapter.publishPost(
        { postType: 'text', content: 'hi', media: [] },
        { accessToken: 'oauth-page-token', externalAccountId: 'oauth-page-id' }
      )
      expect(result.ok).toBe(true)
      expect(result.externalPostId).toBe('ext_post_123')
      const [url, options] = fetchSpy.mock.calls[0]
      expect(String(url)).toContain('oauth-page-id')
      expect(JSON.parse((options as RequestInit).body as string).access_token).toBe('oauth-page-token')
    } finally {
      fetchSpy.mockRestore()
    }
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
