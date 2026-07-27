'use client';

// src/app/(crm)/dashboard/intelligence/page.tsx
// Revenue Intelligence Dashboard — fetches /api/dashboard/intelligence.
// Sales Funnel, Revenue Forecast, Proposal/Booking/Customer Analytics,
// Sales Productivity. Same component conventions as dashboard/revenue/page.tsx
// (no invented UI kit — Tailwind + recharts, both already dependencies).

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import type { RevenueIntelligence } from '@/lib/analytics/revenue-intelligence';

function formatINR(value: number): string {
  if (value >= 100_000) return `₹${(value / 100_000).toFixed(1)}L`;
  if (value >= 1_000) return `₹${(value / 1_000).toFixed(1)}K`;
  return `₹${value.toLocaleString('en-IN')}`;
}

function KpiCard({ label, value, sub, color = 'border-slate-300' }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className={`rounded-xl border bg-white p-5 shadow-sm border-l-4 ${color}`}>
      <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-2">{label}</p>
      <p className="text-2xl font-bold text-slate-900 leading-none">{value}</p>
      {sub && <p className="mt-1.5 text-xs text-slate-400">{sub}</p>}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-4">{children}</h2>;
}

function SkeletonCard() {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm animate-pulse">
      <div className="h-2.5 w-20 rounded bg-slate-200 mb-3" />
      <div className="h-7 w-28 rounded bg-slate-200 mb-2" />
      <div className="h-2 w-14 rounded bg-slate-100" />
    </div>
  );
}

