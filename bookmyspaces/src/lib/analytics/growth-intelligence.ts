// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/analytics/growth-intelligence.ts
// Growth Engine Epic 7 — AI Growth Intelligence.
//
// Same "AI Brief" architecture already proven by computeMarketingBrief()
// (revenue-intelligence.ts, this file's sibling) and buildFounderBrief()'s
// Morning Brief (founder-brief-service.ts): a deterministic, template-
// grounded narrative built ONLY from numbers this codebase has already
// computed — not a live LLM call re-run on every dashboard load.
// "Reuse the existing AI architecture" means reuse THIS proven pattern for
// a business-wide dashboard section; the per-customer, live-Anthropic-call
// pattern (operator-assistant.ts) is a different architecture for a
// different job — one lead's context, on demand — not this one.
//
// Every input here is already computed by an existing caller
// (buildRevenueIntelligence, computeLoyaltyOverview, computeReferralPerformance,
// computeJourneyFunnel, all called once by dashboard/marketing/route.ts) —
// this module composes, it never re-fetches.
// ─────────────────────────────────────────────────────────────────────────────

import type { RevenueIntelligence } from '@/lib/analytics/revenue-intelligence'
import type { LoyaltyOverview } from '@/lib/customers/loyalty'
import type { ReferralPerformance } from '@/lib/customers/referrals'

export interface RevenueOpportunity {
  title: string
  detail: string
}

export interface CustomerHealth {
  narrative: string
  repeatCustomerPct: number
  dormantCustomers: number
  avgCLV: number
  highValueCustomers: number
}

export interface GrowthIntelligence {
  revenueOpportunities: RevenueOpportunity[]
  customerHealth: CustomerHealth
  retentionSuggestions: string[]
  occupancyRecommendation: string
  campaignRecommendation: string
  note: string
}

interface ReferralRewardsSummary {
  pending: number
  earned: number
  redeemed: number
}

