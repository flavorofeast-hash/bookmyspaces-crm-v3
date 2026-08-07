// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/app/api/dashboard/marketing/route.ts
// Version 2.1 — Marketing Intelligence Platform. "Where did every lead come
// from, which campaign generated it, which platform converted it, how much
// revenue did it produce, which advertisement should get more budget."
//
// This route does no computation of its own — it composes
// buildRevenueIntelligence() (the single, already-verified Revenue
// Intelligence service every other dashboard in this codebase reads from)
// and returns its Marketing Intelligence fields (channelPerformance,
// campaignPerformance, marketingBrief) alongside the existing Revenue
// Attribution and Conversion Funnel sections that already lived in
// eventSales/funnel — reused verbatim, not recomputed here. Same
// "route/service do the work, page just renders" split as
// dashboard/founder/route.ts.
//
// Genuinely new logic lives entirely in revenue-intelligence.ts
// (computeChannelPerformance/computeCampaignPerformance/
// computeMarketingBrief) — see that file's "Marketing Intelligence (Version
// 2.1)" section header for the reuse/gap analysis (why this is distinct
// from the pre-existing revenueByLeadSource/revenueByCampaign, which are
// proposal-scoped and outbound-broadcast-scoped respectively).
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { requireAuth } from '@/lib/auth-guard'
import { buildRevenueIntelligence } from '@/lib/analytics/revenue-intelligence'
import { computeReferralPerformance } from '@/lib/customers/referrals'
import { computeLoyaltyOverview } from '@/lib/customers/loyalty'
import { computeJourneyFunnel } from '@/lib/customers/journey'
import { computeGrowthIntelligence } from '@/lib/analytics/growth-intelligence'
import { getSupabaseAdmin } from '@/lib/supabase'
import { computeWhatsAppAnalytics, computeLikelyToBook, computeChurnRisk, computeNextBestActions } from '@/lib/analytics/marketing-ai'
import { getEngagementSummary } from '@/lib/social/metrics-service'

