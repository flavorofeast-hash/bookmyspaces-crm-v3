// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/app/api/marketing/templates/route.ts
// Growth Platform Phase 3 — Message Templates (WhatsApp + Email). CRUD for
// `message_templates` (migration 031). Same requireAuth() + getSupabaseAdmin()
// pattern as every other route in this codebase (see /api/marketing/
// segments/route.ts, /api/campaigns/route.ts).
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
    const channel = req.nextUrl.searchParams.get('channel')
    let query = db.from('message_templates').select('*').order('created_at', { ascending: false })
    if (channel === 'whatsapp' || channel === 'email') query = query.eq('channel', channel)

    const { data, error } = await query
    if (error) throw error
    return NextResponse.json({ templates: data ?? [] })
  } catch (err) {
    logger.error('marketing/templates', 'GET failed', err)
    return NextResponse.json({ error: 'Failed to fetch templates' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  const db = getSupabaseAdmin()
  try {
    const body = await req.json()
    const { name, channel, category, subject, body: templateBody } = body as {
      name?: string; channel?: string; category?: string; subject?: string; body?: string
    }

    if (!name || typeof name !== 'string' || !name.trim()) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 })
    }
    if (!templateBody || typeof templateBody !== 'string' || !templateBody.trim()) {
      return NextResponse.json({ error: 'body is required' }, { status: 400 })
    }
    const resolvedChannel = channel === 'email' ? 'email' : 'whatsapp'

    const { data, error } = await db
      .from('message_templates')
      .insert({
        name: name.trim(),
        channel: resolvedChannel,
        category: category || null,
        subject: resolvedChannel === 'email' ? (subject || null) : null,
        body: templateBody.trim(),
      })
      .select('*')
      .single()
    if (error) throw error

    return NextResponse.json({ template: data }, { status: 201 })
  } catch (err) {
    logger.error('marketing/templates', 'POST failed', err)
    return NextResponse.json({ error: 'Failed to save template' }, { status: 500 })
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

    // Best-effort usage tracking, mirroring marketing_segments' use_count —
    // fired by the Campaigns UI when an operator loads a template into a
    // new campaign.
    if (action === 'mark_used') {
      const { data: tpl } = await db.from('message_templates').select('use_count').eq('id', id).single()
      const { data, error } = await db
        .from('message_templates')
        .update({ last_used_at: new Date().toISOString(), use_count: (tpl?.use_count ?? 0) + 1 })
        .eq('id', id)
        .select('*')
        .single()
      if (error) throw error
      return NextResponse.json({ template: data })
    }

    const { data, error } = await db
      .from('message_templates')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .single()
    if (error) throw error
    return NextResponse.json({ template: data })
  } catch (err) {
    logger.error('marketing/templates', 'PATCH failed', err)
    return NextResponse.json({ error: 'Failed to update template' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  const db = getSupabaseAdmin()
  try {
    const id = req.nextUrl.searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

    const { error } = await db.from('message_templates').delete().eq('id', id)
    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (err) {
    logger.error('marketing/templates', 'DELETE failed', err)
    return NextResponse.json({ error: 'Failed to delete template' }, { status: 500 })
  }
}
