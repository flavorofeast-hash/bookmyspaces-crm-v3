// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/app/api/customers/journey/route.ts
// Growth Engine Epic 4 — Customer Journey Engine.
//
// GET ?leadId=X  → getJourneyForLead() (chronological activity_logs for one lead)
// GET (default)  → computeJourneyFunnel() (post-booking stage counts)
//
// Deliberately separate from GET /api/customers/[id]/timeline (which
// already renders activity_logs generically alongside chat/proposal/
// payment/reservation sources for the Customer detail page) — this route
// is journey-stage-scoped, not a full timeline replacement.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { requireAuth } from '@/lib/auth-guard'
import { getJourneyForLead, computeJourneyFunnel } from '@/lib/customers/journey'

export async function GET(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  try {
    const leadId = req.nextUrl.searchParams.get('leadId')
    if (leadId) {
      return NextResponse.json({ journey: await getJourneyForLead(leadId) })
    }
    return NextResponse.json({ funnel: await computeJourneyFunnel() })
  } catch (err) {
    logger.error('customers/journey', 'GET failed', err)
    return NextResponse.json({ error: 'Failed to fetch journey data' }, { status: 500 })
  }
}
