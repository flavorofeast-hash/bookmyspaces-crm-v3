import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockDb = {
  activeTemplate: null as string | null,
  latestVersion: 0,
  inserted: null as Record<string, unknown> | null,
  deactivated: false,
  selectError: null as { message: string } | null,
}

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table !== 'ai_prompts') throw new Error(`unexpected table: ${table}`)
      return {
        select: (cols: string) => {
          const chain = {
            eq: () => chain,
            order: () => chain,
            limit: () => chain,
            maybeSingle: () =>
              Promise.resolve(
                cols.includes('prompt_template') && !cols.includes('version')
                  ? {
                      data: mockDb.activeTemplate ? { prompt_template: mockDb.activeTemplate } : null,
                      error: mockDb.selectError,
                    }
                  : {
                      data: mockDb.latestVersion ? { version: mockDb.latestVersion } : null,
                      error: null,
                    }
              ),
          }
          return chain
        },
        update: () => {
          mockDb.deactivated = true
          return { eq: () => ({ eq: () => Promise.resolve({ error: null }) }) }
        },
        insert: (v: Record<string, unknown>) => {
          mockDb.inserted = v
          return { select: () => ({ single: () => Promise.resolve({ data: { id: 'p1', ...v }, error: null }) }) }
        },
      }
    },
  }),
}))

import { getActivePrompt, createPromptVersion, clearPromptCache } from './prompt-service'

beforeEach(() => {
  clearPromptCache()
  mockDb.activeTemplate = null
  mockDb.latestVersion = 0
  mockDb.inserted = null
  mockDb.deactivated = false
  mockDb.selectError = null
})

describe('getActivePrompt', () => {
  it('returns the DB template when one is active', async () => {
    mockDb.activeTemplate = 'You are Aria v2.'
    expect(await getActivePrompt('system.customer_chat', 'fallback')).toBe('You are Aria v2.')
  })

  it('falls back when the table is empty', async () => {
    expect(await getActivePrompt('system.customer_chat', 'fallback')).toBe('fallback')
  })

  it('falls back (never throws) on DB error', async () => {
    mockDb.selectError = { message: 'relation missing' }
    expect(await getActivePrompt('system.customer_chat', 'fallback')).toBe('fallback')
  })

  it('caches the resolved value', async () => {
    mockDb.activeTemplate = 'v1'
    await getActivePrompt('n', 'f')
    mockDb.activeTemplate = 'v2 — should not be seen while cached'
    expect(await getActivePrompt('n', 'f')).toBe('v1')
  })
})

describe('createPromptVersion', () => {
  it('creates version max+1, deactivating the previous active version', async () => {
    mockDb.latestVersion = 3
    const res = await createPromptVersion({ name: 'system.customer_chat', prompt_template: 'new text' })
    expect(res.ok).toBe(true)
    expect(mockDb.deactivated).toBe(true)
    expect(mockDb.inserted).toMatchObject({ version: 4, is_active: true })
  })

  it('starts at version 1 for a new prompt name', async () => {
    const res = await createPromptVersion({ name: 'brand.tone', prompt_template: 'friendly' })
    expect(res.ok).toBe(true)
    expect(mockDb.inserted).toMatchObject({ version: 1 })
  })
})
