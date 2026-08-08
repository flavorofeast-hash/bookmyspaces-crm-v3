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
  next_retry_at: string | null
  approved_at: string | null
  account_id?: string | null
}

const state = {
  row: null as MockRow | null,
  fetchError: null as { message: string } | null,
  updateError: null as { message: string } | null,
  dueRows: [] as { id: string; status?: string }[],
  lastUpdates: [] as Record<string, unknown>[],
  // Concurrency-guard test hook — when true, the CLAIM update specifically
  // (the one publish-service.ts chains two .eq() calls onto: .eq('id',...)
  // .eq('status', post.status)) simulates "another request already won the
  // race" by returning 0 matched rows, without applying its patch. Every
  // other update call in publish-service.ts uses exactly one .eq(), so
  // counting chained .eq() calls is a reliable, simple way to identify the
  // claim specifically without building a real per-column filter engine.
  claimConflict: false,
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
        select: () => ({ eq: () => selEqObj, or: () => selEqObj }),
        update: (patch: Record<string, unknown>) => {
          let eqCount = 0
          const isConflicted = () => eqCount >= 2 && state.claimConflict

          function apply(): { data: MockRow | null; error: { message: string } | null } {
            if (isConflicted()) return { data: null, error: null }
            if (!state.updateError && state.row) Object.assign(state.row, patch)
            state.lastUpdates.push(patch)
            return { data: state.updateError ? null : state.row, error: state.updateError }
          }

          const chain: Record<string, unknown> = {}
          chain.eq = () => {
            eqCount++
            return chain
          }
          chain.select = () => ({
            single: () => Promise.resolve(apply()),
            maybeSingle: () => Promise.resolve(apply()),
          })
          // Also directly awaitable when no .select() follows (matches
          // publish-service.ts's no-adapter/catch-block update calls).
          chain.then = (resolve: (v: { error: { message: string } | null }) => void) => {
            const { error } = apply()
            resolve({ error })
          }
          return chain
        },
      }
    },
  }),
}))

interface MockPublishResult { ok: boolean; externalPostId?: string; error?: string }
interface MockCredentials { accessToken: string; externalAccountId: string | null }

const mockAdapter = {
  platform: 'facebook',
  isConfigured: vi.fn(() => true),
  publishPost: vi.fn(async (_input: unknown, _credentials?: MockCredentials): Promise<MockPublishResult> => ({ ok: true, externalPostId: 'ext_1' })),
}

vi.mock('@/lib/social/adapter-registry', () => ({
  getSocialAdapter: (platform: string) => (platform === 'facebook' || platform === 'instagram' ? mockAdapter : null),
}))

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))

// Content Operations Priority 5 — approval gate. Mocked directly so tests
// can control requireApproval precisely, rather than relying on
// getPublishConfig()'s own try/catch-to-default(false) behavior against the
// social_posts-only Supabase mock above (which is what every OTHER test in
// this file implicitly depends on to keep the gate off).
const mockGetPublishConfig = vi.fn(async () => ({ requireApproval: false }))
vi.mock('@/lib/social/publish-config', () => ({ getPublishConfig: () => mockGetPublishConfig() }))

