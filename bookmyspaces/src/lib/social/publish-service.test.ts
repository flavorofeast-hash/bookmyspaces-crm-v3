import { describe, it, expect, vi, beforeEach } from 'vitest'

interface MockRow {
  id: string
  platform: string
  post_type: string
  content: string | null
  media: unknown[]
  status: string
  publish_attempts: number
  external_post_id: string | null
  failure_reason: string | null
  published_at: string | null
}

const state = {
  row: null as MockRow | null,
  fetchError: null as { message: string } | null,
  updateError: null as { message: string } | null,
  dueRows: [] as { id: string }[],
  lastUpdates: [] as Record<string, unknown>[],
}

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table !== 'social_posts') throw new Error(`unexpected table: ${table}`)

      const selEqObj: Record<string, unknown> = {}
      selEqObj.maybeSingle = () =>
        Promise.resolve({ data: state.fetchError ? null : state.row, error: state.fetchError })
      selEqObj.lte = () => selEqObj
      selEqObj.order = () => selEqObj
      selEqObj.limit = (n: number) =>
        Promise.resolve({ data: state.fetchError ? null : state.dueRows.slice(0, n), error: state.fetchError })

      return {
        select: () => ({ eq: () => selEqObj }),
        update: (patch: Record<string, unknown>) => ({
          eq: () => {
            state.lastUpdates.push(patch)
            if (!state.updateError && state.row) Object.assign(state.row, patch)
            const p = Promise.resolve({ error: state.updateError })
            return Object.assign(p, {
              select: () => ({
                single: () =>
                  Promise.resolve({
                    data: state.updateError ? null : state.row,
                    error: state.updateError,
                  }),
              }),
            })
          },
        }),
      }
    },
  }),
}))

const mockAdapter = {
  platform: 'facebook',
  isConfigured: vi.fn(() => true),
  publishPost: vi.fn(async () => ({ ok: true, externalPostId: 'ext_1' })),
}

vi.mock('@/lib/social/adapter-registry', () => ({
  getSocialAdapter: (platform: string) => (platform === 'facebook' || platform === 'instagram' ? mockAdapter : null),
}))

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))

import { publishSocialPost, processDueScheduledPosts } from './publish-service'

function baseRow(overrides: Partial<MockRow> = {}): MockRow {
  return {
    id: 'post_1',
    platform: 'facebook',
    post_type: 'text',
    content: 'Monsoon offer',
    media: [],
    status: 'draft',
    publish_attempts: 0,
    external_post_id: null,
    failure_reason: null,
    published_at: null,
    ...overrides,
  }
}

beforeEach(() => {
  state.row = null
  state.fetchError = null
  state.updateError = null
  state.dueRows = []
  state.lastUpdates = []
  mockAdapter.isConfigured.mockReset().mockReturnValue(true)
  mockAdapter.publishPost.mockReset().mockResolvedValue({ ok: true, externalPostId: 'ext_1' })
})

describe('publishSocialPost', () => {
  it('publishes a draft post and marks it published with the external id', async () => {
    state.row = baseRow({ status: 'draft' })
    const res = await publishSocialPost('post_1')
    expect(res.ok).toBe(true)
    expect(state.row?.status).toBe('published')
    expect(state.row?.external_post_id).toBe('ext_1')
    expect(state.row?.publish_attempts).toBe(1)
  })

  it('retries a failed post the same way as a first attempt', async () => {
    state.row = baseRow({ status: 'failed', publish_attempts: 1, failure_reason: 'graph_error_500' })
    const res = await publishSocialPost('post_1')
    expect(res.ok).toBe(true)
    expect(state.row?.status).toBe('published')
    expect(state.row?.publish_attempts).toBe(2)
  })

  it('marks the post failed when the adapter returns ok:false', async () => {
    mockAdapter.publishPost.mockResolvedValue({ ok: false, error: 'graph_error_400' })
    state.row = baseRow({ status: 'approved' })
    const res = await publishSocialPost('post_1')
    expect(res.ok).toBe(false)
    expect(state.row?.status).toBe('failed')
    expect(state.row?.failure_reason).toBe('graph_error_400')
  })

  it('fails cleanly when the adapter is not configured', async () => {
    mockAdapter.isConfigured.mockReturnValue(false)
    state.row = baseRow({ status: 'scheduled' })
    const res = await publishSocialPost('post_1')
    expect(res.ok).toBe(false)
    expect(state.row?.status).toBe('failed')
    expect(state.row?.failure_reason).toBe('adapter_not_configured')
    expect(mockAdapter.publishPost).not.toHaveBeenCalled()
  })

  it('rejects publishing a platform with no registered adapter', async () => {
    state.row = baseRow({ platform: 'linkedin', status: 'draft' })
    const res = await publishSocialPost('post_1')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toBe('no_adapter_for_platform_linkedin')
    expect(state.row?.status).toBe('failed')
  })

  it('refuses to re-publish a post that is already published', async () => {
    state.row = baseRow({ status: 'published' })
    const res = await publishSocialPost('post_1')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toBe('cannot_publish_from_status_published')
    expect(mockAdapter.publishPost).not.toHaveBeenCalled()
  })

  it('returns an error when the post does not exist', async () => {
    state.row = null
    const res = await publishSocialPost('missing')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toBe('post_not_found')
  })
})

describe('processDueScheduledPosts', () => {
  it('publishes every due row and tallies published/failed', async () => {
    state.dueRows = [{ id: 'post_1' }]
    state.row = baseRow({ status: 'scheduled' })
    const summary = await processDueScheduledPosts(20)
    expect(summary).toEqual({ attempted: 1, published: 1, failed: 0 })
  })

  it('returns a zeroed summary when nothing is due', async () => {
    state.dueRows = []
    const summary = await processDueScheduledPosts(20)
    expect(summary).toEqual({ attempted: 0, published: 0, failed: 0 })
  })
})