export function computeGrowthIntelligence(
  ri: RevenueIntelligence,
  loyalty: LoyaltyOverview,
  referral: ReferralPerformance,
  referralRewards: ReferralRewardsSummary,
  journeyFunnel: Array<{ stage: string; count: number }>
): GrowthIntelligence {
  const { customerAnalytics, bookingAnalytics, campaignROI, multiTouchAttribution, marketingBrief } = ri

  // ── Revenue Opportunities ────────────────────────────────────────────
  const revenueOpportunities: RevenueOpportunity[] = []

  if (customerAnalytics.dormantCustomers > 0) {
    revenueOpportunities.push({
      title: `${customerAnalytics.dormantCustomers} dormant customers (${customerAnalytics.dormantThresholdDays}+ days uncontacted)`,
      detail: 'Trigger the Dormant Win-back automation (Growth Platform Phase 2) to re-engage before they go fully cold.',
    })
  }

  const vipCount = loyalty.byTier.find((t) => t.tier === 'VIP')?.count ?? 0
  if (vipCount > 0) {
    revenueOpportunities.push({
      title: `${vipCount} customer${vipCount === 1 ? '' : 's'} at VIP loyalty tier`,
      detail: 'Highest-value repeat segment — a dedicated VIP outreach or early-access offer converts better than a generic broadcast.',
    })
  }

  const scalableCampaign = [...campaignROI.rows]
    .filter((r) => r.roiAvailable && (r.roi ?? 0) > 1)
    .sort((a, b) => (b.roi ?? 0) - (a.roi ?? 0))[0]
  if (scalableCampaign) {
    revenueOpportunities.push({
      title: `"${scalableCampaign.campaignName}" is returning ${scalableCampaign.roi}x on budget`,
      detail: `₹${scalableCampaign.revenue.toLocaleString('en-IN')} revenue from ${scalableCampaign.leadsReached} leads reached — a strong candidate for more budget.`,
    })
  }

  if (referralRewards.pending > 0) {
    revenueOpportunities.push({
      title: `${referralRewards.pending} referral reward${referralRewards.pending === 1 ? '' : 's'} pending`,
      detail: 'Process pending rewards to redeemed — referrers who see their reward land refer again sooner.',
    })
  }

  // ── Customer Health ──────────────────────────────────────────────────
  const customerHealth: CustomerHealth = {
    narrative: `${customerAnalytics.repeatCustomerPct}% of customers are repeat bookers, average CLV is ₹${customerAnalytics.avgCLV.toLocaleString('en-IN')}, and ${customerAnalytics.highValueCustomers} customer${customerAnalytics.highValueCustomers === 1 ? ' is' : 's are'} above the ₹${(customerAnalytics.highValueThresholdINR / 100_000).toFixed(0)}L high-value threshold.`,
    repeatCustomerPct: customerAnalytics.repeatCustomerPct,
    dormantCustomers: customerAnalytics.dormantCustomers,
    avgCLV: customerAnalytics.avgCLV,
    highValueCustomers: customerAnalytics.highValueCustomers,
  }

  // ── Retention Suggestions ────────────────────────────────────────────
  const retentionSuggestions: string[] = []
  if (customerAnalytics.dormantCustomers > 0) {
    retentionSuggestions.push(`${customerAnalytics.dormantCustomers} dormant customers — run the Dormant Win-back campaign.`)
  }
  const reviewRequested = journeyFunnel.find((s) => s.stage === 'review_requested')?.count ?? 0
  const reviewCompleted = journeyFunnel.find((s) => s.stage === 'review_completed')?.count ?? 0
  if (reviewRequested > reviewCompleted) {
    retentionSuggestions.push(
      `${reviewRequested - reviewCompleted} review request${reviewRequested - reviewCompleted === 1 ? '' : 's'} sent but not yet completed — the review-reminders cron already nudges these automatically.`
    )
  }
  if (referral.topReferrers.length > 0) {
    const top = referral.topReferrers[0]
    retentionSuggestions.push(
      `${top.referrerName} has referred ${top.referredCount} customer${top.referredCount === 1 ? '' : 's'} worth ₹${top.referredRevenue.toLocaleString('en-IN')} — a personal thank-you or reward keeps your best referrer active.`
    )
  }
  if (retentionSuggestions.length === 0) {
    retentionSuggestions.push('No retention risks currently flagged from available data.')
  }

  // ── Occupancy-Based Recommendation ───────────────────────────────────
  const occ = bookingAnalytics.occupancyPct
  const occupancyRecommendation = occ === null
    ? 'Occupancy cannot be computed — active inventory count or reservation data is unavailable in this environment.'
    : occ < 40
      ? `Occupancy is ${occ}% — below a healthy range. Consider a limited-time promotion, or re-engaging dormant customers, to fill the gap.`
      : occ > 85
        ? `Occupancy is ${occ}% — running high. Consider premium/dynamic pricing on remaining inventory rather than discounting.`
        : `Occupancy is ${occ}% — within a healthy range, no action recommended.`

  // ── Campaign Recommendation ──────────────────────────────────────────
  // Starts from the existing Marketing Brief's budget call (unchanged,
  // first-touch-based), then layers in what the NEW multi-touch view
  // (Growth Engine Epic 6) reveals that a first-touch-only read misses.
  let campaignRecommendation = marketingBrief.budgetRecommendation
  const biggestMultiTouchGap = [...multiTouchAttribution.rows]
    .filter((r) => r.linearRevenue > r.firstTouchRevenue)
    .sort((a, b) => (b.linearRevenue - b.firstTouchRevenue) - (a.linearRevenue - a.firstTouchRevenue))[0]
  if (biggestMultiTouchGap) {
    campaignRecommendation += ` Multi-touch attribution also shows "${biggestMultiTouchGap.campaignName}" contributing ₹${Math.round(biggestMultiTouchGap.linearRevenue).toLocaleString('en-IN')} across the full customer journey vs ₹${Math.round(biggestMultiTouchGap.firstTouchRevenue).toLocaleString('en-IN')} first-touch-only — its real influence is under-credited by a first-touch-only view.`
  }

  return {
    revenueOpportunities,
    customerHealth,
    retentionSuggestions,
    occupancyRecommendation,
    campaignRecommendation,
    note: 'Deterministic, template-grounded recommendations computed from real, already-fetched data — same convention as the Marketing Brief and Founder Morning Brief, not a live AI model call.',
  }
}
