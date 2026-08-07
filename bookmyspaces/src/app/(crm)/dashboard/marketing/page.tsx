'use client'

// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/app/(crm)/dashboard/marketing/page.tsx
// Version 2.1 — Marketing Intelligence Platform. Renders GET
// /api/dashboard/marketing exactly as returned — every number here is
// computed server-side by revenue-intelligence.ts; this page does no
// scoring or aggregation of its own, same "route/service do the work, page
// just renders" split as the Founder Dashboard page.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState, useCallback } from 'react'
import { toast } from 'sonner'
import { RefreshCw, AlertTriangle, Sparkles, TrendingUp, TrendingDown, Megaphone, Users, IndianRupee, Share2, Award, MessageCircle, BarChart3, Target, HeartCrack, Compass } from 'lucide-react'

interface AcquisitionPerformanceRow {
  key: string
  leads: number
  qualifiedLeads: number
  proposals: number
  bookings: number
  revenue: number
  conversionPct: number
  avgBookingValue: number
}

interface RevenueBreakdownRow {
  key: string
  proposals: number
  accepted: number
  revenue: number
}

interface FunnelStage {
  stage: string
  count: number
  revenue: number
  conversionFromPreviousPct: number | null
  avgDaysInPreviousStage: number | null
}

interface CampaignROIRow {
  campaignId: string
  campaignName: string
  budget: number | null
  revenue: number
  leadsReached: number
  bookings: number
  roi: number | null
  roiAvailable: boolean
}

interface MultiTouchCampaignRow {
  campaignId: string
  campaignName: string
  linearRevenue: number
  firstTouchRevenue: number
  touchedLeads: number
}

interface CustomerAnalytics {
  totalCustomers: number
  avgCLV: number
  repeatCustomerPct: number
  newCustomersThisMonth: number
  dormantCustomers: number
  dormantThresholdDays: number
  highValueCustomers: number
  highValueThresholdINR: number
}

interface MarketingDashboard {
  windowDays: number
  channelPerformance: AcquisitionPerformanceRow[]
  campaignPerformance: { rows: AcquisitionPerformanceRow[]; degraded: boolean }
  marketingBrief: {
    topPerformingCampaign: string | null
    worstPerformingCampaign: string | null
    highestRevenueChannel: string | null
    lowestConversionChannel: string | null
    budgetRecommendation: string
    businessRecommendation: string
  }
  revenueByEventType: RevenueBreakdownRow[]
  revenueByVenue: RevenueBreakdownRow[]
  revenueByPackage: RevenueBreakdownRow[]
  funnel: { stages: FunnelStage[]; degraded: boolean }
  campaignROI: { rows: CampaignROIRow[]; degraded: boolean; note: string }
  multiTouchAttribution: { model: string; rows: MultiTouchCampaignRow[]; degraded: boolean; note: string }
  customerAnalytics: CustomerAnalytics
  referralPerformance: {
    totalLeadsWithReferralText: number
    attributedReferrals: number
    unattributedReferralText: number
    topReferrers: Array<{ referrerId: string; referrerName: string; referrerPhone: string | null; referredCount: number; referredRevenue: number }>
    note: string
  }
  referralRewards: { pending: number; earned: number; redeemed: number }
  loyaltyOverview: {
    totalAccounts: number
    totalPointsIssued: number
    byTier: Array<{ tier: string; count: number }>
    topEarners: Array<{ leadId: string; leadName: string | null; points: number; tier: string }>
  }
  journeyFunnel: Array<{ stage: string; count: number }>
  growthIntelligence: {
    revenueOpportunities: Array<{ title: string; detail: string }>
    customerHealth: { narrative: string; repeatCustomerPct: number; dormantCustomers: number; avgCLV: number; highValueCustomers: number }
    retentionSuggestions: string[]
    occupancyRecommendation: string
    campaignRecommendation: string
    note: string
  }
  roiNote: string
  // Phase 2 (Social + WhatsApp Growth) — Phase D: AI Marketing.
  whatsappAnalytics: {
    windowDays: number
    sent: number
    received: number
    delivered: number
    read: number
    failed: number
    deliveryRatePct: number | null
    readRatePct: number | null
    note: string
  } | null
  socialAnalytics: {
    postsWithMetrics: number
    totals: { reach: number; impressions: number; clicks: number; likes: number; comments: number; shares: number; saves: number }
    byPlatform: Record<string, { posts: number; reach: number; impressions: number; likes: number; comments: number; shares: number }>
  } | null
  likelyToBook: ScoredLead[]
  churnRisk: ChurnRiskEntry[]
  nextBestActions: ScoredLead[]
}

