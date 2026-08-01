'use client'

// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/app/(crm)/dashboard/chief-of-staff/page.tsx
// Version 3.0 — AI Chief of Staff. Renders GET /api/dashboard/chief-of-staff
// exactly as returned — every number here is computed server-side by
// executive-brief-service.ts, itself an orchestration layer over existing
// services (see that file's header). This page does no scoring or
// aggregation of its own — same "route/service compute, page renders" split
// as every other dashboard in this codebase.
//
// Definition of done this page targets: within two minutes, the Founder
// understands Business Health, Expected Revenue, Revenue at Risk, Highest
// Priority Customers/Actions, Campaign Performance, Business Risks,
// Business Opportunities, and what to do first — without opening the
// Founder, Revenue, Intelligence, or Marketing dashboards separately.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import {
  RefreshCw, AlertTriangle, Sparkles, TrendingUp,
  ShieldAlert, Lightbulb, Gauge, Bell,
} from 'lucide-react'

interface BusinessHealthFactor {
  key: string
  label: string
  value: number | null
  weight: number
  source: string
}

interface PriorityItem {
  id: string
  title: string
  reason: string
  urgencyScore: number
  category: 'opportunity' | 'proposal' | 'follow_up'
  expectedRevenue: number | null
  leadId: string | null
  proposalId: string | null
}

interface ChiefOfStaffBrief {
  date: string
  windowDays: number
  businessHealthScore: { score: number; factors: BusinessHealthFactor[]; formulaNote: string }
  summaries: {
    business: string; revenue: string; lead: string; proposal: string
    booking: string; marketing: string; customer: string; siteVisit: string
  }
  todaysPriorities: PriorityItem[]
  predictiveInsights: {
    expectedRevenue: { value: number; note: string }
    revenueAtRisk: { value: number; note: string }
    likelyBookings: { value: number | null; note: string }
    highValueCustomers: { count: number; thresholdINR: number }
    customersNeedingAttention: { count: number; thresholdDays: number }
    campaignsLikelyToPerform: { name: string | null; conversionPct?: number; note?: string }
    packagesLikelyToSell: { name: string | null; revenue?: number; note?: string }
  }
  aiRecommendations: string[]
  businessRisks: string[]
  businessOpportunities: string[]
  urgentProposalsDegraded: boolean
  funnel: { stages: Array<{ stage: string; count: number; revenue: number; conversionFromPreviousPct: number | null }>; degraded: boolean }
  notifications: { audienceSize: number; written: number; skippedCapped: number; errors: string[] } | null
}

function fmtINR(n: number): string {
  if (n >= 100_000) return `₹${(n / 100_000).toFixed(1)}L`
  if (n >= 1_000) return `₹${(n / 1_000).toFixed(1)}K`
  return `₹${n.toLocaleString('en-IN')}`
}

function healthColor(score: number): string {
  if (score >= 70) return 'text-emerald-600'
  if (score >= 40) return 'text-amber-600'
  return 'text-red-600'
}

const CATEGORY_STYLE: Record<PriorityItem['category'], string> = {
  opportunity: 'bg-blue-50 text-blue-700',
  proposal: 'bg-purple-50 text-purple-700',
  follow_up: 'bg-amber-50 text-amber-700',
}

