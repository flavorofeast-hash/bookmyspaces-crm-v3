// ─────────────────────────────────────────────────────────────────────────────
// Campaign queue drain cron (Priority 3 — Campaign Scheduler).
//
// Two responsibilities, both bounded/idempotent so repeated cron ticks are
// safe: (1) send a batch of due, campaign-tagged message_queue rows via
// processCampaignQueue(), and (2) kick off the next batch for any due
// recurring campaign via advanceRecurringCampaigns(). Mirrors the existing
// /api/cron/followups and /api/cron/escalations routes (same auth pattern,
// same runtime/maxDuration conventions).
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server'
import { processCampaignQueue, advanceRecurringCampaigns } from '@/lib/campaign-scheduler'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

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

  try {
    const recurrence = await advanceRecurringCampaigns()
    const drain = await processCampaignQueue(20)

    return NextResponse.json({
      recurring_triggered: recurrence.triggered,
      queue: drain,
    })
  } catch (err) {
    logger.error('cron', 'campaign-queue drain error', err)
    return NextResponse.json({ error: 'Campaign queue drain failed' }, { status: 500 })
  }
}
