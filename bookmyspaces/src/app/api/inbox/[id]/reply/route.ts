// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/app/api/inbox/[id]/reply/route.ts
// V3 Phase 3 — human reply from the Unified Inbox.
//
// Records the message in unified_messages and dispatches it on the
// conversation's most recent channel via the outbound dispatcher
// (WhatsApp sends for real; website chat is record-only until a push
// transport exists — the response says which happened).
//
// Replying as a human implicitly pauses the AI on this conversation
// (ai_active=false): once an operator steps in, the AI must not talk over
// them. They can hand back explicitly via POST /api/inbox/[id]/ai.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { logger } from '@/lib/logger'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth-guard'
import { parseBody } from '@/lib/validation'
import { dispatchOutbound } from '@/lib/conversations/outbound-dispatcher'

const idSchema = z.string().uuid()
const replySchema = z.object({
  content: z.string().trim().min(1).max(4000),
}).strict()

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  if (!idSchema.safeParse(params.id).success) {
    return NextResponse.json({ error: 'Invalid conversation id' }, { status: 404 })
  }

  const parsed = await parseBody(req, replySchema)
  if (!parsed.ok) return parsed.response

  try {
    const result = await dispatchOutbound({
      conversationId: params.id,
      content: parsed.data.content,
      senderType: 'human',
    })

    if (!result.ok) {
      logger.error('inbox', `reply dispatch failed for ${params.id}`, result.detail)
      return NextResponse.json({ error: result.detail ?? 'Failed to send reply' }, { status: 500 })
    }

    // Human has taken over — pause AI on this conversation.
    await getSupabaseAdmin()
      .from('unified_conversations')
      .update({ ai_active: false })
      .eq('id', params.id)

    return NextResponse.json({
      messageId: result.messageId,
      delivered: result.delivered,
      channelType: result.channelType,
      detail: result.detail ?? null,
    })
  } catch (err) {
    logger.error('inbox', `POST /api/inbox/${params.id}/reply failed`, err)
    return NextResponse.json({ error: 'Failed to send reply' }, { status: 500 })
  }
}
