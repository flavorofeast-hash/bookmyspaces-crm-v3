import { describe, it, expect } from 'vitest'
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
})

describe('classifySentiment', () => {
  it('classifies obvious cases and defaults to neutral', () => {
    expect(classifySentiment('Absolutely beautiful property, best stay ever')).toBe('positive')
    expect(classifySentiment('Worst experience, total fraud')).toBe('negative')
    expect(classifySentiment('What are your banquet timings?')).toBe('neutral')
    expect(classifySentiment(null)).toBeNull()
  })
})
