// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/app/api/social/posts/route.ts
// Step 2.2 — social_posts backend API (list + create ONLY).
//
// GET  /api/social/posts?status=&platform=&limit=&offset=
// POST /api/social/posts  → creates a 'draft', or a 'scheduled' post when a
//                           future ISO scheduled_at is supplied
//
// Explicit non-scope (later steps): no publishing, no adapter calls, no AI
// captioning, no cron, no status transitions past draft/scheduled.
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
