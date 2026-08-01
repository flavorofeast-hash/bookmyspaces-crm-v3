// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/app/api/dashboard/founder/route.ts
// Sprint 3A — Founder Dashboard. "What should the owner do today to
// maximize revenue?"
//
// Version 3.0 (AI Chief of Staff) update: this route's computation was
// extracted, unchanged, into src/lib/founder/founder-brief-service.ts's
// buildFounderBrief() — the Chief of Staff needed the exact same Today's
// Opportunities ranking, Revenue Pipeline, Today's Schedule, and Lost
// Revenue Summary, and re-deriving them a second time here would have been
// exactly the duplicate computation the Engineering OS forbids. This route
// is now a thin handler: auth, call the service, return the same JSON shape
// it always has. Zero behavior change for the existing Founder Dashboard
// page — verified by keeping the response's field set identical (the
// service's extra `revenueIntelligence`/`followUpsDue`/
// `openLeadsCandidateCount` fields are deliberately not forwarded here).
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { requireAuth } from '@/lib/auth-guard'
import { buildFounderBrief } from '@/lib/founder/founder-brief-service'

export async function GET(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response

  const windowDays = Number(req.nextUrl.searchParams.get('days')) || 90

  try {
    const brief = await buildFounderBrief(windowDays)

    return NextResponse.json({
      today: brief.today,
      todaysOpportunities: brief.todaysOpportunities,
      revenuePipeline: brief.revenuePipeline,
      todaysSchedule: brief.todaysSchedule,
      morningBrief: brief.morningBrief,
      lostRevenue: brief.lostRevenue,
    })
  } catch (error) {
    logger.error('dashboard/founder', 'GET failed', error)
    return NextResponse.json({ error: 'Failed to load founder dashboard' }, { status: 500 })
  }
}
