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
import { computeLoyaltyOverview, computeRevenueByLoyaltyTier } from '@/lib/customers/loyalty'
import { computeJourneyFunnel } from '@/lib/customers/journey'
import { computeGrowthIntelligence } from '@/lib/analytics/growth-intelligence'
import { getSupabaseAdmin } from '@/lib/supabase'
import { computeWhatsAppAnalytics, computeLikelyToBook, computeChurnRisk, computeNextBestActions } from '@/lib/analytics/marketing-ai'
import { getEngagementSummary, getTopPerformingContent, computeBestPostingTime, recommendBestContentFormat, recommendBestAudience, recommendBestCTA } from '@/lib/social/metrics-service'
import { computeClickAnalytics } from '@/lib/analytics/click-analytics-service'
import { getSpendByChannelAndCampaign, withSpendMetrics } from '@/lib/analytics/ad-spend-service'
import { computeSocialAttribution } from '@/lib/analytics/social-attribution-service'

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
    // Customer Loyalty & Referral Experience — "Revenue by Loyalty Tier."
    const revenueByLoyaltyTier = await computeRevenueByLoyaltyTier()
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
    const [whatsappAnalytics, socialAnalyticsResult, likelyToBook, churnRisk, nextBestActions, topContentResult, bestPostingTimeResult, clickAnalytics, adSpendByKey, socialAttribution] = await Promise.all([
      computeWhatsAppAnalytics(30).catch(() => null),
      getEngagementSummary().catch(() => null),
      computeLikelyToBook(10).catch(() => []),
      computeChurnRisk(10).catch(() => []),
      computeNextBestActions(10).catch(() => []),
      // Sprint 4 (Marketing Intelligence) — Top Performing Content + Best
      // Posting Time. Same independent-best-effort contract as the other
      // AI Marketing entries above.
      getTopPerformingContent(10).catch(() => null),
      computeBestPostingTime().catch(() => null),
      // Revenue Attribution Priority 2 — WhatsApp/call/website click totals.
      computeClickAnalytics().catch(() => null),
      // Marketing Intelligence Priority 3 — ad spend, matched against
      // channelPerformance (byPlatform) below.
      getSpendByChannelAndCampaign(),
      // End-to-End Campaign Attribution — "Revenue by Social Platform" /
      // "Revenue by Individual Social Post". Independent best-effort read,
      // same contract as the rest of this Promise.all.
      computeSocialAttribution().catch(() => null),
    ])

    // Content Operations Priority 5 — AI recommendations (best CTA/format/
    // audience), same independent-best-effort contract as the block above.
    const [bestFormatResult, bestAudienceResult, bestCTAResult] = await Promise.all([
      recommendBestContentFormat().catch(() => null),
      recommendBestAudience().catch(() => null),
      recommendBestCTA().catch(() => null),
    ])

    return NextResponse.json({
      windowDays,
      // Lead Source Analysis / per-channel required fields (Leads, Qualified
      // Leads, Proposals, Bookings, Revenue, Conversion%, Avg Booking Value).
      channelPerformance: ri.channelPerformance,
      // Marketing Intelligence Priority 3 — same channelPerformance rows,
      // augmented with spend/costPerEnquiry/costPerBooking/roiFromSpend
      // wherever a matching ad_spend.platform record exists (migration
      // 040). Null fields mean "no spend on file for this channel," never
      // a fabricated zero.
      channelPerformanceWithSpend: withSpendMetrics(ri.channelPerformance, adSpendByKey.byPlatform),
      // Campaign Attribution — inbound ad/landing-page campaigns (migration
      // 026). degraded=true means migration 026 isn't live yet; the UI must
      // show that explicitly, never fabricate a per-campaign breakdown.
      campaignPerformance: ri.campaignPerformance,
      campaignPerformanceWithSpend: withSpendMetrics(ri.campaignPerformance.rows, adSpendByKey.byCampaign),
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
      // Customer Loyalty & Referral Experience — Revenue by Loyalty Tier.
      revenueByLoyaltyTier,
      // Growth Engine Epic 4 — post-booking Customer Journey stage counts.
      journeyFunnel,
      // Growth Engine Epic 7 — AI Growth Intelligence (deterministic,
      // template-grounded recommendations — see growth-intelligence.ts).
      growthIntelligence,
      // ROI Dashboard note: Marketing Intelligence Priority 3 added manual
      // ad spend ingestion (POST /api/marketing/ad-spend, migration 040) —
      // channelPerformanceWithSpend/campaignPerformanceWithSpend above carry
      // real cost-per-enquiry/cost-per-booking/ROI wherever an operator has
      // logged spend for that platform/campaign. Rows with no spend on file
      // show null (never a fabricated zero) — spend must still be entered
      // manually per platform; there is no automatic Meta/Google Ads spend
      // ingestion yet (ad_spend.source supports 'meta_ads'/'google_ads' for
      // that future API-fed path without a schema change).
      roiNote: 'Ad spend is tracked via manual entry (Marketing > Ad Spend). channelPerformanceWithSpend/campaignPerformanceWithSpend carry real cost-per-enquiry, cost-per-booking, and ROI wherever spend has been logged for that platform/campaign — null means no spend recorded yet, not zero cost. Outbound campaign ROI above is separately real wherever a budget was set on the campaign.',
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
      // Sprint 4 (Marketing Intelligence) — "Top content" leaderboard
      // (post-level, by disclosed engagement score) and a deterministic
      // "best posting time" recommendation, both computed from this
      // account's own published-post metrics history (metrics-service.ts)
      // — not fabricated, and honestly reports "insufficient data" below a
      // minimum sample size.
      topContent: topContentResult?.ok ? topContentResult.value : [],
      bestPostingTime: bestPostingTimeResult?.ok ? bestPostingTimeResult.value : null,
      // Revenue Attribution Priority 2 — WhatsApp/call/website click totals
      // (trailing 30 days) from the click-beacon events POST /api/track/
      // click writes into analytics_events. Null if the aggregation query
      // itself failed (never blocks the rest of an otherwise-working
      // dashboard).
      clickAnalytics,
      // End-to-End Campaign Attribution — "Revenue by Social Platform" and
      // "Revenue by Individual Social Post" (social-attribution-service.ts).
      // null only if the underlying queries themselves failed; an empty
      // {posts:[], byPlatform:[]} means "no published posts on file yet,"
      // both rendered as an honest empty state, never fabricated.
      socialAttribution,
      // Content Operations Priority 5 — best content format ("best image"
      // reframed to format-level, this schema's finest real signal), best
      // platform audience, and best CTA category — all deterministic,
      // grounded in this account's own published-post engagement history.
      bestContentFormat: bestFormatResult?.ok ? bestFormatResult.value : null,
      bestAudience: bestAudienceResult?.ok ? bestAudienceResult.value : null,
      bestCTA: bestCTAResult?.ok ? bestCTAResult.value : null,
    })
  } catch (error) {
    logger.error('dashboard/marketing', 'GET failed', error)
    return NextResponse.json({ error: 'Failed to load marketing dashboard' }, { status: 500 })
  }
}
