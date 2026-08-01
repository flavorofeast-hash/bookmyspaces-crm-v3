// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/app/api/dashboard/chief-of-staff/route.ts
// Version 3.0 — AI Chief of Staff.
//
// This route does no computation of its own — it composes
// buildExecutiveBrief() (src/lib/chief-of-staff/executive-brief-service.ts),
// which itself composes buildFounderBrief() + buildRevenueIntelligence() +
// proposal-intelligence.ts's computeProposalUrgency(). See that file's
// header for the full reuse/new-query disclosure.
//
// Notifications (Version 3.0's "notify only when meaningful") run AFTER the
// brief is built and are wrapped so a notification-write failure never
// fails this route — the brief itself (what the Founder sees) must always
// succeed; notifications are a side effect, not a dependency.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { requireAuth } from '@/lib/auth-guard'
import { buildExecutiveBrief } from '@/lib/chief-of-staff/executive-brief-service'
import { notifyMeaningfulEvents } from '@/lib/chief-of-staff/notification-producer'

export async function GET(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response

  const windowDays = Number(req.nextUrl.searchParams.get('days')) || 90
  const skipNotifications = req.nextUrl.searchParams.get('notify') === 'false'

  try {
    const brief = await buildExecutiveBrief(windowDays)

    let notifications: { audienceSize: number; written: number; skippedCapped: number; errors: string[] } | null = null
    if (!skipNotifications) {
      try {
        notifications = await notifyMeaningfulEvents(brief, brief.urgentProposals)
      } catch (err) {
        logger.error('dashboard/chief-of-staff', 'notifyMeaningfulEvents failed (non-fatal, brief still returned)', err)
      }
    }

    return NextResponse.json({
      date: brief.date,
      windowDays: brief.windowDays,
      businessHealthScore: brief.businessHealthScore,
      summaries: brief.summaries,
      todaysPriorities: brief.todaysPriorities,
      predictiveInsights: brief.predictiveInsights,
      aiRecommendations: brief.aiRecommendations,
      businessRisks: brief.businessRisks,
      businessOpportunities: brief.businessOpportunities,
      urgentProposalsDegraded: brief.urgentProposalsDegraded,
      // Passed through, unchanged, so the page can render existing sections
      // (Revenue Pipeline, Today's Schedule, Marketing fields, Conversion
      // Funnel) without a second fetch to a different route.
      revenuePipeline: brief.founderBrief.revenuePipeline,
      todaysSchedule: brief.founderBrief.todaysSchedule,
      funnel: brief.founderBrief.revenueIntelligence.funnel,
      channelPerformance: brief.founderBrief.revenueIntelligence.channelPerformance,
      campaignPerformance: brief.founderBrief.revenueIntelligence.campaignPerformance,
      marketingBrief: brief.founderBrief.revenueIntelligence.marketingBrief,
      notifications,
    })
  } catch (error) {
    logger.error('dashboard/chief-of-staff', 'GET failed', error)
    return NextResponse.json({ error: 'Failed to load Chief of Staff brief' }, { status: 500 })
  }
}
