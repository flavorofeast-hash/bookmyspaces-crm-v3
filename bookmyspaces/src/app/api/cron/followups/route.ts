import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin }          from '@/lib/supabase'
import { smartSend }                 from '@/lib/queue'
import { WHATSAPP_MESSAGES }         from '@/lib/templates'
import { logJourneyEvent }           from '@/lib/customers/journey'

export const dynamic     = 'force-dynamic'
export const runtime     = 'nodejs'
export const maxDuration = 30

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const token = request.headers.get('authorization')?.replace('Bearer ', '').trim()
    if (token !== cronSecret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const db  = getSupabaseAdmin()
  const now = new Date().toISOString()

  const { data, error } = await db
    .from('follow_ups')
    .select(`
      id,
      lead_id,
      message,
      trigger_reason,
      leads ( id, name, phone, whatsapp_opted_in )
    `)
    .eq('status', 'pending')
    .eq('type',   'whatsapp')
    .lte('scheduled_at', now)
    .limit(50)

  if (error) {
    return NextResponse.json({
      error:   'DB error',
      message: error.message,
      code:    error.code,
      details: error.details,
      hint:    error.hint,
    }, { status: 500 })
  }

  if (!data || data.length === 0) {
    return NextResponse.json({ processed: 0, sent: 0, skipped: 0, failed: 0 })
  }

  let sent    = 0
  let skipped = 0
  let failed  = 0

  for (const row of data) {
    const raw  = row.leads
    const lead = (Array.isArray(raw) ? raw[0] : raw) as {
      id:                string
      name:              string | null
      phone:             string | null
      whatsapp_opted_in: boolean | null
    } | null

    if (!lead?.phone || lead.whatsapp_opted_in === false) {
      await db.from('follow_ups').update({ status: 'skipped' }).eq('id', row.id)
      skipped++
      continue
    }

    // Phase 2 (Social + WhatsApp Growth) — AI Follow-up Assistant support.
    // `message` was already selected above but previously never read here
    // (every row got the generic template regardless of its content) —
    // confirmed by reading this file before this change. Gated on
    // trigger_reason='ai_followup_assistant' specifically (not "message is
    // present"), because the existing manual /api/followups 'schedule'
    // action writes a non-customer-facing placeholder into `message`
    // ('Scheduled follow-up') — using it unconditionally would have sent
    // that literal placeholder text to customers. Every other row (the
    // manual-schedule path, and any older row) keeps the exact prior
    // behavior: the generic WHATSAPP_MESSAGES.followUp() template.
    const row2 = row as unknown as { message: string | null; trigger_reason: string | null }
    const message = row2.trigger_reason === 'ai_followup_assistant' && row2.message
      ? row2.message
      : WHATSAPP_MESSAGES.followUp(lead.name ?? undefined)
    // Customer Journey Timeline fix (Priority 3): leadId now forwarded so
    // this send shows up on the customer's Timeline (whatsapp_messages.
    // lead_id is what fetchWhatsAppEntries() requires) — previously this
    // cron's sends were logged with lead_id=null and invisible there.
    const ok      = await smartSend(lead.phone, message, { forceSpamCheck: true, leadId: lead.id })

    if (ok) {
      await db.from('follow_ups').update({ status: 'sent', sent_at: now }).eq('id', row.id)
      await db.from('leads').update({ last_contacted_at: now, whatsapp_last_message_at: now }).eq('id', lead.id)
      // Production Stabilization (Priority 2) — Messaging Orchestrator:
      // only the ai_followup_assistant-triggered rows are an "automated
      // engine" send the shared orchestrator (src/lib/messaging/
      // orchestrator.ts) needs to see; an operator's manually-scheduled
      // follow-up is a deliberate human action, not something the
      // cross-system cooldown should suppress or be suppressed by.
      if (row2.trigger_reason === 'ai_followup_assistant') {
        await logJourneyEvent(lead.id, 'whatsapp_ai_followup_sent', 'AI-drafted follow-up sent', { followUpId: row.id })
      }
      sent++
    } else {
      failed++
    }
  }

  return NextResponse.json({ processed: data.length, sent, skipped, failed })
}
