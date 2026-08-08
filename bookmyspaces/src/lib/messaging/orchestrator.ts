// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/messaging/orchestrator.ts
// Production Stabilization (Priority 2) — Messaging Orchestrator.
//
// PROBLEM: eight separate automated-messaging engines already exist and
// each works correctly in isolation —
//   - Marketing Automations (/api/cron/marketing-automations/route.ts):
//     birthday/anniversary/win-back/repeat-booking/referral-request/
//     proposal-expiry/proposal-nudge/business-package-promo, each gated by
//     its OWN per-trigger cooldown via alreadySentWithin() (journey.ts).
//   - AI Follow-up Assistant (/api/cron/ai-followup-assistant/route.ts +
//     its drain cron /api/cron/followups/route.ts): drafts and sends a
//     personalized follow-up, gated only by "does this lead already have a
//     pending follow_ups row" — no time-based cooldown at all.
//   - WhatsApp Drip Sequences (src/lib/whatsapp/drip-service.ts's
//     advanceDueDripSteps()): multi-step pre-authored sequences, gated only
//     by each enrollment's own next_send_at schedule.
//   - Stay Lifecycle (/api/cron/stay-lifecycle/route.ts): pre-arrival
//     reminder, post-stay thank-you, review request — each gated only by
//     the once-daily exact-date-match idiom (no cross-engine awareness).
//   - Event Lifecycle (src/lib/customers/event-lifecycle.ts): event
//     thank-you, review request, referral invitation — same idiom.
//   - Review Reminders (/api/cron/review-reminders/route.ts): gated by
//     review_requests.reminder_count only.
//   - Loyalty Notifications (src/lib/customers/loyalty.ts's
//     notifyLoyaltyUpdate(), called from awardPoints() — the single choke
//     point for reservation sync, event-lifecycle, and manual adjustment).
//   - Referral Notifications (src/lib/customers/referrals.ts's
//     notifyReferralRewardStatusChange(), called from syncReferralRewards()
//     and the PATCH /api/referrals status-change path).
// None of the eight is aware of the other seven, so the SAME lead can
// receive a birthday wish, a drip step, a stay-lifecycle thank-you, AND a
// loyalty update on the same day — each individually "correct" per its own
// cooldown, but a poor customer experience in aggregate, and something no
// single engine can see or prevent on its own.
//
// FIX (this file): a thin, additional eligibility gate every engine calls
// ONCE per candidate lead, layered ON TOP of (never replacing) each
// engine's existing per-trigger cooldown/scheduling/idempotency logic. It
// does not re-implement scheduling, segmentation, or sending — it only
// answers "given everything already sent to this lead recently by ANY of
// the eight engines, is THIS source allowed to send right now?" Reuses the
// exact same activity_logs table + logJourneyEvent()/journey action-name
// idiom every engine already writes to (journey.ts) — no new table, no new
// send primitive, no duplicated scheduling. Two engines (stay-lifecycle's
// pre-arrival/post-stay branches, review-reminders) previously logged
// nothing to activity_logs at all; they now log their existing action name
// via logJourneyEvent() at their existing send point specifically so this
// registry has something to observe — no new journey concept invented,
// just made visible the same way every other engine already is.
//
// PRIORITY: when more than one engine's message would otherwise land on
// the same lead within SHARED_COOLDOWN_HOURS, the higher-priority source
// wins — a lower-priority candidate is blocked once anything
// equal-or-higher priority has already gone out in that window; a
// higher-priority candidate is still allowed to send even if a
// lower-priority message already went out (a proposal nudge should never
// be silently dropped just because a birthday wish fired first). Real
// transactional consequences of something the customer just did (a
// reservation, a referral reward, a loyalty award) are ranked above
// generic outbound marketing, which is ranked above a pre-authored drip
// step — see AUTOMATION_SOURCES below for the exact ordering.
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabaseAdmin } from '@/lib/supabase'

export type AutomationSource =
  | 'proposal_nudge'
  | 'proposal_expiry'
  | 'referral_reward_update'
  | 'loyalty_update'
  | 'pre_arrival'
  | 'event_thank_you'
  | 'post_stay_thank_you'
  | 'ai_followup'
  | 'referral_request'
  | 'repeat_booking'
  | 'business_package_promo'
  | 'review_request'
  | 'winback'
  | 'review_reminder'
  | 'birthday'
  | 'anniversary'
  | 'drip_sequence'