// markAccountUnhealthy / writeNotificationToAudience are side effects
// publish-service.ts calls on failure — both already no-op safely against
// the social_posts-only Supabase mock (each wraps its own DB call in a
// try/catch), so no explicit mock is needed for the existing tests below.
// Mocked here anyway so assertions can confirm they're actually invoked.
const mockMarkAccountUnhealthy = vi.fn(async (_accountId: string, _errorMessage: string) => {})
// Social OAuth -> Publishing credential fix — resolvePublishCredentials()
// default resolves successfully so every EXISTING test below (none of which
// care about credential resolution specifically) is unaffected; the new
// describe block further down overrides this per-test to exercise the
// resolution path itself.
interface MockResolvedCredentials { accessToken: string; externalAccountId: string | null }
type MockResolveResult = { ok: true; value: MockResolvedCredentials } | { ok: false; error: string }
const mockResolvePublishCredentials = vi.fn(
  async (_accountId: string, _platform: string): Promise<MockResolveResult> =>
    ({ ok: true, value: { accessToken: 'resolved-token', externalAccountId: 'resolved-ext-id' } })
)
vi.mock('@/lib/social/oauth/refresh-service', () => ({
  // Lazy reference (same pattern as mockAdapter above) — the wrapper
  // function is only ever CALLED later, at test runtime, by which point
  // mockMarkAccountUnhealthy is initialized. Evaluating the mock function
  // object itself here must not touch the const directly, or Vitest's
  // vi.mock hoisting (factories run before top-level const declarations)
  // throws a TDZ ReferenceError.
  markAccountUnhealthy: (...args: [string, string]) => mockMarkAccountUnhealthy(...args),
  resolvePublishCredentials: (...args: [string, string]) => mockResolvePublishCredentials(...args),
}))
const mockWriteNotification = vi.fn(async (_candidates: unknown[]) => ({ audienceSize: 0, written: 0, skippedCapped: 0, errors: [] as string[] }))
vi.mock('@/lib/chief-of-staff/notification-producer', () => ({
  writeNotificationToAudience: (...args: [unknown[]]) => mockWriteNotification(...args),
}))

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
    next_retry_at: null,
    approved_at: null,
    account_id: null,
    ...overrides,
  }
}

