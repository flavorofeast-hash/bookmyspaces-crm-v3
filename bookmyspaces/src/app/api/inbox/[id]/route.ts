// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/app/api/inbox/[id]/route.ts
// V3 Phase 3 — one unified conversation: metadata + full message timeline.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { logger } from '@/lib/logger'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth-guard'

const idSchema = z.string().uuid()

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  if (!idSchema.safeParse(params.id).success) {
    return NextResponse.json({ error: 'Invalid conversation id' }, { status: 404 })
  }
  const supabase = getSupabaseAdmin()

  try {
    const { data: conversation, error } = await supabase
      .from('unified_conversations')
      .select('id, created_at, status, ai_active, last_message_at, customer_id, leads(id, name, phone, email, status, event_type, guest_count, budget)')
      .eq('id', params.id)
      .maybeSingle()
    if (error) throw error
    if (!conversation) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })

    const [{ data: messages }, { data: links }] = await Promise.all([
      supabase
        .from('unified_messages')
        .select('id, created_at, direction, sender_type, content, ai_confidence')
        .eq('conversation_id', params.id)
        .order('created_at', { ascending: true })
        .limit(500),
      supabase
        .from('unified_conversation_channels')
        .select('channel_identity, channels(channel_type)')
        .eq('conversation_id', params.id),
    ])

    const channels = (links ?? []).map((l) => {
      const c = Array.isArray(l.channels) ? l.channels[0] : l.channels
      return { channelType: c?.channel_type ?? 'unknown', identity: l.channel_identity }
    })

    return NextResponse.json({ conversation, messages: messages ?? [], channels })
  } catch (err) {
    logger.error('inbox', `GET /api/inbox/${params.id} failed`, err)
    return NextResponse.json({ error: 'Failed to load conversation' }, { status: 500 })
  }
}
