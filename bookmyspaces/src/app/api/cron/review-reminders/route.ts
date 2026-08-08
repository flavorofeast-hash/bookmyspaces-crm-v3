// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/app/api/cron/review-reminders/route.ts
// Growth Engine Epic 1 — Review Engine: sends exactly ONE reminder to guests
// whose review_requests row is still 'requested' 7+ days after the original
// ask (from /api/cron/stay-lifecycle). Capped at one reminder — reminder_count
// guards against re-sending on subsequent daily runs. Same cron-secret auth
// pattern as every other cron route in this codebase.
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { enqueueMessage } from '@/lib/queue'
import { WHATSAPP_MESSAGES } from '@/lib/templates'
import { logger } from '@/lib/logger'
import { logJourneyEvent, JOURNEY_ACTIONS } from '@/lib/customers/journey'
import { canSendAutomatedMessage } from '@/lib/messaging/orchestrator'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

interface RequestRow {
  id: string
  lead_id: string | null
  requested_at: string
}

interface LeadRow {
  id: string
  name: string | null
  phone: string | null
}

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const token = request.headers.get('authorization')?.replace('Bearer ', '').trim()
    if (token !== cronSecret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const db = getSupabaseAdmin()
  let reminded = 0

  try {
    const cutoff = new Date(Date.now() - 7 * 86_400_000).toISOString()
    const { data: due } = await db
      .from('review_requests')
      .select('id, lead_id, requested_at')
      .eq('status', 'requested')
      .eq('reminder_count', 0)
      .lte('requested_at', cutoff)
      .limit(200)

    const rows = (due ?? []) as unknown as RequestRow[]
    if (rows.length === 0) return NextResponse.json({ reminded: 0 })

    const leadIds = Array.from(new Set(rows.map((r) => r.lead_id).filter((id): id is string => !!id)))
    if (leadIds.length === 0) return NextResponse.json({ reminded: 0 })
    const { data: leads } = await db.from('leads').select('id, name, phone').in('id', leadIds)
    const leadById = new Map(((leads ?? []) as unknown as LeadRow[]).map((l) => [l.id, l]))

    for (const row of rows) {
      const lead = row.lead_id ? leadById.get(row.lead_id) : undefined
      if (!lead?.phone) continue
      if (!(await canSendAutomatedMessage(lead.id, 'review_reminder'))) continue

      await enqueueMessage({
        phone: lead.phone,
        message: WHATSAPP_MESSAGES.reviewReminderMessage({ name: lead.name ?? undefined }),
        type: 'session',
        metadata: { journey: 'review_reminder', lead_id: lead.id },
      })
      await logJourneyEvent(lead.id, JOURNEY_ACTIONS.REVIEW_REMINDER_SENT, 'Review reminder sent via WhatsApp', { reviewRequestId: row.id })

      await db.from('review_requests').update({
        status: 'reminded',
        reminder_count: 1,
        last_reminder_at: new Date().toISOString(),
      }).eq('id', row.id)

      reminded++
    }

    return NextResponse.json({ reminded })
  } catch (err) {
    logger.error('cron', 'review-reminders error', err)
    return NextResponse.json({ error: 'Review reminders failed', reminded }, { status: 500 })
  }
}
