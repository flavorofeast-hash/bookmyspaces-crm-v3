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
import { parseBody } from '@/lib/validation'
import { logJourneyEvent } from '@/lib/customers/journey'

const idSchema = z.string().uuid()
const assignSchema = z.object({
  assigned_to: z.string().trim().min(1).max(120).nullable(),
}).strict()

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

// Production Stabilization (Priority 5) — Inbox Conversation Assignment.
// Assigns/reassigns the CUSTOMER-facing lead behind this conversation, not
// a new "conversation owner" field — reuses leads.assigned_to (already
// read and displayed as `assignedOwner` by GET /api/inbox and this
// conversation's own GET above) rather than building a second assignment
// system. Pass assigned_to: null to unassign.
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  if (!idSchema.safeParse(params.id).success) {
    return NextResponse.json({ error: 'Invalid conversation id' }, { status: 404 })
  }

  const parsed = await parseBody(req, assignSchema)
  if (!parsed.ok) return parsed.response

  const supabase = getSupabaseAdmin()

  try {
    const { data: conversation, error: convError } = await supabase
      .from('unified_conversations')
      .select('id, customer_id')
      .eq('id', params.id)
      .maybeSingle()
    if (convError) throw convError
    if (!conversation) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    if (!conversation.customer_id) {
      return NextResponse.json({ error: 'This conversation has no linked lead to assign' }, { status: 400 })
    }

    const { data: lead, error: updateError } = await supabase
      .from('leads')
      .update({ assigned_to: parsed.data.assigned_to })
      .eq('id', conversation.customer_id)
      .select('id, assigned_to')
      .single()
    if (updateError || !lead) throw updateError ?? new Error('no lead updated')

    // Best-effort — same never-block-the-write contract as every other
    // logJourneyEvent() call site in this codebase. Reuses the existing
    // generic activity_logs rendering (timeline-service.ts), so the
    // assignment change shows up on the Customer Timeline with zero new UI.
    await logJourneyEvent(
      conversation.customer_id,
      'conversation_assigned',
      lead.assigned_to ? `Assigned to ${lead.assigned_to}` : 'Unassigned',
      { conversationId: params.id, assignedTo: lead.assigned_to, assignedBy: auth.user.email ?? auth.user.id }
    )

    return NextResponse.json({ lead })
  } catch (err) {
    logger.error('inbox', `PATCH /api/inbox/${params.id} failed`, err)
    return NextResponse.json({ error: 'Failed to update assignment' }, { status: 500 })
  }
}