export default function RevenueIntelligencePage() {
  const [data, setData] = useState<RevenueIntelligence | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/dashboard/intelligence?days=180', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (!loading && error) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <div className="rounded-xl border border-red-200 bg-red-50 p-8 text-center">
          <p className="font-semibold text-red-700">Failed to load revenue intelligence</p>
          <p className="mt-1 text-sm text-red-500">{error}</p>
          <button onClick={() => void load()} className="mt-4 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700">Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 py-8 sm:px-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Revenue Intelligence</h1>
          <p className="mt-0.5 text-sm text-slate-500">Sales funnel, forecast, and performance — last {data?.windowDays ?? 180} days</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/dashboard/revenue" className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm hover:bg-slate-50">Revenue Dashboard</Link>
          <button onClick={() => void load()} disabled={loading} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm hover:bg-slate-50 disabled:opacity-40">
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* ── Sales Funnel ─────────────────────────────────────────────────── */}
      <section>
        <SectionTitle>Sales Funnel</SectionTitle>
        {loading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">{Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}</div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-100 bg-slate-50">
                <tr>
                  {['Stage', 'Count', 'Conversion', 'Revenue', 'Avg days to reach'].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data?.funnel.stages.map((s) => (
                  <tr key={s.stage} className="hover:bg-slate-50/60">
                    <td className="px-4 py-3 font-medium text-slate-800">{s.stage}</td>
                    <td className="px-4 py-3 text-slate-700">{s.count}</td>
                    <td className="px-4 py-3 text-slate-500">{s.conversionFromPreviousPct !== null ? `${s.conversionFromPreviousPct}%` : '—'}</td>
                    <td className="px-4 py-3 text-emerald-700 font-medium">{formatINR(s.revenue)}</td>
                    <td className="px-4 py-3 text-slate-500">{s.avgDaysInPreviousStage !== null ? `${s.avgDaysInPreviousStage}d` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data?.funnel.degraded && (
              <p className="px-4 py-2 text-xs text-amber-600 border-t border-amber-100 bg-amber-50">
                &quot;Avg days to reach&quot; needs migration 019 (stage_transitions) applied — showing counts/revenue only until then.
              </p>
            )}
          </div>
        )}
      </section>

      {/* ── Forecast + Proposal Analytics ───────────────────────────────── */}
      <section>
        <SectionTitle>Revenue Forecast</SectionTitle>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {loading ? Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />) : (
            <>
              <KpiCard label="Pipeline Forecast" value={formatINR(data?.forecast.pipelineForecast ?? 0)} sub={`${data?.forecast.historicalAcceptancePct ?? 0}% historical acceptance`} color="border-l-emerald-500" />
              <KpiCard label="Committed (Confirmed)" value={formatINR(data?.forecast.confirmedNotCompletedRevenue ?? 0)} sub="Not yet checked out" color="border-l-sky-500" />
              <KpiCard label="Total Forecast" value={formatINR(data?.forecast.totalForecast ?? 0)} color="border-l-violet-500" />
              <KpiCard label="Open Pipeline Value" value={formatINR(data?.forecast.openProposalValue ?? 0)} sub="Undecided proposals" color="border-l-amber-400" />
            </>
          )}
        </div>
        <p className="mt-2 text-xs text-slate-400">{data?.forecast.methodologyNote}</p>
      </section>

      <section>
        <SectionTitle>Proposal Analytics</SectionTitle>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {loading ? Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />) : (
            <>
              <KpiCard label="Acceptance Rate" value={`${data?.proposalAnalytics.acceptancePct ?? 0}%`} color="border-l-emerald-500" />
              <KpiCard label="Avg Proposal Value" value={formatINR(data?.proposalAnalytics.avgProposalValue ?? 0)} color="border-l-sky-500" />
              <KpiCard label="Avg Days to Acceptance" value={data?.proposalAnalytics.avgDaysToAcceptance != null ? `${data.proposalAnalytics.avgDaysToAcceptance}d` : '—'} color="border-l-violet-500" />
              <KpiCard label="Total Proposals" value={String(data?.proposalAnalytics.total ?? 0)} color="border-l-amber-400" />
            </>
          )}
        </div>
        {!loading && data && (
          <p className="mt-2 text-xs text-slate-400">{data.proposalAnalytics.lostProposalReasonsNote}</p>
        )}
      </section>

      {/* ── Booking Analytics ────────────────────────────────────────────── */}
      <section>
        <SectionTitle>Booking Analytics</SectionTitle>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-4">
          {loading ? Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />) : (
            <>
              <KpiCard label="Occupancy" value={data?.bookingAnalytics.occupancyPct != null ? `${data.bookingAnalytics.occupancyPct}%` : '—'} color="border-l-emerald-500" />
              <KpiCard label="ADR" value={data?.bookingAnalytics.adr != null ? formatINR(data.bookingAnalytics.adr) : '—'} sub="Average daily rate" color="border-l-sky-500" />
              <KpiCard label="Cancellation Rate" value={`${data?.bookingAnalytics.cancellationPct ?? 0}%`} color="border-l-red-400" />
              <KpiCard label="Repeat Bookings" value={`${data?.bookingAnalytics.repeatBookingPct ?? 0}%`} sub={`${data?.bookingAnalytics.repeatBookingCustomers ?? 0} customers`} color="border-l-violet-500" />
            </>
          )}
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-4">Booking Revenue — Last 6 Months</p>
          {loading ? <div className="h-44 animate-pulse rounded-lg bg-slate-100" /> : !data || data.bookingAnalytics.revenueByMonth.every((r) => r.revenue === 0) ? (
            <div className="flex h-44 items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50"><p className="text-xs text-slate-400">No booking revenue yet</p></div>
          ) : (
            <ResponsiveContainer width="100%" height={176}>
              <BarChart data={data.bookingAnalytics.revenueByMonth} margin={{ top: 0, right: 8, bottom: 0, left: 0 }}>
                <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={(v: number) => formatINR(v)} width={52} />
                <Tooltip formatter={(v: number) => [formatINR(v), 'Revenue']} contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }} />
                <Bar dataKey="revenue" fill="#8b5cf6" radius={[4, 4, 0, 0]} maxBarSize={40} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </section>

      {/* ── Customer Analytics ───────────────────────────────────────────── */}
      <section>
        <SectionTitle>Customer Analytics</SectionTitle>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {loading ? Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} />) : (
            <>
              <KpiCard label="Avg CLV" value={formatINR(data?.customerAnalytics.avgCLV ?? 0)} color="border-l-emerald-500" />
              <KpiCard label="Repeat Customers" value={`${data?.customerAnalytics.repeatCustomerPct ?? 0}%`} color="border-l-violet-500" />
              <KpiCard label="New This Month" value={String(data?.customerAnalytics.newCustomersThisMonth ?? 0)} color="border-l-sky-500" />
              <KpiCard label="Dormant" value={String(data?.customerAnalytics.dormantCustomers ?? 0)} sub={`${data?.customerAnalytics.dormantThresholdDays ?? 60}+ days no contact`} color="border-l-amber-400" />
              <KpiCard label="High-Value" value={String(data?.customerAnalytics.highValueCustomers ?? 0)} sub={`≥ ${formatINR(data?.customerAnalytics.highValueThresholdINR ?? 150000)}`} color="border-l-rose-500" />
            </>
          )}
        </div>
      </section>

      {/* ── Event Revenue Dashboard (Direct Event Sales Engine, Section 6) ── */}
      <section>
        <SectionTitle>Event Sales</SectionTitle>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6 mb-4">
          {loading ? Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />) : (
            <>
              <KpiCard label="Event Enquiries" value={String(data?.eventSales.eventEnquiries ?? 0)} color="border-l-sky-500" />
              <KpiCard label="Event Proposals" value={String(data?.eventSales.eventProposals ?? 0)} color="border-l-violet-500" />
              <KpiCard label="Proposal Conversion" value={`${data?.eventSales.eventProposalConversionPct ?? 0}%`} sub={`${data?.eventSales.eventProposalsAccepted ?? 0} accepted`} color="border-l-emerald-500" />
              <KpiCard label="Event Bookings" value={String(data?.eventSales.eventBookings ?? 0)} color="border-l-amber-400" />
              <KpiCard label="Event Revenue" value={formatINR(data?.eventSales.eventRevenue ?? 0)} color="border-l-rose-500" />
              <KpiCard
                label="AI Recommendation Success"
                value={data?.eventSales.aiRecommendationSuccess.degraded ? '—' : `${data?.eventSales.aiRecommendationSuccess.successRatePct ?? 0}%`}
                sub={data?.eventSales.aiRecommendationSuccess.degraded ? 'temporarily unavailable' : `${data?.eventSales.aiRecommendationSuccess.bookedMatchingRecommendation ?? 0}/${data?.eventSales.aiRecommendationSuccess.recommendationsWithPackage ?? 0} booked`}
                color="border-l-fuchsia-500"
              />
            </>
          )}
        </div>

        {!loading && data && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {([
              ['Revenue by Event Type', data.eventSales.revenueByEventType],
              ['Revenue by Venue', data.eventSales.revenueByVenue],
              ['Revenue by Hall', data.eventSales.revenueByHall],
              ['Revenue by Package', data.eventSales.revenueByPackage],
              ['Revenue by Lead Source', data.eventSales.revenueByLeadSource],
              ['Revenue by Campaign', data.eventSales.revenueByCampaign],
            ] as const).map(([title, rows]) => (
              <div key={title} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                <p className="px-4 py-3 text-xs font-semibold uppercase tracking-widest text-slate-500 border-b border-slate-100 bg-slate-50">{title}</p>
                {rows.length === 0 ? (
                  <p className="px-4 py-6 text-center text-xs text-slate-400">No data yet</p>
                ) : (
                  <table className="w-full text-sm">
                    <tbody className="divide-y divide-slate-100">
                      {rows.slice(0, 8).map((r) => (
                        <tr key={r.key} className="hover:bg-slate-50/60">
                          <td className="px-4 py-2.5 font-medium text-slate-700">{r.key}</td>
                          <td className="px-4 py-2.5 text-slate-500 text-xs">{r.accepted}/{r.proposals} won</td>
                          <td className="px-4 py-2.5 text-right font-medium text-emerald-700">{formatINR(r.revenue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {title === 'Revenue by Campaign' && data.eventSales.campaignAttributionDegraded && (
                  <p className="px-4 py-2 text-xs text-amber-600 border-t border-amber-100 bg-amber-50">Campaign attribution temporarily unavailable.</p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Sales Productivity ───────────────────────────────────────────── */}
      {!loading && data && data.salesProductivity.length > 0 && (
        <section>
          <SectionTitle>Sales Productivity</SectionTitle>
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-100 bg-slate-50">
                <tr>
                  {['Person', 'Leads', 'Proposals', 'Won', 'Bookings', 'Revenue', 'Follow-up Compliance'].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.salesProductivity.map((s) => (
                  <tr key={s.person} className="hover:bg-slate-50/60">
                    <td className="px-4 py-3 font-medium text-slate-800">{s.person}</td>
                    <td className="px-4 py-3 text-slate-600">{s.leadsHandled}</td>
                    <td className="px-4 py-3 text-slate-600">{s.proposalsCreated}</td>
                    <td className="px-4 py-3 text-slate-600">{s.proposalsWon}</td>
                    <td className="px-4 py-3 text-slate-600">{s.bookings}</td>
                    <td className="px-4 py-3 font-medium text-emerald-700">{formatINR(s.revenue)}</td>
                    <td className="px-4 py-3 text-slate-500">{s.followUpComplianceePct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

    </div>
  );
}
