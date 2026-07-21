// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/app/api/social/interactions/[id]/route.ts
// V3 Phase 5 — act on one social interaction.
//
// PATCH { status } | { reply_draft } — triage/drafting (no platform call).
// POST /reply body { message } is NOT here — replying goes through this
// same route with { action: 'reply', message } and dispatches via the
// platform adapter when configured; unconfigured platforms save the reply
// as a draft and report cleanly, so operators can work today and the send
// happens once credentials exist.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { logger } from '@/lib/logger'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth-guard'
import { parseBody } from '@/lib/validation'
import { getSocialAdapter } from '@/lib/social/adapter-registry'

const idSchema = z.string().uuid()
const patchSchema = z.object({
  status: z.enum(['new', 'replied', 'escalated', 'archived']).optional(),
  reply_draft: z.string().trim().max(4000).optional(),
  action: z.literal('reply').optional(),
  message: z.string().trim().min(1).max(4000).optional(),
}).strict().refine(
  (v) => v.status !== undefined || v.reply_draft !== undefined || v.action === 'reply',
  { message: 'Provide status, reply_draft, or action:reply with message' }
).refine(
  (v) => v.action !== 'reply' || !!v.message,
  { message: 'action:reply requires message' }
)

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  if (!idSchema.safeParse(params.id).success) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 404 })
  }

  const parsed = await parseBody(req, patchSchema)
  if (!parsed.ok) return parsed.response
  const supabase = getSupabaseAdmin()

  try {
    if (parsed.data.action === 'reply' && parsed.data.message) {
      const { data: interaction } = await supabase
        .from('social_interactions')
        .select('id, platform, external_id')
        .eq('id', params.id)
        .maybeSingle()
      if (!interaction) return NextResponse.json({ error: 'Not found' }, { status: 404 })

      const adapter = getSocialAdapter(interaction.platform)
      const send = adapter && interaction.external_id
        ? await adapter.replyToInteraction(interaction.external_id, parsed.data.message)
        : { ok: false as const, error: `no adapter for ${interaction.platform}` }

      const { data: updated, error } = await supabase
        .from('social_interactions')
        .update(
          send.ok
            ? { status: 'replied', reply_draft: parsed.data.message, replied_at: new Date().toISOString() }
            : { reply_draft: parsed.data.message } // saved as draft; send later when configured
        )
        .eq('id', params.id)
        .select('*')
        .single()
      if (error) throw error

      return NextResponse.json({
        interaction: updated,
        sent: send.ok,
        detail: send.ok ? null : send.error ?? 'saved as draft',
      })
    }

    const values: Record<string, unknown> = {}
    if (parsed.data.status) values.status = parsed.data.status
    if (parsed.data.reply_draft !== undefined) values.reply_draft = parsed.data.reply_draft

    const { data, error } = await supabase
      .from('social_interactions')
      .update(values)
      .eq('id', params.id)
      .select('*')
      .single()
    if (error || !data) throw error ?? new Error('no row')
    return NextResponse.json({ interaction: data })
  } catch (err) {
    logger.error('social', `PATCH /api/social/interactions/${params.id} failed`, err)
    return NextResponse.json({ error: 'Failed to update interaction' }, { status: 500 })
  }
}
