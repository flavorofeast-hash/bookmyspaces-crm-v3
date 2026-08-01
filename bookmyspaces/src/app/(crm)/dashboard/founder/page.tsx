'use client'

// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/app/(crm)/dashboard/founder/page.tsx
// Sprint 3A — Founder Dashboard. Renders GET /api/dashboard/founder exactly
// as returned — every number on this page is computed server-side by that
// route from existing services (opportunity-score.ts, revenue-intelligence.ts,
// site-visit-service.ts, lead-intelligence.ts); this page does no scoring or
// aggregation of its own, only formatting/layout — same "route/service do
// the work, page just renders" split as every other dashboard page.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import {
  RefreshCw, AlertTriangle, Sparkles, Clock, TrendingDown,
  MapPin, PhoneCall, FileText,
} from 'lucide-react'

interface Opportunity {
  leadId: string
  customerName: string | null
  eventType: string | null
  eventDate: string | null
  guestCount: number | null
  revenueProbability: { score: number; band: 'HIGH' | 'MEDIUM' | 'LOW' }
  expectedRevenue: number | null
  expectedRevenueSource: 'proposal' | 'estimated' | 'none'
  nextAction: { action: string; label: string; color: string }
}

interface FounderDashboard {
  today: string
  todaysOpportunities: Opportunity[]
  revenuePipeline: {
    windowDays: number
    leads: { count: number; revenue: number }
    visits: { count: number }
    draftProposals: { count: number; revenue: number }
    sentProposals: { count: number; revenue: number }
    negotiation: { count: number; revenue: number }
    bookings: { count: number; revenue: number }
    degraded: boolean
  }
  todaysSchedule: {
    siteVisits: Array<{ id: string; time: string; customerName: string | null; customerPhone: string | null; property: string | null; purpose: string | null; status: string; statusLabel: string }>
    followUps: Array<{ leadId: string; name: string | null; phone: string | null; dueAt: string | null; leadStage: string | null; aiScore: number | null }>
    proposalReviews: Array<{ proposalId: string; clientName: string | null; status: string | null; totalPrice: number | null; createdAt: string }>
    proposalReviewsNote: string
  }
  morningBrief: {
    date: string
    topOpportunities: Opportunity[]
    proposalActivity: { sentLast48h: number; viewedLast48h: number }
    visitRemindersCount: number
    recommendedActions: string[]
  }
  lostRevenue: {
    windowDays: number
    lostLeadsValue: number
    lostLeadsCount: number
    lostProposalsValue: number
    lostProposalsCount: number
    byReason: {
      noFollowUp: { count: number; value: number }
      noResponse: null
      price: null
      capacity: null
      other: null
    }
    gapNote: string
  }
}

function fmtINR(n: number): string {
  if (n >= 100_000) return `₹${(n / 100_000).toFixed(1)}L`
  if (n >= 1_000) return `₹${(n / 1_000).toFixed(1)}K`
  return `₹${n.toLocaleString('en-IN')}`
}

