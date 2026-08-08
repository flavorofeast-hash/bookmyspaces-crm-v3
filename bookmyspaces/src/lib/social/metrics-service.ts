// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/social/metrics-service.ts
// Phase 2 (Social Growth) — Engagement Analytics. Backs social_post_metrics
// (migration 037). Two ways a row gets written:
//   1. syncPostMetrics(postId)  — explicit POST action, calls the post's
//      platform adapter's fetchEngagementMetrics(). Idempotent sync-job
//      pattern, same shape as publishSocialPost/syncReferralRewards — never
//      a read-time side effect.
//   2. upsertManualMetrics(postId, metrics) — operator-entered numbers for
//      platforms with no adapter yet (or before a post's adapter sync has
//      run). Never fabricated by this service itself; the caller (API
//      route) is the one asserting these came from a human.
// getPostMetrics / getEngagementSummary are pure reads.
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabaseAdmin } from '@/lib/supabase'
import { getSocialAdapter } from '@/lib/social/adapter-registry'
import type { PostMetrics } from '@/lib/social/types'

type Result<T> = { ok: true; value: T } | { ok: false; error: string }

export interface SocialPostMetricsRow {
  id: string
  created_at: string
  updated_at: string
  post_id: string
  reach: number | null
  impressions: number | null
  clicks: number | null
  likes: number | null
  comments: number | null
  shares: number | null
  saves: number | null
  source: 'manual' | 'adapter_sync'
}

export async function syncPostMetrics(postId: string): Promise<Result<SocialPostMetricsRow>> {
  const db = getSupabaseAdmin()

  const { data: post, error: postError } = await db
    .from('social_posts')
    .select('id, platform, status, external_post_id')
    .eq('id', postId)
    .maybeSingle()
  if (postError) return { ok: false, error: postError.message }
  if (!post) return { ok: false, error: 'post_not_found' }
  if (post.status !== 'published' || !post.external_post_id) {
    return { ok: false, error: 'post_not_published: metrics can only be synced for a published post with an external_post_id' }
  }

  const adapter = getSocialAdapter(post.platform)
  if (!adapter) return { ok: false, error: `no_adapter_for_platform_${post.platform}` }

  const result = await adapter.fetchEngagementMetrics(post.external_post_id)
  if (!result.ok || !result.metrics) return { ok: false, error: result.error ?? 'fetch_failed' }

  return upsertMetricsRow(postId, result.metrics, 'adapter_sync')
}

export async function upsertManualMetrics(postId: string, metrics: PostMetrics): Promise<Result<SocialPostMetricsRow>> {
  return upsertMetricsRow(postId, metrics, 'manual')
}

async function upsertMetricsRow(
  postId: string,
  metrics: PostMetrics,
  source: 'manual' | 'adapter_sync'
): Promise<Result<SocialPostMetricsRow>> {
  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('social_post_metrics')
    .upsert(
      {
        post_id: postId,
        reach: metrics.reach ?? null,
        impressions: metrics.impressions ?? null,
        clicks: metrics.clicks ?? null,
        likes: metrics.likes ?? null,
        comments: metrics.comments ?? null,
        shares: metrics.shares ?? null,
        saves: metrics.saves ?? null,
        source,
      },
      { onConflict: 'post_id' }
    )
    .select('*')
    .single()
  if (error || !data) return { ok: false, error: error?.message ?? 'upsert returned no row' }
  return { ok: true, value: data as SocialPostMetricsRow }
}

export async function getPostMetrics(postId: string): Promise<Result<SocialPostMetricsRow | null>> {
  const db = getSupabaseAdmin()
  const { data, error } = await db.from('social_post_metrics').select('*').eq('post_id', postId).maybeSingle()
  if (error) return { ok: false, error: error.message }
  return { ok: true, value: (data as SocialPostMetricsRow | null) ?? null }
}

export interface EngagementSummary {
  postsWithMetrics: number
  totals: { reach: number; impressions: number; clicks: number; likes: number; comments: number; shares: number; saves: number }
  byPlatform: Record<string, { posts: number; reach: number; impressions: number; likes: number; comments: number; shares: number }>
}

