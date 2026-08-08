// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/analytics/social-attribution-service.ts
// End-to-End Campaign Attribution — "Revenue by Individual Social Post" and
// "Revenue by Social Platform".
//
// No new tracking mechanism, no new table: this codebase has no per-post
// landing-page link, so an individual click/lead can't be traced back to one
// specific post among several promoting the same Business Package. Instead,
// each package's REAL revenue (computeBusinessPackagePerformance() — accepted
// proposals + non-double-counted reservations, already the single source of
// truth for "Revenue by Business Package") is split across that package's
// own published posts in proportion to their platform-reported link clicks
// (social_post_metrics.clicks, migration 037 — populated by metrics-
// service.ts's syncPostMetrics()/manual entry, not fabricated). When no post
// in a package has any click data yet, the split falls back to even shares
// across its posts rather than guessing which one performed best. Posts with
// no business_package_id at all are listed as unattributed (0 revenue), not
// silently dropped — same "disclose the gap" posture as campaignPerformance's
// degraded flag elsewhere in this codebase.
//
// Revenue by Social Platform is pure composition on top of this: group the
// same per-post rows by `platform` and sum. Zero duplicate revenue logic.
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabaseAdmin } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { computeBusinessPackagePerformance } from '@/lib/business-packages/business-package-service'

export interface SocialPostRevenueRow {
  postId: string
  platform: string
  content: string | null
  publishedAt: string | null
  businessPackageId: string | null
  campaignId: string | null
  clicks: number
  estimatedRevenue: number
  attributionBasis: 'click_share' | 'even_split' | 'unattributed'
}

export interface SocialPlatformRevenueRow {
  platform: string
  postCount: number
  totalClicks: number
  estimatedRevenue: number
}

export interface SocialAttribution {
  posts: SocialPostRevenueRow[]
  byPlatform: SocialPlatformRevenueRow[]
  note: string
}

const ATTRIBUTION_NOTE =
  'Revenue per post is an estimate: each Business Package\'s real revenue (accepted proposals / confirmed reservations) is split across that package\'s published posts in proportion to platform-reported link clicks. Packages with no click data yet split evenly across their posts. Posts not linked to a Business Package show as unattributed, not zero-cost.'

interface SocialPostRow {
  id: string
  platform: string
  content: string | null
  published_at: string | null
  business_package_id: string | null
  campaign_id: string | null
}

interface SocialPostMetricRow {
  post_id: string
  clicks: number | null
}

export async function computeSocialAttribution(): Promise<SocialAttribution> {
  const empty: SocialAttribution = { posts: [], byPlatform: [], note: ATTRIBUTION_NOTE }
  try {
    const db = getSupabaseAdmin()
    const [packagePerf, postsResult, metricsResult] = await Promise.all([
      computeBusinessPackagePerformance(),
      db.from('social_posts').select('id, platform, content, published_at, business_package_id, campaign_id').eq('status', 'published'),
      db.from('social_post_metrics').select('post_id, clicks'),
    ])

    if (postsResult.error) throw postsResult.error
    const posts = (postsResult.data ?? []) as unknown as SocialPostRow[]
    const metrics = (metricsResult.data ?? []) as unknown as SocialPostMetricRow[]

    const clicksByPost = new Map<string, number>()
    for (const m of metrics) clicksByPost.set(m.post_id, Number(m.clicks) || 0)

    const revenueByPackageId = new Map(packagePerf.map((p) => [p.packageId, p.revenue]))

    const postsByPackage = new Map<string, SocialPostRow[]>()
    const unattributedPosts: SocialPostRow[] = []
    for (const post of posts) {
      if (!post.business_package_id) { unattributedPosts.push(post); continue }
      if (!postsByPackage.has(post.business_package_id)) postsByPackage.set(post.business_package_id, [])
      postsByPackage.get(post.business_package_id)!.push(post)
    }

    const rows: SocialPostRevenueRow[] = []

    for (const [packageId, pkgPosts] of Array.from(postsByPackage.entries())) {
      const revenue = revenueByPackageId.get(packageId) ?? 0
      const totalClicks = pkgPosts.reduce((sum, p) => sum + (clicksByPost.get(p.id) ?? 0), 0)

      for (const post of pkgPosts) {
        const clicks = clicksByPost.get(post.id) ?? 0
        let estimatedRevenue = 0
        let basis: SocialPostRevenueRow['attributionBasis'] = 'unattributed'
        if (revenue > 0) {
          if (totalClicks > 0) {
            estimatedRevenue = Math.round((revenue * (clicks / totalClicks)) * 100) / 100
            basis = 'click_share'
          } else {
            estimatedRevenue = Math.round((revenue / pkgPosts.length) * 100) / 100
            basis = 'even_split'
          }
        }
        rows.push({
          postId: post.id,
          platform: post.platform,
          content: post.content,
          publishedAt: post.published_at,
          businessPackageId: packageId,
          campaignId: post.campaign_id,
          clicks,
          estimatedRevenue,
          attributionBasis: basis,
        })
      }
    }

    for (const post of unattributedPosts) {
      rows.push({
        postId: post.id,
        platform: post.platform,
        content: post.content,
        publishedAt: post.published_at,
        businessPackageId: null,
        campaignId: post.campaign_id,
        clicks: clicksByPost.get(post.id) ?? 0,
        estimatedRevenue: 0,
        attributionBasis: 'unattributed',
      })
    }

    rows.sort((a, b) => b.estimatedRevenue - a.estimatedRevenue)

    const byPlatformMap = new Map<string, SocialPlatformRevenueRow>()
    for (const row of rows) {
      if (!byPlatformMap.has(row.platform)) byPlatformMap.set(row.platform, { platform: row.platform, postCount: 0, totalClicks: 0, estimatedRevenue: 0 })
      const bucket = byPlatformMap.get(row.platform)!
      bucket.postCount++
      bucket.totalClicks += row.clicks
      bucket.estimatedRevenue = Math.round((bucket.estimatedRevenue + row.estimatedRevenue) * 100) / 100
    }
    const byPlatform = Array.from(byPlatformMap.values()).sort((a, b) => b.estimatedRevenue - a.estimatedRevenue)

    return { posts: rows, byPlatform, note: ATTRIBUTION_NOTE }
  } catch (err) {
    logger.error('social-attribution-service', 'computeSocialAttribution failed', err)
    return empty
  }
}
