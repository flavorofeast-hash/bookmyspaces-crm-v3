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
