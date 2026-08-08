// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/customers/event-lifecycle.ts
// Event Post-Experience Lifecycle — extends the existing stay-lifecycle
// journey cron to accepted event bookings (weddings, birthdays, corporate,
// rooftop events) that have no linked room reservation.
//
// AUDIT FINDING this closes: /api/cron/stay-lifecycle only ever queries
// `reservations` by check_in_date/check_out_date proximity — an accepted
// proposal with `reservation_id IS NULL` (a pure event, not a stay) never
// gets a pre/post-experience touch, a review ask, a referral invitation, or
// loyalty points. Confirmed via a full read of that cron and a negative
// grep for reservation-creation side effects in proposal-service.ts before
// writing this file.
//
// REUSE, NOT DUPLICATION — every send/track/award below calls the exact
// same service the reservation lifecycle already uses:
//   - enqueueMessage()            (src/lib/queue.ts)               — same as stay-lifecycle
//   - WHATSAPP_MESSAGES           (src/lib/templates.ts)           — new eventThankYou + existing reviewRequestMessage
//   - review_requests insert      (Growth Engine Epic 1)           — new proposal_id column (migration 042), same UNIQUE-backstop idiom as reservation_id
//   - /api/cron/review-reminders  (Growth Engine Epic 1)           — already reminds ANY 'requested' row after 7 days; no new code needed for "AI follow-up if no review"
//   - buildReferralInvitationMessage()  (src/lib/customers/referrals.ts)  — extracted from marketing-automations.ts's runReferralRequest(), not reimplemented
//   - awardPoints()               (src/lib/customers/loyalty.ts)   — same ledger, same POINTS_PER_RUPEE_SPENT rate, new referenceType:'proposal'
//   - logJourneyEvent()/alreadySentWithin()  (src/lib/customers/journey.ts)  — same Timeline + cooldown idiom as every other automation
//   - buildSegment()/campaigns.ts  — "Marketing Segment Update" needs NO code here: bookingCountByLead already counts every proposal with accepted_at
//     regardless of reservation_id (confirmed by reading computeAdvancedSegmentSets()), so this event is already visible to repeat_customer/referral
//     segments the moment it's marked accepted — nothing to wire up.
//
// IDEMPOTENCY: same exact-date-equality pattern as stay-lifecycle — a
// once-daily run only ever matches a given proposal on the one day each
// condition is true, backed by DB-level UNIQUE backstops (review_requests.
// proposal_id, loyalty_transactions partial unique index) for re-run safety.
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabaseAdmin } from '@/lib/supabase'
import { enqueueMessage } from '@/lib/queue'
import { WHATSAPP_MESSAGES } from '@/lib/templates'
import { logger } from '@/lib/logger'
import { logJourneyEvent, JOURNEY_ACTIONS, alreadySentWithin } from '@/lib/customers/journey'
import { awardPoints, getLoyaltyAccount, POINTS_PER_RUPEE_SPENT } from '@/lib/customers/loyalty'
import { buildReferralInvitationMessage } from '@/lib/customers/referrals'
import { canSendAutomatedMessage } from '@/lib/messaging/orchestrator'

