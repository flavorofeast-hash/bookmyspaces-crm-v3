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
// rows whose scheduled_at has passed, PLUS 'failed' rows whose backoff
// window (next_retry_at) has passed, and publishes each — bounded, one row
// failing never aborts the batch — same shape as processCampaignQueue().
//
// Sprint 1 (Social Publishing) additive extension — Retry/Failure handling:
// a transient publish failure (adapter call failed/threw) now schedules an
// automatic backoff retry (next_retry_at, migration 039) instead of sitting
// inert until a human notices. After MAX_PUBLISH_ATTEMPTS the post moves to
// 'failed_permanent' (migration 039 CHECK widen) so the cron stops
// auto-retrying a post that structurally cannot succeed — a human can still
// force a manual retry via the existing PATCH .../posts action:'publish'
// (kept in PUBLISHABLE_STATUSES). Failures that are NOT transient (no
// adapter registered, adapter not configured) do not get a next_retry_at —
// waiting cannot fix a missing credential, so cron will not spin on those;
// they wait for a human (configure the adapter, or explicit manual retry).
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
import { getPublishConfig } from '@/lib/social/publish-config'
import { markAccountUnhealthy, resolvePublishCredentials } from '@/lib/social/oauth/refresh-service'
import { writeNotificationToAudience } from '@/lib/chief-of-staff/notification-producer'
import type { SocialPostRecord, SocialPostStatus } from '@/lib/social/post-service'
import type { PublishInput, PublishCredentials } from '@/lib/social/types'

type Result<T> = { ok: true; value: T } | { ok: false; error: string }

// Every status a publish attempt may legally start from. 'publishing' is
// deliberately excluded — a post already mid-publish should not be
// re-triggered by a second concurrent call. 'failed_permanent' is included
// so a human can still force a manual override retry after exhausting
// automatic attempts — only the CRON path (processDueScheduledPosts) never
// selects it.
const PUBLISHABLE_STATUSES: SocialPostStatus[] = ['draft', 'approved', 'scheduled', 'failed', 'failed_permanent']

// Sprint 1 — max automatic attempts before a transient failure becomes
// permanent (no further auto-retry). Backoff minutes indexed by
// (attempts - 1); the last entry repeats for any attempt beyond the array.
const MAX_PUBLISH_ATTEMPTS = 5
const RETRY_BACKOFF_MINUTES = [5, 15, 60, 240, 1440]

