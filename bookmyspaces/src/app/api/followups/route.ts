export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { getSupabaseAdmin } from '@/lib/supabase'
import { smartSend } from '@/lib/queue'
import { WHATSAPP_MESSAGES } from '@/lib/templates'
import { requireAuth } from '@/lib/auth-guard'

export async function GET(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  const supabaseAdmin = getSupabaseAdmin()
  const { searchParams } = new URL(req.url)
  const leadId = searchParams.get('lead_id')

  if (leadId) {
    const { data: activities, error } = await supabaseAdmin
      .from('activity_logs')
      .select('*')
      .eq('lead_id', leadId)
      .order('created_at', { ascending: false })
      .limit(50)

    if (error) {
      logger.error('followups', 'Activity fetch failed', error)
      return NextResponse.json({ activities: [] })
    }
    return NextResponse.json({ activities: activities || [] })
  }

  try {
    const now = new Date().toISOString()
    const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

    const { data: overdueLeads } = await supabaseAdmin
      .from('leads')
      .select('id, name, phone, email, event_type, status, followup_date, last_contacted_at, created_at')
      .in('status', ['new_inquiry', 'followup_pending', 'future_prospect'])
      .not('followup_date', 'is', null)
      .lt('followup_date', now)
      .order('followup_date', { ascending: true })
      .limit(50)

    const { data: pendingLeads } = await supabaseAdmin
      .from('leads')
      .select('id, name, phone, email, event_type, status, followup_date, last_contacted_at, created_at')
      .in('status', ['new_inquiry', 'followup_pending', 'future_prospect'])
      .not('phone', 'is', null)
      .or(`last_contacted_at.is.null,last_contacted_at.lt.${cutoff24h}`)
      .order('created_at', { ascending: true })
      .limit(50)

    return NextResponse.json({
      leads: pendingLeads || [],
      overdue: overdueLeads || [],
      counts: { pending: pendingLeads?.length ?? 0, overdue: overdueLeads?.length ?? 0 }
    })
  } catch (err) {
    logger.error('followups', 'GET failed', err)
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const supabaseAdmin2 = getSupabaseAdmin()
    const { data } = await supabaseAdmin2
      .from('leads')
      .select('id, name, phone, email, event_type, status, last_contacted_at, created_at')
      .in('status', ['new_inquiry', 'followup_pending', 'future_prospect'])
      .not('phone', 'is', null)
      .or(`last_contacted_at.is.null,last_contacted_at.lt.${cutoff}`)
      .order('created_at', { ascending: true })
      .limit(50)

    return NextResponse.json({ leads: data || [], overdue: [], counts: { pending: data?.length ?? 0, overdue: 0 } })
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  const supabaseAdmin = getSupabaseAdmin()
  try {
    const body = await req.json()
    const { action, lead_id, note, followup_date, performed_by = 'admin' } = body

    if (action === 'schedule' && lead_id) {
      if (!followup_date) return NextResponse.json({ error: 'followup_date required' }, { status: 400 })
      const { error } = await supabaseAdmin.from('leads').update({ followup_date }).eq('id', lead_id)
      if (error) throw error
      await supabaseAdmin.from('follow_ups').insert({
        lead_id,
        type: 'whatsapp',
        status: 'pending',
        scheduled_at: followup_date,
        message: 'Scheduled follow-up',
      })
      await supabaseAdmin.from('activity_logs').insert({
        lead_id, action: 'followup_scheduled',
        description: `Follow-up scheduled for ${new Date(followup_date).toLocaleDateString('en-IN')}`,
        performed_by, metadata: { followup_date },
      })
      return NextResponse.json({ success: true })
    }

    if (action === 'note' && lead_id) {
      if (!note?.trim()) return NextResponse.json({ error: 'note is required' }, { status: 400 })
      const { data: lead } = await supabaseAdmin.from('leads').select('notes').eq('id', lead_id).single()
      const timestamp = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
      const existing = lead?.notes ? lead.notes + '\n\n' : ''
      const updated = `${existing}[${timestamp}] ${note.trim()}`
      const { error } = await supabaseAdmin.from('leads').update({ notes: updated }).eq('id', lead_id)
      if (error) throw error
      await supabaseAdmin.from('activity_logs').insert({ lead_id, action: 'note_added', description: note.trim(), performed_by })
      return NextResponse.json({ success: true, notes: updated })
    }

    if (action === 'complete' && lead_id) {
      const { error } = await supabaseAdmin.from('leads').update({ followup_date: null, last_contacted_at: new Date().toISOString() }).eq('id', lead_id)
      if (error) throw error
      await supabaseAdmin.from('activity_logs').insert({ lead_id, action: 'followup_completed', description: 'Follow-up marked as completed', performed_by })
      return NextResponse.json({ success: true })
    }

    if (action === 'single' && lead_id) {
      const { data: lead } = await supabaseAdmin.from('leads').select('*').eq('id', lead_id).single()
      if (!lead?.phone) return NextResponse.json({ error: 'Lead has no phone number' }, { status: 400 })
      const message = WHATSAPP_MESSAGES.followUp(lead.name || undefined)
      // Customer Journey Timeline fix (Priority 3): see cron/followups for
      // the full audit finding — leadId now forwarded to smartSend() so
      // this shows up on the customer's Timeline instead of being logged
      // with lead_id=null.
      const sent = await smartSend(lead.phone, message, { type: 'session', leadId: lead.id })
      if (sent) {
        await supabaseAdmin.from('leads').update({ last_contacted_at: new Date().toISOString(), status: lead.status === 'new_inquiry' ? 'followup_pending' : lead.status }).eq('id', lead_id)
        await supabaseAdmin.from('activity_logs').insert({ lead_id, action: 'followup_sent', description: 'WhatsApp follow-up sent', performed_by: 'system' })
      }
      return NextResponse.json({ success: sent })
    }

    if (action === 'bulk') {
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      const { data: leads } = await supabaseAdmin.from('leads').select('id, name, phone, status')
        .in('status', ['new_inquiry', 'followup_pending']).not('phone', 'is', null)
        .or(`last_contacted_at.is.null,last_contacted_at.lt.${cutoff}`).limit(20)
      if (!leads?.length) return NextResponse.json({ success: true, sent: 0, message: 'No leads to follow up' })
      let sent = 0
      for (const lead of leads) {
        if (!lead.phone) continue
        const ok = await smartSend(lead.phone, WHATSAPP_MESSAGES.followUp(lead.name || undefined), { type: 'session', leadId: lead.id })
        if (ok) { sent++; await supabaseAdmin.from('leads').update({ last_contacted_at: new Date().toISOString() }).eq('id', lead.id); await new Promise(r => setTimeout(r, 1500)) }
      }
      return NextResponse.json({ success: true, sent, total: leads.length, message: `Sent ${sent} follow-up messages` })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err) {
    logger.error('followups', 'POST failed', err)
    return NextResponse.json({ error: 'Follow-up operation failed' }, { status: 500 })
  }
}