function fmtTime(iso: string): string {
  try { return new Date(iso).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' }) }
  catch { return iso }
}

const BAND_STYLE: Record<Opportunity['revenueProbability']['band'], string> = {
  HIGH: 'bg-emerald-100 text-emerald-700',
  MEDIUM: 'bg-amber-100 text-amber-700',
  LOW: 'bg-gray-100 text-gray-600',
}

function PipelineStage({ label, count, revenue }: { label: string; count: number; revenue?: number }) {
  return (
    <div className="flex-1 min-w-[100px] bg-white rounded-lg border border-gray-200 px-3 py-2.5 text-center">
      <div className="text-lg font-bold text-gray-900">{count}</div>
      <div className="text-[11px] text-gray-400 mt-0.5">{label}</div>
      {revenue !== undefined && revenue > 0 && (
        <div className="text-[11px] text-emerald-600 font-medium mt-0.5">{fmtINR(revenue)}</div>
      )}
    </div>
  )
}

export default function FounderDashboardPage() {
  const [data, setData] = useState<FounderDashboard | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/dashboard/founder')
      if (!res.ok) throw new Error('Failed to load founder dashboard')
      setData(await res.json())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load founder dashboard')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Founder Dashboard</h1>
          <p className="text-sm text-gray-500 mt-0.5">What needs your attention today.</p>
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
          {/* ── AI Morning Brief ─────────────────────────────────────────── */}
          <div className="bg-gradient-to-br from-indigo-600 to-indigo-700 rounded-xl p-6 text-white">
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="w-4 h-4" />
              <h2 className="text-sm font-semibold">Morning Brief — {data.morningBrief.date}</h2>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4 text-sm">
              <div><div className="text-2xl font-bold">{data.todaysOpportunities.length}</div><div className="text-indigo-200 text-xs">Open opportunities</div></div>
              <div><div className="text-2xl font-bold">{data.morningBrief.visitRemindersCount}</div><div className="text-indigo-200 text-xs">Site visits today</div></div>
              <div><div className="text-2xl font-bold">{data.morningBrief.proposalActivity.sentLast48h}</div><div className="text-indigo-200 text-xs">Proposals sent (48h)</div></div>
              <div><div className="text-2xl font-bold">{data.morningBrief.proposalActivity.viewedLast48h}</div><div className="text-indigo-200 text-xs">Proposals viewed (48h)</div></div>
            </div>
            {data.morningBrief.recommendedActions.length > 0 && (
              <div className="border-t border-indigo-500/40 pt-3 space-y-1.5">
                <p className="text-xs font-semibold text-indigo-200 uppercase tracking-wide">Recommended actions</p>
                {data.morningBrief.recommendedActions.map((a, i) => (
                  <p key={i} className="text-sm text-indigo-50">• {a}</p>
                ))}
              </div>
            )}
          </div>

          {/* ── Revenue Pipeline ─────────────────────────────────────────── */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-700">Revenue Pipeline <span className="text-gray-400 font-normal">({data.revenuePipeline.windowDays}d)</span></h2>
              <Link href="/dashboard/intelligence" className="text-xs font-medium text-blue-600 hover:underline">Full Intelligence →</Link>
            </div>
            {data.revenuePipeline.degraded && (
              <p className="text-xs text-amber-600 mb-3">Booking stage is degraded — reservation data isn&apos;t live in this environment yet.</p>
            )}
            <div className="flex flex-wrap gap-2">
              <PipelineStage label="Leads" count={data.revenuePipeline.leads.count} />
              <PipelineStage label="Site Visits" count={data.revenuePipeline.visits.count} />
              <PipelineStage label="Draft Proposals" count={data.revenuePipeline.draftProposals.count} revenue={data.revenuePipeline.draftProposals.revenue} />
              <PipelineStage label="Sent Proposals" count={data.revenuePipeline.sentProposals.count} revenue={data.revenuePipeline.sentProposals.revenue} />
              <PipelineStage label="Negotiation" count={data.revenuePipeline.negotiation.count} revenue={data.revenuePipeline.negotiation.revenue} />
              <PipelineStage label="Bookings" count={data.revenuePipeline.bookings.count} revenue={data.revenuePipeline.bookings.revenue} />
            </div>
          </div>

          {/* ── Today's Opportunities ────────────────────────────────────── */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100">
              <h2 className="text-sm font-semibold text-gray-700">Today&apos;s Opportunities</h2>
            </div>
            {data.todaysOpportunities.length === 0 ? (
              <p className="text-sm text-gray-400 px-6 py-8 text-center">No open opportunities right now.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-400 uppercase tracking-wide border-b border-gray-100">
                    <th className="px-6 py-2.5 font-medium">Customer</th>
                    <th className="px-3 py-2.5 font-medium">Event</th>
                    <th className="px-3 py-2.5 font-medium">Revenue Probability</th>
                    <th className="px-3 py-2.5 font-medium">Expected Revenue</th>
                    <th className="px-6 py-2.5 font-medium text-right">Next Action</th>
                  </tr>
                </thead>
                <tbody>
                  {data.todaysOpportunities.map((o) => (
                    <tr key={o.leadId} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                      <td className="px-6 py-3">
                        <Link href={`/customers/${o.leadId}`} className="text-gray-800 font-medium hover:underline">{o.customerName ?? 'Unnamed'}</Link>
                      </td>
                      <td className="px-3 py-3 text-gray-600">{o.eventType ?? '—'}{o.guestCount ? ` · ${o.guestCount} guests` : ''}</td>
                      <td className="px-3 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${BAND_STYLE[o.revenueProbability.band]}`}>
                          {o.revenueProbability.score}/100
                        </span>
                      </td>
                      <td className="px-3 py-3 text-gray-700">
                        {o.expectedRevenue != null ? fmtINR(o.expectedRevenue) : '—'}
                        {o.expectedRevenueSource === 'estimated' && <span className="text-gray-300 text-xs ml-1">(est.)</span>}
                      </td>
                      <td className="px-6 py-3 text-right">
                        <span className={`text-xs font-medium ${o.nextAction.color}`}>{o.nextAction.label}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* ── Today's Schedule ─────────────────────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5 text-gray-400" /> Site Visits</h2>
              {data.todaysSchedule.siteVisits.length === 0 ? (
                <p className="text-xs text-gray-400">None scheduled today.</p>
              ) : (
                <ul className="space-y-2.5">
                  {data.todaysSchedule.siteVisits.map((v) => (
                    <li key={v.id} className="text-xs">
                      <span className="text-gray-400 inline-flex items-center gap-1"><Clock className="w-3 h-3" />{fmtTime(v.time)}</span>
                      <span className="text-gray-800 font-medium ml-2">{v.customerName ?? 'Unnamed'}</span>
                      <div className="text-gray-400">{v.property ?? '—'}</div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-1.5"><PhoneCall className="w-3.5 h-3.5 text-gray-400" /> Follow-ups</h2>
              {data.todaysSchedule.followUps.length === 0 ? (
                <p className="text-xs text-gray-400">None due today.</p>
              ) : (
                <ul className="space-y-2.5">
                  {data.todaysSchedule.followUps.map((f) => (
                    <li key={f.leadId} className="text-xs">
                      <span className="text-gray-800 font-medium">{f.name ?? 'Unnamed'}</span>
                      <span className="text-gray-400 ml-2">{f.phone ?? '—'}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h2 className="text-sm font-semibold text-gray-700 mb-1 flex items-center gap-1.5"><FileText className="w-3.5 h-3.5 text-gray-400" /> Proposal Reviews</h2>
              <p className="text-[11px] text-gray-400 mb-2.5">Draft backlog — no scheduling exists for this yet.</p>
              {data.todaysSchedule.proposalReviews.length === 0 ? (
                <p className="text-xs text-gray-400">Nothing awaiting review.</p>
              ) : (
                <ul className="space-y-2.5">
                  {data.todaysSchedule.proposalReviews.slice(0, 6).map((p) => (
                    <li key={p.proposalId} className="text-xs flex items-center justify-between">
                      <span className="text-gray-800 font-medium">{p.clientName ?? 'Unnamed'}</span>
                      <span className="text-gray-400">{p.totalPrice != null ? fmtINR(p.totalPrice) : '—'}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* ── Lost Revenue Summary ─────────────────────────────────────── */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-1 flex items-center gap-1.5"><TrendingDown className="w-3.5 h-3.5 text-red-400" /> Lost Revenue Summary <span className="text-gray-400 font-normal">({data.lostRevenue.windowDays}d)</span></h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 my-3 text-sm">
              <div><div className="text-lg font-bold text-red-600">{fmtINR(data.lostRevenue.lostLeadsValue)}</div><div className="text-xs text-gray-400">{data.lostRevenue.lostLeadsCount} lost leads</div></div>
              <div><div className="text-lg font-bold text-red-600">{fmtINR(data.lostRevenue.lostProposalsValue)}</div><div className="text-xs text-gray-400">{data.lostRevenue.lostProposalsCount} rejected/expired proposals</div></div>
              <div><div className="text-lg font-bold text-gray-700">{data.lostRevenue.byReason.noFollowUp.count}</div><div className="text-xs text-gray-400">No Follow-up ({fmtINR(data.lostRevenue.byReason.noFollowUp.value)})</div></div>
              <div><div className="text-lg font-bold text-gray-300">—</div><div className="text-xs text-gray-400">Other reasons: not tracked</div></div>
            </div>
            <p className="text-[11px] text-gray-400 border-t border-gray-100 pt-2.5">{data.lostRevenue.gapNote}</p>
          </div>
        </>
      )}
    </div>
  )
}
