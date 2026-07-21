// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/app/api/inbox/[id]/ai/route.ts
// V3 Phase 3 — AI pause/resume + conversation status on one conversation.
//
// POST { ai_active: true|false } — hand a conversation back to the AI, or
// pause it (human takeover without sending a message yet).
// POST { status: 'open'|'closed'|'escalated' } — conversation lifecycle.
// Both may be sent together.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { logger } from '@/lib/logger'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth-guard'
import { parseBody } from '@/lib/validation'

const idSchema = z.string().uuid()
const bodySchema = z.object({
  ai_active: z.boolean().optional(),
  status: z.enum(['open', 'closed', 'escalated']).optional(),
}).strict().refine((v) => v.ai_active !== undefined || v.status !== undefined, {
  message: 'Provide ai_active and/or status',
})

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  if (!idSchema.safeParse(params.id).success) {
    return NextResponse.json({ error: 'Invalid conversation id' }, { status: 404 })
  }

  const parsed = await parseBody(req, bodySchema)
  if (!parsed.ok) return parsed.response

  try {
    const values: Record<string, unknown> = {}
    if (parsed.data.ai_active !== undefined) values.ai_active = parsed.data.ai_active
    if (parsed.data.status !== undefined) values.status = parsed.data.status

    const { data, error } = await getSupabaseAdmin()
      .from('unified_conversations')
      .update(values)
      .eq('id', params.id)
      .select('id, ai_active, status')
      .single()

    if (error || !data) throw error ?? new Error('no row updated')
    return NextResponse.json({ conversation: data })
  } catch (err) {
    logger.error('inbox', `POST /api/inbox/${params.id}/ai failed`, err)
    return NextResponse.json({ error: 'Failed to update conversation' }, { status: 500 })
  }
}
