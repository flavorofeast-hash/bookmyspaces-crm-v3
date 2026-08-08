// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/social/post-service.ts
// Step 2.2 — social_posts backend (list + create only).
//
// Deliberately scoped: no publishing (adapter.publishPost is NOT called
// here), no AI captioning, no cron. Posts are created as 'draft', or as
// 'scheduled' when a future scheduled_at is supplied — a later step adds
// the scheduler that moves scheduled → publishing → published/failed.
//
// Same conventions as interaction-service.ts / catalog-service.ts:
// service-role client (route layer enforces auth), column allow-list via
// explicit field mapping, Result-shaped returns, no throws for expected
// failures.
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabaseAdmin } from '@/lib/supabase'
import type { SocialPlatform } from '@/lib/social/types'

// Sprint 1 (Social Publishing) added 'failed_permanent' (migration 039,
// CHECK-widened) — a transient 'failed' status that exhausted
// MAX_PUBLISH_ATTEMPTS automatic retries in publish-service.ts. Still
// manually re-publishable by an explicit human action.
export type SocialPostStatus =
  | 'draft' | 'approved' | 'scheduled' | 'publishing' | 'published' | 'failed' | 'failed_permanent'

export interface SocialPostRecord {
  id: string
  created_at: string
  updated_at: string
  account_id: string | null
  platform: string
  post_type: string
  content: string | null
  media: { url: string; type: string; alt?: string }[]
  hashtags: string[]
  status: SocialPostStatus
  scheduled_at: string | null
  published_at: string | null
  external_post_id: string | null
  failure_reason: string | null
  created_by: string | null
  // Growth Engine Epic 5 — publish attempt counter (migration 036).
  publish_attempts: number
  // Sprint 1 (Social Publishing) — backoff-scheduled automatic retry time
  // for a transient failure (migration 039); null once published or once
  // permanently failed.
  next_retry_at: string | null
  // Content Operations Priority 5 — approval hard gate (migration 041).
  // Set only for a 'scheduled' post that a human explicitly approved
  // without pulling it out of the cron pipeline (status stays 'scheduled'
  // so processDueScheduledPosts() still fires it at scheduled_at — see
  // publish-service.ts's gate and the PATCH .../posts 'approve' action).
  // Not used for 'draft'->'approved' transitions, which still just flip
  // status the same way they always have.
  approved_at: string | null
  // Business Package Engine (migration 043) — optional attribution link, so
  // a post drafted from a package's AI Prompt/hashtags can be rolled up by
  // package. Null for every post created before this, and for any post not
  // created from a package.
  business_package_id: string | null
  // End-to-End Campaign Attribution (migration 045) — optional link to the
  // outbound broadcast_campaigns row this post promotes. Null for posts not
  // tied to a tracked campaign.
  campaign_id: string | null
}

type Result<T> = { ok: true; value: T } | { ok: false; error: string }

export interface ListPostsFilters {
  status?: SocialPostStatus
  platform?: SocialPlatform
  limit?: number
  offset?: number
}

export async function listSocialPosts(
  filters: ListPostsFilters = {}
): Promise<Result<{ posts: SocialPostRecord[]; total: number | null }>> {
  const supabase = getSupabaseAdmin()
  const limit = Math.min(filters.limit ?? 50, 100)
  const offset = Math.max(filters.offset ?? 0, 0)

  let query = supabase
    .from('social_posts')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (filters.status) query = query.eq('status', filters.status)
  if (filters.platform) query = query.eq('platform', filters.platform)

  const { data, error, count } = await query
  if (error) return { ok: false, error: error.message }
  return { ok: true, value: { posts: (data ?? []) as SocialPostRecord[], total: count } }
}

export interface CreatePostInput {
  platform: SocialPlatform
  post_type: 'text' | 'image' | 'carousel' | 'video' | 'reel' | 'story'
  content?: string | null
  media?: { url: string; type: string; alt?: string }[]
  hashtags?: string[]
  account_id?: string | null
  /** Present + future ⇒ the post is created as 'scheduled'; absent ⇒ 'draft'. */
  scheduled_at?: string | null
  created_by: string
  business_package_id?: string | null
  campaign_id?: string | null
}

export async function createSocialPost(
  input: CreatePostInput
): Promise<Result<SocialPostRecord>> {
  const supabase = getSupabaseAdmin()

  // Status is DERIVED, never caller-supplied: this API only mints drafts
  // and scheduled posts. 'publishing'/'published'/'failed' are owned by the
  // (future) scheduler; 'approved' by a future approval action.
  const status: SocialPostStatus = input.scheduled_at ? 'scheduled' : 'draft'

  const { data, error } = await supabase
    .from('social_posts')
    .insert({
      platform: input.platform,
      post_type: input.post_type,
      content: input.content ?? null,
      media: input.media ?? [],
      hashtags: input.hashtags ?? [],
      account_id: input.account_id ?? null,
      status,
      scheduled_at: input.scheduled_at ?? null,
      created_by: input.created_by,
      business_package_id: input.business_package_id ?? null,
      campaign_id: input.campaign_id ?? null,
    })
    .select('*')
    .single()

  if (error || !data) return { ok: false, error: error?.message ?? 'insert returned no row' }
  return { ok: true, value: data as SocialPostRecord }
}
