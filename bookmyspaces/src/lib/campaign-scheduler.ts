// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/campaign-scheduler.ts
// Campaign Scheduler (Priority 3 — Marketing Intelligence).
//
// AUDIT FINDING THIS BUILDS ON: src/lib/queue.ts (message_queue-backed
// enqueue + rate limiting + spam check + smartSend) was fully built and
// tested but never called from anywhere in the codebase — confirmed by a
// full-repo grep before writing this file. The Campaigns "send" action
// instead sent every recipient synchronously inside the HTTP request
// (a for-loop with a 1.2s sleep per message), which cannot be paused,
// resumed, or scheduled, and risks a Vercel function timeout on any
// mid-size recipient list. This module reroutes campaign sends through the
// existing queue instead of rebuilding a second one.
//
// ATTRIBUTION SIDE EFFECT: tagging each queued message with
// metadata.campaign_id gives future campaign sends a real join key back to
// message_queue/whatsapp delivery — something Revenue Intelligence's
// Campaign Dashboard flagged as missing for past sends (no attribution
// possible retroactively, but from this point forward it is).
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabaseAdmin } from '@/lib/supabase'
import { enqueueMessage, smartSend } from '@/lib/queue'
import { buildSegment } from '@/lib/campaigns'

const RECURRENCE_DAYS: Record<string, number> = { daily: 1, weekly: 7, monthly: 30 }

interface CampaignRow {
  id: string
  segment: Record<string, unknown> | null
  message_template: string
  is_recurring: boolean | null
  recurrence_interval: string | null
}

/**
 * Builds the campaign's recipient list and enqueues one message per
 * recipient into message_queue (reusing enqueueMessage() unchanged),
 * tagged with metadata.campaign_id. Sets the campaign to 'scheduled' —
 * the queue-drain cron (processCampaignQueue) does the actual sending.
 * This function itself never calls the WhatsApp API.
 */
export async function scheduleCampaignSend(campaignId: string): Promise<{ ok: boolean; recipientCount: number; error?: string }> {
  const db = getSupabaseAdmin()

  const { data: campaign, error } = await db
    .from('broadcast_campaigns')
    .select('id, segment, message_template, is_recurring, recurrence_interval')
    .eq('id', campaignId)
    .single()

  if (error || !campaign) return { ok: false, recipientCount: 0, error: 'Campaign not found' }
  const c = campaign as unknown as CampaignRow

  const recipients = await buildSegment((c.segment ?? {}) as Parameters<typeof buildSegment>[0])

  for (const r of recipients) {
    if (!r.phone) continue
    // SELF-FOUND BUG FIX: the Campaigns UI has always told operators "Use
    // {{name}} as a placeholder for the customer name" (src/app/(crm)/
    // campaigns/page.tsx), but no code anywhere ever substituted it — every
    // campaign sent the literal string "{{name}}" to every recipient. Fixed
    // here since it directly affects message quality for the win-back
    // automation being wired up now, not scope creep.
    const personalizedMessage = c.message_template.replace(/\{\{\s*name\s*\}\}/gi, r.name?.trim() || 'there')
    await enqueueMessage({
      phone: r.phone,
      message: personalizedMessage,
      type: 'session',
      metadata: { campaign_id: campaignId, lead_id: r.id },
    })
  }

  await db
    .from('broadcast_campaigns')
    .update({ status: 'scheduled', recipient_count: recipients.length, sent_at: new Date().toISOString() })
    .eq('id', campaignId)

  return { ok: true, recipientCount: recipients.length }
}

interface QueueRow {
  id: string
  phone: string
  message: string
  metadata: { campaign_id?: string; lead_id?: string } | null
}

/**
 * Drains up to `batchSize` due, pending messages from message_queue via
 * smartSend() (rate limiting + spam check reused unchanged). This is the
 * general-purpose queue drain — NOT campaign-only. AUDIT FINDING: before
 * this pass, nothing anywhere drained message_queue at all (enqueueMessage
 * was write-only). It now serves two producers into the same queue: (1)
 * campaign sends from scheduleCampaignSend() (metadata.campaign_id set —
 * rolls sent/failed counts up into broadcast_campaigns, respects
 * pause/cancel), and (2) Customer Journey Automation's one-off scheduled
 * messages (metadata.journey set — e.g. proposal reminders, pre-arrival/
 * post-stay messages) which have no campaign to pause/cancel against and
 * are just sent as soon as they're due.
 */
