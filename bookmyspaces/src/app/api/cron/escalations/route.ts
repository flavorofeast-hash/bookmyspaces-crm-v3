// src/app/api/cron/escalations/route.ts
// ISS-017: periodically scans open leads and runs the already-written escalation-engine
// (src/modules/automation/escalation-engine.ts) against current data, per the user's
// explicit decision to trigger this from a scheduled job (cron) rather than inline in
// webhooks or on every lead update. Mirrors the existing src/app/api/cron/followups/route.ts
// pattern: same CRON_SECRET bearer-token guard, same shape of response.

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin }          from '@/lib/supabase'
import { applyEscalation }           from '@/modules/automation/escalation-engine'
import type { Lead }                 from '@/modules/leads/types'
import { logger }                    from '@/lib/logger'

export const dynamic     = 'force-dynamic'
export const runtime     = 'nodejs'
export const maxDuration = 30

// Only fields evaluateEscalation()'s rules actually read, plus id/escalation_required
// to filter out leads already escalated and terminal-stage leads that don't need checking.
const ESCALATION_SELECT =
  'id, ai_score, estimated_revenue, tags, event_type, guest_count, lead_temperature, ' +
  'last_contacted_at, lead_stage, escalation_required'

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
    const db = getSupabaseAdmin()

    // Only leads not already escalated and not in a terminal stage need re-checking.
    const { data, error } = await db
      .from('leads')
      .select(ESCALATION_SELECT)
      .eq('escalation_required', false)
      .not('lead_stage', 'in', '(CONFIRMED,LOST)')
      .limit(200)

    if (error) {
      return NextResponse.json({
        error:   'DB error',
        message: error.message,
        code:    error.code,
        details: error.details,
        hint:    error.hint,
      }, { status: 500 })
    }

    if (!data || data.length === 0) {
      return NextResponse.json({ processed: 0, escalated: 0 })
    }

    let escalated = 0

    for (const row of data as Partial<Lead>[]) {
      if (!row.id) continue
      const result = await applyEscalation(row.id, row)
      if (result.escalated) escalated++
    }

    return NextResponse.json({ processed: data.length, escalated })
  } catch (err) {
    logger.error('cron', 'escalations cron error', err)
    return NextResponse.json({ error: 'Escalation cron failed' }, { status: 500 })
  }
}
