import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin }          from '@/lib/supabase'
import { smartSend }                 from '@/lib/queue'
import { WHATSAPP_MESSAGES }         from '@/lib/templates'

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

    const message = WHATSAPP_MESSAGES.followUp(lead.name ?? undefined)
    // Customer Journey Timeline fix (Priority 3): leadId now forwarded so
    // this send shows up on the customer's Timeline (whatsapp_messages.
    // lead_id is what fetchWhatsAppEntries() requires) — previously this
    // cron's sends were logged with lead_id=null and invisible there.
    const ok      = await smartSend(lead.phone, message, { forceSpamCheck: true, leadId: lead.id })

    if (ok) {
      await db.from('follow_ups').update({ status: 'sent', sent_at: now }).eq('id', row.id)
      await db.from('leads').update({ last_contacted_at: now, whatsapp_last_message_at: now }).eq('id', lead.id)
      sent++
    } else {
      failed++
    }
  }

  return NextResponse.json({ processed: data.length, sent, skipped, failed })
}
