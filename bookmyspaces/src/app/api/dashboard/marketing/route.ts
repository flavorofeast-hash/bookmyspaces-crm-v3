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

export async function GET(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response

  const windowDays = Number(req.nextUrl.searchParams.get('days')) || 90

  try {
    const ri = await buildRevenueIntelligence(windowDays)

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
      // ROI Dashboard note: this system does not track ad spend anywhere
      // (no spend-capture path exists for any channel), so a true ROI
      // (revenue ÷ spend) cannot be computed without fabricating a number.
      // channelPerformance/campaignPerformance's revenue-per-lead and
      // conversion% are the closest real proxies — surfaced as-is, with
      // this caveat, rather than inventing a spend figure.
      roiNote: 'Ad spend is not tracked anywhere in this system, so a true ROI (revenue ÷ spend) cannot be computed. Use revenue-per-lead and conversion% below as the closest real proxy until spend tracking is built.',
    })
  } catch (error) {
    logger.error('dashboard/marketing', 'GET failed', error)
    return NextResponse.json({ error: 'Failed to load marketing dashboard' }, { status: 500 })
  }
}
