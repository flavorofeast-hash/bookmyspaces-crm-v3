export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// ─────────────────────────────────────────────────────────────────────────────
// Revenue Attribution Priority 2 — WhatsApp/call/website click tracking.
//
// Public (unauthenticated) route — same posture as /api/campaigns/track:
// fired from marketing-facing CTAs (LandingCTA.tsx, proposal share pages),
// not CRM pages, so it cannot sit behind requireAuth(). Rate-limited the
// same way.
//
// Reuses the existing track_event() RPC + analytics_events table (migration
// 007) rather than a new table — this is exactly what that table already
// exists for ("user interaction tracking"). event_type is unconstrained
// TEXT so '{type}_click' (whatsapp_click/call_click/website_click) needs no
// schema change. channel IS constrained (website|whatsapp|admin|api) — a
// value outside that set is silently swallowed by track_event()'s own
// EXCEPTION WHEN others handler (a pre-existing, unrelated latent behavior
// left untouched), so this route only ever passes 'whatsapp' or 'website',
// keeping the real click type in event_type/properties instead.
//
// Fire-and-forget beacon on the client (see click-tracker-client.ts) means
// this route's response body is never read — it must never block or break
// the native tel:/wa.me navigation it accompanies. Errors are logged and
// swallowed, same as campaigns/track.
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { parseBody, clickTrackSchema } from '@/lib/validation'
import { checkRateLimit, clientIpFrom } from '@/lib/rate-limit'

export async function POST(req: NextRequest) {
  const rl = checkRateLimit(`click-track:${clientIpFrom(req)}`, { limit: 30, windowMs: 60_000 })
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many requests — please wait a moment.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } }
    )
  }

  const parsed = await parseBody(req, clickTrackSchema)
  if (!parsed.ok) return parsed.response
  const body = parsed.data

  try {
    const supabaseAdmin = getSupabaseAdmin()
    await supabaseAdmin.rpc('track_event', {
      p_event_type: `${body.type}_click`,
      p_session_id: body.sessionId || null,
      p_lead_id: body.leadId || null,
      p_channel: body.type === 'whatsapp' ? 'whatsapp' : 'website',
      p_properties: {
        target: body.target,
        campaign: body.campaign || null,
        page: body.page || null,
        // End-to-End Campaign Attribution — preserves the Business Package
        // this click's landing page resolved to, if any. analytics_events.
        // properties is JSONB, so this is a new key, not a schema change.
        business_package_id: body.businessPackageId || null,
      },
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    logger.error('track/click', 'track_event RPC failed', err)
    // Best-effort beacon — never surface a hard failure to the caller.
    return NextResponse.json({ ok: false })
  }
}
