// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/social/publish-service.ts
// Growth Engine Epic 5 — Social Publishing pipeline.
//
// One function does the actual work: publishSocialPost() drives a single
// social_posts row through publishing -> published/failed via whatever
// adapter is registered for its platform (adapter-registry.ts). It is the
// SAME code path for a first attempt and a retry — a 'failed' post is just
// as publishable as a 'draft'/'approved'/'scheduled' one, so "retry" is not
// a separate function, it's this function called again (publish_attempts
// increments either way, per migration 036).
//
// processDueScheduledPosts() is the cron-facing wrapper: finds 'scheduled'
// rows whose scheduled_at has passed and publishes each, bounded + one row
// failing never aborts the batch — same shape as processCampaignQueue().
//
// Adapters that aren't configured yet (every platform right now — no Meta
// credentials in this environment, see meta-adapter.ts header) fail cleanly
// with a clear failure_reason instead of a crash. This is the intended
// "architecture ready, not live" state per the Phase 2 instruction not to
// integrate third-party APIs yet — the pipeline is real, the credentials
// are not.
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabaseAdmin } from '@/lib/supabase'
import { getSocialAdapter } from '@/lib/social/adapter-registry'
import { logger } from '@/lib/logger'
import type { SocialPostRecord, SocialPostStatus } from '@/lib/social/post-service'
import type { PublishInput } from '@/lib/social/types'

type Result<T> = { ok: true; value: T } | { ok: false; error: string }

// Every status a publish attempt may legally start from. 'publishing' is
// deliberately excluded — a post already mid-publish should not be
// re-triggered by a second concurrent call.
const PUBLISHABLE_STATUSES: SocialPostStatus[] = ['draft', 'approved', 'scheduled', 'failed']

export async function publishSocialPost(postId: string): Promise<Result<SocialPostRecord>> {
  const db = getSupabaseAdmin()

  const { data: existing, error: fetchError } = await db
    .from('social_posts')
    .select('*')
    .eq('id', postId)
    .maybeSingle()
  if (fetchError) return { ok: false, error: fetchError.message }
  if (!existing) return { ok: false, error: 'post_not_found' }

  const post = existing as SocialPostRecord
  if (!PUBLISHABLE_STATUSES.includes(post.status)) {
    return { ok: false, error: `cannot_publish_from_status_${post.status}` }
  }

  const adapter = getSocialAdapter(post.platform)
  const attempts = (post.publish_attempts ?? 0) + 1

  if (!adapter) {
    await db
      .from('social_posts')
      .update({ status: 'failed', failure_reason: `no_adapter_for_platform_${post.platform}`, publish_attempts: attempts })
      .eq('id', postId)
    return { ok: false, error: `no_adapter_for_platform_${post.platform}` }
  }

  // Mark publishing + record this attempt before calling out, so a crash
  // mid-call still leaves an accurate attempt count and status.
  await db.from('social_posts').update({ status: 'publishing', publish_attempts: attempts }).eq('id', postId)

  if (!adapter.isConfigured()) {
    const { data: row, error } = await db
      .from('social_posts')
      .update({ status: 'failed', failure_reason: 'adapter_not_configured' })
      .eq('id', postId).select('*').single()
    if (error || !row) return { ok: false, error: error?.message ?? 'adapter_not_configured' }
    return { ok: false, error: 'adapter_not_configured' }
  }

  const input: PublishInput = {
    postType: post.post_type as PublishInput['postType'],
    content: post.content,
    media: post.media,
  }

  try {
    const result = await adapter.publishPost(input)

    if (result.ok) {
      const { data: row, error } = await db
        .from('social_posts')
        .update({
          status: 'published',
          published_at: new Date().toISOString(),
          external_post_id: result.externalPostId ?? null,
          failure_reason: null,
        })
        .eq('id', postId).select('*').single()
      if (error || !row) return { ok: false, error: error?.message ?? 'post_update_failed' }
      return { ok: true, value: row as SocialPostRecord }
    }

    const { data: row, error } = await db
      .from('social_posts')
      .update({ status: 'failed', failure_reason: result.error ?? 'unknown_publish_error' })
      .eq('id', postId).select('*').single()
    if (error || !row) return { ok: false, error: error?.message ?? 'post_update_failed' }
    return { ok: false, error: result.error ?? 'unknown_publish_error' }
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'unknown_publish_exception'
    await db.from('social_posts').update({ status: 'failed', failure_reason: reason }).eq('id', postId)
    return { ok: false, error: reason }
  }
}

/**
 * Cron entry point. Publishes every 'scheduled' post whose scheduled_at has
 * passed, oldest first, up to `limit`. One row's failure never blocks the
 * rest of the batch — mirrors processCampaignQueue()'s per-item isolation.
 */
export async function processDueScheduledPosts(limit = 20): Promise<{ attempted: number; published: number; failed: number }> {
  const db = getSupabaseAdmin()
  const { data: due, error } = await db
    .from('social_posts')
    .select('id')
    .eq('status', 'scheduled')
    .lte('scheduled_at', new Date().toISOString())
    .order('scheduled_at', { ascending: true })
    .limit(limit)

  if (error) {
    logger.error('social/publish-service', 'processDueScheduledPosts fetch failed', error)
    return { attempted: 0, published: 0, failed: 0 }
  }

  const rows = (due ?? []) as Array<{ id: string }>
  let published = 0
  let failed = 0

  for (const row of rows) {
    const result = await publishSocialPost(row.id)
    if (result.ok) published++
    else failed++
  }

  return { attempted: rows.length, published, failed }
}
