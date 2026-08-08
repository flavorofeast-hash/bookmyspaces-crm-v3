// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/app/api/social/posts/route.ts
// Step 2.2 — social_posts backend API (list + create ONLY).
//
// GET   /api/social/posts?status=&platform=&limit=&offset=
// POST  /api/social/posts  → creates a 'draft', or a 'scheduled' post when a
//                            future ISO scheduled_at is supplied
// PATCH /api/social/posts  → { id, action: 'approve' | 'publish' } for status
//                            transitions (Growth Engine Epic 5, see below),
//                            or { id, ...fields } for plain content edits.
//
// Auth: requireAuth (staff-facing, same standard as /api/social/interactions).
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { requireAuth } from '@/lib/auth-guard'
import { parseBody, createSocialPostSchema, updateSocialPostSchema } from '@/lib/validation'
import {
  listSocialPosts,
  createSocialPost,
  type SocialPostStatus,
} from '@/lib/social/post-service'
import type { SocialPlatform } from '@/lib/social/types'
import { isSocialPlatform } from '@/lib/social/adapter-registry'
import { getSupabaseAdmin } from '@/lib/supabase'
import { publishSocialPost } from '@/lib/social/publish-service'

const POST_STATUSES: SocialPostStatus[] = ['draft', 'approved', 'scheduled', 'publishing', 'published', 'failed']

export async function GET(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response

  try {
    const { searchParams } = new URL(req.url)
    const statusParam = searchParams.get('status')
    const platformParam = searchParams.get('platform')

    const result = await listSocialPosts({
      status: statusParam && (POST_STATUSES as string[]).includes(statusParam)
        ? (statusParam as SocialPostStatus)
        : undefined,
      platform: platformParam && isSocialPlatform(platformParam)
        ? (platformParam as SocialPlatform)
        : undefined,
      limit: parseInt(searchParams.get('limit') || '50', 10) || 50,
      offset: parseInt(searchParams.get('offset') || '0', 10) || 0,
    })

    if (!result.ok) {
      logger.error('social-posts', 'GET list failed', result.error)
      return NextResponse.json({ error: 'Failed to list posts' }, { status: 500 })
    }
    return NextResponse.json({ posts: result.value.posts, total: result.value.total })
  } catch (err) {
    logger.error('social-posts', 'GET /api/social/posts failed', err)
    return NextResponse.json({ error: 'Failed to list posts' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response

  const parsed = await parseBody(req, createSocialPostSchema)
  if (!parsed.ok) return parsed.response

  try {
    const result = await createSocialPost({
      platform: parsed.data.platform,
      post_type: parsed.data.post_type,
      content: parsed.data.content ?? null,
      media: parsed.data.media,
      hashtags: parsed.data.hashtags,
      account_id: parsed.data.account_id ?? null,
      scheduled_at: parsed.data.scheduled_at ?? null,
      created_by: auth.user.email ?? auth.user.id,
      business_package_id: parsed.data.business_package_id ?? null,
      campaign_id: parsed.data.campaign_id ?? null,
    })

    if (!result.ok) {
      logger.error('social-posts', 'POST create failed', result.error)
      return NextResponse.json({ error: result.error }, { status: 500 })
    }
    return NextResponse.json({ post: result.value }, { status: 201 })
  } catch (err) {
    logger.error('social-posts', 'POST /api/social/posts failed', err)
    return NextResponse.json({ error: 'Failed to create post' }, { status: 500 })
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Growth Engine Epic 5 — Social Publishing completion.
//
// action: 'approve'  → draft/scheduled -> approved (human sign-off before a
//                       scheduled_at fires, or before a manual publish).
// action: 'publish'  → drives the post through publish-service.ts. Works
//                       from draft/approved/scheduled AND from 'failed' —
//                       there is no separate retry action, calling publish
//                       again on a failed post IS the retry.
// Same { id, action, ...updates } body shape as /api/marketing/templates
// PATCH (mark_used) and /api/referrals PATCH.
// ─────────────────────────────────────────────────────────────────────────────
export async function PATCH(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  const db = getSupabaseAdmin()

  try {
    const body = await req.json()
    const { id, action } = body as { id?: string; action?: string }
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

    if (action === 'publish') {
      const result = await publishSocialPost(id)
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: 422 })
      return NextResponse.json({ post: result.value })
    }

    if (action === 'approve') {
      const { data: post, error: fetchError } = await db.from('social_posts').select('status').eq('id', id).maybeSingle()
      if (fetchError) throw fetchError
      if (!post) return NextResponse.json({ error: 'post_not_found' }, { status: 404 })
      if (post.status !== 'draft' && post.status !== 'scheduled') {
        return NextResponse.json({ error: `cannot_approve_from_status_${post.status}` }, { status: 422 })
      }
      // migration 041 — a 'scheduled' post is approved by stamping
      // approved_at, NOT by changing status. Changing status to 'approved'
      // would pull it out of processDueScheduledPosts()'s status='scheduled'
      // selection and it would never auto-publish at its scheduled_at again.
      // A 'draft' post has no scheduled_at to preserve, so it still just
      // transitions status directly, unchanged from before.
      const updates = post.status === 'scheduled' ? { approved_at: new Date().toISOString() } : { status: 'approved' }
      const { data, error } = await db.from('social_posts').update(updates).eq('id', id).select('*').single()
      if (error) throw error
      return NextResponse.json({ post: data })
    }

    // Plain field edits — explicit ALLOW-list (updateSocialPostSchema:
    // content/media/hashtags/scheduled_at/account_id only), not a deny-list.
    // The previous deny-list stripped status/external_post_id/published_at/
    // publish_attempts/failure_reason but NOT approved_at, account_id, or
    // platform — a caller could PATCH {id, approved_at: <any date>} and
    // completely bypass the publish-approval gate (migration 041) without
    // ever going through the action:'approve' checks above, and could
    // overwrite content/media/hashtags past createSocialPostSchema's own
    // size caps. The body was already consumed by req.json() above, so this
    // validates the already-parsed object directly rather than re-reading
    // the request stream (parseBody() would fail — a Request body can only
    // be read once).
    const parsed = updateSocialPostSchema.safeParse(body)
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
      return NextResponse.json({ error: 'Invalid request body', issues }, { status: 400 })
    }
    if (Object.keys(parsed.data).length === 0) {
      return NextResponse.json({ error: 'No updatable fields provided' }, { status: 400 })
    }

    const { data, error } = await db
      .from('social_posts')
      .update(parsed.data)
      .eq('id', id)
      .select('*')
      .single()
    if (error) throw error
    return NextResponse.json({ post: data })
  } catch (err) {
    logger.error('social-posts', 'PATCH failed', err)
    return NextResponse.json({ error: 'Failed to update post' }, { status: 500 })
  }
}
