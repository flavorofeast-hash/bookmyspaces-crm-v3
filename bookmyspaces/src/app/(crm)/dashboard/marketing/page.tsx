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
import { RefreshCw, AlertTriangle, Sparkles, TrendingUp, TrendingDown, Megaphone, Users, IndianRupee, Share2, Award, MessageCircle, BarChart3, Target, HeartCrack, Compass, MousePointerClick, Wallet, Loader2 } from 'lucide-react'

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
    referralConversionRate: number
    totalReferralRevenue: number
    note: string
  }
  referralRewards: { pending: number; earned: number; redeemed: number }
  loyaltyOverview: {
    totalAccounts: number
    totalPointsIssued: number
    byTier: Array<{ tier: string; count: number }>
    topEarners: Array<{ leadId: string; leadName: string | null; points: number; tier: string }>
  }
  revenueByLoyaltyTier: Array<{ tier: string; revenue: number; accountCount: number }>
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
  // Sprint 4 (Marketing Intelligence) — Top Performing Content + Best Posting Time.
  topContent: {
    postId: string
    platform: string
    content: string | null
    publishedAt: string | null
    engagementScore: number
  }[]
  bestPostingTime: {
    sampleSize: number
    byHour: { hour: number; avgEngagement: number; posts: number }[]
    byDayOfWeek: { day: string; avgEngagement: number; posts: number }[]
    recommendation: string
  } | null
  // Marketing Intelligence Priority 3 — same rows as channelPerformance/
  // campaignPerformance.rows, augmented with spend-derived metrics wherever
  // ad spend has been logged for that platform/campaign.
  channelPerformanceWithSpend: (AcquisitionPerformanceRow & { spend: number | null; costPerEnquiry: number | null; costPerBooking: number | null; roiFromSpend: number | null })[]
  campaignPerformanceWithSpend: (AcquisitionPerformanceRow & { spend: number | null; costPerEnquiry: number | null; costPerBooking: number | null; roiFromSpend: number | null })[]
  // Revenue Attribution Priority 2 — WhatsApp/call/website click totals (trailing 30 days).
  clickAnalytics: {
    rangeStart: string
    rangeEnd: string
    totalClicks: number
    rows: { type: string; totalClicks: number; byCampaign: { campaign: string; clicks: number }[] }[]
  } | null
  // End-to-End Campaign Attribution — null only on a hard failure; an empty
  // {posts:[],byPlatform:[]} is the honest "nothing published yet" state.
  socialAttribution: SocialAttribution | null
  // Content Operations Priority 5 — AI recommendations, deterministic over this account's own published-post history.
  bestContentFormat: { sampleSize: number; byFormat: { postType: string; avgEngagement: number; posts: number }[]; recommendation: string } | null
  bestAudience: { sampleSize: number; byPlatform: { platform: string; avgEngagement: number; posts: number }[]; recommendation: string } | null
  bestCTA: { sampleSize: number; byCTA: { label: string; avgEngagement: number; posts: number }[]; recommendation: string } | null
}

// Business Package Engine (migration 044) — mirrors computeBusinessPackagePerformance()'s
// return shape (src/lib/business-packages/business-package-service.ts) 1:1.
interface BusinessPackagePerformanceRow {
  packageId: string
  packageName: string
  status: 'active' | 'inactive' | 'retired'
  enquiries: number
  convertedLeads: number
  conversionPct: number
  revenue: number
  spend: number | null
  roi: number | null
  costPerLead: number | null
  costPerBooking: number | null
  repeatCustomers: number
  reviewCount: number
  avgRating: number | null
  referralCount: number
  referralsEarned: number
}

// End-to-End Campaign Attribution — mirrors social-attribution-service.ts's
// SocialPostRevenueRow/SocialPlatformRevenueRow/SocialAttribution shapes 1:1.
interface SocialPostRevenueRow {
  postId: string
  platform: string
  content: string | null
  publishedAt: string | null
  businessPackageId: string | null
  campaignId: string | null
  clicks: number
  estimatedRevenue: number
  attributionBasis: 'click_share' | 'even_split' | 'unattributed'
}
interface SocialPlatformRevenueRow {
  platform: string
  postCount: number
  totalClicks: number
  estimatedRevenue: number
}
interface SocialAttribution {
  posts: SocialPostRevenueRow[]
  byPlatform: SocialPlatformRevenueRow[]
  note: string
}

