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
import { parseBody, createSocialPostSchema } from '@/lib/validation'
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
    const { id, action, ...updates } = body as { id?: string; action?: string; [k: string]: unknown }
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
      const { data, error } = await db.from('social_posts').update({ status: 'approved' }).eq('id', id).select('*').single()
      if (error) throw error
      return NextResponse.json({ post: data })
    }

    // Plain field edits (content/media/hashtags/scheduled_at) — never
    // status, external_post_id, published_at, or publish_attempts, which
    // are only ever set by createSocialPost/publishSocialPost above.
    delete (updates as Record<string, unknown>).status
    delete (updates as Record<string, unknown>).external_post_id
    delete (updates as Record<string, unknown>).published_at
    delete (updates as Record<string, unknown>).publish_attempts
    delete (updates as Record<string, unknown>).failure_reason

    const { data, error } = await db
      .from('social_posts')
      .update(updates)
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
