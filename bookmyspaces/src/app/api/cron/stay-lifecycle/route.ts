// ─────────────────────────────────────────────────────────────────────────────
// Stay-lifecycle journey cron (Priority 3 — Customer Journey Automation).
//
// Fills journey stages 4-6 of the target flow:
//   ... Booking confirmed -> Pre-arrival reminder -> ... -> Post-stay
//   thank-you -> Review request -> Win-back campaign
// AUDIT FINDING: no code anywhere queried reservations by check_in_date/
// check_out_date proximity before this — genuinely new, not a reconnection
// of existing logic (see WHATSAPP_MESSAGES.thankYou()/APPROVED_TEMPLATES.
// REVIEW_REQUEST, which existed but were generic/template-only and unused).
//
// Runs once daily (registered in vercel.json alongside the other crons).
// Each condition below matches reservations on an EXACT date equality
// (tomorrow / yesterday / 3-days-ago), the same idempotency pattern already
// used by this codebase's other date-driven crons — a once-daily run only
// ever finds a given reservation on the one day that condition is true, so
// no separate "already sent" tracking column is needed.
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { enqueueMessage } from '@/lib/queue'
import { WHATSAPP_MESSAGES } from '@/lib/templates'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

function isoDateDaysFromNow(days: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

interface StayRow {
  id: string
  customer_id: string | null
  guest_name: string | null
  guest_mobile: string | null
  check_in_date: string
  check_out_date: string
  properties: { name: string } | { name: string }[] | null
}

function propertyName(row: StayRow): string | undefined {
  const p = row.properties
  if (!p) return undefined
  return Array.isArray(p) ? p[0]?.name : p.name
}

export async function GET(request: NextRequest) {
  // SECURITY: fail closed. Previously `if (cronSecret)` meant an unset
  // CRON_SECRET left this route completely unauthenticated in production
  // instead of blocking it — the opposite of the intended fail-safe.
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    logger.error('cron', 'CRON_SECRET not configured — refusing request')
    return NextResponse.json({ error: 'Cron not configured' }, { status: 500 })
  }
  const token = request.headers.get('authorization')?.replace('Bearer ', '').trim()
  if (token !== cronSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = getSupabaseAdmin()
  let preArrival = 0, postStay = 0, reviewRequests = 0

  try {
    // ── Pre-arrival reminder: confirmed reservations checking in tomorrow ──
    const { data: arriving } = await db
      .from('reservations')
      .select('id, customer_id, guest_name, guest_mobile, check_in_date, check_out_date, properties(name)')
      .eq('status', 'confirmed')
      .eq('check_in_date', isoDateDaysFromNow(1))
      .limit(200)

    for (const row of (arriving ?? []) as unknown as StayRow[]) {
      if (!row.guest_mobile) continue
      await enqueueMessage({
        phone: row.guest_mobile,
        message: WHATSAPP_MESSAGES.preArrivalReminder({ name: row.guest_name ?? undefined, checkInDate: row.check_in_date, venue: propertyName(row) }),
        type: 'session',
        metadata: { journey: 'pre_arrival', reservation_id: row.id, lead_id: row.customer_id },
      })
      preArrival++
    }

    // ── Post-stay thank-you: checked out yesterday ──
    const { data: departedYesterday } = await db
      .from('reservations')
      .select('id, customer_id, guest_name, guest_mobile, check_in_date, check_out_date, properties(name)')
      .eq('status', 'checked_out')
      .eq('check_out_date', isoDateDaysFromNow(-1))
      .limit(200)

    for (const row of (departedYesterday ?? []) as unknown as StayRow[]) {
      if (!row.guest_mobile) continue
      await enqueueMessage({
        phone: row.guest_mobile,
        message: WHATSAPP_MESSAGES.postStayThankYou({ name: row.guest_name ?? undefined, venue: propertyName(row) }),
        type: 'session',
        metadata: { journey: 'post_stay_thank_you', reservation_id: row.id, lead_id: row.customer_id },
      })
      postStay++
    }

    // ── Review request: 3 days after checkout, giving the thank-you room to land first ──
    const { data: departed3DaysAgo } = await db
      .from('reservations')
      .select('id, customer_id, guest_name, guest_mobile, check_in_date, check_out_date, properties(name)')
      .eq('status', 'checked_out')
      .eq('check_out_date', isoDateDaysFromNow(-3))
      .limit(200)

    for (const row of (departed3DaysAgo ?? []) as unknown as StayRow[]) {
      if (!row.guest_mobile) continue
      await enqueueMessage({
        phone: row.guest_mobile,
        message: WHATSAPP_MESSAGES.reviewRequestMessage({ name: row.guest_name ?? undefined }),
        type: 'session',
        metadata: { journey: 'review_request', reservation_id: row.id, lead_id: row.customer_id },
      })
      reviewRequests++
    }

    return NextResponse.json({ preArrival, postStay, reviewRequests })
  } catch (err) {
    logger.error('cron', 'stay-lifecycle journey error', err)
    return NextResponse.json({ error: 'Stay lifecycle journey failed', preArrival, postStay, reviewRequests }, { status: 500 })
  }
}
