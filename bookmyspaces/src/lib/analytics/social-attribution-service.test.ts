import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))

const packagePerfMock = vi.fn()
vi.mock('@/lib/business-packages/business-package-service', () => ({
  computeBusinessPackagePerformance: () => packagePerfMock(),
}))

const tableData: Record<string, unknown[]> = { social_posts: [], social_post_metrics: [] }
let queryError: { message: string } | null = null

function makeBuilder(table: string) {
  const builder: Record<string, unknown> = {}
  builder.eq = () => builder
  builder.then = (resolve: (v: { data: unknown[] | null; error: unknown }) => void) =>
    resolve(queryError ? { data: null, error: queryError } : { data: tableData[table] ?? [], error: null })
  return builder
}

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => ({ select: () => makeBuilder(table) }),
  }),
}))

import { computeSocialAttribution } from './social-attribution-service'

describe('computeSocialAttribution', () => {
  it('splits a package\'s real revenue across its posts by click share', async () => {
    packagePerfMock.mockResolvedValue([
      { packageId: 'pkg1', packageName: 'Wedding Bliss', revenue: 90000 },
    ])
    tableData.social_posts = [
      { id: 'post1', platform: 'facebook', content: 'A', published_at: '2026-01-01', business_package_id: 'pkg1', campaign_id: 'camp1' },
      { id: 'post2', platform: 'instagram', content: 'B', published_at: '2026-01-02', business_package_id: 'pkg1', campaign_id: null },
    ]
    tableData.social_post_metrics = [
      { post_id: 'post1', clicks: 30 },
      { post_id: 'post2', clicks: 10 },
    ]
    queryError = null

    const result = await computeSocialAttribution()
    const post1 = result.posts.find((p) => p.postId === 'post1')!
    const post2 = result.posts.find((p) => p.postId === 'post2')!

    expect(post1.estimatedRevenue).toBe(67500) // 90000 * 30/40
    expect(post1.attributionBasis).toBe('click_share')
    expect(post2.estimatedRevenue).toBe(22500) // 90000 * 10/40
    expect(post1.estimatedRevenue + post2.estimatedRevenue).toBe(90000)

    const fb = result.byPlatform.find((p) => p.platform === 'facebook')!
    expect(fb.estimatedRevenue).toBe(67500)
    expect(fb.postCount).toBe(1)
  })

  it('splits evenly across a package\'s posts when none have recorded clicks yet', async () => {
    packagePerfMock.mockResolvedValue([{ packageId: 'pkg1', packageName: 'Wedding Bliss', revenue: 30000 }])
    tableData.social_posts = [
      { id: 'post1', platform: 'facebook', content: 'A', published_at: '2026-01-01', business_package_id: 'pkg1', campaign_id: null },
      { id: 'post2', platform: 'facebook', content: 'B', published_at: '2026-01-02', business_package_id: 'pkg1', campaign_id: null },
      { id: 'post3', platform: 'facebook', content: 'C', published_at: '2026-01-03', business_package_id: 'pkg1', campaign_id: null },
    ]
    tableData.social_post_metrics = []
    queryError = null

    const result = await computeSocialAttribution()
    for (const row of result.posts) {
      expect(row.estimatedRevenue).toBe(10000)
      expect(row.attributionBasis).toBe('even_split')
    }
  })

  it('lists posts with no business package as unattributed rather than dropping them', async () => {
    packagePerfMock.mockResolvedValue([])
    tableData.social_posts = [
      { id: 'post1', platform: 'linkedin', content: 'A', published_at: '2026-01-01', business_package_id: null, campaign_id: null },
    ]
    tableData.social_post_metrics = []
    queryError = null

    const result = await computeSocialAttribution()
    expect(result.posts).toHaveLength(1)
    expect(result.posts[0].attributionBasis).toBe('unattributed')
    expect(result.posts[0].estimatedRevenue).toBe(0)
  })

  it('never fabricates revenue for a package with zero real revenue', async () => {
    packagePerfMock.mockResolvedValue([{ packageId: 'pkg1', packageName: 'Wedding Bliss', revenue: 0 }])
    tableData.social_posts = [
      { id: 'post1', platform: 'facebook', content: 'A', published_at: '2026-01-01', business_package_id: 'pkg1', campaign_id: null },
    ]
    tableData.social_post_metrics = [{ post_id: 'post1', clicks: 50 }]
    queryError = null

    const result = await computeSocialAttribution()
    expect(result.posts[0].estimatedRevenue).toBe(0)
    expect(result.posts[0].attributionBasis).toBe('unattributed')
  })

  it('returns an empty result (never throws) when the query fails', async () => {
    packagePerfMock.mockResolvedValue([])
    queryError = { message: 'db down' }

    const result = await computeSocialAttribution()
    expect(result).toEqual({ posts: [], byPlatform: [], note: expect.any(String) })
  })
})
