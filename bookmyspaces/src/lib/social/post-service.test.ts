import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockDb = {
  rows: [] as unknown[],
  count: 0,
  error: null as { message: string } | null,
  lastInsert: null as Record<string, unknown> | null,
  lastFilters: [] as [string, unknown][],
  lastRange: null as [number, number] | null,
}

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table !== 'social_posts') throw new Error(`unexpected table: ${table}`)
      const chain: Record<string, unknown> = {}
      chain.select = () => chain
      chain.order = () => chain
      chain.range = (a: number, b: number) => {
        mockDb.lastRange = [a, b]
        const promise = Promise.resolve({ data: mockDb.rows, error: mockDb.error, count: mockDb.count })
        return Object.assign(promise, {
          eq: (col: string, val: unknown) => {
            mockDb.lastFilters.push([col, val])
            return Object.assign(Promise.resolve({ data: mockDb.rows, error: mockDb.error, count: mockDb.count }), {
              eq: (c2: string, v2: unknown) => {
                mockDb.lastFilters.push([c2, v2])
                return Promise.resolve({ data: mockDb.rows, error: mockDb.error, count: mockDb.count })
              },
            })
          },
        })
      }
      chain.insert = (v: Record<string, unknown>) => {
        mockDb.lastInsert = v
        return {
          select: () => ({
            single: () => Promise.resolve({
              data: mockDb.error ? null : { id: 'p1', ...v },
              error: mockDb.error,
            }),
          }),
        }
      }
      return chain
    },
  }),
}))

import { listSocialPosts, createSocialPost } from './post-service'

beforeEach(() => {
  mockDb.rows = []
  mockDb.count = 0
  mockDb.error = null
  mockDb.lastInsert = null
  mockDb.lastFilters = []
  mockDb.lastRange = null
})

describe('createSocialPost', () => {
  it('creates a draft when no scheduled_at is given', async () => {
    const res = await createSocialPost({
      platform: 'facebook',
      post_type: 'text',
      content: 'Monsoon wedding offer!',
      created_by: 'raju@bookmyspaces.in',
    })
    expect(res.ok).toBe(true)
    expect(mockDb.lastInsert).toMatchObject({
      status: 'draft',
      scheduled_at: null,
      platform: 'facebook',
      created_by: 'raju@bookmyspaces.in',
    })
  })

  it('creates a scheduled post when scheduled_at is given', async () => {
    const when = new Date(Date.now() + 86_400_000).toISOString()
    const res = await createSocialPost({
      platform: 'instagram',
      post_type: 'image',
      content: 'Rooftop evenings',
      media: [{ url: 'https://cdn.example/x.jpg', type: 'image' }],
      scheduled_at: when,
      created_by: 'raju@bookmyspaces.in',
    })
    expect(res.ok).toBe(true)
    expect(mockDb.lastInsert).toMatchObject({ status: 'scheduled', scheduled_at: when })
  })

  it('never accepts a caller-supplied status (derived only)', async () => {
    await createSocialPost({
      platform: 'facebook',
      post_type: 'text',
      content: 'x',
      created_by: 'u',
      // @ts-expect-error — status is deliberately not part of CreatePostInput
      status: 'published',
    })
    expect(mockDb.lastInsert?.status).toBe('draft')
  })

  it('surfaces DB errors as ok:false', async () => {
    mockDb.error = { message: 'insert denied' }
    const res = await createSocialPost({
      platform: 'facebook', post_type: 'text', content: 'x', created_by: 'u',
    })
    expect(res.ok).toBe(false)
  })
})

describe('listSocialPosts', () => {
  it('applies status/platform filters and pagination', async () => {
    mockDb.rows = [{ id: 'a' }]
    mockDb.count = 1
    const res = await listSocialPosts({ status: 'draft', platform: 'facebook', limit: 10, offset: 20 })
    expect(res.ok).toBe(true)
    expect(mockDb.lastFilters).toEqual([['status', 'draft'], ['platform', 'facebook']])
    expect(mockDb.lastRange).toEqual([20, 29])
  })

  it('caps limit at 100', async () => {
    await listSocialPosts({ limit: 5000 })
    expect(mockDb.lastRange).toEqual([0, 99])
  })

  it('surfaces DB errors as ok:false', async () => {
    mockDb.error = { message: 'relation missing' }
    const res = await listSocialPosts()
    expect(res.ok).toBe(false)
  })
})
