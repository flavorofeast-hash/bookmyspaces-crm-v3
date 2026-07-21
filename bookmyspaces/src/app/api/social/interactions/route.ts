// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/app/api/social/interactions/route.ts
// V3 Phase 5 — Unified Social Inbox list.
// GET ?status=&platform=&limit=&offset=
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth-guard'

export async function GET(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response

  try {
    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status')
    const platform = searchParams.get('platform')
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10) || 50, 100)
    const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10) || 0, 0)

    let query = getSupabaseAdmin()
      .from('social_interactions')
      .select('*, leads(name, phone)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (status && ['new', 'replied', 'escalated', 'archived'].includes(status)) query = query.eq('status', status)
    if (platform) query = query.eq('platform', platform)

    const { data, error, count } = await query
    if (error) throw error
    return NextResponse.json({ interactions: data ?? [], total: count })
  } catch (err) {
    logger.error('social', 'GET /api/social/interactions failed', err)
    return NextResponse.json({ error: 'Failed to load social inbox' }, { status: 500 })
  }
}