interface AdSpendRecord {
  id: string
  platform: string
  campaign_name: string | null
  spend_date: string
  amount: number
  currency: string
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

  // Marketing Intelligence Priority 3 — Ad Spend entry (POST /api/marketing/
  // ad-spend). Reloads the whole dashboard on save so channelPerformance
  // WithSpend picks up the new figure immediately, same pattern as
  // handleSyncRewards/handleSyncPoints below.
  const [adSpendPlatform, setAdSpendPlatform] = useState('facebook')
  const [adSpendCampaign, setAdSpendCampaign] = useState('')
  const [adSpendDate, setAdSpendDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [adSpendAmount, setAdSpendAmount] = useState('')
  const [adSpendSaving, setAdSpendSaving] = useState(false)
  const [adSpendRecords, setAdSpendRecords] = useState<AdSpendRecord[]>([])

  const loadAdSpend = useCallback(async () => {
    try {
      const res = await fetch('/api/marketing/ad-spend')
      if (!res.ok) return
      const json = await res.json()
      setAdSpendRecords(Array.isArray(json.records) ? json.records.slice(0, 10) : [])
    } catch { /* best-effort */ }
  }, [])

  useEffect(() => { loadAdSpend() }, [loadAdSpend])

  // Business Package Engine — "Marketing Dashboard should display Business
  // Package performance." Own loader/state (like ad spend above) since
  // GET /api/dashboard/marketing's payload isn't touched — reuses the new
  // GET /api/business-packages/analytics route instead.
  const [businessPackagePerf, setBusinessPackagePerf] = useState<BusinessPackagePerformanceRow[]>([])
  const [loadingBPP, setLoadingBPP] = useState(true)

  const loadBusinessPackagePerf = useCallback(async () => {
    setLoadingBPP(true)
    try {
      const res = await fetch('/api/business-packages/analytics')
      if (!res.ok) return
      const json = await res.json()
      setBusinessPackagePerf(Array.isArray(json.performance) ? json.performance : [])
    } catch { /* best-effort */ }
    finally { setLoadingBPP(false) }
  }, [])

  useEffect(() => { loadBusinessPackagePerf() }, [loadBusinessPackagePerf])

  async function handleAddAdSpend(e: React.FormEvent) {
    e.preventDefault()
    const amount = Number(adSpendAmount)
    if (!amount || amount <= 0) { toast.error('Enter a valid amount'); return }
    setAdSpendSaving(true)
    try {
      const res = await fetch('/api/marketing/ad-spend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: adSpendPlatform,
          campaignName: adSpendCampaign.trim() || null,
          spendDate: adSpendDate,
          amount,
        }),
      })
      const json = await res.json()
      if (!res.ok) { toast.error(json.error || 'Failed to record ad spend'); return }
      toast.success('Ad spend recorded.')
      setAdSpendCampaign(''); setAdSpendAmount('')
      await Promise.all([loadAdSpend(), load()])
    } finally {
      setAdSpendSaving(false)
    }
  }

  async function handleDeleteAdSpend(id: string) {
    const res = await fetch(`/api/marketing/ad-spend?id=${id}`, { method: 'DELETE' })
    if (res.ok) await Promise.all([loadAdSpend(), load()])
    else toast.error('Failed to delete record')
  }

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

          {/* ── Business Package Performance (Business Package Engine) ──── */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100">
              <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5"><Target className="w-3.5 h-3.5" /> Business Package Performance</h2>
              <p className="text-xs text-gray-400 mt-1">Enquiries, conversion, revenue, ROI, repeat customers, reviews and referrals — grouped by Business Package.</p>
            </div>
            {loadingBPP ? (
              <p className="text-sm text-gray-400 px-6 py-8 text-center">Loading…</p>
            ) : businessPackagePerf.length === 0 ? (
              <p className="text-sm text-gray-400 px-6 py-8 text-center">No Business Packages yet — create one under Business Packages.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-400 uppercase tracking-wide border-b border-gray-100">
                    <th className="px-6 py-2.5 font-medium">Package</th>
                    <th className="px-3 py-2.5 font-medium text-right">Enquiries</th>
                    <th className="px-3 py-2.5 font-medium text-right">Conversion%</th>
                    <th className="px-3 py-2.5 font-medium text-right">Revenue</th>
                    <th className="px-3 py-2.5 font-medium text-right">ROI</th>
                    <th className="px-3 py-2.5 font-medium text-right">Cost/Lead</th>
                    <th className="px-3 py-2.5 font-medium text-right">Cost/Booking</th>
                    <th className="px-3 py-2.5 font-medium text-right">Repeat</th>
                    <th className="px-3 py-2.5 font-medium text-right">Reviews</th>
                    <th className="px-6 py-2.5 font-medium text-right">Referrals</th>
                  </tr>
                </thead>
                <tbody>
                  {businessPackagePerf.map((r) => (
                    <tr key={r.packageId} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                      <td className="px-6 py-3 text-gray-800 font-medium">
                        {r.packageName}
                        {r.status !== 'active' && <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">{r.status}</span>}
                      </td>
                      <td className="px-3 py-3 text-right text-gray-600">{r.enquiries}</td>
                      <td className="px-3 py-3 text-right text-gray-600">{r.conversionPct}%</td>
                      <td className="px-3 py-3 text-right text-emerald-600 font-medium">{fmtINR(r.revenue)}</td>
                      <td className={`px-3 py-3 text-right font-medium ${r.roi != null && r.roi > 0 ? 'text-emerald-600' : r.roi != null ? 'text-red-600' : 'text-gray-400'}`}>
                        {r.roi != null ? `${(r.roi * 100).toFixed(0)}%` : '—'}
                      </td>
                      <td className="px-3 py-3 text-right text-gray-600">{r.costPerLead != null ? fmtINR(r.costPerLead) : '—'}</td>
                      <td className="px-3 py-3 text-right text-gray-600">{r.costPerBooking != null ? fmtINR(r.costPerBooking) : '—'}</td>
                      <td className="px-3 py-3 text-right text-gray-600">{r.repeatCustomers}</td>
                      <td className="px-3 py-3 text-right text-gray-600">{r.reviewCount}{r.avgRating != null ? ` (${r.avgRating}★)` : ''}</td>
                      <td className="px-6 py-3 text-right text-gray-600">{r.referralCount}{r.referralsEarned > 0 ? ` (${r.referralsEarned} earned)` : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

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
                <p className="text-xs text-gray-400">Conversion: <span className="font-medium text-gray-600">{data.referralPerformance.referralConversionRate}%</span></p>
                <p className="text-xs text-gray-400">Referral Revenue: <span className="font-medium text-emerald-600">{fmtINR(data.referralPerformance.totalReferralRevenue)}</span></p>
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
            {data.revenueByLoyaltyTier.length > 0 && (
              <div className="mt-4 pt-4 border-t border-gray-100">
                <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">Revenue by Loyalty Tier</p>
                <ul className="space-y-1.5">
                  {data.revenueByLoyaltyTier.map((t) => (
                    <li key={t.tier} className="flex items-center justify-between text-sm">
                      <span className="text-gray-700">{t.tier} <span className="text-xs text-gray-400">({t.accountCount} {t.accountCount === 1 ? 'account' : 'accounts'})</span></span>
                      <span className="text-emerald-600 font-medium">{fmtINR(t.revenue)}</span>
                    </li>
                  ))}
                </ul>
              </div>
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

          {/* Top Performing Content / Best Posting Time (Sprint 4 — Marketing Intelligence) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100">
                <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5"><Award className="w-3.5 h-3.5" /> Top Performing Content</h2>
              </div>
              {data.topContent.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-6 px-4">No published posts with synced metrics yet.</p>
              ) : (
                <ul className="divide-y divide-gray-50">
                  {data.topContent.slice(0, 5).map((c) => (
                    <li key={c.postId} className="px-5 py-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-gray-500 capitalize">{c.platform.replace('_', ' ')}</span>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-medium">{c.engagementScore} pts</span>
                      </div>
                      <p className="text-sm text-gray-700 mt-1 truncate">{c.content || <span className="text-gray-400 italic">Media-only post</span>}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5" /> AI: Best Posting Time</h2>
              {!data.bestPostingTime || data.bestPostingTime.byHour.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-4">{data.bestPostingTime?.recommendation ?? 'Not enough data yet.'}</p>
              ) : (
                <>
                  <p className="text-sm text-gray-700 mb-3">{data.bestPostingTime.recommendation}</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-xs text-gray-400 mb-1">Best hours</p>
                      <ul className="space-y-1">
                        {data.bestPostingTime.byHour.slice(0, 3).map((h) => (
                          <li key={h.hour} className="text-xs text-gray-600 flex justify-between"><span>{h.hour}:00</span><span>{h.avgEngagement} avg</span></li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <p className="text-xs text-gray-400 mb-1">Best days</p>
                      <ul className="space-y-1">
                        {data.bestPostingTime.byDayOfWeek.slice(0, 3).map((d) => (
                          <li key={d.day} className="text-xs text-gray-600 flex justify-between"><span>{d.day}</span><span>{d.avgEngagement} avg</span></li>
                        ))}
                      </ul>
                    </div>
                  </div>
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

          {/* Marketing Intelligence Priority 3 — Ad Spend / Cost per Enquiry / Cost per Booking */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-1 flex items-center gap-1.5"><Wallet className="w-3.5 h-3.5" /> Ad Spend &amp; ROI</h2>
            <p className="text-xs text-gray-500 mb-4">{data.roiNote}</p>

            <form onSubmit={handleAddAdSpend} className="grid grid-cols-1 md:grid-cols-5 gap-3 mb-5 pb-5 border-b border-gray-100">
              <select
                value={adSpendPlatform}
                onChange={(e) => setAdSpendPlatform(e.target.value)}
                aria-label="Ad spend platform"
                className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {['facebook', 'instagram', 'linkedin', 'google_business', 'x', 'youtube', 'threads', 'google_ads', 'other'].map((p) => (
                  <option key={p} value={p}>{p.replace('_', ' ')}</option>
                ))}
              </select>
              <input
                value={adSpendCampaign}
                onChange={(e) => setAdSpendCampaign(e.target.value)}
                placeholder="Campaign name (optional)"
                aria-label="Ad spend campaign name"
                className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <input
                type="date"
                value={adSpendDate}
                onChange={(e) => setAdSpendDate(e.target.value)}
                aria-label="Spend date"
                required
                className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <input
                type="number"
                min="0"
                step="0.01"
                value={adSpendAmount}
                onChange={(e) => setAdSpendAmount(e.target.value)}
                placeholder="Amount (₹)"
                aria-label="Spend amount"
                required
                className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="submit"
                disabled={adSpendSaving}
                className="flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-60"
              >
                {adSpendSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Add Spend
              </button>
            </form>

            {data.channelPerformanceWithSpend.filter((r) => r.spend != null).length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">No spend recorded yet for any channel — add an entry above to see cost-per-enquiry, cost-per-booking, and ROI.</p>
            ) : (
              <table className="w-full text-sm mb-5">
                <thead>
                  <tr className="text-left text-xs text-gray-400 uppercase tracking-wide border-b border-gray-100">
                    <th className="py-2 font-medium">Channel</th>
                    <th className="py-2 font-medium text-right">Spend</th>
                    <th className="py-2 font-medium text-right">Cost / Enquiry</th>
                    <th className="py-2 font-medium text-right">Cost / Booking</th>
                    <th className="py-2 font-medium text-right">ROI</th>
                  </tr>
                </thead>
                <tbody>
                  {data.channelPerformanceWithSpend.filter((r) => r.spend != null).map((r) => (
                    <tr key={r.key} className="border-b border-gray-50 last:border-0">
                      <td className="py-2.5 text-gray-800 font-medium">{r.key}</td>
                      <td className="py-2.5 text-right text-gray-600">{fmtINR(r.spend as number)}</td>
                      <td className="py-2.5 text-right text-gray-600">{r.costPerEnquiry != null ? fmtINR(r.costPerEnquiry) : '—'}</td>
                      <td className="py-2.5 text-right text-gray-600">{r.costPerBooking != null ? fmtINR(r.costPerBooking) : '—'}</td>
                      <td className={`py-2.5 text-right font-medium ${r.roiFromSpend != null && r.roiFromSpend > 0 ? 'text-emerald-600' : r.roiFromSpend != null ? 'text-red-600' : 'text-gray-400'}`}>
                        {r.roiFromSpend != null ? `${(r.roiFromSpend * 100).toFixed(0)}%` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {adSpendRecords.length > 0 && (
              <>
                <p className="text-xs text-gray-400 mb-2">Recent entries</p>
                <ul className="divide-y divide-gray-50">
                  {adSpendRecords.map((r) => (
                    <li key={r.id} className="py-2 flex items-center justify-between text-sm">
                      <span className="text-gray-600">
                        <span className="capitalize font-medium text-gray-800">{r.platform.replace('_', ' ')}</span>
                        {r.campaign_name ? ` · ${r.campaign_name}` : ''} · {r.spend_date}
                      </span>
                      <span className="flex items-center gap-3">
                        <span className="text-gray-700 font-medium">{fmtINR(Number(r.amount))}</span>
                        <button onClick={() => handleDeleteAdSpend(r.id)} className="text-xs text-red-500 hover:text-red-700">Delete</button>
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>

          {/* Revenue Attribution Priority 2 — Click Analytics */}
          {data.clickAnalytics && (
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-1.5"><MousePointerClick className="w-3.5 h-3.5" /> Click Analytics (last 30 days) — {data.clickAnalytics.totalClicks} total clicks</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {data.clickAnalytics.rows.map((row) => (
                  <div key={row.type} className="border border-gray-100 rounded-lg p-3">
                    <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">{row.type.replace('_click', '')}</p>
                    <p className="text-xl font-semibold text-gray-800 mb-2">{row.totalClicks}</p>
                    {row.byCampaign.slice(0, 3).map((c) => (
                      <div key={c.campaign} className="flex justify-between text-xs text-gray-500">
                        <span className="truncate">{c.campaign}</span><span>{c.clicks}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* End-to-End Campaign Attribution — Revenue by Social Platform / Revenue by Individual Social Post */}
          {data.socialAttribution && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-5 py-3 border-b border-gray-100">
                  <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5"><Share2 className="w-3.5 h-3.5" /> Revenue by Social Platform</h2>
                </div>
                {data.socialAttribution.byPlatform.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-6 px-4">No published posts with Business Package attribution yet.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-gray-400 uppercase tracking-wide border-b border-gray-100">
                        <th className="px-5 py-2 font-medium">Platform</th>
                        <th className="px-3 py-2 font-medium text-right">Posts</th>
                        <th className="px-3 py-2 font-medium text-right">Clicks</th>
                        <th className="px-5 py-2 font-medium text-right">Est. Revenue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.socialAttribution.byPlatform.map((r) => (
                        <tr key={r.platform} className="border-b border-gray-50 last:border-0">
                          <td className="px-5 py-2.5 text-gray-800 font-medium capitalize">{r.platform.replace('_', ' ')}</td>
                          <td className="px-3 py-2.5 text-right text-gray-600">{r.postCount}</td>
                          <td className="px-3 py-2.5 text-right text-gray-600">{r.totalClicks}</td>
                          <td className="px-5 py-2.5 text-right text-emerald-600 font-medium">{fmtINR(r.estimatedRevenue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-5 py-3 border-b border-gray-100">
                  <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5"><Award className="w-3.5 h-3.5" /> Revenue by Individual Social Post</h2>
                </div>
                {data.socialAttribution.posts.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-6 px-4">No published posts yet.</p>
                ) : (
                  <ul className="divide-y divide-gray-50 max-h-80 overflow-y-auto">
                    {data.socialAttribution.posts.slice(0, 10).map((p) => (
                      <li key={p.postId} className="px-5 py-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-medium text-gray-500 capitalize">{p.platform.replace('_', ' ')}</span>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${p.attributionBasis === 'unattributed' ? 'bg-gray-100 text-gray-500' : 'bg-emerald-50 text-emerald-700'}`}>
                            {p.attributionBasis === 'unattributed' ? 'No package linked' : fmtINR(p.estimatedRevenue)}
                          </span>
                        </div>
                        <p className="text-sm text-gray-700 mt-1 truncate">{p.content || <span className="text-gray-400 italic">Media-only post</span>}</p>
                        <p className="text-xs text-gray-400 mt-0.5">{p.clicks} clicks{p.attributionBasis === 'even_split' ? ' · split evenly (no click data yet)' : ''}</p>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="px-5 py-2.5 text-xs text-gray-400 border-t border-gray-100">{data.socialAttribution.note}</p>
              </div>
            </div>
          )}

          {/* Content Operations Priority 5 — AI Recommendations (best CTA / format / audience) */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h2 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5" /> Best CTA</h2>
              <p className="text-xs text-gray-600">{data.bestCTA?.recommendation ?? 'Not enough data yet.'}</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h2 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5" /> Best Content Format</h2>
              <p className="text-xs text-gray-600">{data.bestContentFormat?.recommendation ?? 'Not enough data yet.'}</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h2 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5" /> Best Audience (Platform)</h2>
              <p className="text-xs text-gray-600">{data.bestAudience?.recommendation ?? 'Not enough data yet.'}</p>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
