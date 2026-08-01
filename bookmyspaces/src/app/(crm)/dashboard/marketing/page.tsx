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
import { RefreshCw, AlertTriangle, Sparkles, TrendingUp, TrendingDown, Megaphone } from 'lucide-react'

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
  roiNote: string
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

          {data.campaignPerformance.degraded && (
            <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-700">
              <AlertTriangle className="w-4 h-4 shrink-0" /> Campaign attribution (migration 026) isn&apos;t live in this environment yet — campaign rows below are grouped into a single &quot;Attribution Unavailable&quot; bucket, not fabricated per-campaign.
            </div>
          )}

          {/* ── Lead Source Analysis ─────────────────────────────────────── */}
          <PerformanceTable title="Lead Source Analysis (by Channel)" rows={data.channelPerformance} keyLabel="Channel" />

          {/* ── Campaign Performance ─────────────────────────────────────── */}
          <PerformanceTable title="Campaign Performance" rows={data.campaignPerformance.rows} keyLabel="Campaign" />

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
          </div>

          {/* ── ROI Dashboard ────────────────────────────────────────────── */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-2">ROI Dashboard</h2>
            <p className="text-xs text-gray-400">{data.roiNote}</p>
          </div>
        </>
      )}
    </div>
  )
}
