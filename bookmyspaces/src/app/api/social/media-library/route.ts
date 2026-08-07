// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/app/api/social/media-library/route.ts
// Growth Platform Phase 4 — Media Library. CRUD for `media_library`
// (migration 032). Same requireAuth() + getSupabaseAdmin() pattern as
// /api/marketing/segments and /api/marketing/templates.
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
    const tag = req.nextUrl.searchParams.get('tag')
    let query = db.from('media_library').select('*').order('created_at', { ascending: false })
    if (tag) query = query.contains('tags', [tag])

    const { data, error } = await query
    if (error) throw error
    return NextResponse.json({ media: data ?? [] })
  } catch (err) {
    logger.error('media-library', 'GET failed', err)
    return NextResponse.json({ error: 'Failed to fetch media library' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  const db = getSupabaseAdmin()
  try {
    const body = await req.json()
    const { url, media_type, label, tags } = body as { url?: string; media_type?: string; label?: string; tags?: string[] }

    if (!url || typeof url !== 'string' || !url.trim()) {
      return NextResponse.json({ error: 'url is required' }, { status: 400 })
    }

    const { data, error } = await db
      .from('media_library')
      .insert({
        url: url.trim(),
        media_type: media_type === 'video' ? 'video' : 'image',
        label: label || null,
        tags: Array.isArray(tags) ? tags.filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim()) : [],
      })
      .select('*')
      .single()
    if (error) throw error

    return NextResponse.json({ media: data }, { status: 201 })
  } catch (err) {
    logger.error('media-library', 'POST failed', err)
    return NextResponse.json({ error: 'Failed to save media' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  const db = getSupabaseAdmin()
  try {
    const body = await req.json()
    const { id, action, ...updates } = body
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

    if (action === 'mark_used') {
      const { data: item } = await db.from('media_library').select('use_count').eq('id', id).single()
      const { data, error } = await db
        .from('media_library')
        .update({ last_used_at: new Date().toISOString(), use_count: (item?.use_count ?? 0) + 1 })
        .eq('id', id)
        .select('*')
        .single()
      if (error) throw error
      return NextResponse.json({ media: data })
    }

    const { data, error } = await db
      .from('media_library')
      .update(updates)
      .eq('id', id)
      .select('*')
      .single()
    if (error) throw error
    return NextResponse.json({ media: data })
  } catch (err) {
    logger.error('media-library', 'PATCH failed', err)
    return NextResponse.json({ error: 'Failed to update media' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  const db = getSupabaseAdmin()
  try {
    const id = req.nextUrl.searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

    const { error } = await db.from('media_library').delete().eq('id', id)
    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (err) {
    logger.error('media-library', 'DELETE failed', err)
    return NextResponse.json({ error: 'Failed to delete media' }, { status: 500 })
  }
}
