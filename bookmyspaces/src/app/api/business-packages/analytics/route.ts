// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/app/api/business-packages/analytics/route.ts
// Business Package Engine (migration 044) — exposes computeBusinessPackagePerformance()
// for the Marketing Dashboard's "Business Package performance" section.
// Gated the same as /api/marketing/ad-spend (admin/manager), since it surfaces
// revenue/ROI figures.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { requireRole } from '@/lib/auth-guard'
import { computeBusinessPackagePerformance } from '@/lib/business-packages/business-package-service'

export async function GET() {
  const auth = await requireRole(['admin', 'manager'])
  if (!auth.ok) return auth.response

  try {
    const performance = await computeBusinessPackagePerformance()
    return NextResponse.json({ performance })
  } catch (err) {
    logger.error('business-packages', 'GET /api/business-packages/analytics failed', err)
    return NextResponse.json({ error: 'Failed to compute business package performance' }, { status: 500 })
  }
}
