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

export type SocialPostStatus =
  | 'draft' | 'approved' | 'scheduled' | 'publishing' | 'published' | 'failed'

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
    })
    .select('*')
    .single()

  if (error || !data) return { ok: false, error: error?.message ?? 'insert returned no row' }
  return { ok: true, value: data as SocialPostRecord }
}
