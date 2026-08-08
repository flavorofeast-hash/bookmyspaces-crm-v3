// ─────────────────────────────────────────────────────────────────────────────
// Social token refresh cron (Social Connectivity Priority 1). Same
// CRON_SECRET/runtime/idempotency conventions as /api/cron/social-publish —
// one job type per cron route (this project's established convention: see
// campaign-queue, drip-sequences, marketing-automations, social-publish,
// each a distinct file rather than one route branching on a job param).
// Recommended schedule: daily. Renewing a token that isn't near expiry yet
// is a no-op (refreshExpiringAccounts() only selects rows inside the
// buffer window), so running more often than needed is harmless.
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server'
import { refreshExpiringAccounts } from '@/lib/social/oauth/refresh-service'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const token = request.headers.get('authorization')?.replace('Bearer ', '').trim()
    if (token !== cronSecret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  try {
    const result = await refreshExpiringAccounts()
    return NextResponse.json(result)
  } catch (err) {
    logger.error('cron', 'social-token-refresh error', err)
    return NextResponse.json({ error: 'Social token refresh failed' }, { status: 500 })
  }
}
