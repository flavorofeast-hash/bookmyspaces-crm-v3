export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { getSupabaseAdmin } from '@/lib/supabase'
import { buildSegment, generateFestivalMessage, generateCampaignMessage, getUpcomingFestivals, getMarketingPerformance, generateCampaignBrief } from '@/lib/campaigns'
import { requireAuth } from '@/lib/auth-guard'
import { scheduleCampaignSend } from '@/lib/campaign-scheduler'

export async function GET(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  const supabaseAdmin = getSupabaseAdmin()
  try {
    const { searchParams } = new URL(req.url)
    const view = searchParams.get('view') || 'campaigns'

    if (view === 'festivals') {
      const festivals = await getUpcomingFestivals(60)
      return NextResponse.json({ festivals })
    }

    if (view === 'performance') {
      const performance = await getMarketingPerformance()
      return NextResponse.json({ performance })
    }

    const { data: campaigns, error, count } = await supabaseAdmin
      .from('broadcast_campaigns')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .limit(50)

    if (error) throw error

    return NextResponse.json({ campaigns: campaigns || [], total: count })
  } catch (err) {
    logger.error('campaigns', 'GET /api/campaigns error', err)
    return NextResponse.json({ error: 'Failed to fetch campaigns' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  const supabaseAdmin = getSupabaseAdmin()
  try {
    const body = await req.json()
    const {
      action,
      name,
      type,
      segment,
      message_template,
      template_name,
      campaign_id,
      festival,
      offer_details,
      context,
      tone,
      goal,
      dry_run = true,
      is_recurring = false,
      recurrence_interval,
    } = body

    if (action === 'generate_festival') {
      const msg = await generateFestivalMessage(festival || 'Festival', offer_details)
      return NextResponse.json({ message: msg })
    }

    if (action === 'generate_message') {
      const msg = await generateCampaignMessage(type || 'promotional', context || '', tone || 'warm')
      return NextResponse.json({ message: msg })
    }

    // AI Campaign Builder (Priority 3) — drafts title/WhatsApp/email/CTA/
    // audience/send-time in one call. Pure draft, no side effects — the
    // operator reviews and edits before using the existing create/send
    // actions below. Never auto-sends anything.
    if (action === 'generate_brief') {
      if (!goal || typeof goal !== 'string') {
        return NextResponse.json({ error: 'goal is required' }, { status: 400 })
      }
      const brief = await generateCampaignBrief(goal, context)
      return NextResponse.json({ brief })
    }

    if (action === 'preview') {
      const recipients = await buildSegment(segment || {})
      return NextResponse.json({
        count: recipients.length,
        sample: recipients.slice(0, 5).map(r => ({ name: r.name, phone: r.phone, status: r.status, score: r.ai_score })),
      })
    }

    if (action === 'create') {
      const recipients = await buildSegment(segment || {})
      const recurring = !!is_recurring && ['daily', 'weekly', 'monthly'].includes(recurrence_interval)

      const { data: campaign, error } = await supabaseAdmin
        .from('broadcast_campaigns')
        .insert({
          name: name || `Campaign ${new Date().toLocaleDateString('en-IN')}`,
          type: type || 'custom',
          segment: segment || {},
          message_template,
          template_name,
          recipient_count: recipients.length,
          status: 'draft',
          is_recurring: recurring,
          recurrence_interval: recurring ? recurrence_interval : null,
          // First run is scheduled immediately on creation; the operator
          // still triggers the initial send explicitly via the 'send'
          // action below — next_run_at only governs *future* recurrences,
          // set once that first send has gone out.
          next_run_at: null,
        })
        .select('*')
        .single()

      if (error) throw error
      return NextResponse.json({ campaign }, { status: 201 })
    }

    // Campaign send now routes through message_queue (Priority 3: Campaign
    // Scheduler) instead of sending synchronously inside this request.
    // AUDIT FINDING: src/lib/queue.ts's enqueueMessage()/smartSend() were
    // fully built (rate limiting, spam check, DB-backed queue) but never
    // called anywhere — this reuses that infrastructure rather than
    // continuing the old blocking for-loop, which could not be paused,
    // resumed, or safely used for large recipient lists. Actual delivery
    // happens in the /api/cron/campaign-queue drain, not in this request.
    if (action === 'send' && campaign_id) {
      const { data: campaign } = await supabaseAdmin
        .from('broadcast_campaigns')
        .select('*')
        .eq('id', campaign_id)
        .single()

      if (!campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })

      if (dry_run) {
        const recipients = await buildSegment(campaign.segment || {})
        return NextResponse.json({
          dry_run: true,
          count: recipients.length,
          sample: recipients.slice(0, 3).map(r => ({ name: r.name, phone: r.phone })),
        })
      }

      const result = await scheduleCampaignSend(campaign_id)
      if (!result.ok) return NextResponse.json({ error: result.error || 'Schedule failed' }, { status: 400 })

      // If this campaign is recurring, arm the *next* run now that the
      // first batch has been queued; scheduleCampaignSend() itself never
      // touches next_run_at (it's also called by the recurrence advancer,
      // which sets next_run_at itself after each subsequent run).
      if (campaign.is_recurring && campaign.recurrence_interval) {
        const days = { daily: 1, weekly: 7, monthly: 30 }[campaign.recurrence_interval as 'daily' | 'weekly' | 'monthly'] || 7
        await supabaseAdmin
          .from('broadcast_campaigns')
          .update({ next_run_at: new Date(Date.now() + days * 86_400_000).toISOString() })
          .eq('id', campaign_id)
      }

      return NextResponse.json({ success: true, queued: result.recipientCount })
    }

    // Pause / resume / cancel (Priority 3: Campaign Scheduler). Pause and
    // resume only toggle status — queued messages already in message_queue
    // stay 'pending' either way, and the drain cron (processCampaignQueue)
    // checks the campaign's live status per-batch before sending, so a
    // pause takes effect on the next drain tick without touching every
    // queued row. Cancel additionally marks any still-pending queued
    // messages 'skipped' so they stop showing up as outstanding work.
    if (action === 'pause' && campaign_id) {
      const { data: campaign, error } = await supabaseAdmin
        .from('broadcast_campaigns')
        .update({ status: 'paused' })
        .eq('id', campaign_id)
        .select('*')
        .single()
      if (error) throw error
      return NextResponse.json({ campaign })
    }

    if (action === 'resume' && campaign_id) {
      const { data: campaign, error } = await supabaseAdmin
        .from('broadcast_campaigns')
        .update({ status: 'running' })
        .eq('id', campaign_id)
        .select('*')
        .single()
      if (error) throw error
      return NextResponse.json({ campaign })
    }

    if (action === 'cancel' && campaign_id) {
      const { data: campaign, error } = await supabaseAdmin
        .from('broadcast_campaigns')
        .update({ status: 'cancelled', is_recurring: false })
        .eq('id', campaign_id)
        .select('*')
        .single()
      if (error) throw error

      await supabaseAdmin
        .from('message_queue')
        .update({ status: 'skipped' })
        .eq('status', 'pending')
        .eq('metadata->>campaign_id', campaign_id)

      return NextResponse.json({ campaign })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (err) {
    logger.error('campaigns', 'POST /api/campaigns error', err)
    return NextResponse.json({ error: 'Campaign operation failed' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  const supabaseAdmin = getSupabaseAdmin()
  try {
    const body = await req.json()
    const { id, ...updates } = body
    if (!id) return NextResponse.json({ error: 'ID required' }, { status: 400 })

    const { data, error } = await supabaseAdmin
      .from('broadcast_campaigns')
      .update(updates)
      .eq('id', id)
      .select('*')
      .single()

    if (error) throw error
    return NextResponse.json({ campaign: data })
  } catch (err) {
    return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  }
}