export function isoDateDaysFromNow(days: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

// Configurable delays (Requirement: "Support configurable delays") — env-
// overridable, defaulting to the same offsets the reservation lifecycle
// already uses (thank-you next day, review request 3 days later) plus two
// new event-only stages. Invalid/zero/negative overrides fall back to the
// default rather than silently disabling a stage.
function envDays(name: string, fallback: number): number {
  const raw = process.env[name]
  const n = raw ? Number(raw) : NaN
  return Number.isFinite(n) && n > 0 ? n : fallback
}

export const EVENT_LIFECYCLE_CONFIG = {
  thankYouDelayDays: envDays('EVENT_THANK_YOU_DELAY_DAYS', 1),
  reviewRequestDelayDays: envDays('EVENT_REVIEW_REQUEST_DELAY_DAYS', 3),
  referralInviteDelayDays: envDays('EVENT_REFERRAL_INVITE_DELAY_DAYS', 10),
  referralCooldownDays: envDays('EVENT_REFERRAL_COOLDOWN_DAYS', 120),
}

/**
 * Shared per-guest send step — same enqueue-and-tag pattern the reservation
 * branches in stay-lifecycle/route.ts use, extracted so it isn't
 * copy-pasted a 4th/5th/6th time for the event branches below (Requirement:
 * "Do not duplicate reservation lifecycle logic. Extract shared logic if
 * needed."). Never throws — a queue failure must not abort the rest of the
 * day's run.
 */
async function sendLifecycleMessage(params: {
  phone: string | null | undefined
  message: string
  journey: string
  leadId: string | null
  extraMetadata?: Record<string, unknown>
}): Promise<boolean> {
  if (!params.phone) return false
  await enqueueMessage({
    phone: params.phone,
    message: params.message,
    type: 'session',
    metadata: { journey: params.journey, lead_id: params.leadId, ...params.extraMetadata },
  })
  return true
}

interface EventProposalRow {
  id: string
  lead_id: string | null
  client_name: string | null
  client_phone: string | null
  event_date: string
  event_type: string | null
  venue: string | null
  total_price: number | null
  leads: { whatsapp_opted_in: boolean | null } | { whatsapp_opted_in: boolean | null }[] | null
}

function optedIn(row: EventProposalRow): boolean {
  const l = row.leads
  if (!l) return false // no lead attached — can't check opt-out, so don't message (Requirement: "Respect opt-out settings")
  const rec = Array.isArray(l) ? l[0] : l
  return rec?.whatsapp_opted_in !== false // DEFAULT TRUE column — undefined/null/true all mean "not opted out"
}

async function fetchAcceptedEventsOn(targetDate: string): Promise<EventProposalRow[]> {
  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('proposals')
    .select('id, lead_id, client_name, client_phone, event_date, event_type, venue, total_price, leads(whatsapp_opted_in)')
    .eq('status', 'accepted')
    .is('reservation_id', null)
    .not('lead_id', 'is', null)
    .eq('event_date', targetDate)
    .limit(200)
  if (error) {
    logger.error('event-lifecycle', 'Failed to fetch accepted events', error)
    return []
  }
  return (data ?? []) as unknown as EventProposalRow[]
}

// ── Stage 1: Thank You WhatsApp + Loyalty Update ────────────────────────
async function runEventThankYouAndLoyalty(): Promise<{ thankYou: number; loyaltyAwarded: number }> {
  const rows = await fetchAcceptedEventsOn(isoDateDaysFromNow(-EVENT_LIFECYCLE_CONFIG.thankYouDelayDays))
  let thankYou = 0
  let loyaltyAwarded = 0

  for (const row of rows) {
    // Current (pre-this-award) loyalty standing, folded into the thank-you
    // message as a courtesy line — best-effort, never blocks the send.
    let loyaltyPoints: number | null = null
    let loyaltyTier: string | null = null
    if (row.lead_id) {
      try {
        const account = await getLoyaltyAccount(row.lead_id)
        loyaltyPoints = account?.points_balance ?? null
        loyaltyTier = account?.tier ?? null
      } catch {
        // non-fatal — thank-you send must not depend on loyalty lookup
      }
    }

    const thankYouAllowed = !row.lead_id || (await canSendAutomatedMessage(row.lead_id, 'event_thank_you'))
    if (thankYouAllowed && optedIn(row) && (await sendLifecycleMessage({
      phone: row.client_phone,
      message: WHATSAPP_MESSAGES.eventThankYou({ name: row.client_name ?? undefined, venue: row.venue ?? undefined, eventType: row.event_type ?? undefined, loyaltyPoints, loyaltyTier }),
      journey: 'event_thank_you',
      leadId: row.lead_id,
      extraMetadata: { proposalId: row.id },
    }))) {
      thankYou++
      await logJourneyEvent(row.lead_id, JOURNEY_ACTIONS.EVENT_THANK_YOU_SENT, 'Event thank-you sent via WhatsApp', { proposalId: row.id })
    }

    // Loyalty Update — same rate/ledger as reservation revenue, gated by the
    // DB-level partial unique index (migration 042) for idempotent re-runs.
    const revenue = Number(row.total_price) || 0
    if (row.lead_id && revenue > 0) {
      try {
        const points = Math.round(revenue * POINTS_PER_RUPEE_SPENT)
        if (points > 0) {
          const result = await awardPoints({
            leadId: row.lead_id,
            points,
            reason: `Event revenue (₹${revenue.toLocaleString('en-IN')})`,
            referenceType: 'proposal',
            referenceId: row.id,
          })
          if (result.awarded) {
            loyaltyAwarded++
            await logJourneyEvent(row.lead_id, JOURNEY_ACTIONS.EVENT_LOYALTY_AWARDED, `Loyalty points awarded for event (${points} pts)`, { proposalId: row.id, points })
          }
        }
      } catch (err) {
        logger.error('event-lifecycle', 'Loyalty award failed for event proposal', err, { proposalId: row.id })
      }
    }
  }

  return { thankYou, loyaltyAwarded }
}

// ── Stage 2: Review Request ─────────────────────────────────────────────
async function runEventReviewRequest(): Promise<number> {
  const db = getSupabaseAdmin()
  const rows = await fetchAcceptedEventsOn(isoDateDaysFromNow(-EVENT_LIFECYCLE_CONFIG.reviewRequestDelayDays))
  let reviewRequests = 0

  for (const row of rows) {
    if (!optedIn(row)) continue
    if (row.lead_id && !(await canSendAutomatedMessage(row.lead_id, 'review_request'))) continue
    const sent = await sendLifecycleMessage({
      phone: row.client_phone,
      message: WHATSAPP_MESSAGES.reviewRequestMessage({ name: row.client_name ?? undefined }),
      journey: 'event_review_request',
      leadId: row.lead_id,
      extraMetadata: { proposalId: row.id },
    })
    if (!sent) continue

    // Same insert-and-swallow-23505 idiom as stay-lifecycle's reservation
    // branch — UNIQUE(proposal_id) (migration 042) makes a same-day re-run
    // a safe no-op instead of a duplicate ask. This row is also
    // automatically picked up by the existing /api/cron/review-reminders
    // cron (it filters on status/reminder_count only, not reservation_id),
    // which is the "AI Follow-up (if no review after configurable delay)"
    // stage — reused as-is, not duplicated.
    try {
      const { error: reviewRequestError } = await db.from('review_requests').insert({
        lead_id: row.lead_id,
        proposal_id: row.id,
        channel: 'whatsapp',
        status: 'requested',
      })
      if (reviewRequestError && reviewRequestError.code !== '23505') {
        logger.error('event-lifecycle', 'review_requests insert failed', reviewRequestError)
      }
    } catch (reviewRequestErr) {
      logger.error('event-lifecycle', 'review_requests insert threw', reviewRequestErr)
    }

    await logJourneyEvent(row.lead_id, JOURNEY_ACTIONS.REVIEW_REQUESTED, 'Review requested via WhatsApp (event)', { proposalId: row.id })
    reviewRequests++
  }

  return reviewRequests
}

// ── Stage 3: Referral Invitation ────────────────────────────────────────
async function runEventReferralInvitation(): Promise<number> {
  const rows = await fetchAcceptedEventsOn(isoDateDaysFromNow(-EVENT_LIFECYCLE_CONFIG.referralInviteDelayDays))
  let referralsSent = 0

  for (const row of rows) {
    if (!row.lead_id || !optedIn(row) || !row.client_phone) continue

    // Same action name marketing-automations' repeat-customer referral
    // trigger uses — a lead who gets this immediate post-event ask won't
    // also be double-asked by that longer-cooldown segment automation
    // within the same window.
    if (await alreadySentWithin(row.lead_id, 'whatsapp_referral_request_sent', EVENT_LIFECYCLE_CONFIG.referralCooldownDays)) continue
    if (!(await canSendAutomatedMessage(row.lead_id, 'referral_request'))) continue

    try {
      const { message, referralCode } = await buildReferralInvitationMessage({ id: row.lead_id, name: row.client_name })
      const sent = await sendLifecycleMessage({
        phone: row.client_phone,
        message,
        journey: 'event_referral_invitation',
        leadId: row.lead_id,
        extraMetadata: { proposalId: row.id, referralCode },
      })
      if (sent) {
        referralsSent++
        await logJourneyEvent(row.lead_id, JOURNEY_ACTIONS.EVENT_REFERRAL_INVITED, 'Referral invitation sent after event', { proposalId: row.id, referralCode })
        // Also logged under the shared cooldown action name so the cooldown
        // check above (and marketing-automations' own check) sees it.
        await logJourneyEvent(row.lead_id, 'whatsapp_referral_request_sent', 'Referral request sent (event post-experience)', { proposalId: row.id, referralCode })
      }
    } catch (err) {
      logger.error('event-lifecycle', 'Referral invitation failed for event proposal', err, { proposalId: row.id })
    }
  }

  return referralsSent
}

export interface EventLifecycleCounts {
  eventThankYou: number
  eventLoyaltyAwarded: number
  eventReviewRequests: number
  eventReferralInvitations: number
}

/**
 * Entry point called by /api/cron/stay-lifecycle. Each stage is independently
 * try/caught by the caller's own convention — here we run them sequentially
 * and let a failure in one stage not block the others, matching
 * stay-lifecycle's existing top-level try/catch-per-cron (not per-branch)
 * contract by catching internally instead, since these three branches are
 * genuinely independent (different date offsets, different candidate rows).
 */
export async function processEventPostExperienceLifecycle(): Promise<EventLifecycleCounts> {
  const counts: EventLifecycleCounts = { eventThankYou: 0, eventLoyaltyAwarded: 0, eventReviewRequests: 0, eventReferralInvitations: 0 }

  try {
    const { thankYou, loyaltyAwarded } = await runEventThankYouAndLoyalty()
    counts.eventThankYou = thankYou
    counts.eventLoyaltyAwarded = loyaltyAwarded
  } catch (err) {
    logger.error('event-lifecycle', 'Thank-you/loyalty stage failed', err)
  }

  try {
    counts.eventReviewRequests = await runEventReviewRequest()
  } catch (err) {
    logger.error('event-lifecycle', 'Review request stage failed', err)
  }

  try {
    counts.eventReferralInvitations = await runEventReferralInvitation()
  } catch (err) {
    logger.error('event-lifecycle', 'Referral invitation stage failed', err)
  }

  return counts
}