function computeNextRetryAt(attempts: number): string {
  const idx = Math.min(attempts - 1, RETRY_BACKOFF_MINUTES.length - 1)
  return new Date(Date.now() + RETRY_BACKOFF_MINUTES[idx] * 60_000).toISOString()
}

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

  // Content Operations Priority 5 — approval hard gate, opt-in via
  // publish-config.ts (default off, preserves today's behavior). Covers
  // BOTH a direct publish of a never-reviewed 'draft' AND a 'scheduled'
  // post that was never explicitly approved (migration 041's
  // social_posts.approved_at) — a scheduled post is exactly as unreviewed
  // as a draft until a human signs off on it; gating only 'draft' would
  // have let the approval requirement be bypassed trivially by picking a
  // future date instead of clicking Publish. 'failed'/'failed_permanent'/
  // 'approved' are unaffected — those have either already cleared the gate
  // once (approved) or are a manual-override retry a human is explicitly
  // re-triggering. A pure, side-effect-free rejection: no attempt consumed,
  // no status mutated, so it's retriable the instant the post is approved.
  if (post.status === 'draft' || (post.status === 'scheduled' && !post.approved_at)) {
    const { requireApproval } = await getPublishConfig()
    if (requireApproval) {
      return { ok: false, error: 'approval_required' }
    }
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
  //
  // Concurrency guard (TOCTOU fix): the earlier SELECT + PUBLISHABLE_STATUSES
  // check is not itself atomic — without this, two overlapping calls (a
  // manual "Publish now" click racing the cron's processDueScheduledPosts,
  // or a double-click) could both read the same pre-publish status, both
  // pass the check, and both go on to call adapter.publishPost(), posting
  // the same content to the live platform twice. Making this specific
  // update CONDITIONAL on the status still matching what we just read turns
  // it into an atomic compare-and-swap claim: only the first caller to reach
  // this line wins the row (postgres row-level locking on the UPDATE makes
  // this safe even for truly simultaneous requests); the loser gets 0 rows
  // back and bails out cleanly instead of double-publishing.
  const { data: claimed, error: claimError } = await db
    .from('social_posts')
    .update({ status: 'publishing', publish_attempts: attempts })
    .eq('id', postId)
    .eq('status', post.status)
    .select('id')
    .maybeSingle()
  if (claimError) return { ok: false, error: claimError.message }
  if (!claimed) {
    return { ok: false, error: 'concurrent_publish_conflict: this post is already being published by another request' }
  }

  // Social OAuth -> Publishing credential fix: a post with a SELECTED
  // social_accounts row (post.account_id) resolves that account's own
  // decrypted token/page-id, never "the first connected account for this
  // platform" — resolvePublishCredentials() looks it up by id. A post with
  // no selected account (account_id null) falls back to the adapter's
  // static env-configured credentials exactly as before, preserving
  // backward compatibility for callers that never set account_id.
  let credentials: PublishCredentials | undefined
  if (post.account_id) {
    const resolved = await resolvePublishCredentials(post.account_id, post.platform)
    if (!resolved.ok) return failTransient(resolved.error)
    credentials = resolved.value
  }

  if (!credentials && !adapter.isConfigured()) {
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

  // Shared transient-failure handler — same backoff/permanent/health/
  // notification behavior used for BOTH a failed credential resolution and
  // an adapter.publishPost() ok:false result, so there is exactly one place
  // that logic lives.
  async function failTransient(failureReason: string): Promise<Result<SocialPostRecord>> {
    const permanent = attempts >= MAX_PUBLISH_ATTEMPTS
    const { data: row, error } = await db
      .from('social_posts')
      .update({
        status: permanent ? 'failed_permanent' : 'failed',
        failure_reason: failureReason,
        next_retry_at: permanent ? null : computeNextRetryAt(attempts),
      })
      .eq('id', postId).select('*').single()
    await reportPublishFailure(post, failureReason, permanent)
    if (error || !row) return { ok: false, error: error?.message ?? 'post_update_failed' }
    return { ok: false, error: failureReason }
  }

  try {
    const result = await adapter.publishPost(input, credentials)

    if (result.ok) {
      const { data: row, error } = await db
        .from('social_posts')
        .update({
          status: 'published',
          published_at: new Date().toISOString(),
          external_post_id: result.externalPostId ?? null,
          failure_reason: null,
          next_retry_at: null,
        })
        .eq('id', postId).select('*').single()
      if (error || !row) return { ok: false, error: error?.message ?? 'post_update_failed' }
      return { ok: true, value: row as SocialPostRecord }
    }

    // Transient failure (adapter call returned ok:false, e.g. a platform API
    // error) — schedule an automatic backoff retry unless attempts are
    // exhausted, in which case it becomes permanent (no more auto-retry).
    return await failTransient(result.error ?? 'unknown_publish_error')
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'unknown_publish_exception'
    const permanent = attempts >= MAX_PUBLISH_ATTEMPTS
    await db
      .from('social_posts')
      .update({
        status: permanent ? 'failed_permanent' : 'failed',
        failure_reason: reason,
        next_retry_at: permanent ? null : computeNextRetryAt(attempts),
      })
      .eq('id', postId)
    await reportPublishFailure(post, reason, permanent)
    return { ok: false, error: reason }
  }
}

/**
 * Social Connectivity Priority 1 (connection health) + Social Operations
 * Priority 4 (publish failure alerts) — one shared helper called from both
 * failure branches above so neither behavior can be added to one branch and
 * forgotten in the other. Reuses markAccountUnhealthy() (only flips
 * social_accounts.status when the error looks auth-shaped — a transient
 * rate-limit/network failure never hides a healthy connection) and
 * writeNotificationToAudience() (same admin/manager audience + spam-cap
 * logic already used by the AI Chief of Staff notifier) rather than any new
 * alerting path. Never throws — a notification/health-flag side effect must
 * never fail the publish call itself.
 */
async function reportPublishFailure(post: SocialPostRecord, reason: string, permanent: boolean): Promise<void> {
  try {
    if (post.account_id) {
      await markAccountUnhealthy(post.account_id, reason)
    }
    if (permanent) {
      await writeNotificationToAudience([
        {
          title: `Post failed permanently: ${post.platform}`,
          message: `"${(post.content ?? '').slice(0, 80)}" could not be published after ${MAX_PUBLISH_ATTEMPTS} attempts. Reason: ${reason}. Review in Content Studio.`,
          priority: 'high',
        },
      ])
    }
  } catch (err) {
    logger.error('social/publish-service', 'reportPublishFailure side effect failed', err)
  }
}

/**
 * Cron entry point. Publishes every 'scheduled' post whose scheduled_at has
 * passed, oldest first, up to `limit`. One row's failure never blocks the
 * rest of the batch — mirrors processCampaignQueue()'s per-item isolation.
 */
export async function processDueScheduledPosts(limit = 20): Promise<{ attempted: number; published: number; failed: number; retried: number }> {
  const db = getSupabaseAdmin()
  const nowIso = new Date().toISOString()

  // Sprint 1 — a single query for both due 'scheduled' posts AND 'failed'
  // posts whose backoff window has elapsed (next_retry_at <= now). Combined
  // via .or()/and() rather than two separate queries so a shared `limit`
  // budget applies across both — a burst of retries can never starve new
  // scheduled posts out of a batch, or vice versa.
  const { data: due, error } = await db
    .from('social_posts')
    .select('id, status')
    .or(`and(status.eq.scheduled,scheduled_at.lte.${nowIso}),and(status.eq.failed,next_retry_at.lte.${nowIso})`)
    .order('scheduled_at', { ascending: true })
    .limit(limit)

  if (error) {
    logger.error('social/publish-service', 'processDueScheduledPosts fetch failed', error)
    return { attempted: 0, published: 0, failed: 0, retried: 0 }
  }

  const rows = (due ?? []) as Array<{ id: string; status: SocialPostStatus }>
  let published = 0
  let failed = 0
  let retried = 0

  for (const row of rows) {
    if (row.status === 'failed') retried++
    const result = await publishSocialPost(row.id)
    if (result.ok) published++
    else failed++
  }

  return { attempted: rows.length, published, failed, retried }
}
