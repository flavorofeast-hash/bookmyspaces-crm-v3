// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/chief-of-staff/notification-producer.ts
// Version 3.0 (AI Chief of Staff) — Notifications.
//
// "Reuse existing notification system. Notify only when meaningful."
//
// The `notifications` table + GET/PATCH /api/notifications ALREADY EXIST
// and are a real, working read/mark-read API (owner-scoped RLS,
// `auth.uid() = user_id` — confirmed the best-designed RLS in the schema
// per audit/LIVE_SCHEMA_AUDIT.md). But a repo-wide search found NO producer
// anywhere — nothing in this codebase, not escalations, not high-value
// leads, not lost revenue, ever inserts a row. This module is the first
// writer. That is legitimate new orchestration (there is no existing
// "create a notification" service to duplicate), not a second notification
// system — every write goes into the SAME `notifications` table the
// existing GET/PATCH route already serves.
//
// SCHEMA CAVEAT (disclosed, not assumed silently): `notifications` is
// documented in audit/DATABASE_RECONCILIATION.md as "not in any migration
// file" — an undocumented live production object. Only five columns are
// confirmed by reading actual code that reads/writes it (src/app/api/
// notifications/route.ts, the notification_summary view in migration 009):
// user_id, is_read, dismissed_at, read_at, created_at, priority. This
// module additionally writes `title`/`message` — the conventional pair for
// a notification's content — which is a REASONABLE, but UNVERIFIED,
// assumption (see scripts/verify-notifications-columns.sql, added
// alongside this file, and GO_LIVE_CHECKLIST.md). Every insert is wrapped
// in its own try/catch and never throws: if the real column names differ,
// this degrades to "no notifications written, logged," never a broken
// Executive Brief (notifications are a side effect of the brief, not a
// dependency of it).
//
// SPAM GUARD: before writing anything for a given user, this module checks
// how many unread, undismissed notifications they already have. If that's
// at or above NOTIFICATION_CAP, nothing new is written for them this run —
// "do not spam," enforced with only the columns already confirmed to exist
// (no assumed dedupe-key column required).
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabaseAdmin } from '@/lib/supabase'
import type { ExecutiveBrief } from './executive-brief-service'
import type { UrgentProposal } from './executive-brief-service'

const NOTIFICATION_CAP = 5
const OCCUPANCY_ALMOST_FULL_PCT = 90
const REVENUE_TREND_DROP_THRESHOLD = 30 // businessHealthScore's revenueTrend factor, 0-100, flat=50

export interface CandidateNotification {
  title: string
  message: string
  priority: 'normal' | 'high' | 'urgent'
}

function buildCandidates(brief: ExecutiveBrief, urgentProposals: UrgentProposal[]): CandidateNotification[] {
  const candidates: CandidateNotification[] = []
  const ri = brief.founderBrief.revenueIntelligence

  // High-value lead arrived — top HIGH-band opportunity, if any.
  const topHighValue = brief.founderBrief.todaysOpportunities.find((o) => o.revenueProbability.band === 'HIGH')
  if (topHighValue) {
    candidates.push({
      title: `High-value lead: ${topHighValue.customerName ?? 'Unnamed lead'}`,
      message: `Revenue Probability ${topHighValue.revenueProbability.score}/100.${topHighValue.expectedRevenue != null ? ` Expected ₹${Math.round(topHighValue.expectedRevenue).toLocaleString('en-IN')}.` : ''}`,
      priority: 'high',
    })
  }

  // Proposal viewed multiple times, no reply.
  const hotProposal = urgentProposals.find((p) => p.viewedCount >= 3 && p.urgency.followUpRequired)
  if (hotProposal) {
    candidates.push({
      title: `Proposal viewed ${hotProposal.viewedCount} times, no reply${hotProposal.clientName ? `: ${hotProposal.clientName}` : ''}`,
      message: hotProposal.urgency.recommendation,
      priority: 'high',
    })
  }

  // Revenue dropping significantly.
  const revenueTrendFactor = brief.businessHealthScore.factors.find((f) => f.key === 'revenueTrend')
  if (revenueTrendFactor?.value != null && revenueTrendFactor.value < REVENUE_TREND_DROP_THRESHOLD) {
    candidates.push({
      title: 'Revenue trending down',
      message: `Month-over-month revenue is down (Business Health revenue-trend factor: ${revenueTrendFactor.value}/100). Review Marketing Dashboard and open pipeline.`,
      priority: 'urgent',
    })
  }

  // Capacity almost full.
  if (ri.bookingAnalytics.occupancyPct !== null && ri.bookingAnalytics.occupancyPct >= OCCUPANCY_ALMOST_FULL_PCT) {
    candidates.push({
      title: `Capacity at ${ri.bookingAnalytics.occupancyPct}%`,
      message: 'Confirm availability before quoting new dates — occupancy is near full.',
      priority: 'normal',
    })
  }

  return candidates
}

export interface NotificationRunResult {
  audienceSize: number
  written: number
  skippedCapped: number
  errors: string[]
}

export async function notifyMeaningfulEvents(brief: ExecutiveBrief, urgentProposals: UrgentProposal[]): Promise<NotificationRunResult> {
  const candidates = buildCandidates(brief, urgentProposals)
  if (candidates.length === 0) return { audienceSize: 0, written: 0, skippedCapped: 0, errors: [] }
  return writeNotificationToAudience(candidates)
}

/**
 * Social Operations Priority 4 (Publish failure alerts) reuses this exact
 * function rather than a second "insert a notification" implementation —
 * extracted from notifyMeaningfulEvents() above (which now just builds its
 * own candidates and delegates here) so the founder-tier-audience lookup +
 * per-user NOTIFICATION_CAP spam guard lives in exactly one place. Any
 * future producer (a new alert type) should call this, not write to
 * `notifications` directly.
 */
export async function writeNotificationToAudience(candidates: CandidateNotification[]): Promise<NotificationRunResult> {
  const result: NotificationRunResult = { audienceSize: 0, written: 0, skippedCapped: 0, errors: [] }
  if (candidates.length === 0) return result

  try {
    const db = getSupabaseAdmin()

    // Founder-tier audience — same role convention already recommended for
    // "founder-tier access" in audit/DATABASE_RECONCILIATION.md
    // ("owner_id = auth.uid() OR role IN ('admin','manager')").
    const { data: users, error: usersError } = await db
      .from('user_profiles')
      .select('id')
      .in('role', ['admin', 'manager'])
      .eq('is_active', true)

    if (usersError) throw usersError
    const userIds = ((users ?? []) as Array<{ id: string }>).map((u) => u.id)
    result.audienceSize = userIds.length
    if (userIds.length === 0) return result

    for (const userId of userIds) {
      try {
        const { count: unreadCount, error: countError } = await db
          .from('notifications')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', userId)
          .eq('is_read', false)
          .is('dismissed_at', null)

        if (countError) throw countError
        const alreadyUnread = unreadCount ?? 0
        const room = Math.max(0, NOTIFICATION_CAP - alreadyUnread)
        if (room === 0) { result.skippedCapped += 1; continue }

        const toWrite = candidates.slice(0, room)
        for (const c of toWrite) {
          const { error: insertError } = await db.from('notifications').insert({
            user_id: userId,
            title: c.title,
            message: c.message,
            priority: c.priority,
            is_read: false,
          })
          if (insertError) throw insertError
          result.written += 1
        }
      } catch (err) {
        result.errors.push(`user ${userId}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  } catch (err) {
    result.errors.push(`audience lookup failed: ${err instanceof Error ? err.message : String(err)}`)
  }

  return result
}
