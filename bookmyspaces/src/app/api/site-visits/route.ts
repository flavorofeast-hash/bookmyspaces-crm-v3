// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/app/api/site-visits/route.ts
// Sprint 1 — Revenue Capture Pipeline: Visit Scheduling.
//
// Thin route over src/lib/visits/site-visit-service.ts, same layering as
// every other CRM resource in this codebase (proposals, leads, followups).
// CRM-authenticated (requireAuth), unlike /api/campaigns/track which is a
// public landing-page route — this is the internal scheduling action, used
// by CRM staff today and intended for the AI conversation tool-call to
// invoke next (that wiring lives in the chat route, out of scope for this
// pass — see sprint report).
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-guard'
import { logger } from '@/lib/logger'
import { scheduleSiteVisit, listSiteVisitsForDate } from '@/lib/visits/site-visit-service'

// ── GET — visits for a given date (defaults to today, IST) ────────────────────

export async function GET(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response

  try {
    const { searchParams } = new URL(req.url)
    const date = searchParams.get('date') || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })

    const visits = await listSiteVisitsForDate(date)
    return NextResponse.json({ visits, date })
  } catch (err) {
    logger.error('site-visits', 'GET failed', err)
    return NextResponse.json({ error: 'Failed to fetch site visits' }, { status: 500 })
  }
}

// ── POST — schedule a new visit ────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response

  try {
    const body = await req.json()
    const {
      lead_id, name, phone, email,
      property, visit_date, visit_time,
      purpose, guest_count, budget,
    } = body

    if (!lead_id && !name?.trim()) {
      return NextResponse.json({ error: 'Customer name is required.' }, { status: 400 })
    }
    if (!lead_id && !phone?.trim() && !email?.trim()) {
      return NextResponse.json(
        { error: 'Provide at least one contact method — phone or email — for the customer.' },
        { status: 400 }
      )
    }
    if (!property?.trim()) {
      return NextResponse.json({ error: 'Property is required.' }, { status: 400 })
    }
    if (!visit_date?.trim() || !visit_time?.trim()) {
      return NextResponse.json({ error: 'Visit date and time are required.' }, { status: 400 })
    }

    const result = await scheduleSiteVisit({
      leadId    : lead_id || null,
      name      : name || '',
      phone     : phone || null,
      email     : email || null,
      property,
      visitDate : visit_date,
      visitTime : visit_time,
      purpose   : purpose || null,
      guestCount: guest_count ? parseInt(String(guest_count), 10) : null,
      budget    : budget || null,
    })

    if (!result) {
      return NextResponse.json({ error: 'Failed to schedule site visit' }, { status: 500 })
    }

    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    logger.error('site-visits', 'POST failed', err)
    return NextResponse.json({ error: 'Failed to schedule site visit' }, { status: 500 })
  }
}