export async function GET(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response

  const windowDays = Number(req.nextUrl.searchParams.get('days')) || 90

  try {
    const ri = await buildRevenueIntelligence(windowDays)
    // Growth Platform Phase 2 — Referral Campaigns. Independent, cheap
    // read (two bulk queries, in-memory match) — not part of Revenue
    // Intelligence's RawData contract, so computed separately here rather
    // than growing that already-large shared fetch for a Marketing-
    // Dashboard-only section.
    const referralPerformance = await computeReferralPerformance()
    // Growth Engine Epic 2 — Referral Rewards summary counts (cheap head-
    // count queries, not the full row set).
    const db = getSupabaseAdmin()
    const [{ count: pendingRewards }, { count: earnedRewards }, { count: redeemedRewards }] = await Promise.all([
      db.from('referral_rewards').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      db.from('referral_rewards').select('id', { count: 'exact', head: true }).eq('status', 'earned'),
      db.from('referral_rewards').select('id', { count: 'exact', head: true }).eq('status', 'redeemed'),
    ])
    const referralRewards = { pending: pendingRewards ?? 0, earned: earnedRewards ?? 0, redeemed: redeemedRewards ?? 0 }

    // Growth Engine Epic 3 — Loyalty Foundation overview.
    const loyaltyOverview = await computeLoyaltyOverview()
    // Growth Engine Epic 4 — post-booking journey stage counts (extends the
    // existing Lead->Booked funnel already in ri.funnel).
    const journeyFunnel = await computeJourneyFunnel()

    // Growth Engine Epic 7 — AI Growth Intelligence. Pure composition over
    // everything already fetched above (ri, loyaltyOverview,
    // referralPerformance, referralRewards, journeyFunnel) — no new queries.
    const growthIntelligence = computeGrowthIntelligence(ri, loyaltyOverview, referralPerformance, referralRewards, journeyFunnel)

    // Phase 2 (Social + WhatsApp Growth) — Phase D: AI Marketing. Each is
    // independently best-effort (own try/catch) so one failure never blanks
    // the rest of an otherwise-working dashboard.
    const [whatsappAnalytics, socialAnalyticsResult, likelyToBook, churnRisk, nextBestActions] = await Promise.all([
      computeWhatsAppAnalytics(30).catch(() => null),
      getEngagementSummary().catch(() => null),
      computeLikelyToBook(10).catch(() => []),
      computeChurnRisk(10).catch(() => []),
      computeNextBestActions(10).catch(() => []),
    ])

    return NextResponse.json({
      windowDays,
      // Lead Source Analysis / per-channel required fields (Leads, Qualified
      // Leads, Proposals, Bookings, Revenue, Conversion%, Avg Booking Value).
      channelPerformance: ri.channelPerformance,
      // Campaign Attribution — inbound ad/landing-page campaigns (migration
      // 026). degraded=true means migration 026 isn't live yet; the UI must
      // show that explicitly, never fabricate a per-campaign breakdown.
      campaignPerformance: ri.campaignPerformance,
      // AI Marketing Brief — deterministic, template-grounded (no real LLM
      // call), same convention as the Founder Dashboard's own AI Morning
      // Brief.
      marketingBrief: ri.marketingBrief,
      // Revenue Attribution — answers "which event type/property/package
      // sells best," reused verbatim from the existing Event Sales
      // Dashboard, not recomputed.
      revenueByEventType: ri.eventSales.revenueByEventType,
      revenueByVenue: ri.eventSales.revenueByVenue,
      revenueByPackage: ri.eventSales.revenueByPackage,
      // Conversion Funnel — reused verbatim from the existing Sales Funnel.
      funnel: ri.funnel,
      // Growth Platform Phase 1 — outbound campaign ROI (revenue ÷ operator-
      // entered budget, migration 030). Distinct from the ad-spend caveat
      // below, which is about INBOUND channel spend (Facebook/Google ads —
      // still untracked).
      campaignROI: ri.campaignROI,
      // Growth Engine Epic 6 — linear multi-touch upgrade of the same
      // outbound campaign send history campaignROI (above) attributes
      // first-touch. Additive field; campaignROI's own numbers are
      // unchanged.
      multiTouchAttribution: ri.multiTouchAttribution,
      // Growth Platform Phase 1 — Customer Lifetime Value / customer health,
      // reused verbatim from Revenue Intelligence's existing Customer
      // Analytics section (not recomputed here).
      customerAnalytics: ri.customerAnalytics,
      // Growth Platform Phase 2 — Referral Campaigns performance.
      referralPerformance,
      // Growth Engine Epic 2 — Referral rewards status summary.
      referralRewards,
      // Growth Engine Epic 3 — Loyalty Foundation overview.
      loyaltyOverview,
      // Growth Engine Epic 4 — post-booking Customer Journey stage counts.
      journeyFunnel,
      // Growth Engine Epic 7 — AI Growth Intelligence (deterministic,
      // template-grounded recommendations — see growth-intelligence.ts).
      growthIntelligence,
      // ROI Dashboard note: this system does not track inbound ad spend
      // anywhere (no spend-capture path exists for any channel), so a true
      // channel-level ROI (revenue ÷ spend) cannot be computed without
      // fabricating a number. channelPerformance/campaignPerformance's
      // revenue-per-lead and conversion% are the closest real proxies.
      // Outbound campaign ROI (above) is real where a budget was set.
      roiNote: 'Ad spend is not tracked anywhere in this system, so a true channel-level ROI (revenue ÷ spend) cannot be computed. Use revenue-per-lead and conversion% below as the closest real proxy until spend tracking is built. Outbound campaign ROI above is real wherever a budget was set on the campaign.',
      // Phase 2 (Social + WhatsApp Growth) — Phase D: AI Marketing.
      whatsappAnalytics,
      socialAnalytics: socialAnalyticsResult?.ok ? socialAnalyticsResult.value : null,
      // Deterministic, auditable scores (src/lib/ai/opportunity-score.ts +
      // src/lib/analytics/marketing-ai.ts) — not live LLM calls, same
      // reasoning as growthIntelligence above. Bounded to a 40-lead
      // candidate pool per computation (see marketing-ai.ts's
      // CANDIDATE_LIMIT) — a dashboard-scale signal, not an exhaustive scan.
      likelyToBook,
      churnRisk,
      nextBestActions,
    })
  } catch (error) {
    logger.error('dashboard/marketing', 'GET failed', error)
    return NextResponse.json({ error: 'Failed to load marketing dashboard' }, { status: 500 })
  }
}