export default function ChiefOfStaffPage() {
  const [data, setData] = useState<ChiefOfStaffBrief | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/dashboard/chief-of-staff')
      if (!res.ok) throw new Error('Failed to load Chief of Staff brief')
      setData(await res.json())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Chief of Staff brief')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Chief of Staff</h1>
          <p className="text-sm text-gray-500 mt-0.5">Everything you need to know this morning, in one place.</p>
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
          {/* ── Business Health Score + Executive Summary ───────────────── */}
          <div className="bg-gradient-to-br from-indigo-600 to-indigo-700 rounded-xl p-6 text-white">
            <div className="flex items-start justify-between flex-wrap gap-4 mb-4">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4" />
                <h2 className="text-sm font-semibold">Executive Brief — {data.date}</h2>
              </div>
              <div className="flex items-center gap-2 bg-white/10 rounded-lg px-4 py-2">
                <Gauge className="w-5 h-5" />
                <div>
                  <div className="text-2xl font-bold leading-none">{data.businessHealthScore.score}<span className="text-sm font-normal text-indigo-200">/100</span></div>
                  <div className="text-[10px] text-indigo-200">Business Health</div>
                </div>
              </div>
            </div>
            <p className="text-sm text-indigo-50 leading-relaxed mb-4">{data.summaries.business}</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              <div><div className="text-xl font-bold">{fmtINR(data.predictiveInsights.expectedRevenue.value)}</div><div className="text-indigo-200 text-xs">Expected Revenue</div></div>
              <div><div className="text-xl font-bold">{fmtINR(data.predictiveInsights.revenueAtRisk.value)}</div><div className="text-indigo-200 text-xs">Revenue at Risk</div></div>
              <div><div className="text-xl font-bold">{data.predictiveInsights.highValueCustomers.count}</div><div className="text-indigo-200 text-xs">High-value Customers</div></div>
              <div><div className="text-xl font-bold">{data.todaysPriorities.length}</div><div className="text-indigo-200 text-xs">Priorities Today</div></div>
            </div>
          </div>

          {/* ── Business Health factor breakdown ─────────────────────────── */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-1 flex items-center gap-1.5"><Gauge className="w-3.5 h-3.5 text-gray-400" /> Business Health Breakdown</h2>
            <p className="text-[11px] text-gray-400 mb-3">{data.businessHealthScore.formulaNote}</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {data.businessHealthScore.factors.map((f) => (
                <div key={f.key} className="bg-gray-50 rounded-lg border border-gray-200 px-3 py-2.5">
                  <div className={`text-lg font-bold ${f.value != null ? healthColor(f.value) : 'text-gray-300'}`}>{f.value != null ? `${f.value}` : '—'}</div>
                  <div className="text-[11px] text-gray-500">{f.label}</div>
                  <div className="text-[10px] text-gray-400 mt-0.5">weight {f.weight}</div>
                </div>
              ))}
            </div>
          </div>

          {/* ── AI Recommendations ────────────────────────────────────────── */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-1.5"><Lightbulb className="w-3.5 h-3.5 text-amber-500" /> AI Recommendations</h2>
            {data.aiRecommendations.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">No specific recommendations right now.</p>
            ) : (
              <ul className="space-y-2">
                {data.aiRecommendations.map((r, i) => (
                  <li key={i} className="text-sm text-gray-700 flex gap-2"><span className="text-amber-500">•</span>{r}</li>
                ))}
              </ul>
            )}
          </div>

          {/* ── Today's Priorities ────────────────────────────────────────── */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100">
              <h2 className="text-sm font-semibold text-gray-700">Today&apos;s Priorities</h2>
            </div>
            {data.todaysPriorities.length === 0 ? (
              <p className="text-sm text-gray-400 px-6 py-8 text-center">Nothing urgent right now.</p>
            ) : (
              <ul className="divide-y divide-gray-50">
                {data.todaysPriorities.map((p) => (
                  <li key={p.id} className="flex items-start gap-3 px-6 py-3">
                    <span className={`shrink-0 mt-0.5 px-2 py-0.5 rounded-full text-[10px] font-medium uppercase ${CATEGORY_STYLE[p.category]}`}>{p.category.replace('_', ' ')}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800">
                        {p.leadId ? <Link href={`/customers/${p.leadId}`} className="hover:underline">{p.title}</Link> : p.title}
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">{p.reason}</p>
                    </div>
                    {p.expectedRevenue != null && (
                      <span className="shrink-0 text-sm text-emerald-600 font-medium">{fmtINR(p.expectedRevenue)}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* ── Risks & Opportunities ─────────────────────────────────────── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-1.5"><ShieldAlert className="w-3.5 h-3.5 text-red-500" /> Business Risks</h2>
              {data.businessRisks.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-4">No significant risks detected.</p>
              ) : (
                <ul className="space-y-2">
                  {data.businessRisks.map((r, i) => (
                    <li key={i} className="text-sm text-gray-700 flex gap-2"><span className="text-red-500">•</span>{r}</li>
                  ))}
                </ul>
              )}
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-1.5"><TrendingUp className="w-3.5 h-3.5 text-emerald-500" /> Business Opportunities</h2>
              {data.businessOpportunities.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-4">No standout opportunities detected.</p>
              ) : (
                <ul className="space-y-2">
                  {data.businessOpportunities.map((o, i) => (
                    <li key={i} className="text-sm text-gray-700 flex gap-2"><span className="text-emerald-500">•</span>{o}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* ── Predictive Insights ───────────────────────────────────────── */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Predictive Insights</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
              <div>
                <div className="text-gray-400 text-xs">Likely Bookings</div>
                <div className="font-medium text-gray-800">{data.predictiveInsights.likelyBookings.value != null ? data.predictiveInsights.likelyBookings.value : 'Insufficient data'}</div>
              </div>
              <div>
                <div className="text-gray-400 text-xs">Customers Needing Attention</div>
                <div className="font-medium text-gray-800">{data.predictiveInsights.customersNeedingAttention.count} (dormant {data.predictiveInsights.customersNeedingAttention.thresholdDays}+ days)</div>
              </div>
              <div>
                <div className="text-gray-400 text-xs">Campaign Likely to Perform</div>
                <div className="font-medium text-gray-800">{data.predictiveInsights.campaignsLikelyToPerform.name ?? 'Insufficient data'}{data.predictiveInsights.campaignsLikelyToPerform.conversionPct != null ? ` (${data.predictiveInsights.campaignsLikelyToPerform.conversionPct}%)` : ''}</div>
              </div>
              <div>
                <div className="text-gray-400 text-xs">Package Likely to Sell</div>
                <div className="font-medium text-gray-800">{data.predictiveInsights.packagesLikelyToSell.name ?? 'Insufficient data'}</div>
              </div>
              <div>
                <div className="text-gray-400 text-xs">High-value Customers</div>
                <div className="font-medium text-gray-800">{data.predictiveInsights.highValueCustomers.count} (≥{fmtINR(data.predictiveInsights.highValueCustomers.thresholdINR)})</div>
              </div>
            </div>
            <p className="text-[11px] text-gray-400 border-t border-gray-100 mt-3 pt-2.5">{data.predictiveInsights.expectedRevenue.note}</p>
          </div>

          {/* ── Business Summaries ────────────────────────────────────────── */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Business Summaries</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <div><span className="text-gray-400 text-xs block">Revenue</span>{data.summaries.revenue}</div>
              <div><span className="text-gray-400 text-xs block">Lead</span>{data.summaries.lead}</div>
              <div><span className="text-gray-400 text-xs block">Proposal</span>{data.summaries.proposal}</div>
              <div><span className="text-gray-400 text-xs block">Booking</span>{data.summaries.booking}</div>
              <div><span className="text-gray-400 text-xs block">Marketing</span>{data.summaries.marketing}</div>
              <div><span className="text-gray-400 text-xs block">Customer</span>{data.summaries.customer}</div>
              <div><span className="text-gray-400 text-xs block">Site Visit</span>{data.summaries.siteVisit}</div>
            </div>
          </div>

          {/* ── Conversion Funnel (reused verbatim) ──────────────────────── */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-700">Conversion Funnel</h2>
              <div className="flex gap-3 text-xs">
                <Link href="/dashboard/founder" className="text-blue-600 hover:underline">Founder Dashboard →</Link>
                <Link href="/dashboard/marketing" className="text-blue-600 hover:underline">Marketing Dashboard →</Link>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {data.funnel.stages.map((s) => (
                <div key={s.stage} className="flex-1 min-w-[100px] bg-gray-50 rounded-lg border border-gray-200 px-3 py-2.5 text-center">
                  <div className="text-lg font-bold text-gray-900">{s.count}</div>
                  <div className="text-[11px] text-gray-400 mt-0.5">{s.stage}</div>
                </div>
              ))}
            </div>
          </div>

          {data.notifications && (data.notifications.written > 0 || data.notifications.errors.length > 0) && (
            <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-4 py-2.5 text-xs text-gray-500">
              <Bell className="w-3.5 h-3.5 shrink-0" />
              {data.notifications.written} notification{data.notifications.written === 1 ? '' : 's'} sent to {data.notifications.audienceSize} team member{data.notifications.audienceSize === 1 ? '' : 's'}.
              {data.notifications.errors.length > 0 && ' Some notifications could not be written this run — see server logs.'}
            </div>
          )}

          {data.urgentProposalsDegraded && (
            <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-700">
              <AlertTriangle className="w-4 h-4 shrink-0" /> Proposal urgency data is degraded this run — Today&apos;s Priorities may be missing proposal-based items.
            </div>
          )}
        </>
      )}
    </div>
  )
}
