// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/app/api/reviews/requests/route.ts
// Growth Engine Epic 1 — lists review_requests joined with the lead's name/
// phone (two bulk queries, in-memory join — same pattern used throughout
// this codebase rather than a Postgres join, since there's no generated
// Database type to build one against safely). Read-only; requests are
// created by /api/cron/stay-lifecycle and updated by /api/cron/review-
// reminders and /api/reviews (POST, on review-request auto-completion).
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
  const db = getSupabaseAdmin()
  try {
    const status = req.nextUrl.searchParams.get('status')
    let query = db.from('review_requests').select('*').order('requested_at', { ascending: false }).limit(200)
    if (status) query = query.eq('status', status)

    const { data: requests, error } = await query
    if (error) throw error

    const leadIds = Array.from(new Set((requests ?? []).map((r) => r.lead_id).filter((id): id is string => !!id)))
    const { data: leads } = leadIds.length > 0
      ? await db.from('leads').select('id, name, phone').in('id', leadIds)
      : { data: [] }
    const leadById = new Map((leads ?? []).map((l) => [l.id, l]))

    const enriched = (requests ?? []).map((r) => ({
      ...r,
      lead_name: r.lead_id ? leadById.get(r.lead_id)?.name ?? null : null,
      lead_phone: r.lead_id ? leadById.get(r.lead_id)?.phone ?? null : null,
    }))

    return NextResponse.json({ requests: enriched })
  } catch (err) {
    logger.error('reviews/requests', 'GET failed', err)
    return NextResponse.json({ error: 'Failed to fetch review requests' }, { status: 500 })
  }
}
