// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/analytics/click-analytics-service.ts
// Revenue Attribution Priority 2 — aggregates the click beacons written by
// POST /api/track/click into the analytics_events table (migration 007).
// No new table: reads the exact rows track_event() already writes
// (event_type IN 'whatsapp_click'/'call_click'/'website_click', properties
// JSONB carrying target/campaign/page). Read-only aggregation, same
// "computed in a service, exposed via a route" shape as revenue-
// intelligence.ts, kept as its own small file rather than added there —
// this reads analytics_events, a completely different source table than
// revenue-intelligence.ts's leads/proposals, so there's no shared logic to
// consolidate.
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabaseAdmin } from '@/lib/supabase'

const CLICK_EVENT_TYPES = ['whatsapp_click', 'call_click', 'website_click'] as const
export type ClickEventType = (typeof CLICK_EVENT_TYPES)[number]

export interface ClickAnalyticsRow {
  type: ClickEventType
  totalClicks: number
  byCampaign: Array<{ campaign: string; clicks: number }>
  // End-to-End Campaign Attribution — same shape as byCampaign, grouped by
  // the Business Package the click's landing page resolved to (properties.
  // business_package_id, written by POST /api/track/click). Clicks with no
  // package on file are excluded, not bucketed into a fake "None" package.
  byBusinessPackage: Array<{ businessPackageId: string; clicks: number }>
}

export interface ClickAnalytics {
  rangeStart: string
  rangeEnd: string
  totalClicks: number
  rows: ClickAnalyticsRow[]
}

interface AnalyticsEventRow {
  event_type: string
  properties: { campaign?: string | null; target?: string | null; page?: string | null; business_package_id?: string | null } | null
}

/**
 * Aggregates click-beacon events in [startIso, endIso). Defaults to the
 * trailing 30 days when no range is given — same default window convention
 * as computeMarketingBrief()'s reporting period.
 */
export async function computeClickAnalytics(startIso?: string, endIso?: string): Promise<ClickAnalytics> {
  const db = getSupabaseAdmin()
  const rangeEnd = endIso ?? new Date().toISOString()
  const rangeStart = startIso ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  const { data, error } = await db
    .from('analytics_events')
    .select('event_type, properties')
    .in('event_type', CLICK_EVENT_TYPES as unknown as string[])
    .gte('created_at', rangeStart)
    .lt('created_at', rangeEnd)

  if (error) {
    return { rangeStart, rangeEnd, totalClicks: 0, rows: CLICK_EVENT_TYPES.map((type) => ({ type, totalClicks: 0, byCampaign: [], byBusinessPackage: [] })) }
  }

  const rows = (data ?? []) as AnalyticsEventRow[]
  const byType = new Map<ClickEventType, Map<string, number>>()
  const byTypePackage = new Map<ClickEventType, Map<string, number>>()
  for (const type of CLICK_EVENT_TYPES) { byType.set(type, new Map()); byTypePackage.set(type, new Map()) }

  for (const row of rows) {
    const type = row.event_type as ClickEventType
    const bucket = byType.get(type)
    if (!bucket) continue
    const campaign = row.properties?.campaign || 'No Campaign'
    bucket.set(campaign, (bucket.get(campaign) ?? 0) + 1)

    const packageId = row.properties?.business_package_id
    if (packageId) {
      const pkgBucket = byTypePackage.get(type)!
      pkgBucket.set(packageId, (pkgBucket.get(packageId) ?? 0) + 1)
    }
  }

  const result: ClickAnalyticsRow[] = CLICK_EVENT_TYPES.map((type) => {
    const bucket = byType.get(type)!
    const byCampaign = Array.from(bucket.entries())
      .map(([campaign, clicks]) => ({ campaign, clicks }))
      .sort((a, b) => b.clicks - a.clicks)
    const byBusinessPackage = Array.from(byTypePackage.get(type)!.entries())
      .map(([businessPackageId, clicks]) => ({ businessPackageId, clicks }))
      .sort((a, b) => b.clicks - a.clicks)
    return { type, totalClicks: byCampaign.reduce((sum, c) => sum + c.clicks, 0), byCampaign, byBusinessPackage }
  })

  return {
    rangeStart,
    rangeEnd,
    totalClicks: result.reduce((sum, r) => sum + r.totalClicks, 0),
    rows: result,
  }
}
