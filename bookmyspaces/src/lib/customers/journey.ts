// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/customers/journey.ts
// Growth Engine Epic 4 — Customer Journey Engine.
//
// KEY REUSE DECISION: this does NOT introduce a new "journey_events" table.
// `activity_logs` is already the established, generic per-lead event log
// (written by reservation-workflow.ts's logActivity(), POST /api/campaigns/
// track, and others) and is ALREADY read generically by
// src/lib/timeline/timeline-service.ts — any `activity_logs.action` not in
// its FOLLOWUP_ACTIONS set renders as a 'lead_activity' Timeline entry with
// a human-readable title automatically. Logging journey events into
// activity_logs means they show up on the existing Customer Timeline UI
// with ZERO new UI work, and reuses the exact write shape
// reservation-workflow.ts's logActivity() already established (lead_id,
// action, description, performed_by, metadata) — confirmed by reading that
// function before writing this file, not assumed.
//
// The Lead -> Qualified -> Proposal -> Negotiation -> Booked -> Completed
// portion of the journey already has a real, working funnel
// (revenue-intelligence.ts's computeFunnel()) — not rebuilt here.
// computeJourneyFunnel() below extends it with the stages that didn't exist
// anywhere: Review Requested/Completed, Referral Made, Repeat Booking, VIP.
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabaseAdmin } from '@/lib/supabase'

export const JOURNEY_ACTIONS = {
  REVIEW_REQUESTED: 'review_requested',
  REVIEW_COMPLETED: 'review_completed',
  REFERRAL_ATTRIBUTED: 'referral_attributed',
  REPEAT_BOOKING: 'repeat_booking_reached',
  VIP_REACHED: 'vip_tier_reached',
  // Event Post-Experience Lifecycle (non-reservation bookings — accepted
  // proposals with no linked reservation: weddings, birthdays, corporate,
  // rooftop events). Mirrors the reservation journey's stages so the
  // Timeline reads consistently regardless of booking type.
  EVENT_THANK_YOU_SENT: 'event_thank_you_sent',
  EVENT_REFERRAL_INVITED: 'event_referral_invited',
  EVENT_LOYALTY_AWARDED: 'event_loyalty_awarded',
  // Business Package Engine — logged wherever a lead/proposal/reservation
  // is tagged with (or inherits) a business_package_id, so the Customer
  // Timeline shows package attribution without any new UI (activity_logs
  // rows with an unrecognized action already render generically — see this
  // file's header comment).
  BUSINESS_PACKAGE_ASSIGNED: 'business_package_assigned',
  // Customer Loyalty & Referral Experience — logged whenever awardPoints()
  // (loyalty.ts) actually sends the customer a WhatsApp update. Distinct
  // from EVENT_LOYALTY_AWARDED below (which documents WHY points were
  // given, from the event-lifecycle cron specifically) — this documents
  // that the customer was notified, regardless of which caller triggered
  // the award (reservation sync, event-lifecycle, or a manual admin
  // adjustment).
  LOYALTY_POINTS_AWARDED: 'loyalty_points_awarded',
  // Generalizes VIP_REACHED to any tier transition (Bronze->Silver->Gold),
  // logged in addition to VIP_REACHED (kept as-is, unchanged) when the tier
  // reached is VIP specifically.
  LOYALTY_TIER_UPGRADED: 'loyalty_tier_upgraded',
  // Referral Engine — a reward's status changed (created as 'earned',
  // promoted from 'pending', or an operator's manual PATCH), so the
  // Timeline shows the referrer's reward history without new UI.
  REFERRAL_REWARD_STATUS_CHANGED: 'referral_reward_status_changed',
  // Messaging Orchestrator (Production Stabilization) — these three sends
  // previously logged nothing to activity_logs at all, leaving the shared
  // orchestrator with no way to observe them. Added purely so
  // canSendAutomatedMessage() (src/lib/messaging/orchestrator.ts) has a
  // record to check against; no new send/track behavior otherwise.
  PRE_ARRIVAL_SENT: 'whatsapp_pre_arrival_sent',
  POST_STAY_THANK_YOU_SENT: 'whatsapp_post_stay_thank_you_sent',
  REVIEW_REMINDER_SENT: 'whatsapp_review_reminder_sent',
} as const

