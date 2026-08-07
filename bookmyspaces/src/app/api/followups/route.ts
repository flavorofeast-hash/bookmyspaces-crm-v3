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

    // Phase 3 (Revenue Automation) — AI Follow-up Assistant dashboard.
    // /api/cron/ai-followup-assistant already drafts these (follow_ups rows,
    // status='pending', created_by='ai_followup_assistant') for a human to
    // review before /api/cron/followups' drain cron sends them — but until
    // now nothing ever surfaced the drafts for that review step. Reusing
    // the existing follow_ups table/leads join, not a new queue.
    const { data: aiDraftedRaw } = await supabaseAdmin
      .from('follow_ups')
      .select('id, lead_id, message, notes, scheduled_at, trigger_reason, created_at, leads(id, name, phone, status)')
      .eq('status', 'pending')
      .eq('created_by', 'ai_followup_assistant')
      .order('scheduled_at', { ascending: true })
      .limit(30)

    const aiDrafted = (aiDraftedRaw ?? []).map((row) => {
      const leadRaw = Array.isArray(row.leads) ? row.leads[0] : row.leads
      return {
        id: row.id,
        leadId: row.lead_id,
        leadName: leadRaw?.name ?? null,
        leadPhone: leadRaw?.phone ?? null,
        leadStatus: leadRaw?.status ?? null,
        message: row.message,
        scheduledAt: row.scheduled_at,
        createdAt: row.created_at,
      }
    })

    return NextResponse.json({
      leads: pendingLeads || [],
      overdue: overdueLeads || [],
      aiDrafted,
      counts: { pending: pendingLeads?.length ?? 0, overdue: overdueLeads?.length ?? 0, aiDrafted: aiDrafted.length }
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

    return NextResponse.json({ leads: data || [], overdue: [], aiDrafted: [], counts: { pending: data?.length ?? 0, overdue: 0, aiDrafted: 0 } })
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  const supabaseAdmin = getSupabaseAdmin()
  try {
    const body = await req.json()
    const { action, lead_id, note, followup_date, follow_up_id, performed_by = 'admin' } = body

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

    // Phase 3 (Revenue Automation) — AI Follow-up Assistant dashboard
    // approve/dismiss actions, operating on a specific follow_ups row
    // (not a lead) — distinct from 'single' above, which sends the
    // generic template for a lead rather than a specific AI-drafted row.
    if (action === 'send_now' && follow_up_id) {
      const { data: row, error: rowErr } = await supabaseAdmin
        .from('follow_ups')
        .select('id, lead_id, message, status, trigger_reason, leads(id, name, phone, whatsapp_opted_in)')
        .eq('id', follow_up_id)
        .single()
      if (rowErr || !row) return NextResponse.json({ error: 'Follow-up not found' }, { status: 404 })

      const leadRaw = Array.isArray(row.leads) ? row.leads[0] : row.leads
      if (!leadRaw?.phone) return NextResponse.json({ error: 'Lead has no phone number' }, { status: 400 })
      if (leadRaw.whatsapp_opted_in === false) return NextResponse.json({ error: 'Lead has opted out of WhatsApp' }, { status: 400 })

      // Claim BEFORE sending, not after: a conditional update guarded on
      // status='pending' so two concurrent send_now calls (e.g. a double
      // click) for the same row can't both pass the check-then-act window
      // and both send the WhatsApp message — only the request that actually
      // flips the row proceeds. Reverted back to 'pending' below if the
      // send itself fails, so a real failure can still be retried.
      const { data: claimed, error: claimErr } = await supabaseAdmin
        .from('follow_ups')
        .update({ status: 'sent', sent_at: new Date().toISOString() })
        .eq('id', follow_up_id)
        .eq('status', 'pending')
        .select('id')
        .maybeSingle()
      if (claimErr) throw claimErr
      if (!claimed) return NextResponse.json({ error: 'Follow-up is not pending' }, { status: 409 })

      // Same guard /api/cron/followups' drain cron already established:
      // `message` is only real customer-facing content on AI-drafted rows.
      // Manually-scheduled rows (action:'schedule' above) write a non-
      // customer-facing placeholder ('Scheduled follow-up') into the same
      // column — sending it unconditionally would leak that placeholder
      // text to the customer.
      const message = row.trigger_reason === 'ai_followup_assistant' && row.message
        ? row.message
        : WHATSAPP_MESSAGES.followUp(leadRaw.name || undefined)
      const sent = await smartSend(leadRaw.phone, message, { type: 'session', leadId: leadRaw.id })
      if (sent) {
        await supabaseAdmin.from('leads').update({ last_contacted_at: new Date().toISOString() }).eq('id', leadRaw.id)
        await supabaseAdmin.from('activity_logs').insert({ lead_id: leadRaw.id, action: 'followup_sent', description: 'AI-drafted follow-up approved and sent', performed_by })
      } else {
        // Send failed — release the claim so it isn't stuck 'sent' with
        // nothing actually delivered.
        await supabaseAdmin.from('follow_ups').update({ status: 'pending', sent_at: null }).eq('id', follow_up_id)
      }
      return NextResponse.json({ success: sent })
    }

    if (action === 'dismiss' && follow_up_id) {
      // Guarded on status='pending' so a dismiss racing a concurrent
      // send_now can't both "succeed" — .select().maybeSingle() confirms
      // whether this request actually matched/changed the row instead of
      // reporting success on a silent zero-row no-op (e.g. it was already
      // sent a moment earlier).
      const { data: dismissed, error: dismissErr } = await supabaseAdmin
        .from('follow_ups')
        .update({ status: 'skipped' })
        .eq('id', follow_up_id)
        .eq('status', 'pending')
        .select('id')
        .maybeSingle()
      if (dismissErr) throw dismissErr
      if (!dismissed) return NextResponse.json({ error: 'Follow-up is not pending' }, { status: 409 })
      return NextResponse.json({ success: true })
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
