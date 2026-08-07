// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/app/api/whatsapp/drip-sequences/enroll/route.ts
// Phase 2 (Social + WhatsApp Growth) — enroll/cancel a lead in a drip
// sequence. Separate from the sequences CRUD route since this acts on
// drip_sequence_enrollments, not drip_sequences.
//
// POST   { sequenceId, leadId }   → enroll (idempotent — re-enrolling an
//                                    already-active lead just resets progress
//                                    to step 1, via the upsert in
//                                    enrollLead()'s onConflict clause)
// PATCH  { enrollmentId, action: 'cancel' | 'pause' | 'resume' }
//   → cancelEnrollment / pauseEnrollment / resumeEnrollment
//   (pause/resume added Phase 3 — Revenue Automation, drip pause/resume)
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { requireAuth } from '@/lib/auth-guard'
import { enrollLead, cancelEnrollment, pauseEnrollment, resumeEnrollment } from '@/lib/whatsapp/drip-service'

export async function POST(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response

  try {
    const body = await req.json()
    const { sequenceId, leadId } = body as { sequenceId?: string; leadId?: string }
    if (!sequenceId || !leadId) {
      return NextResponse.json({ error: 'sequenceId and leadId are required' }, { status: 400 })
    }

    const result = await enrollLead(sequenceId, leadId)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 422 })
    return NextResponse.json({ enrollment: result.value }, { status: 201 })
  } catch (err) {
    logger.error('drip-sequences-enroll', 'POST failed', err)
    return NextResponse.json({ error: 'Failed to enroll lead' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response

  try {
    const body = await req.json()
    const { enrollmentId, action } = body as { enrollmentId?: string; action?: string }
    if (!enrollmentId) return NextResponse.json({ error: 'enrollmentId is required' }, { status: 400 })
    if (action !== 'cancel' && action !== 'pause' && action !== 'resume') {
      return NextResponse.json({ error: 'action must be "cancel", "pause", or "resume"' }, { status: 400 })
    }

    const result =
      action === 'cancel' ? await cancelEnrollment(enrollmentId)
      : action === 'pause' ? await pauseEnrollment(enrollmentId)
      : await resumeEnrollment(enrollmentId)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 422 })
    return NextResponse.json({ enrollment: result.value })
  } catch (err) {
    logger.error('drip-sequences-enroll', 'PATCH failed', err)
    return NextResponse.json({ error: 'Failed to update enrollment' }, { status: 500 })
  }
}
