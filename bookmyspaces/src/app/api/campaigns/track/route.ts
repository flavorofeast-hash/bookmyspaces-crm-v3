export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// ─────────────────────────────────────────────────────────────────────────────
// Sprint 1 — Revenue Capture Engine / Campaign Landing Page System.
//
// Public (unauthenticated) route — same posture as /api/chat: campaign landing
// pages are marketing-site pages, not CRM pages, so this cannot sit behind
// requireAuth(). Rate-limited the same way /api/chat is, per
// docs/engineering/MASTER_ARCHITECTURE.md's "authorization enforced at the API
// layer" model.
//
// Reuses the existing `leads` table + `activity_logs` pattern rather than a
// new table: this is attribution about a lead, not a new entity. Dedup is via
// `activity_logs.metadata.session_id` (one 'landing_capture' activity per
// client session) rather than a new column, per the additive-only migration
// discipline in MASTER_DATABASE.md (026_campaign_landing_attribution.sql adds
// only the columns actually needed for reporting).
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { parseBody, campaignTrackSchema } from '@/lib/validation'
import { checkRateLimit, clientIpFrom } from '@/lib/rate-limit'
import { syncLeadToSheets } from '@/lib/sheets'

export async function POST(req: NextRequest) {
  const rl = checkRateLimit(`campaign-track:${clientIpFrom(req)}`, { limit: 15, windowMs: 60_000 })
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many requests — please wait a moment.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } }
    )
  }

  const parsed = await parseBody(req, campaignTrackSchema)
  if (!parsed.ok) return parsed.response
  const body = parsed.data

  const supabaseAdmin = getSupabaseAdmin()

  try {
    // Dedup: if this client session already captured a lead for this
    // campaign, return it instead of creating a second one (e.g. React
    // effect double-invocation in development, or a page reload).
    const { data: existingActivity } = await supabaseAdmin
      .from('activity_logs')
      .select('lead_id')
      .eq('action', 'landing_capture')
      .contains('metadata', { session_id: body.sessionId })
      .maybeSingle()

    if (existingActivity?.lead_id) {
      return NextResponse.json({ leadId: existingActivity.lead_id, created: false })
    }

    const { data: lead, error } = await supabaseAdmin
      .from('leads')
      .insert({
        // 'other', not 'campaign' — leads.source is acquisition-channel data
        // (see MASTER_DATABASE.md's "Column Semantics — leads.source"); the
        // true channel isn't known from an ad click alone, and 'campaign'
        // is not in leads_source_check, so this insert was failing 100% of
        // the time (Postgres 23514), caught by this route's own try/catch,
        // silently returning 500 to a fetch the landing page treats as
        // best-effort. The campaign/landing_page/utm_* columns below (026)
        // already capture the real attribution detail — no data is lost.
        source: 'other',
        status: 'new_inquiry',
        event_type: body.leadEventType || body.intent || null,
        venue: body.property || null,
        campaign: body.campaign,
        landing_page: body.landingPage || null,
        utm_source: body.utmSource || null,
        utm_medium: body.utmMedium || null,
        utm_campaign: body.utmCampaign || null,
        referral: body.referral || null,
      })
      .select('id')
      .single()

    if (error || !lead) {
      logger.error('campaigns/track', 'Auto-lead insert failed', error)
      return NextResponse.json({ error: 'Failed to capture landing attribution' }, { status: 500 })
    }

    await supabaseAdmin.from('activity_logs').insert({
      lead_id: lead.id,
      action: 'landing_capture',
      description: `Auto-captured from campaign landing page: ${body.campaign}`,
      performed_by: 'landing_page',
      metadata: {
        session_id: body.sessionId,
        campaign: body.campaign,
        utm_source: body.utmSource || null,
        utm_medium: body.utmMedium || null,
        utm_campaign: body.utmCampaign || null,
        referral: body.referral || null,
        landing_page: body.landingPage || null,
      },
    })

    syncLeadToSheets(lead as any).catch(() => {})

    Promise.resolve(
      supabaseAdmin.rpc('track_event', {
        p_event_type: 'lead_created',
        p_session_id: body.sessionId,
        p_lead_id: lead.id,
        p_channel: 'campaign_landing',
        p_properties: { campaign: body.campaign },
      })
    ).catch(() => {})

    return NextResponse.json({ leadId: lead.id, created: true })
  } catch (err) {
    logger.error('campaigns/track', 'Unhandled error', err)
    return NextResponse.json({ error: 'Failed to capture landing attribution' }, { status: 500 })
  }
}
