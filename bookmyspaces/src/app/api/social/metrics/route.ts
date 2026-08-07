// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/app/api/social/metrics/route.ts
// Phase 2 (Social Growth) — Engagement Analytics API.
//
// GET  /api/social/metrics?post_id=<uuid>   → single post's metrics row (or null)
// GET  /api/social/metrics?summary=1        → aggregate EngagementSummary
// POST /api/social/metrics  { postId, action: 'sync' }         → adapter sync
// POST /api/social/metrics  { postId, metrics: {...} }         → manual entry
//
// Same requireAuth() + explicit-action-vs-plain-body-shape convention as
// /api/social/posts PATCH.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { requireAuth } from '@/lib/auth-guard'
import {
  syncPostMetrics, upsertManualMetrics, getPostMetrics, getEngagementSummary,
} from '@/lib/social/metrics-service'
import type { PostMetrics } from '@/lib/social/types'

const NUMERIC_METRIC_KEYS = ['reach', 'impressions', 'clicks', 'likes', 'comments', 'shares', 'saves'] as const

function sanitizeMetrics(input: unknown): PostMetrics {
  const raw = (input ?? {}) as Record<string, unknown>
  const out: PostMetrics = {}
  for (const key of NUMERIC_METRIC_KEYS) {
    const v = raw[key]
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) out[key] = Math.round(v)
  }
  return out
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response

  try {
    const { searchParams } = new URL(req.url)
    const postId = searchParams.get('post_id')
    const summary = searchParams.get('summary')

    if (summary) {
      const result = await getEngagementSummary()
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 })
      return NextResponse.json({ summary: result.value })
    }

    if (!postId) return NextResponse.json({ error: 'post_id or summary=1 is required' }, { status: 400 })

    const result = await getPostMetrics(postId)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 })
    return NextResponse.json({ metrics: result.value })
  } catch (err) {
    logger.error('social-metrics', 'GET /api/social/metrics failed', err)
    return NextResponse.json({ error: 'Failed to fetch metrics' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response

  try {
    const body = await req.json()
    const { postId, action, metrics } = body as { postId?: string; action?: string; metrics?: unknown }
    if (!postId) return NextResponse.json({ error: 'postId is required' }, { status: 400 })

    if (action === 'sync') {
      const result = await syncPostMetrics(postId)
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: 422 })
      return NextResponse.json({ metrics: result.value })
    }

    const clean = sanitizeMetrics(metrics)
    if (Object.keys(clean).length === 0) {
      return NextResponse.json({ error: 'Provide action:"sync" or a metrics object with at least one numeric field' }, { status: 400 })
    }
    const result = await upsertManualMetrics(postId, clean)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 })
    return NextResponse.json({ metrics: result.value })
  } catch (err) {
    logger.error('social-metrics', 'POST /api/social/metrics failed', err)
    return NextResponse.json({ error: 'Failed to save metrics' }, { status: 500 })
  }
}
