// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/app/api/whatsapp/drip-sequences/route.ts
// Phase 2 (Social + WhatsApp Growth) — Drip Sequences CRUD (create/list).
// GET   /api/whatsapp/drip-sequences        → sequences + their steps
// POST  /api/whatsapp/drip-sequences        → create a sequence with steps
// Same requireAuth() pattern as /api/social/posts. Enrollment is a
// separate endpoint: /api/whatsapp/drip-sequences/enroll.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { requireAuth } from '@/lib/auth-guard'
import { listSequences, createSequence } from '@/lib/whatsapp/drip-service'

export async function GET() {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response

  const result = await listSequences()
  if (!result.ok) {
    logger.error('drip-sequences', 'GET failed', result.error)
    return NextResponse.json({ error: result.error }, { status: 500 })
  }
  return NextResponse.json({ sequences: result.value })
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response

  try {
    const body = await req.json()
    const { name, description, trigger_event, steps } = body as {
      name?: string; description?: string; trigger_event?: string
      steps?: { delay_days?: number; channel?: string; message_template?: string }[]
    }

    if (!name || typeof name !== 'string' || !name.trim()) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 })
    }
    if (!Array.isArray(steps) || steps.length === 0) {
      return NextResponse.json({ error: 'At least one step is required' }, { status: 400 })
    }
    const cleanSteps: { delay_days: number; channel: 'whatsapp' | 'email'; message_template: string }[] = []
    for (const s of steps) {
      if (!s.message_template || !s.message_template.trim()) {
        return NextResponse.json({ error: 'Every step needs a message_template' }, { status: 400 })
      }
      cleanSteps.push({
        delay_days: typeof s.delay_days === 'number' && s.delay_days >= 0 ? Math.round(s.delay_days) : 1,
        channel: s.channel === 'email' ? 'email' : 'whatsapp',
        message_template: s.message_template.trim(),
      })
    }

    const result = await createSequence({ name: name.trim(), description: description?.trim() || null, trigger_event, steps: cleanSteps })
    if (!result.ok) {
      logger.error('drip-sequences', 'POST create failed', result.error)
      return NextResponse.json({ error: result.error }, { status: 500 })
    }
    return NextResponse.json({ sequence: result.value }, { status: 201 })
  } catch (err) {
    logger.error('drip-sequences', 'POST /api/whatsapp/drip-sequences failed', err)
    return NextResponse.json({ error: 'Failed to create sequence' }, { status: 500 })
  }
}
