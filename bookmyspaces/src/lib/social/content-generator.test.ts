import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/social/content-generator.test.ts
// Sprint 2 (AI Content Studio) — first test coverage for this file (none
// existed before). Mocks '@anthropic-ai/sdk' the same way
// src/lib/ai/operator-assistant.test.ts does, since this file uses the same
// direct-lazy-client pattern (not ai-provider.ts).
// ─────────────────────────────────────────────────────────────────────────────

const state = {
  responseText: '{}',
  shouldThrow: false,
  lastPrompt: '',
}

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: {
      create: (args: { messages: { content: string }[] }) => {
        state.lastPrompt = args.messages[0]?.content ?? ''
        if (state.shouldThrow) throw new Error('Anthropic API error')
        return Promise.resolve({ content: [{ type: 'text', text: state.responseText }] })
      },
    },
  })),
}))

import {
  generateSocialPostDraft,
  generateHashtags,
  generateImagePrompt,
  generateInteractionReplySuggestion,
} from './content-generator'

beforeEach(() => {
  state.responseText = '{}'
  state.shouldThrow = false
  state.lastPrompt = ''
  process.env.ANTHROPIC_API_KEY = 'test-key'
})

describe('generateSocialPostDraft', () => {
  it('parses a full JSON response into content/hashtags/title/cta', async () => {
    state.responseText = JSON.stringify({
      title: 'Weekend Rooftop Special',
      content: 'Join us this weekend for rooftop views and great food!',
      cta: 'DM us to book your table!',
      hashtags: ['kolkatarooftop', 'weekendvibes'],
    })

    const draft = await generateSocialPostDraft('instagram', 'promote weekend rooftop dining')

    expect(draft).toEqual({
      title: 'Weekend Rooftop Special',
      content: 'Join us this weekend for rooftop views and great food!',
      cta: 'DM us to book your table!',
      hashtags: ['kolkatarooftop', 'weekendvibes'],
    })
  })

  it('strips accidental markdown fences before parsing', async () => {
    state.responseText = '```json\n{"content":"Hello","hashtags":["a"],"title":"","cta":""}\n```'
    const draft = await generateSocialPostDraft('facebook', 'test goal')
    expect(draft.content).toBe('Hello')
    expect(draft.hashtags).toEqual(['a'])
  })

  it('returns an empty-but-shaped draft when the model call throws', async () => {
    state.shouldThrow = true
    const draft = await generateSocialPostDraft('facebook', 'test goal')
    expect(draft).toEqual({ content: '', hashtags: [], title: '', cta: '' })
  })

  it('returns an empty-but-shaped draft when the response is not valid JSON', async () => {
    state.responseText = 'not json at all'
    const draft = await generateSocialPostDraft('facebook', 'test goal')
    expect(draft).toEqual({ content: '', hashtags: [], title: '', cta: '' })
  })

  it('includes the variant guidance line in the prompt when a non-standard variant is requested', async () => {
    state.responseText = '{"content":"x","hashtags":[],"title":"","cta":""}'
    await generateSocialPostDraft('facebook', 'goal', undefined, { variant: 'short' })
    expect(state.lastPrompt).toMatch(/SHORT version/)
  })

  it('includes the template theme guidance in the prompt when a template category is requested', async () => {
    state.responseText = '{"content":"x","hashtags":[],"title":"","cta":""}'
    await generateSocialPostDraft('facebook', 'goal', undefined, { template: 'wedding' })
    expect(state.lastPrompt).toMatch(/wedding\/reception venue/)
  })

  it('omits variant/template guidance lines when not requested (standard, no template)', async () => {
    state.responseText = '{"content":"x","hashtags":[],"title":"","cta":""}'
    await generateSocialPostDraft('facebook', 'goal')
    expect(state.lastPrompt).not.toMatch(/Length\/tone instruction/)
    expect(state.lastPrompt).not.toMatch(/Content theme/)
  })
})

describe('generateHashtags', () => {
  it('returns the parsed hashtag array', async () => {
    state.responseText = JSON.stringify(['kolkatawedding', 'rooftopvenue'])
    const tags = await generateHashtags('instagram', 'wedding season')
    expect(tags).toEqual(['kolkatawedding', 'rooftopvenue'])
  })

  it('returns an empty array on failure', async () => {
    state.shouldThrow = true
    const tags = await generateHashtags('instagram', 'wedding season')
    expect(tags).toEqual([])
  })
})

describe('generateImagePrompt', () => {
  it('returns the trimmed prompt text', async () => {
    state.responseText = '  A golden-hour rooftop shot with string lights.  '
    const result = await generateImagePrompt('instagram', 'promote rooftop dining')
    expect(result.prompt).toBe('A golden-hour rooftop shot with string lights.')
  })

  it('returns an empty prompt on failure', async () => {
    state.shouldThrow = true
    const result = await generateImagePrompt('instagram', 'promote rooftop dining')
    expect(result.prompt).toBe('')
  })
})

describe('generateInteractionReplySuggestion', () => {
  it('returns the trimmed reply text and includes intent/content in the prompt', async () => {
    state.responseText = 'Thanks for reaching out! DM us for pricing and availability.'
    const result = await generateInteractionReplySuggestion('instagram', 'comment', 'How much for a 50 guest wedding?', 'enquiry')
    expect(result.reply).toBe('Thanks for reaching out! DM us for pricing and availability.')
    expect(state.lastPrompt).toMatch(/How much for a 50 guest wedding\?/)
    expect(state.lastPrompt).toMatch(/enquiry/)
  })

  it('returns an empty reply on failure', async () => {
    state.shouldThrow = true
    const result = await generateInteractionReplySuggestion('facebook', 'comment', 'test', null)
    expect(result.reply).toBe('')
  })
})
