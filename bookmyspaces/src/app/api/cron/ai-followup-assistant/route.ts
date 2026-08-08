// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/app/api/cron/ai-followup-assistant/route.ts
// Phase 2 (Social + WhatsApp Growth) — AI Follow-up Assistant.
//
// GAP THIS CLOSES: follow_ups (queue table) + its drain cron
// (/api/cron/followups) + a manual scheduling API already existed and
// work — but nothing ever populated follow_ups automatically. Two now-dead
// modules (src/modules/followups/followup-rules.ts, followup-engine.ts)
// were an earlier, never-wired attempt at this. Rather than resurrect that
// disconnected cadence-rule code, this reuses the AI Operator Assistant's
// existing 'recommended_follow_up' action (src/lib/ai/operator-assistant.ts
// — the SAME function an operator triggers by hand from AIAssistantPanel)
// to draft each follow-up, and inserts the result into the existing
// follow_ups table so the existing drain cron sends it. No new AI
// architecture, no new queue.
//
// Bounded to MAX_LEADS per run — this makes one Anthropic call per
// candidate lead, so an unbounded pipeline would be both slow and costly.
// A lead is a candidate only if: pipeline status suggests it's still being
// nurtured (not yet confirmed/rejected), it has no pending follow_up
// already queued, and it hasn't been contacted in NURTURE_GAP_DAYS.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { getSupabaseAdmin } from '@/lib/supabase'
import { buildAIContext } from '@/lib/ai/context-builder'
import { runOperatorAssist } from '@/lib/ai/operator-assistant'
import { canSendAutomatedMessage } from '@/lib/messaging/orchestrator'

const MAX_LEADS = 15
const NURTURE_GAP_DAYS = 3
const ACTIVE_PIPELINE_STATUSES = ['new_inquiry', 'followup_pending', 'proposal_sent', 'negotiation']

export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const auth = req.headers.get('authorization')
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const db = getSupabaseAdmin()
  let drafted = 0
  let skipped = 0
  let failed = 0
  let orchestrationSkipped = 0

  try {
    const cutoff = new Date(Date.now() - NURTURE_GAP_DAYS * 86400000).toISOString()

    const { data: candidates, error } = await db
      .from('leads')
      .select('id, name, status, last_contacted_at')
      .in('status', ACTIVE_PIPELINE_STATUSES)
      .or(`last_contacted_at.is.null,last_contacted_at.lt.${cutoff}`)
      .order('last_contacted_at', { ascending: true, nullsFirst: true })
      .limit(MAX_LEADS * 2) // headroom before the pending-follow-up filter below

    if (error) throw error

    const { data: pending } = await db.from('follow_ups').select('lead_id').eq('status', 'pending')
    const pendingLeadIds = new Set((pending ?? []).map((f) => f.lead_id))

    const toProcess = (candidates ?? []).filter((l) => !pendingLeadIds.has(l.id)).slice(0, MAX_LEADS)

    for (const lead of toProcess) {
      try {
        // Production Stabilization (Priority 2) — Messaging Orchestrator:
        // skip drafting (saves the Anthropic call too) if a higher-or-equal
        // priority automated message already went out to this lead
        // recently via Marketing Automations or Drip Sequences.
        if (!(await canSendAutomatedMessage(lead.id, 'ai_followup'))) {
          orchestrationSkipped++
          continue
        }
        const context = await buildAIContext({ leadId: lead.id, query: '', conversationId: null })
        const result = await runOperatorAssist('recommended_follow_up', context, lead.id, null)

        if (!result.ok) {
          failed++
          continue
        }

        // NOTE: /api/cron/followups (the drain cron) reads the `message`
        // column, NOT `notes` — confirmed by reading src/app/api/followups/
        // route.ts's own 'schedule' action, which writes
        // `message: 'Scheduled follow-up'`. `message` isn't in any
        // migration file (a documented "undocumented production object"
        // per migration 009's own title) but is the real, live column the
        // send path depends on — writing only `notes` here would silently
        // never be sent (the drain cron would fall back to the generic
        // WHATSAPP_MESSAGES.followUp() text instead of this AI draft).
        // `notes` is also set, matching the officially-migrated column's
        // documented purpose (free-form detail, migration 007).
        const { error: insertError } = await db.from('follow_ups').insert({
          lead_id: lead.id,
          scheduled_at: new Date(Date.now() + 86400000).toISOString(), // tomorrow — operator reviews/approves via the Follow-ups page before it sends
          type: 'whatsapp',
          message: result.text,
          notes: result.text,
          trigger_reason: 'ai_followup_assistant',
          status: 'pending',
          assigned_to: 'team',
          created_by: 'ai_followup_assistant',
        })
        if (insertError) {
          failed++
          logger.error('ai-followup-assistant', 'Failed to insert follow_up row', insertError, { leadId: lead.id })
          continue
        }
        drafted++
      } catch (err) {
        failed++
        logger.error('ai-followup-assistant', 'Failed to draft follow-up for lead', err, { leadId: lead.id })
      }
    }

    skipped = (candidates?.length ?? 0) - toProcess.length + orchestrationSkipped
    return NextResponse.json({ drafted, skipped, failed, orchestrationSkipped, candidatesConsidered: candidates?.length ?? 0 })
  } catch (err) {
    logger.error('ai-followup-assistant', 'Cron run failed', err)
    return NextResponse.json({ error: 'Failed to run AI follow-up assistant' }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  return POST(req)
}
