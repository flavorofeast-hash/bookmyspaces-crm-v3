// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/app/api/cron/drip-sequences/route.ts
// Phase 2 (Social + WhatsApp Growth) — drains due drip_sequence_enrollments
// via advanceDueDripSteps(). Same CRON_SECRET-gated pattern (conditional —
// unauthenticated when CRON_SECRET is unset, matching this codebase's
// established convention) as every other cron route.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { advanceDueDripSteps } from '@/lib/whatsapp/drip-service'

async function handle(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const auth = req.headers.get('authorization')
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  try {
    const result = await advanceDueDripSteps(20)
    return NextResponse.json(result)
  } catch (err) {
    logger.error('cron-drip-sequences', 'advanceDueDripSteps failed', err)
    return NextResponse.json({ error: 'Failed to advance drip sequences' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) { return handle(req) }
export async function GET(req: NextRequest) { return handle(req) }
