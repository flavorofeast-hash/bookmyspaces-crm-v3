// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/app/api/marketing/segments/route.ts
// Growth Platform Phase 1 — Saved Segments. CRUD for `marketing_segments`
// (migration 030). Segments are named, reusable SegmentFilter objects
// (src/lib/campaigns.ts) — this route never resolves them into a recipient
// list itself; `action: 'preview'` reuses buildSegment() unchanged (same
// function /api/campaigns's own 'preview' action calls) so segment sizing
// stays consistent with what a campaign built from it would actually send
// to. Same requireAuth() + getSupabaseAdmin() pattern as every other route
// in this codebase (see /api/campaigns/route.ts).
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth-guard'
import { buildSegment, type SegmentFilter } from '@/lib/campaigns'

export async function GET() {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  const db = getSupabaseAdmin()
  try {
    const { data, error } = await db
      .from('marketing_segments')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) throw error
    return NextResponse.json({ segments: data ?? [] })
  } catch (err) {
    logger.error('marketing/segments', 'GET failed', err)
    return NextResponse.json({ error: 'Failed to fetch segments' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  const db = getSupabaseAdmin()
  try {
    const body = await req.json()
    const { action, filter } = body as { action?: string; filter?: SegmentFilter }

    // Reused by the Campaigns UI to size a segment before saving it, or to
    // re-check a saved segment's current size — identical semantics to
    // POST /api/campaigns { action: 'preview' }.
    if (action === 'preview') {
      const recipients = await buildSegment(filter || {})
      return NextResponse.json({
        count: recipients.length,
        sample: recipients.slice(0, 5).map((r) => ({ name: r.name, phone: r.phone, status: r.status, score: r.ai_score })),
      })
    }

    const { name, description } = body as { name?: string; description?: string }
    if (!name || typeof name !== 'string' || !name.trim()) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 })
    }

    const { data, error } = await db
      .from('marketing_segments')
      .insert({ name: name.trim(), description: description || null, filter: filter || {} })
      .select('*')
      .single()
    if (error) throw error

    const recipients = await buildSegment((filter || {}) as SegmentFilter)
    return NextResponse.json({ segment: data, previewCount: recipients.length }, { status: 201 })
  } catch (err) {
    logger.error('marketing/segments', 'POST failed', err)
    return NextResponse.json({ error: 'Failed to save segment' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  const db = getSupabaseAdmin()
  try {
    const body = await req.json()
    const { id, ...updates } = body
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

    const { data, error } = await db
      .from('marketing_segments')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .single()
    if (error) throw error
    return NextResponse.json({ segment: data })
  } catch (err) {
    logger.error('marketing/segments', 'PATCH failed', err)
    return NextResponse.json({ error: 'Failed to update segment' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  const db = getSupabaseAdmin()
  try {
    const id = req.nextUrl.searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

    const { error } = await db.from('marketing_segments').delete().eq('id', id)
    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (err) {
    logger.error('marketing/segments', 'DELETE failed', err)
    return NextResponse.json({ error: 'Failed to delete segment' }, { status: 500 })
  }
}