// Bounded fetch + in-JS reduce — same "fetch once, reduce in JS" contract
// used throughout revenue-intelligence.ts/growth-intelligence.ts, not a
// SQL-side GROUP BY. Accepted here for consistency; same future-scaling
// caveat applies (flagged in prior audit reports for the analogous pattern
// elsewhere).
export async function getEngagementSummary(limit = 200): Promise<Result<EngagementSummary>> {
  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('social_post_metrics')
    .select('reach, impressions, clicks, likes, comments, shares, saves, social_posts!inner(platform)')
    .order('updated_at', { ascending: false })
    .limit(limit)
  if (error) return { ok: false, error: error.message }

  const rows = (data ?? []) as unknown as (SocialPostMetricsRow & { social_posts: { platform: string } })[]

  const totals = { reach: 0, impressions: 0, clicks: 0, likes: 0, comments: 0, shares: 0, saves: 0 }
  const byPlatform: EngagementSummary['byPlatform'] = {}

  for (const row of rows) {
    totals.reach += row.reach ?? 0
    totals.impressions += row.impressions ?? 0
    totals.clicks += row.clicks ?? 0
    totals.likes += row.likes ?? 0
    totals.comments += row.comments ?? 0
    totals.shares += row.shares ?? 0
    totals.saves += row.saves ?? 0

    const platform = row.social_posts?.platform ?? 'unknown'
    if (!byPlatform[platform]) byPlatform[platform] = { posts: 0, reach: 0, impressions: 0, likes: 0, comments: 0, shares: 0 }
    byPlatform[platform].posts += 1
    byPlatform[platform].reach += row.reach ?? 0
    byPlatform[platform].impressions += row.impressions ?? 0
    byPlatform[platform].likes += row.likes ?? 0
    byPlatform[platform].comments += row.comments ?? 0
    byPlatform[platform].shares += row.shares ?? 0
  }

  return { ok: true, value: { postsWithMetrics: rows.length, totals, byPlatform } }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sprint 4 (Marketing Intelligence) — "Top performing content" leaderboard
// + "Best posting time" recommendation. Both read the same
// social_post_metrics/social_posts join getEngagementSummary() already
// uses; one shared internal fetch (fetchRankedPublishedPosts), not two
// separate queries, so ranking logic isn't duplicated between the two
// public functions below.
// ─────────────────────────────────────────────────────────────────────────────

export interface RankedContentItem {
  postId: string
  platform: string
  content: string | null
  publishedAt: string | null
  /** image/video/carousel/reel/story/text — social_posts.post_type. Used by recommendBestContentFormat() below. */
  postType: string
  /** Disclosed, deterministic score — likes + comments*2 + shares*3 + saves*2 (comments/shares/saves weighted higher as stronger engagement signals than a like). Not a fabricated "virality" index. */
  engagementScore: number
  metrics: { reach: number | null; impressions: number | null; clicks: number | null; likes: number | null; comments: number | null; shares: number | null; saves: number | null }
}

type RankedRow = SocialPostMetricsRow & { social_posts: { platform: string; content: string | null; published_at: string | null; status: string } }

// Content Operations Priority 5 (AI recommendations) needs post_type
// (image/video/carousel/reel/story) per post to rank by format — not
// selected by fetchRankedPublishedPosts' original callers, so added to the
// shared select rather than a second near-duplicate query.
type RankedRowWithFormat = RankedRow & { social_posts: RankedRow['social_posts'] & { post_type?: string } }

async function fetchRankedPublishedPosts(): Promise<Result<RankedContentItem[]>> {
  const db = getSupabaseAdmin()
  // Bounded fetch + in-JS reduce — same contract as getEngagementSummary() above.
  const { data, error } = await db
    .from('social_post_metrics')
    .select('post_id, reach, impressions, clicks, likes, comments, shares, saves, social_posts!inner(platform, content, published_at, status, post_type)')
    .limit(500)
  if (error) return { ok: false, error: error.message }

  const rows = (data ?? []) as unknown as RankedRowWithFormat[]

  const ranked = rows
    .filter((r) => r.social_posts?.status === 'published')
    .map((r) => ({
      postId: r.post_id,
      platform: r.social_posts.platform,
      content: r.social_posts.content,
      publishedAt: r.social_posts.published_at,
      postType: r.social_posts.post_type ?? 'text',
      engagementScore: (r.likes ?? 0) + (r.comments ?? 0) * 2 + (r.shares ?? 0) * 3 + (r.saves ?? 0) * 2,
      metrics: { reach: r.reach, impressions: r.impressions, clicks: r.clicks, likes: r.likes, comments: r.comments, shares: r.shares, saves: r.saves },
    }))
    .sort((a, b) => b.engagementScore - a.engagementScore)

  return { ok: true, value: ranked }
}

/**
 * Sprint 4 — ranks published posts (with a synced/manual metrics row) by
 * engagementScore, highest first. Reads existing tables only — no new
 * table, no fabricated "virality" metric.
 */
export async function getTopPerformingContent(limit = 10): Promise<Result<RankedContentItem[]>> {
  const result = await fetchRankedPublishedPosts()
  if (!result.ok) return result
  return { ok: true, value: result.value.slice(0, limit) }
}

export interface BestPostingTimeResult {
  sampleSize: number
  byHour: { hour: number; avgEngagement: number; posts: number }[]
  byDayOfWeek: { day: string; avgEngagement: number; posts: number }[]
  recommendation: string
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MIN_POSTING_TIME_SAMPLE = 5

/**
 * Sprint 4 / AI Opportunities — "Best posting time" recommendation.
 * Deterministic aggregation over THIS ACCOUNT'S OWN published-post
 * engagement history (published_at hour-of-day / day-of-week vs.
 * engagementScore) — same "template-grounded over real computed numbers,
 * not a live LLM call" convention as growth-intelligence.ts's briefs.
 * Returns an honest "insufficient data" recommendation below
 * MIN_POSTING_TIME_SAMPLE rather than a confident-sounding guess.
 */
export async function computeBestPostingTime(): Promise<Result<BestPostingTimeResult>> {
  const result = await fetchRankedPublishedPosts()
  if (!result.ok) return result

  const rows = result.value.filter((r) => r.publishedAt)
  if (rows.length < MIN_POSTING_TIME_SAMPLE) {
    return {
      ok: true,
      value: {
        sampleSize: rows.length,
        byHour: [],
        byDayOfWeek: [],
        recommendation: `Insufficient data — only ${rows.length} published post(s) with metrics and a timestamp (need at least ${MIN_POSTING_TIME_SAMPLE}). Publish and sync metrics for more posts before trusting a best-time recommendation.`,
      },
    }
  }

  const hourBuckets = new Map<number, { total: number; count: number }>()
  const dayBuckets = new Map<number, { total: number; count: number }>()

  for (const r of rows) {
    const d = new Date(r.publishedAt as string)
    const hour = d.getHours()
    const day = d.getDay()
    const h = hourBuckets.get(hour) ?? { total: 0, count: 0 }
    h.total += r.engagementScore; h.count += 1
    hourBuckets.set(hour, h)
    const dbk = dayBuckets.get(day) ?? { total: 0, count: 0 }
    dbk.total += r.engagementScore; dbk.count += 1
    dayBuckets.set(day, dbk)
  }

  const byHour = Array.from(hourBuckets.entries())
    .map(([hour, v]) => ({ hour, avgEngagement: Math.round((v.total / v.count) * 10) / 10, posts: v.count }))
    .sort((a, b) => b.avgEngagement - a.avgEngagement)

  const byDayOfWeek = Array.from(dayBuckets.entries())
    .map(([day, v]) => ({ day: DAY_NAMES[day], avgEngagement: Math.round((v.total / v.count) * 10) / 10, posts: v.count }))
    .sort((a, b) => b.avgEngagement - a.avgEngagement)

  const bestHour = byHour[0]
  const bestDay = byDayOfWeek[0]
  const recommendation = bestHour && bestDay
    ? `Based on ${rows.length} published posts: highest average engagement is around ${bestHour.hour}:00 on ${bestDay.day}s. Treat as directional, not definitive, until more posts accumulate.`
    : 'Insufficient data to recommend a best posting time yet.'

  return { ok: true, value: { sampleSize: rows.length, byHour, byDayOfWeek, recommendation } }
}

// ─────────────────────────────────────────────────────────────────────────────
// Content Operations Priority 5 — "AI recommendations (best CTA, image,
// audience, posting time)". Best posting time is computeBestPostingTime()
// above; the three below use the SAME real data source (this account's own
// published-post engagement history, via fetchRankedPublishedPosts) rather
// than a live LLM call or fabricated numbers — consistent with this
// codebase's "template-grounded over real computed numbers" convention for
// every other AI Marketing/Growth Intelligence brief. Each honestly reports
// "insufficient data" below its own minimum sample rather than a
// confident-sounding guess.
//
// Two of the three are deliberately reframed to the finest real signal this
// schema actually has, disclosed in each result's `note`, rather than
// inventing tracking that doesn't exist:
//   - "best image" -> best CONTENT FORMAT (post_type: image/video/carousel/
//     reel/story/text) — there is no per-image style/palette tracking
//     anywhere in this schema.
//   - "best audience" -> best PLATFORM (each platform's audience is the
//     only audience segmentation this schema has — there is no demographic/
//     interest targeting data anywhere in this codebase).
// ─────────────────────────────────────────────────────────────────────────────

const MIN_RECOMMENDATION_SAMPLE = 5

export interface BestFormatResult {
  sampleSize: number
  byFormat: { postType: string; avgEngagement: number; posts: number }[]
  recommendation: string
}

export async function recommendBestContentFormat(): Promise<Result<BestFormatResult>> {
  const result = await fetchRankedPublishedPosts()
  if (!result.ok) return result
  const rows = result.value

  if (rows.length < MIN_RECOMMENDATION_SAMPLE) {
    return {
      ok: true,
      value: { sampleSize: rows.length, byFormat: [], recommendation: `Insufficient data — only ${rows.length} published post(s) with metrics (need at least ${MIN_RECOMMENDATION_SAMPLE}).` },
    }
  }

  const buckets = new Map<string, { total: number; count: number }>()
  for (const r of rows) {
    const b = buckets.get(r.postType) ?? { total: 0, count: 0 }
    b.total += r.engagementScore; b.count += 1
    buckets.set(r.postType, b)
  }

  const byFormat = Array.from(buckets.entries())
    .map(([postType, v]) => ({ postType, avgEngagement: Math.round((v.total / v.count) * 10) / 10, posts: v.count }))
    .sort((a, b) => b.avgEngagement - a.avgEngagement)

  const best = byFormat[0]
  return {
    ok: true,
    value: {
      sampleSize: rows.length,
      byFormat,
      recommendation: best
        ? `Based on ${rows.length} published posts: "${best.postType}" format has the highest average engagement (${best.avgEngagement}, ${best.posts} post(s)). Note: this is format-level (image/video/carousel/reel/story), not per-image style — this schema doesn't track finer image attributes.`
        : 'Insufficient data to recommend a best format yet.',
    },
  }
}

export interface BestAudienceResult {
  sampleSize: number
  byPlatform: { platform: string; avgEngagement: number; posts: number }[]
  recommendation: string
}

export async function recommendBestAudience(): Promise<Result<BestAudienceResult>> {
  const result = await fetchRankedPublishedPosts()
  if (!result.ok) return result
  const rows = result.value

  if (rows.length < MIN_RECOMMENDATION_SAMPLE) {
    return {
      ok: true,
      value: { sampleSize: rows.length, byPlatform: [], recommendation: `Insufficient data — only ${rows.length} published post(s) with metrics (need at least ${MIN_RECOMMENDATION_SAMPLE}).` },
    }
  }

  const buckets = new Map<string, { total: number; count: number }>()
  for (const r of rows) {
    const b = buckets.get(r.platform) ?? { total: 0, count: 0 }
    b.total += r.engagementScore; b.count += 1
    buckets.set(r.platform, b)
  }

  const byPlatform = Array.from(buckets.entries())
    .map(([platform, v]) => ({ platform, avgEngagement: Math.round((v.total / v.count) * 10) / 10, posts: v.count }))
    .sort((a, b) => b.avgEngagement - a.avgEngagement)

  const best = byPlatform[0]
  return {
    ok: true,
    value: {
      sampleSize: rows.length,
      byPlatform,
      recommendation: best
        ? `Based on ${rows.length} published posts: ${best.platform}'s audience has the highest average engagement (${best.avgEngagement}, ${best.posts} post(s)). Note: this is platform-level — this schema doesn't track demographic/interest-level audience data.`
        : 'Insufficient data to recommend a best audience yet.',
    },
  }
}

// Keyword-categorized CTA patterns actually seen in this business's own
// generated/published copy (content-generator.ts's own prompt vocabulary:
// "DM us", "WhatsApp us", etc.) — same "heuristic keyword table, disclosed"
// convention as classifyInteractionIntent()'s SPAM/COMPLAINT/ENQUIRY_HINT
// regexes, not a new pattern.
const CTA_CATEGORIES: { label: string; pattern: RegExp }[] = [
  { label: 'WhatsApp/DM us', pattern: /\b(dm us|dm me|whatsapp us|message us|inbox us)\b/i },
  { label: 'Call us', pattern: /\b(call us|call now|ring us)\b/i },
  { label: 'Book now', pattern: /\b(book now|book your|reserve your|book today)\b/i },
  { label: 'Visit us', pattern: /\b(visit us|come by|drop by|stop by)\b/i },
  { label: 'Link in bio / website', pattern: /\b(link in bio|visit our website|check our website)\b/i },
  { label: 'Limited-time urgency', pattern: /\b(limited slots|limited time|hurry|don't miss|last chance|offer ends)\b/i },
]

export interface BestCTAResult {
  sampleSize: number
  byCTA: { label: string; avgEngagement: number; posts: number }[]
  recommendation: string
}

/**
 * Categorizes each published post's content by which CTA_CATEGORIES pattern
 * it matches (a post can match more than one; uncategorized posts are
 * excluded from the ranking, not force-bucketed into a misleading "Other").
 */
export async function recommendBestCTA(): Promise<Result<BestCTAResult>> {
  const result = await fetchRankedPublishedPosts()
  if (!result.ok) return result
  const rows = result.value.filter((r) => r.content)

  if (rows.length < MIN_RECOMMENDATION_SAMPLE) {
    return {
      ok: true,
      value: { sampleSize: rows.length, byCTA: [], recommendation: `Insufficient data — only ${rows.length} published post(s) with content and metrics (need at least ${MIN_RECOMMENDATION_SAMPLE}).` },
    }
  }

  const buckets = new Map<string, { total: number; count: number }>()
  let categorized = 0
  for (const r of rows) {
    for (const cat of CTA_CATEGORIES) {
      if (cat.pattern.test(r.content as string)) {
        const b = buckets.get(cat.label) ?? { total: 0, count: 0 }
        b.total += r.engagementScore; b.count += 1
        buckets.set(cat.label, b)
        categorized++
      }
    }
  }

  const byCTA = Array.from(buckets.entries())
    .map(([label, v]) => ({ label, avgEngagement: Math.round((v.total / v.count) * 10) / 10, posts: v.count }))
    .sort((a, b) => b.avgEngagement - a.avgEngagement)

  if (categorized === 0) {
    return {
      ok: true,
      value: { sampleSize: rows.length, byCTA: [], recommendation: `${rows.length} published posts with metrics, but none matched a recognized CTA pattern (WhatsApp/DM, call, book now, visit, link in bio, urgency). Cannot recommend a best CTA yet.` },
    }
  }

  const best = byCTA[0]
  return {
    ok: true,
    value: {
      sampleSize: rows.length,
      byCTA,
      recommendation: `Based on ${categorized} categorized mentions across ${rows.length} published posts: "${best.label}" CTAs have the highest average engagement (${best.avgEngagement}, ${best.posts} post(s)).`,
    },
  }
}
