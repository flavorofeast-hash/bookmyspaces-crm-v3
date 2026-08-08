// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/analytics/ad-spend-service.ts
// Marketing Intelligence Priority 3 — ad spend ingestion + Cost per
// Enquiry / Cost per Booking / spend-based ROI.
//
// Deliberately NOT added to revenue-intelligence.ts: that file's
// RawData/buildRevenueIntelligence() contract has no spend concept and is
// large, already-tested, and load-bearing for every other dashboard. This
// module reads the new `ad_spend` table (migration 040) and augments
// AcquisitionPerformanceRow[] (channelPerformance/campaignPerformance,
// already returned by buildRevenueIntelligence()) at the ROUTE layer —
// exact same "compute the extra field in the route, don't touch the core
// service" precedent already set for referralPerformance/loyaltyOverview/
// journeyFunnel in dashboard/marketing/route.ts.
//
// Matching spend to a channel/campaign row is done by `platform` (ad_spend)
// vs `key` (AcquisitionPerformanceRow, e.g. leads.source or leads.campaign)
// — a best-effort case-insensitive match, degrading to "no spend on file"
// (nulls, never a fabricated zero-cost/zero-ROI) rather than guessing.
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabaseAdmin } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import type { AcquisitionPerformanceRow } from '@/lib/analytics/revenue-intelligence'

export interface AdSpendRecord {
  id: string
  platform: string
  campaign_name: string | null
  spend_date: string
  amount: number
  currency: string
  source: 'manual' | 'meta_ads' | 'google_ads'
  notes: string | null
  created_by: string | null
  created_at: string
  // Business Package Engine (migration 044) — optional, enables ROI-by-package.
  business_package_id: string | null
}

export interface CreateAdSpendInput {
  platform: string
  campaignName?: string | null
  spendDate: string
  amount: number
  currency?: string
  notes?: string | null
  createdBy?: string | null
  businessPackageId?: string | null
}

type Result<T> = { ok: true; value: T } | { ok: false; error: string }

export async function createAdSpend(input: CreateAdSpendInput): Promise<Result<AdSpendRecord>> {
  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('ad_spend')
    .insert({
      platform: input.platform,
      campaign_name: input.campaignName ?? null,
      spend_date: input.spendDate,
      amount: input.amount,
      currency: input.currency ?? 'INR',
      source: 'manual',
      notes: input.notes ?? null,
      created_by: input.createdBy ?? null,
      business_package_id: input.businessPackageId ?? null,
    })
    .select('*')
    .single()
  if (error || !data) return { ok: false, error: error?.message ?? 'ad_spend_insert_failed' }
  return { ok: true, value: data as AdSpendRecord }
}

export async function listAdSpend(startDate?: string, endDate?: string): Promise<Result<AdSpendRecord[]>> {
  const db = getSupabaseAdmin()
  let query = db.from('ad_spend').select('*').order('spend_date', { ascending: false })
  if (startDate) query = query.gte('spend_date', startDate)
  if (endDate) query = query.lte('spend_date', endDate)
  const { data, error } = await query
  if (error) return { ok: false, error: error.message }
  return { ok: true, value: (data ?? []) as AdSpendRecord[] }
}

export async function deleteAdSpend(id: string): Promise<Result<true>> {
  const db = getSupabaseAdmin()
  const { error } = await db.from('ad_spend').delete().eq('id', id)
  if (error) return { ok: false, error: error.message }
  return { ok: true, value: true }
}

/** Total spend per platform and per campaign_name, within an optional date range. Used by withSpendMetrics() below to match against AcquisitionPerformanceRow.key. */
export async function getSpendByChannelAndCampaign(
  startDate?: string,
  endDate?: string
): Promise<{ byPlatform: Map<string, number>; byCampaign: Map<string, number> }> {
  const byPlatform = new Map<string, number>()
  const byCampaign = new Map<string, number>()
  try {
    const result = await listAdSpend(startDate, endDate)
    if (!result.ok) throw new Error(result.error)
    for (const row of result.value) {
      const amount = Number(row.amount) || 0
      byPlatform.set(row.platform, (byPlatform.get(row.platform) ?? 0) + amount)
      if (row.campaign_name) {
        const key = row.campaign_name.toLowerCase()
        byCampaign.set(key, (byCampaign.get(key) ?? 0) + amount)
      }
    }
  } catch (err) {
    logger.error('ad-spend-service', 'getSpendByChannelAndCampaign failed', err)
  }
  return { byPlatform, byCampaign }
}

/** Total spend per business_package_id, within an optional date range — the spend half of "ROI by Business Package". Rows with no business_package_id set are excluded, same "never fabricate an attribution" posture as the rest of this file. */
export async function getSpendByBusinessPackage(startDate?: string, endDate?: string): Promise<Map<string, number>> {
  const byPackage = new Map<string, number>()
  try {
    const result = await listAdSpend(startDate, endDate)
    if (!result.ok) throw new Error(result.error)
    for (const row of result.value) {
      if (!row.business_package_id) continue
      byPackage.set(row.business_package_id, (byPackage.get(row.business_package_id) ?? 0) + (Number(row.amount) || 0))
    }
  } catch (err) {
    logger.error('ad-spend-service', 'getSpendByBusinessPackage failed', err)
  }
  return byPackage
}

export interface AcquisitionPerformanceRowWithSpend extends AcquisitionPerformanceRow {
  spend: number | null
  costPerEnquiry: number | null
  costPerBooking: number | null
  roiFromSpend: number | null // (revenue - spend) / spend, null when spend is null or 0
}

/**
 * Augments channelPerformance/campaignPerformance rows with spend-derived
 * metrics, matched by lowercased key. `isChannel` picks byPlatform vs
 * byCampaign matching (channelPerformance rows are keyed by leads.source,
 * which for social-sourced leads shares vocabulary with ad_spend.platform;
 * campaignPerformance rows are keyed by leads.campaign, matched against
 * ad_spend.campaign_name).
 */
export function withSpendMetrics(
  rows: AcquisitionPerformanceRow[],
  spendMap: Map<string, number>
): AcquisitionPerformanceRowWithSpend[] {
  return rows.map((row) => {
    const spend = spendMap.get(row.key.toLowerCase()) ?? null
    const costPerEnquiry = spend != null && row.leads > 0 ? Math.round((spend / row.leads) * 100) / 100 : null
    const costPerBooking = spend != null && row.bookings > 0 ? Math.round((spend / row.bookings) * 100) / 100 : null
    const roiFromSpend = spend != null && spend > 0 ? Math.round(((row.revenue - spend) / spend) * 1000) / 1000 : null
    return { ...row, spend, costPerEnquiry, costPerBooking, roiFromSpend }
  })
}
