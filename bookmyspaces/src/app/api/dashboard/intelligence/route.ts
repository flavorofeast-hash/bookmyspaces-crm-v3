// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/app/api/dashboard/intelligence/route.ts
// GET /api/dashboard/intelligence?days=180
// Revenue Intelligence (Priority 2) — Sales Funnel, Revenue Forecast,
// Proposal Analytics, Booking Analytics, Customer Analytics, Sales
// Productivity. Thin wrapper — all computation lives in
// src/lib/analytics/revenue-intelligence.ts (see that file's header for the
// performance contract and audit findings this was built on).
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { requireAuth } from '@/lib/auth-guard'
import { buildRevenueIntelligence } from '@/lib/analytics/revenue-intelligence'

export async function GET(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response

  try {
    const { searchParams } = new URL(req.url)
    const daysParam = Number(searchParams.get('days'))
    const windowDays = Number.isFinite(daysParam) && daysParam > 0 && daysParam <= 730 ? daysParam : 180

    const intelligence = await buildRevenueIntelligence(windowDays)
    return NextResponse.json(intelligence)
  } catch (error) {
    logger.error('dashboard/intelligence', 'GET failed', error)
    return NextResponse.json({ error: 'Failed to compute revenue intelligence' }, { status: 500 })
  }
}