export async function processCampaignQueue(batchSize = 20): Promise<{ processed: number; sent: number; failed: number; skipped: number }> {
  const db = getSupabaseAdmin()

  const { data: pending } = await db
    .from('message_queue')
    .select('id, phone, message, metadata')
    .eq('status', 'pending')
    .eq('type', 'session')
    .lte('scheduled_at', new Date().toISOString())
    .order('scheduled_at', { ascending: true })
    .limit(batchSize)

  const rows = (pending ?? []) as unknown as QueueRow[]
  if (rows.length === 0) return { processed: 0, sent: 0, failed: 0, skipped: 0 }

  const campaignIds = Array.from(new Set(rows.map((r) => r.metadata?.campaign_id).filter((id): id is string => !!id)))
  const { data: campaigns } = await db
    .from('broadcast_campaigns')
    .select('id, status')
    .in('id', campaignIds)
  const statusByCampaign = new Map((campaigns ?? []).map((c) => [c.id as string, c.status as string]))

  let sent = 0, failed = 0, skipped = 0
  const deltaByCampaign = new Map<string, { sent: number; failed: number }>()

  for (const row of rows) {
    const campaignId = row.metadata?.campaign_id
    const status = campaignId ? statusByCampaign.get(campaignId) : undefined

    if (status === 'paused') continue // leave pending — will resume later
    if (status === 'cancelled') {
      await db.from('message_queue').update({ status: 'skipped' }).eq('id', row.id)
      skipped++
      continue
    }

    try {
      // Customer Journey Timeline fix: pass leadId through so this send
      // actually shows up on the customer's Timeline (whatsapp_messages.
      // lead_id is what fetchWhatsAppEntries() filters on) — see the
      // leadId doc-comment on smartSend() in src/lib/queue.ts for the
      // full audit finding.
      const success = await smartSend(row.phone, row.message, { leadId: row.metadata?.lead_id ?? null })
      await db.from('message_queue').update({
        status: success ? 'sent' : 'failed',
        last_attempted_at: new Date().toISOString(),
        attempts: 1,
      }).eq('id', row.id)

      if (campaignId) {
        const delta = deltaByCampaign.get(campaignId) ?? { sent: 0, failed: 0 }
        if (success) delta.sent++; else delta.failed++
        deltaByCampaign.set(campaignId, delta)
      }
      if (success) sent++; else failed++
    } catch {
      await db.from('message_queue').update({ status: 'failed', last_attempted_at: new Date().toISOString(), attempts: 1 }).eq('id', row.id)
      failed++
    }
  }

  // Roll deltas up into each affected campaign's counters, and mark
  // 'completed' once no pending messages remain for it.
  for (const [campaignId, delta] of Array.from(deltaByCampaign.entries())) {
    const { data: campaign } = await db.from('broadcast_campaigns').select('sent_count, failed_count').eq('id', campaignId).single()
    const { count: remaining } = await db
      .from('message_queue')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')
      .eq('metadata->>campaign_id', campaignId)

    await db.from('broadcast_campaigns').update({
      sent_count: (campaign?.sent_count ?? 0) + delta.sent,
      failed_count: (campaign?.failed_count ?? 0) + delta.failed,
      ...(remaining === 0 ? { status: 'completed' } : {}),
    }).eq('id', campaignId)
  }

  return { processed: rows.length, sent, failed, skipped }
}

/**
 * Recurring campaigns: for every is_recurring campaign whose next_run_at
 * has passed, re-runs scheduleCampaignSend() (rebuilding the segment fresh
 * — new/changed matches are naturally picked up) and advances next_run_at
 * by the configured interval. Bounded to campaigns actually due; not a
 * per-campaign polling loop across all campaigns.
 */
export async function advanceRecurringCampaigns(): Promise<{ triggered: number }> {
  const db = getSupabaseAdmin()
  const { data: due } = await db
    .from('broadcast_campaigns')
    .select('id, recurrence_interval')
    .eq('is_recurring', true)
    .lte('next_run_at', new Date().toISOString())

  const rows = (due ?? []) as unknown as Array<{ id: string; recurrence_interval: string | null }>
  let triggered = 0

  for (const row of rows) {
    const days = RECURRENCE_DAYS[row.recurrence_interval ?? 'weekly'] ?? 7
    const result = await scheduleCampaignSend(row.id)
    if (result.ok) {
      await db.from('broadcast_campaigns').update({
        next_run_at: new Date(Date.now() + days * 86_400_000).toISOString(),
      }).eq('id', row.id)
      triggered++
    }
  }

  return { triggered }
}
