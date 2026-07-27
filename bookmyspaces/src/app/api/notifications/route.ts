// src/app/api/notifications/route.ts
// GET  — fetch notifications for current user (unread by default)
// PATCH — mark notifications read/dismissed

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { getCurrentUser } from '@/lib/supabase-server'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const unreadOnly = searchParams.get('unread') !== 'false'
    const limit      = Math.min(parseInt(searchParams.get('limit') ?? '30'), 100)

    const db = getSupabaseAdmin()
    let query = db
      .from('notifications')
      .select('*')
      .eq('user_id', user.id)
      .is('dismissed_at', null)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (unreadOnly) query = query.eq('is_read', false)

    const { data, error } = await query

    if (error) {
      logger.error('notifications', 'GET failed', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Get unread count
    const { count } = await db
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('is_read', false)
      .is('dismissed_at', null)

    return NextResponse.json({
      notifications : data ?? [],
      unread_count  : count ?? 0,
    })

  } catch (err: unknown) {
    logger.error('notifications', 'GET unexpected error', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json() as {
      ids?    : string[]
      action  : 'mark_read' | 'mark_all_read' | 'dismiss'
    }

    const db  = getSupabaseAdmin()
    const now = new Date().toISOString()

    if (body.action === 'mark_all_read') {
      await db
        .from('notifications')
        .update({ is_read: true, read_at: now })
        .eq('user_id', user.id)
        .eq('is_read', false)

    } else if (body.ids?.length) {
      const update =
        body.action === 'dismiss'
          ? { dismissed_at: now }
          : { is_read: true, read_at: now }

      await db
        .from('notifications')
        .update(update)
        .eq('user_id', user.id)
        .in('id', body.ids)
    }

    return NextResponse.json({ success: true })

  } catch (err: unknown) {
    logger.error('notifications', 'PATCH unexpected error', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
