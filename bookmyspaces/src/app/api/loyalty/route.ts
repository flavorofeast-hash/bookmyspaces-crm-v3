// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/app/api/loyalty/route.ts
// Growth Engine Epic 3 — Loyalty Foundation.
//
// GET ?leadId=X   → this lead's loyalty account + recent transactions
// GET (default)   → computeLoyaltyOverview() (tier breakdown, top earners)
// POST { action: 'sync_points' }                → syncLoyaltyPointsFromBookings()
// POST { action: 'adjust', leadId, points, reason } → manual award/deduction
//
// Same requireAuth() + getSupabaseAdmin() pattern as every other route.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth-guard'
import { awardPoints, getLoyaltyAccount, syncLoyaltyPointsFromBookings, computeLoyaltyOverview } from '@/lib/customers/loyalty'

export async function GET(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  const db = getSupabaseAdmin()
  try {
    const leadId = req.nextUrl.searchParams.get('leadId')
    if (leadId) {
      const [account, transactionsResult] = await Promise.all([
        getLoyaltyAccount(leadId),
        db.from('loyalty_transactions').select('*').eq('lead_id', leadId).order('created_at', { ascending: false }).limit(50),
      ])
      return NextResponse.json({ account, transactions: transactionsResult.data ?? [] })
    }

    return NextResponse.json({ overview: await computeLoyaltyOverview() })
  } catch (err) {
    logger.error('loyalty', 'GET failed', err)
    return NextResponse.json({ error: 'Failed to fetch loyalty data' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  try {
    const body = await req.json()
    const { action, leadId, points, reason } = body as { action?: string; leadId?: string; points?: number; reason?: string }

    if (action === 'sync_points') {
      const result = await syncLoyaltyPointsFromBookings()
      return NextResponse.json(result)
    }

    if (action === 'adjust') {
      if (!leadId || typeof points !== 'number' || !Number.isFinite(points)) {
        return NextResponse.json({ error: 'leadId and a numeric points value are required' }, { status: 400 })
      }
      const result = await awardPoints({ leadId, points, reason: reason || 'Manual adjustment', referenceType: 'manual' })
      return NextResponse.json(result)
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (err) {
    logger.error('loyalty', 'POST failed', err)
    return NextResponse.json({ error: 'Loyalty operation failed' }, { status: 500 })
  }
}
