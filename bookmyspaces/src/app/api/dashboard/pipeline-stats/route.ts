// src/app/api/dashboard/pipeline-stats/route.ts
// GET /api/dashboard/pipeline-stats
//
// Additive endpoint providing Dashboard statistics derived from actual
// business-pipeline state (proposals/visits/reservations), not just
// leads.status/lead_stage. Deliberately separate from the existing
// GET /api/dashboard/stats — that route and its DashboardSummary shape are
// left completely untouched, so HotLeadDashboard's existing 6 stat cards and
// stage-breakdown table keep working exactly as before.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-guard'
import { logger } from '@/lib/logger'
import { fetchPipelineDashboardStats } from '@/lib/leads/pipeline-service'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<NextResponse> {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response

  try {
    const stats = await fetchPipelineDashboardStats()
    return NextResponse.json(stats)
  } catch (error) {
    logger.error('dashboard-pipeline-stats', 'GET failed', error)
    return NextResponse.json({ error: 'Failed to fetch pipeline stats' }, { status: 500 })
  }
}