interface ScoredLead {
  leadId: string
  name: string | null
  phone: string | null
  score: number
  band: 'HIGH' | 'MEDIUM' | 'LOW'
  nextBestAction: string
  reasoning: string[]
}

interface ChurnRiskEntry {
  leadId: string
  name: string | null
  phone: string | null
  riskScore: number
  daysSinceContact: number | null
  estimatedRevenueAtStake: number
  reasons: string[]
}

function fmtINR(n: number): string {
  if (n >= 100_000) return `₹${(n / 100_000).toFixed(1)}L`
  if (n >= 1_000) return `₹${(n / 1_000).toFixed(1)}K`
  return `₹${n.toLocaleString('en-IN')}`
}

function PerformanceTable({ title, rows, keyLabel }: { title: string; rows: AcquisitionPerformanceRow[]; keyLabel: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100">
        <h2 className="text-sm font-semibold text-gray-700">{title}</h2>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-gray-400 px-6 py-8 text-center">No data in this window.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-400 uppercase tracking-wide border-b border-gray-100">
              <th className="px-6 py-2.5 font-medium">{keyLabel}</th>
              <th className="px-3 py-2.5 font-medium text-right">Leads</th>
              <th className="px-3 py-2.5 font-medium text-right">Qualified</th>
              <th className="px-3 py-2.5 font-medium text-right">Proposals</th>
              <th className="px-3 py-2.5 font-medium text-right">Bookings</th>
              <th className="px-3 py-2.5 font-medium text-right">Revenue</th>
              <th className="px-3 py-2.5 font-medium text-right">Conversion%</th>
              <th className="px-6 py-2.5 font-medium text-right">Avg Booking Value</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                <td className="px-6 py-3 text-gray-800 font-medium">{r.key}</td>
                <td className="px-3 py-3 text-right text-gray-600">{r.leads}</td>
                <td className="px-3 py-3 text-right text-gray-600">{r.qualifiedLeads}</td>
                <td className="px-3 py-3 text-right text-gray-600">{r.proposals}</td>
                <td className="px-3 py-3 text-right text-gray-600">{r.bookings}</td>
                <td className="px-3 py-3 text-right text-emerald-600 font-medium">{fmtINR(r.revenue)}</td>
                <td className="px-3 py-3 text-right text-gray-600">{r.conversionPct}%</td>
                <td className="px-6 py-3 text-right text-gray-600">{r.bookings > 0 ? fmtINR(r.avgBookingValue) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function BreakdownTable({ title, rows }: { title: string; rows: RevenueBreakdownRow[] }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-xs text-gray-400 text-center py-4">No data in this window.</p>
      ) : (
        <ul className="space-y-2">
          {rows.slice(0, 6).map((r) => (
            <li key={r.key} className="flex items-center justify-between text-sm">
              <span className="text-gray-700">{r.key}</span>
              <span className="text-emerald-600 font-medium">{fmtINR(r.revenue)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function MarketingDashboardPage() {
  const [data, setData] = useState<MarketingDashboard | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [syncingRewards, setSyncingRewards] = useState(false)
  const [syncingPoints, setSyncingPoints] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/dashboard/marketing')
      if (!res.ok) throw new Error('Failed to load marketing dashboard')
      setData(await res.json())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load marketing dashboard')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function handleSyncRewards() {
    setSyncingRewards(true)
    try {
      const res = await fetch('/api/referrals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sync_rewards' }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || 'Sync failed')
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to sync referral rewards')
    } finally {
      setSyncingRewards(false)
    }
  }

  async function handleSyncPoints() {
    setSyncingPoints(true)
    try {
      const res = await fetch('/api/loyalty', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sync_points' }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || 'Sync failed')
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to sync loyalty points')
    } finally {
      setSyncingPoints(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Marketing Dashboard</h1>
          <p className="text-sm text-gray-500 mt-0.5">Where every lead came from, and what it produced.</p>
        </div>
        <button
          onClick={load}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 border border-gray-200"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
          <AlertTriangle className="w-4 h-4" /> {error}
        </div>
      )}

      {loading ? (
        <div className="px-6 py-10 text-center text-sm text-gray-400 flex items-center justify-center gap-2">
          <RefreshCw className="w-4 h-4 animate-spin" /> Loading…
        </div>
      ) : data && (
        <>
          {/* ── AI Marketing Brief ───────────────────────────────────────── */}
          <div className="bg-gradient-to-br from-indigo-600 to-indigo-700 rounded-xl p-6 text-white">
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="w-4 h-4" />
              <h2 className="text-sm font-semibold">AI Marketing Brief — {data.windowDays}d window</h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <div className="flex items-start gap-2">
                <TrendingUp className="w-4 h-4 mt-0.5 shrink-0 text-emerald-300" />
                <div>
                  <p className="text-indigo-200 text-xs">Highest Revenue Channel</p>
                  <p className="font-medium">{data.marketingBrief.highestRevenueChannel ?? 'Not enough data yet'}</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <TrendingDown className="w-4 h-4 mt-0.5 shrink-0 text-red-300" />
                <div>
                  <p className="text-indigo-200 text-xs">Lowest Conversion Channel</p>
                  <p className="font-medium">{data.marketingBrief.lowestConversionChannel ?? 'Not enough data yet'}</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Megaphone className="w-4 h-4 mt-0.5 shrink-0 text-amber-300" />
                <div>
                  <p className="text-indigo-200 text-xs">Top Performing Campaign</p>
                  <p className="font-medium">{data.marketingBrief.topPerformingCampaign ?? 'Not enough data yet'}</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Megaphone className="w-4 h-4 mt-0.5 shrink-0 text-gray-300" />
                <div>
                  <p className="text-indigo-200 text-xs">Worst Performing Campaign</p>
                  <p className="font-medium">{data.marketingBrief.worstPerformingCampaign ?? 'Not enough data yet'}</p>
                </div>
              </div>
            </div>
            <div className="border-t border-indigo-500/40 mt-4 pt-3 space-y-1.5">
              <p className="text-sm text-indigo-50"><span className="font-semibold">Budget:</span> {data.marketingBrief.budgetRecommendation}</p>
              <p className="text-sm text-indigo-50"><span className="font-semibold">Business:</span> {data.marketingBrief.businessRecommendation}</p>
            </div>
          </div>

          {/* ── AI Growth Intelligence (Growth Engine Epic 7) ────────────── */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100">
              <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5"><Award className="w-3.5 h-3.5" /> AI Growth Intelligence</h2>
              <p className="text-xs text-gray-400 mt-1">{data.growthIntelligence.note}</p>
            </div>
            <div className="p-6 space-y-5">
              <div>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Revenue Opportunities</h3>
                {data.growthIntelligence.revenueOpportunities.length === 0 ? (
                  <p className="text-sm text-gray-400">No specific opportunities flagged from current data.</p>
                ) : (
                  <ul className="space-y-2">
                    {data.growthIntelligence.revenueOpportunities.map((o, i) => (
                      <li key={i} className="text-sm">
                        <span className="font-medium text-gray-800">{o.title}</span>
                        <span className="text-gray-500"> — {o.detail}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Customer Health</h3>
                <p className="text-sm text-gray-700">{data.growthIntelligence.customerHealth.narrative}</p>
              </div>

              <div>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Retention Suggestions</h3>
                <ul className="space-y-1.5">
                  {data.growthIntelligence.retentionSuggestions.map((s, i) => (
                    <li key={i} className="text-sm text-gray-700">• {s}</li>
                  ))}
                </ul>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Occupancy Recommendation</h3>
                  <p className="text-sm text-gray-700">{data.growthIntelligence.occupancyRecommendation}</p>
                </div>
                <div>
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Campaign Recommendation</h3>
                  <p className="text-sm text-gray-700">{data.growthIntelligence.campaignRecommendation}</p>
                </div>
              </div>
            </div>
          </div>

          {/* ── Customer Lifetime Value ──────────────────────────────────── */}
          <div>
            <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-1.5"><Users className="w-4 h-4" /> Customer Lifetime Value</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <p className="text-xs text-gray-400">Avg. CLV</p>
                <p className="text-xl font-bold text-gray-900 mt-1">{fmtINR(data.customerAnalytics.avgCLV)}</p>
              </div>
              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <p className="text-xs text-gray-400">Repeat Customers</p>
                <p className="text-xl font-bold text-gray-900 mt-1">{data.customerAnalytics.repeatCustomerPct}%</p>
              </div>
              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <p className="text-xs text-gray-400">High-Value (₹{(data.customerAnalytics.highValueThresholdINR / 100_000).toFixed(0)}L+)</p>
                <p className="text-xl font-bold text-gray-900 mt-1">{data.customerAnalytics.highValueCustomers}</p>
              </div>
              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <p className="text-xs text-gray-400">Dormant ({data.customerAnalytics.dormantThresholdDays}d+)</p>
                <p className="text-xl font-bold text-gray-900 mt-1">{data.customerAnalytics.dormantCustomers}</p>
              </div>
            </div>
          </div>

          {data.campaignPerformance.degraded && (
            <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-700">
              <AlertTriangle className="w-4 h-4 shrink-0" /> Campaign attribution (migration 026) isn&apos;t live in this environment yet — campaign rows below are grouped into a single &quot;Attribution Unavailable&quot; bucket, not fabricated per-campaign.
            </div>
          )}

          {/* ── Lead Source Analysis ─────────────────────────────────────── */}
          <PerformanceTable title="Lead Source Analysis (by Channel)" rows={data.channelPerformance} keyLabel="Channel" />

          {/* ── Campaign Performance ─────────────────────────────────────── */}
          <PerformanceTable title="Campaign Performance" rows={data.campaignPerformance.rows} keyLabel="Campaign" />

          {/* ── Campaign ROI (Growth Platform Phase 1) ───────────────────── */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5"><IndianRupee className="w-3.5 h-3.5" /> Campaign ROI</h2>
            </div>
            {data.campaignROI.rows.length === 0 ? (
              <p className="text-sm text-gray-400 px-6 py-8 text-center">
                {data.campaignROI.degraded ? 'Campaign send data is unavailable in this environment.' : 'No campaigns with a budget or recipients yet — set a budget when creating a campaign to see ROI here.'}
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-400 uppercase tracking-wide border-b border-gray-100">
                    <th className="px-6 py-2.5 font-medium">Campaign</th>
                    <th className="px-3 py-2.5 font-medium text-right">Budget</th>
                    <th className="px-3 py-2.5 font-medium text-right">Revenue</th>
                    <th className="px-3 py-2.5 font-medium text-right">Bookings</th>
                    <th className="px-6 py-2.5 font-medium text-right">ROI</th>
                  </tr>
                </thead>
                <tbody>
                  {data.campaignROI.rows.map((r) => (
                    <tr key={r.campaignId} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                      <td className="px-6 py-3 text-gray-800 font-medium">{r.campaignName}</td>
                      <td className="px-3 py-3 text-right text-gray-600">{r.budget !== null ? fmtINR(r.budget) : '—'}</td>
                      <td className="px-3 py-3 text-right text-emerald-600 font-medium">{fmtINR(r.revenue)}</td>
                      <td className="px-3 py-3 text-right text-gray-600">{r.bookings}</td>
                      <td className="px-6 py-3 text-right font-medium text-gray-800">{r.roiAvailable ? `${r.roi}x` : 'No budget set'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="px-6 py-3 text-xs text-gray-400 border-t border-gray-100">{data.campaignROI.note}</p>
          </div>

          {/* ── Multi-Touch Attribution (Growth Engine Epic 6) ───────────── */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5"><IndianRupee className="w-3.5 h-3.5" /> Multi-Touch Attribution (Linear)</h2>
            </div>
            {data.multiTouchAttribution.rows.length === 0 ? (
              <p className="text-sm text-gray-400 px-6 py-8 text-center">
                {data.multiTouchAttribution.degraded ? 'Campaign send data is unavailable in this environment.' : 'No campaign-attributed bookings yet.'}
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-400 uppercase tracking-wide border-b border-gray-100">
                    <th className="px-6 py-2.5 font-medium">Campaign</th>
                    <th className="px-3 py-2.5 font-medium text-right">Linear Revenue</th>
                    <th className="px-3 py-2.5 font-medium text-right">First-Touch Revenue</th>
                    <th className="px-6 py-2.5 font-medium text-right">Touched Leads</th>
                  </tr>
                </thead>
                <tbody>
                  {data.multiTouchAttribution.rows.map((r) => (
                    <tr key={r.campaignId} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                      <td className="px-6 py-3 text-gray-800 font-medium">{r.campaignName}</td>
                      <td className="px-3 py-3 text-right text-emerald-600 font-medium">{fmtINR(r.linearRevenue)}</td>
                      <td className="px-3 py-3 text-right text-gray-500">{fmtINR(r.firstTouchRevenue)}</td>
                      <td className="px-6 py-3 text-right text-gray-600">{r.touchedLeads}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="px-6 py-3 text-xs text-gray-400 border-t border-gray-100">{data.multiTouchAttribution.note}</p>
          </div>

          {/* ── Referral Campaigns (Growth Platform Phase 2) ─────────────── */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
              <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5"><Share2 className="w-3.5 h-3.5" /> Top Referrers</h2>
              <div className="flex items-center gap-3">
                <p className="text-xs text-gray-400">{data.referralPerformance.attributedReferrals} attributed of {data.referralPerformance.totalLeadsWithReferralText} referral notes</p>
                <p className="text-xs text-gray-400">Rewards: {data.referralRewards.pending} pending · {data.referralRewards.earned} earned · {data.referralRewards.redeemed} redeemed</p>
                <button
                  onClick={() => void handleSyncRewards()}
                  disabled={syncingRewards}
                  className="text-xs text-blue-600 hover:text-blue-800 font-medium disabled:opacity-50"
                >
                  {syncingRewards ? 'Syncing…' : 'Sync Rewards'}
                </button>
              </div>
            </div>
            {data.referralPerformance.topReferrers.length === 0 ? (
              <p className="text-sm text-gray-400 px-6 py-8 text-center">No attributed referrals yet — ask good customers to share their phone number as a referral code.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-400 uppercase tracking-wide border-b border-gray-100">
                    <th className="px-6 py-2.5 font-medium">Referrer</th>
                    <th className="px-3 py-2.5 font-medium text-right">Referred Leads</th>
                    <th className="px-6 py-2.5 font-medium text-right">Revenue From Referrals</th>
                  </tr>
                </thead>
                <tbody>
                  {data.referralPerformance.topReferrers.slice(0, 10).map((r) => (
                    <tr key={r.referrerId} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                      <td className="px-6 py-3 text-gray-800 font-medium">{r.referrerName}{r.referrerPhone ? ` (${r.referrerPhone})` : ''}</td>
                      <td className="px-3 py-3 text-right text-gray-600">{r.referredCount}</td>
                      <td className="px-6 py-3 text-right text-emerald-600 font-medium">{fmtINR(r.referredRevenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="px-6 py-3 text-xs text-gray-400 border-t border-gray-100">{data.referralPerformance.note}</p>
          </div>

          {/* ── Loyalty (Growth Engine Epic 3) ───────────────────────────── */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5"><Award className="w-3.5 h-3.5" /> Loyalty</h2>
              <button onClick={() => void handleSyncPoints()} disabled={syncingPoints} className="text-xs text-blue-600 hover:text-blue-800 font-medium disabled:opacity-50">
                {syncingPoints ? 'Syncing…' : 'Sync Points from Bookings'}
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <div className="text-center"><p className="text-lg font-bold text-gray-900">{data.loyaltyOverview.totalAccounts}</p><p className="text-xs text-gray-400">Accounts</p></div>
              <div className="text-center"><p className="text-lg font-bold text-gray-900">{data.loyaltyOverview.totalPointsIssued.toLocaleString('en-IN')}</p><p className="text-xs text-gray-400">Points Issued</p></div>
              {data.loyaltyOverview.byTier.map((t) => (
                <div key={t.tier} className="text-center"><p className="text-lg font-bold text-gray-900">{t.count}</p><p className="text-xs text-gray-400">{t.tier}</p></div>
              ))}
            </div>
            {data.loyaltyOverview.topEarners.length > 0 && (
              <ul className="space-y-1.5">
                {data.loyaltyOverview.topEarners.slice(0, 5).map((e) => (
                  <li key={e.leadId} className="flex items-center justify-between text-sm">
                    <span className="text-gray-700">{e.leadName || 'Unnamed lead'} <span className="text-xs text-gray-400">({e.tier})</span></span>
                    <span className="text-gray-600 font-medium">{e.points.toLocaleString('en-IN')} pts</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* ── Revenue Attribution ──────────────────────────────────────── */}
          <div>
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Revenue Attribution</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <BreakdownTable title="By Event Type" rows={data.revenueByEventType} />
              <BreakdownTable title="By Property" rows={data.revenueByVenue} />
              <BreakdownTable title="By Package" rows={data.revenueByPackage} />
            </div>
          </div>

          {/* ── Conversion Funnel ────────────────────────────────────────── */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Conversion Funnel</h2>
            {data.funnel.degraded && (
              <p className="text-xs text-amber-600 mb-3">Some funnel stages are degraded in this environment.</p>
            )}
            <div className="flex flex-wrap gap-2">
              {data.funnel.stages.map((s) => (
                <div key={s.stage} className="flex-1 min-w-[110px] bg-gray-50 rounded-lg border border-gray-200 px-3 py-2.5 text-center">
                  <div className="text-lg font-bold text-gray-900">{s.count}</div>
                  <div className="text-[11px] text-gray-400 mt-0.5">{s.stage}</div>
                  {s.conversionFromPreviousPct !== null && (
                    <div className="text-[11px] text-gray-500 mt-0.5">{s.conversionFromPreviousPct}%</div>
                  )}
                </div>
              ))}
            </div>
            {/* Growth Engine Epic 4 — post-booking journey stages, continuing the funnel above. */}
            <p className="text-xs text-gray-400 mt-3 mb-2">Post-booking journey</p>
            <div className="flex flex-wrap gap-2">
              {data.journeyFunnel.map((s) => (
                <div key={s.stage} className="flex-1 min-w-[110px] bg-indigo-50 rounded-lg border border-indigo-100 px-3 py-2.5 text-center">
                  <div className="text-lg font-bold text-gray-900">{s.count}</div>
                  <div className="text-[11px] text-gray-400 mt-0.5">{s.stage}</div>
                </div>
              ))}
            </div>
          </div>

          {/* ── ROI Dashboard ────────────────────────────────────────────── */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-2">ROI Dashboard</h2>
            <p className="text-xs text-gray-400">{data.roiNote}</p>
          </div>

          {/* ── Phase 2 (Social + WhatsApp Growth) — Phase D: AI Marketing ── */}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* WhatsApp Analytics */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-1.5"><MessageCircle className="w-3.5 h-3.5" /> WhatsApp Analytics ({data.whatsappAnalytics?.windowDays ?? 30}d)</h2>
              {!data.whatsappAnalytics ? (
                <p className="text-sm text-gray-400 text-center py-4">Unavailable right now.</p>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-3 mb-2">
                    <div className="text-center"><p className="text-lg font-bold text-gray-900">{data.whatsappAnalytics.sent}</p><p className="text-xs text-gray-400">Sent</p></div>
                    <div className="text-center"><p className="text-lg font-bold text-gray-900">{data.whatsappAnalytics.received}</p><p className="text-xs text-gray-400">Received</p></div>
                    <div className="text-center"><p className="text-lg font-bold text-gray-900">{data.whatsappAnalytics.failed}</p><p className="text-xs text-gray-400">Failed</p></div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="text-center bg-gray-50 rounded-lg py-2"><p className="text-base font-semibold text-gray-800">{data.whatsappAnalytics.deliveryRatePct != null ? `${data.whatsappAnalytics.deliveryRatePct}%` : '—'}</p><p className="text-xs text-gray-400">Delivery Rate</p></div>
                    <div className="text-center bg-gray-50 rounded-lg py-2"><p className="text-base font-semibold text-gray-800">{data.whatsappAnalytics.readRatePct != null ? `${data.whatsappAnalytics.readRatePct}%` : '—'}</p><p className="text-xs text-gray-400">Read Rate</p></div>
                  </div>
                  {data.whatsappAnalytics.note && <p className="text-xs text-gray-400 mt-2">{data.whatsappAnalytics.note}</p>}
                </>
              )}
            </div>

            {/* Social Analytics */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-1.5"><BarChart3 className="w-3.5 h-3.5" /> Social Engagement Analytics</h2>
              {!data.socialAnalytics || data.socialAnalytics.postsWithMetrics === 0 ? (
                <p className="text-sm text-gray-400 text-center py-4">No engagement metrics synced yet — use &quot;Sync metrics&quot; on published posts in Content Studio.</p>
              ) : (
                <>
                  <div className="grid grid-cols-4 gap-2 mb-3">
                    <div className="text-center"><p className="text-base font-bold text-gray-900">{data.socialAnalytics.totals.reach}</p><p className="text-[11px] text-gray-400">Reach</p></div>
                    <div className="text-center"><p className="text-base font-bold text-gray-900">{data.socialAnalytics.totals.impressions}</p><p className="text-[11px] text-gray-400">Impr.</p></div>
                    <div className="text-center"><p className="text-base font-bold text-gray-900">{data.socialAnalytics.totals.likes}</p><p className="text-[11px] text-gray-400">Likes</p></div>
                    <div className="text-center"><p className="text-base font-bold text-gray-900">{data.socialAnalytics.totals.shares}</p><p className="text-[11px] text-gray-400">Shares</p></div>
                  </div>
                  <ul className="space-y-1">
                    {Object.entries(data.socialAnalytics.byPlatform).map(([platform, s]) => (
                      <li key={platform} className="flex items-center justify-between text-xs text-gray-600">
                        <span className="capitalize">{platform.replace('_', ' ')}</span>
                        <span>{s.posts} posts · {s.reach} reach · {s.likes} likes</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </div>

          {/* Customers Likely To Book / Churn Risk / Next Best Action */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100">
                <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5"><Target className="w-3.5 h-3.5" /> Likely To Book</h2>
              </div>
              {data.likelyToBook.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-6 px-4">No high-scoring active leads right now.</p>
              ) : (
                <ul className="divide-y divide-gray-50">
                  {data.likelyToBook.map((l) => (
                    <li key={l.leadId} className="px-5 py-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-gray-800">{l.name || 'Unnamed lead'}</span>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-medium">{l.score}/100</span>
                      </div>
                      <p className="text-xs text-gray-500 mt-1">{l.nextBestAction}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100">
                <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5"><HeartCrack className="w-3.5 h-3.5" /> Churn Risk</h2>
              </div>
              {data.churnRisk.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-6 px-4">No repeat/known customers currently at risk.</p>
              ) : (
                <ul className="divide-y divide-gray-50">
                  {data.churnRisk.map((c) => (
                    <li key={c.leadId} className="px-5 py-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-gray-800">{c.name || 'Unnamed lead'}</span>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-700 font-medium">{c.riskScore}/100</span>
                      </div>
                      <p className="text-xs text-gray-500 mt-1">
                        {c.daysSinceContact != null ? `${c.daysSinceContact}d since contact` : 'No contact on record'}
                        {c.estimatedRevenueAtStake > 0 ? ` · ~${fmtINR(c.estimatedRevenueAtStake)} at stake` : ''}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100">
                <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5"><Compass className="w-3.5 h-3.5" /> Next Best Action</h2>
              </div>
              {data.nextBestActions.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-6 px-4">No active-pipeline leads to prioritize right now.</p>
              ) : (
                <ul className="divide-y divide-gray-50">
                  {data.nextBestActions.slice(0, 8).map((l) => (
                    <li key={l.leadId} className="px-5 py-3">
                      <span className="text-sm font-medium text-gray-800">{l.name || 'Unnamed lead'}</span>
                      <p className="text-xs text-gray-500 mt-1">{l.nextBestAction}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