interface SourceDefinition {
  /** Higher wins when two sources' messages would otherwise collide within the shared cooldown window. */
  priority: number
  /** The exact activity_logs.action string this source's engine already writes on a successful send. */
  action: string
}

// One entry per automated-send action string already in use across the
// eight engines (confirmed by reading each route/service before writing
// this). Two action names are deliberately SHARED across two engines that
// already log the identical string for the identical customer-facing ask:
//   - 'review_requested' — stay-lifecycle's reservation branch AND
//     event-lifecycle's event branch both already log this exact action
//     (Growth Engine Epic 1), so one 'review_request' source covers both
//     without inventing a second name.
//   - 'whatsapp_referral_request_sent' — event-lifecycle's referral
//     invitation already deliberately double-logs under this same action
//     name (see event-lifecycle.ts's own comment on that call) specifically
//     so it shares marketing-automations' referral cooldown; 'referral_request'
//     below reuses that existing convention, not a new one.
export const AUTOMATION_SOURCES: Record<AutomationSource, SourceDefinition> = {
  proposal_nudge: { priority: 100, action: 'whatsapp_proposal_nudge_sent' },
  proposal_expiry: { priority: 95, action: 'whatsapp_proposal_expiry_sent' },
  referral_reward_update: { priority: 93, action: 'referral_reward_status_changed' },
  loyalty_update: { priority: 92, action: 'loyalty_points_awarded' },
  pre_arrival: { priority: 90, action: 'whatsapp_pre_arrival_sent' },
  event_thank_you: { priority: 85, action: 'event_thank_you_sent' },
  post_stay_thank_you: { priority: 85, action: 'whatsapp_post_stay_thank_you_sent' },
  ai_followup: { priority: 80, action: 'whatsapp_ai_followup_sent' },
  referral_request: { priority: 60, action: 'whatsapp_referral_request_sent' },
  repeat_booking: { priority: 55, action: 'whatsapp_repeat_booking_sent' },
  business_package_promo: { priority: 50, action: 'whatsapp_business_package_promo_sent' },
  review_request: { priority: 47, action: 'review_requested' },
  winback: { priority: 40, action: 'whatsapp_winback_sent' },
  review_reminder: { priority: 35, action: 'whatsapp_review_reminder_sent' },
  birthday: { priority: 30, action: 'whatsapp_birthday_sent' },
  anniversary: { priority: 30, action: 'whatsapp_anniversary_sent' },
  drip_sequence: { priority: 20, action: 'drip_sequence_step_sent' },
}

const ACTION_TO_SOURCE: Map<string, AutomationSource> = new Map(
  (Object.entries(AUTOMATION_SOURCES) as [AutomationSource, SourceDefinition][]).map(([source, def]) => [def.action, source])
)

const ALL_ACTIONS = Object.values(AUTOMATION_SOURCES).map((d) => d.action)

/** Same-day pile-up window — deliberately shorter than any engine's own per-trigger cooldown (which stays in place unchanged); this only stops multiple DIFFERENT automated sources from stacking on the same lead within one day. */
export const SHARED_COOLDOWN_HOURS = 20

/**
 * The single shared eligibility check every automated-messaging engine
 * calls exactly once per candidate lead, in addition to (not instead of)
 * its own existing cooldown check. Returns false when a message from an
 * equal-or-higher-priority source already went out to this lead within
 * SHARED_COOLDOWN_HOURS; true otherwise (including when nothing has been
 * sent, or when only a lower-priority source has sent recently).
 */
export async function canSendAutomatedMessage(leadId: string, source: AutomationSource): Promise<boolean> {
  const db = getSupabaseAdmin()
  const since = new Date(Date.now() - SHARED_COOLDOWN_HOURS * 3600_000).toISOString()

  const { data, error } = await db
    .from('activity_logs')
    .select('action')
    .eq('lead_id', leadId)
    .in('action', ALL_ACTIONS)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  // Fail open: an orchestration-layer read failure must never block a
  // message an engine's own (already-proven) cooldown logic has approved —
  // this gate is an additional safety net, not the primary correctness
  // guarantee.
  if (error || !data) return true

  const lastSource = ACTION_TO_SOURCE.get(data.action)
  if (!lastSource) return true

  return AUTOMATION_SOURCES[source].priority > AUTOMATION_SOURCES[lastSource].priority
}
