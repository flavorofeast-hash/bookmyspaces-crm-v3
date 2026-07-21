// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/app/api/inbox/route.ts
// V3 Phase 3 — Unified Inbox: one conversation list across every channel.
//
// GET /api/inbox?status=open|closed|escalated&limit=&offset=
// Returns unified_conversations with linked customer (leads), channel types
// and a last-message preview. This is the read model the Unified Inbox UI
// renders; WhatsApp and website chat both mirror here (Phase 3), so this
// list is cross-channel by construction.
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
  const supabase = getSupabaseAdmin()

  try {
    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status')
    const limit = Math.min(parseInt(searchParams.get('limit') || '30', 10) || 30, 100)
    const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10) || 0, 0)

    let query = supabase
      .from('unified_conversations')
      .select('id, created_at, status, ai_active, last_message_at, customer_id, leads(name, phone, email, status)', { count: 'exact' })
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .range(offset, offset + limit - 1)

    if (status && ['open', 'closed', 'escalated'].includes(status)) {
      query = query.eq('status', status)
    }

    const { data: conversations, error, count } = await query
    if (error) throw error

    const ids = (conversations ?? []).map((c) => c.id)

    // channel types per conversation
    const { data: links } = ids.length
      ? await supabase
          .from('unified_conversation_channels')
          .select('conversation_id, channel_identity, channels(channel_type)')
          .in('conversation_id', ids)
      : { data: [] }

    // last message preview per conversation (one query, reduce in JS)
    const { data: recent } = ids.length
      ? await supabase
          .from('unified_messages')
          .select('conversation_id, content, direction, sender_type, created_at')
          .in('conversation_id', ids)
          .order('created_at', { ascending: false })
          .limit(ids.length * 4)
      : { data: [] }

    const lastByConv = new Map<string, unknown>()
    for (const m of recent ?? []) {
      if (!lastByConv.has(m.conversation_id)) lastByConv.set(m.conversation_id, m)
    }

    const channelsByConv = new Map<string, { channelType: string; identity: string }[]>()
    for (const l of links ?? []) {
      const c = Array.isArray(l.channels) ? l.channels[0] : l.channels
      const arr = channelsByConv.get(l.conversation_id) ?? []
      arr.push({ channelType: c?.channel_type ?? 'unknown', identity: l.channel_identity })
      channelsByConv.set(l.conversation_id, arr)
    }

    const enriched = (conversations ?? []).map((c) => ({
      ...c,
      channels: channelsByConv.get(c.id) ?? [],
      lastMessage: lastByConv.get(c.id) ?? null,
    }))

    return NextResponse.json({ conversations: enriched, total: count })
  } catch (err) {
    logger.error('inbox', 'GET /api/inbox failed', err)
    return NextResponse.json({ error: 'Failed to load inbox' }, { status: 500 })
  }
}
