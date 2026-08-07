// ─────────────────────────────────────────────────────────────────────────────
// Social publish drain cron (Growth Engine Epic 5).
//
// Publishes every due 'scheduled' social_posts row via
// processDueScheduledPosts(). Same auth/runtime/idempotency conventions as
// /api/cron/campaign-queue: bearer CRON_SECRET check, bounded batch, safe to
// run repeatedly (a post already published/failed is not 'scheduled'
// anymore, so a re-run never double-publishes it).
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server'
import { processDueScheduledPosts } from '@/lib/social/publish-service'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const token = request.headers.get('authorization')?.replace('Bearer ', '').trim()
    if (token !== cronSecret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  try {
    const result = await processDueScheduledPosts(20)
    return NextResponse.json(result)
  } catch (err) {
    logger.error('cron', 'social-publish drain error', err)
    return NextResponse.json({ error: 'Social publish drain failed' }, { status: 500 })
  }
}