/**
 * Cooldown/dedup guard shared by every automated WhatsApp trigger that fires
 * off a recurring cron (birthday, win-back, referral request, event
 * lifecycle, ...): has this exact action already been logged for this lead
 * within the last N days? Extracted from marketing-automations/route.ts
 * (was a private, duplicated-in-spirit helper) so the new Event
 * Post-Experience Lifecycle can reuse the identical idiom — including
 * reusing the SAME action name where appropriate (e.g.
 * 'whatsapp_referral_request_sent') so two different triggers never double-
 * ask the same lead within the cooldown window.
 */
export async function alreadySentWithin(leadId: string, action: string, cooldownDays: number): Promise<boolean> {
  const db = getSupabaseAdmin()
  const since = new Date(Date.now() - cooldownDays * 86400000).toISOString()
  const { count } = await db
    .from('activity_logs')
    .select('id', { count: 'exact', head: true })
    .eq('lead_id', leadId)
    .eq('action', action)
    .gte('created_at', since)
  return (count ?? 0) > 0
}

/**
 * Logs a journey event onto the lead's existing activity trail. Same
 * best-effort, never-block-the-caller contract as reservation-workflow.ts's
 * logActivity() — a logging failure must never fail the operation that
 * triggered it (a review request, a referral match, etc.).
 */
export async function logJourneyEvent(
  leadId: string | null | undefined,
  action: string,
  description: string,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  if (!leadId) return
  try {
    await getSupabaseAdmin().from('activity_logs').insert({
      lead_id: leadId,
      action,
      description,
      performed_by: 'system',
      metadata,
    })
  } catch {
    // non-fatal — journey visibility, not a correctness requirement
  }
}

export interface JourneyEntry {
  action: string
  description: string | null
  createdAt: string
  metadata: Record<string, unknown>
}

/** Reusable per-lead journey history — every activity_logs row for this lead, chronological. Powers both this Epic's funnel and (already, for free) the existing Customer Timeline. */
export async function getJourneyForLead(leadId: string): Promise<JourneyEntry[]> {
  const db = getSupabaseAdmin()
  const { data } = await db
    .from('activity_logs')
    .select('action, description, created_at, metadata')
    .eq('lead_id', leadId)
    .order('created_at', { ascending: true })
    .limit(200)

  return ((data ?? []) as unknown as Array<{ action: string; description: string | null; created_at: string; metadata: Record<string, unknown> | null }>)
    .map((r) => ({ action: r.action, description: r.description, createdAt: r.created_at, metadata: r.metadata ?? {} }))
}

export interface JourneyStageCount {
  stage: string
  count: number
}

/**
 * Post-booking journey stages (the Sales funnel — Lead through Booked —
 * already exists in revenue-intelligence.ts's computeFunnel(); this
 * deliberately does not recompute it). Each stage is a distinct-lead count,
 * bounded fetch + in-memory Set dedup, same performance contract used
 * throughout this codebase.
 */
export async function computeJourneyFunnel(): Promise<JourneyStageCount[]> {
  const db = getSupabaseAdmin()

  const [reviewRequested, reviewCompleted, referrers, repeatBookers, vipAccounts] = await Promise.all([
    db.from('activity_logs').select('lead_id').eq('action', JOURNEY_ACTIONS.REVIEW_REQUESTED),
    db.from('activity_logs').select('lead_id').eq('action', JOURNEY_ACTIONS.REVIEW_COMPLETED),
    db.from('referral_rewards').select('referrer_lead_id'),
    db.from('activity_logs').select('lead_id').eq('action', JOURNEY_ACTIONS.REPEAT_BOOKING),
    db.from('loyalty_accounts').select('lead_id').eq('tier', 'VIP'),
  ])

  const distinctCount = (rows: Array<{ lead_id?: string | null; referrer_lead_id?: string | null }> | null, key: 'lead_id' | 'referrer_lead_id') =>
    new Set((rows ?? []).map((r) => r[key]).filter(Boolean)).size

  return [
    { stage: 'Review Requested', count: distinctCount(reviewRequested.data, 'lead_id') },
    { stage: 'Review Completed', count: distinctCount(reviewCompleted.data, 'lead_id') },
    { stage: 'Referral Made', count: distinctCount(referrers.data, 'referrer_lead_id') },
    { stage: 'Repeat Booking', count: distinctCount(repeatBookers.data, 'lead_id') },
    { stage: 'VIP', count: distinctCount(vipAccounts.data, 'lead_id') },
  ]
}