beforeEach(() => {
  state.row = null
  state.fetchError = null
  state.updateError = null
  state.dueRows = []
  state.lastUpdates = []
  state.claimConflict = false
  mockAdapter.isConfigured.mockReset().mockReturnValue(true)
  mockAdapter.publishPost.mockReset().mockResolvedValue({ ok: true, externalPostId: 'ext_1' })
  mockGetPublishConfig.mockReset().mockResolvedValue({ requireApproval: false })
  mockMarkAccountUnhealthy.mockReset().mockResolvedValue(undefined)
  mockResolvePublishCredentials.mockReset().mockResolvedValue({ ok: true, value: { accessToken: 'resolved-token', externalAccountId: 'resolved-ext-id' } })
  mockWriteNotification.mockReset().mockResolvedValue({ audienceSize: 0, written: 0, skippedCapped: 0, errors: [] })
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

  it('marks the post failed (with a scheduled backoff retry) when the adapter returns ok:false', async () => {
    mockAdapter.publishPost.mockResolvedValue({ ok: false, error: 'graph_error_400' })
    state.row = baseRow({ status: 'approved' })
    const res = await publishSocialPost('post_1')
    expect(res.ok).toBe(false)
    expect(state.row?.status).toBe('failed')
    expect(state.row?.failure_reason).toBe('graph_error_400')
    expect(state.row?.next_retry_at).not.toBeNull()
  })

  it('moves to failed_permanent (no next_retry_at) once MAX_PUBLISH_ATTEMPTS is reached', async () => {
    mockAdapter.publishPost.mockResolvedValue({ ok: false, error: 'graph_error_500' })
    // publish_attempts:4 -> this attempt becomes the 5th (MAX_PUBLISH_ATTEMPTS).
    state.row = baseRow({ status: 'failed', publish_attempts: 4 })
    const res = await publishSocialPost('post_1')
    expect(res.ok).toBe(false)
    expect(state.row?.status).toBe('failed_permanent')
    expect(state.row?.publish_attempts).toBe(5)
    expect(state.row?.next_retry_at).toBeNull()
  })

  it('allows a manual retry of a failed_permanent post (human override)', async () => {
    state.row = baseRow({ status: 'failed_permanent', publish_attempts: 5 })
    const res = await publishSocialPost('post_1')
    expect(res.ok).toBe(true)
    expect(state.row?.status).toBe('published')
  })

  it('clears next_retry_at on a successful publish', async () => {
    state.row = baseRow({ status: 'failed', publish_attempts: 1, next_retry_at: new Date().toISOString() })
    const res = await publishSocialPost('post_1')
    expect(res.ok).toBe(true)
    expect(state.row?.next_retry_at).toBeNull()
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

  it('rejects a concurrent publish attempt (TOCTOU fix) without calling the adapter', async () => {
    // Simulates a second, overlapping publishSocialPost() call losing the
    // atomic claim (e.g. a double-click, or a manual publish racing cron) —
    // the adapter must never be called for the loser, and the row must be
    // left untouched (still 'approved', not 'publishing').
    state.row = baseRow({ status: 'approved' })
    state.claimConflict = true
    const res = await publishSocialPost('post_1')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toContain('concurrent_publish_conflict')
    expect(state.row?.status).toBe('approved')
    expect(mockAdapter.publishPost).not.toHaveBeenCalled()
  })

  it('calls markAccountUnhealthy and writeNotificationToAudience when a post reaches failed_permanent', async () => {
    mockAdapter.publishPost.mockResolvedValue({ ok: false, error: 'graph_error_500' })
    state.row = baseRow({ status: 'failed', publish_attempts: 4, account_id: 'acct_1' })
    const res = await publishSocialPost('post_1')
    expect(res.ok).toBe(false)
    expect(state.row?.status).toBe('failed_permanent')
    expect(mockMarkAccountUnhealthy).toHaveBeenCalledWith('acct_1', 'graph_error_500')
    expect(mockWriteNotification).toHaveBeenCalledTimes(1)
  })

  describe('Social OAuth -> Publishing credential resolution', () => {
    it('resolves the selected account and passes its token/external id to the adapter', async () => {
      state.row = baseRow({ status: 'draft', account_id: 'acct_1' })
      mockResolvePublishCredentials.mockResolvedValue({ ok: true, value: { accessToken: 'tok_acct_1', externalAccountId: 'ext_acct_1' } })

      const res = await publishSocialPost('post_1')

      expect(res.ok).toBe(true)
      expect(mockResolvePublishCredentials).toHaveBeenCalledWith('acct_1', 'facebook')
      expect(mockAdapter.publishPost).toHaveBeenCalledWith(
        expect.anything(),
        { accessToken: 'tok_acct_1', externalAccountId: 'ext_acct_1' }
      )
    })

    it('publishes using the SPECIFIC selected account, not an arbitrary/first connected one — proven by resolving by exact id', async () => {
      state.row = baseRow({ status: 'draft', account_id: 'acct_2' })
      mockResolvePublishCredentials.mockImplementation(async (accountId: string) =>
        accountId === 'acct_2'
          ? { ok: true, value: { accessToken: 'tok_acct_2', externalAccountId: 'ext_acct_2' } }
          : { ok: true, value: { accessToken: 'tok_WRONG_ACCOUNT', externalAccountId: 'ext_WRONG' } }
      )

      await publishSocialPost('post_1')

      expect(mockResolvePublishCredentials).toHaveBeenCalledWith('acct_2', 'facebook')
      expect(mockAdapter.publishPost).toHaveBeenCalledWith(
        expect.anything(),
        { accessToken: 'tok_acct_2', externalAccountId: 'ext_acct_2' }
      )
    })

    it('never calls adapter.isConfigured() as a gate when a per-account credential resolves successfully (env-unconfigured adapter still publishes)', async () => {
      mockAdapter.isConfigured.mockReturnValue(false)
      state.row = baseRow({ status: 'draft', account_id: 'acct_1' })

      const res = await publishSocialPost('post_1')

      expect(res.ok).toBe(true)
      expect(state.row?.status).toBe('published')
    })

    it('falls back to the adapter static-env path when no account is selected (account_id null) — backward compatible', async () => {
      state.row = baseRow({ status: 'draft', account_id: null })

      const res = await publishSocialPost('post_1')

      expect(res.ok).toBe(true)
      expect(mockResolvePublishCredentials).not.toHaveBeenCalled()
      expect(mockAdapter.publishPost).toHaveBeenCalledWith(expect.anything(), undefined)
    })

    it('fails cleanly (adapter never called) when credential resolution fails for an invalid/missing token, and marks the account unhealthy', async () => {
      state.row = baseRow({ status: 'draft', account_id: 'acct_bad', publish_attempts: 4 })
      mockResolvePublishCredentials.mockResolvedValue({ ok: false, error: 'token_decrypt_failed' })

      const res = await publishSocialPost('post_1')

      expect(res.ok).toBe(false)
      expect(mockAdapter.publishPost).not.toHaveBeenCalled()
      expect(state.row?.status).toBe('failed_permanent')
      expect(state.row?.failure_reason).toBe('token_decrypt_failed')
      expect(mockMarkAccountUnhealthy).toHaveBeenCalledWith('acct_bad', 'token_decrypt_failed')
    })

    it('schedules a normal backoff retry (not permanent) on a first-attempt credential resolution failure — same convention as any other transient publish failure', async () => {
      state.row = baseRow({ status: 'draft', account_id: 'acct_bad' })
      mockResolvePublishCredentials.mockResolvedValue({ ok: false, error: 'social_account_not_connected' })

      const res = await publishSocialPost('post_1')

      expect(res.ok).toBe(false)
      expect(state.row?.status).toBe('failed')
      expect(state.row?.next_retry_at).not.toBeNull()
    })
  })

  describe('approval gate (Content Operations Priority 5)', () => {
    it('rejects a draft when requireApproval is on, without consuming an attempt', async () => {
      mockGetPublishConfig.mockResolvedValue({ requireApproval: true })
      state.row = baseRow({ status: 'draft' })
      const res = await publishSocialPost('post_1')
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.error).toBe('approval_required')
      expect(state.row?.status).toBe('draft')
      expect(state.row?.publish_attempts).toBe(0)
      expect(mockAdapter.publishPost).not.toHaveBeenCalled()
    })

    it('rejects a scheduled post with no approved_at when requireApproval is on — closes the schedule-to-bypass-approval gap', async () => {
      mockGetPublishConfig.mockResolvedValue({ requireApproval: true })
      state.row = baseRow({ status: 'scheduled', approved_at: null })
      const res = await publishSocialPost('post_1')
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.error).toBe('approval_required')
      expect(state.row?.status).toBe('scheduled')
      expect(mockAdapter.publishPost).not.toHaveBeenCalled()
    })

    it('publishes a scheduled post that has approved_at set, even when requireApproval is on', async () => {
      mockGetPublishConfig.mockResolvedValue({ requireApproval: true })
      state.row = baseRow({ status: 'scheduled', approved_at: '2026-01-01T00:00:00.000Z' })
      const res = await publishSocialPost('post_1')
      expect(res.ok).toBe(true)
      expect(state.row?.status).toBe('published')
    })

    it('does not gate a draft when requireApproval is off', async () => {
      mockGetPublishConfig.mockResolvedValue({ requireApproval: false })
      state.row = baseRow({ status: 'draft' })
      const res = await publishSocialPost('post_1')
      expect(res.ok).toBe(true)
    })

    it('never gates an already-approved or failed post (only draft / unapproved-scheduled)', async () => {
      mockGetPublishConfig.mockResolvedValue({ requireApproval: true })
      state.row = baseRow({ status: 'approved' })
      const res = await publishSocialPost('post_1')
      expect(res.ok).toBe(true)
    })
  })
})

describe('processDueScheduledPosts', () => {
  it('publishes every due row and tallies published/failed', async () => {
    state.dueRows = [{ id: 'post_1', status: 'scheduled' }]
    state.row = baseRow({ status: 'scheduled' })
    const summary = await processDueScheduledPosts(20)
    expect(summary).toEqual({ attempted: 1, published: 1, failed: 0, retried: 0 })
  })

  it('returns a zeroed summary when nothing is due', async () => {
    state.dueRows = []
    const summary = await processDueScheduledPosts(20)
    expect(summary).toEqual({ attempted: 0, published: 0, failed: 0, retried: 0 })
  })

  it('counts a due failed-retry row under "retried", separate from a fresh scheduled publish', async () => {
    state.dueRows = [{ id: 'post_1', status: 'failed' }]
    state.row = baseRow({ status: 'failed', publish_attempts: 1 })
    const summary = await processDueScheduledPosts(20)
    expect(summary).toEqual({ attempted: 1, published: 1, failed: 0, retried: 1 })
  })
})
