'use client';

// src/app/(crm)/dashboard/revenue/page.tsx
// Revenue Dashboard — fetches /api/dashboard/revenue and renders inline.
// No invented components. Uses only Tailwind classes already in the project.
// Recharts is an existing dependency (package.json).
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import type { RevenueSummary } from '@/app/api/dashboard/revenue/route';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatINR(value: number): string {
  if (value >= 100_000) return `₹${(value / 100_000).toFixed(1)}L`;
  if (value >= 1_000)   return `₹${(value / 1_000).toFixed(1)}K`;
  return `₹${value.toLocaleString('en-IN')}`;
}

const CHART_COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

// ─── Sub-components (inline, no separate files) ───────────────────────────────

function KpiCard({
  label,
  value,
  sub,
  color = 'border-slate-300',
}: {
  label : string;
  value : string;
  sub  ?: string;
  color?: string;
}) {
  return (
    <div className={`rounded-xl border bg-white p-5 shadow-sm border-l-4 ${color}`}>
      <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-2">
        {label}
      </p>
      <p className="text-2xl font-bold text-slate-900 leading-none">{value}</p>
      {sub && <p className="mt-1.5 text-xs text-slate-400">{sub}</p>}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-4">
      {children}
    </h2>
  );
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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function RevenueDashboardPage() {
  const [data,    setData]    = useState<RevenueSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/dashboard/revenue', { cache: 'no-store' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      const json = await res.json() as RevenueSummary;
      setData(json);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // ── Error state ────────────────────────────────────────────────────────────
  if (!loading && error) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <div className="rounded-xl border border-red-200 bg-red-50 p-8 text-center">
          <p className="font-semibold text-red-700">Failed to load revenue data</p>
          <p className="mt-1 text-sm text-red-500">{error}</p>
          <button
            onClick={() => void load()}
            className="mt-4 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-4 py-8 sm:px-6">

      {/* ── Page header ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Revenue Dashboard</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Revenue = accepted proposals · <code className="text-xs bg-slate-100 rounded px-1">accepted_at IS NOT NULL</code>
            {' '}&middot; Reservation Revenue shown separately below
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/dashboard/operations"
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm hover:bg-slate-50"
          >
            Operations Dashboard
          </Link>
          <button
            onClick={() => void load()}
            disabled={loading}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm hover:bg-slate-50 disabled:opacity-40"
          >
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* ── Revenue KPIs ─────────────────────────────────────────────────── */}
      <section>
        <SectionTitle>Revenue</SectionTitle>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {loading ? (
            Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
          ) : (
            <>
              <KpiCard
                label="Total Revenue"
                value={data ? formatINR(data.revenue.total) : '—'}
                sub={`${data?.revenue.deal_count ?? 0} accepted deals`}
                color="border-l-emerald-500"
              />
              <KpiCard
                label="This Month"
                value={data ? formatINR(data.revenue.this_month) : '—'}
                color="border-l-emerald-400"
              />
              <KpiCard
                label="Last Month"
                value={data ? formatINR(data.revenue.last_month) : '—'}
                color="border-l-slate-300"
              />
              <KpiCard
                label="Avg Deal Value"
                value={data ? formatINR(data.revenue.avg_value) : '—'}
                sub="per accepted proposal"
                color="border-l-amber-400"
              />
            </>
          )}
        </div>
      </section>

      {/* ── Reservation Revenue (direct bookings) ───────────────────────────
          Kept as its own section, not merged into the KPIs above: a
          reservation can be linked to an accepted proposal (proposal_id),
          and this dashboard doesn't dedupe that overlap — see
          `linked_to_proposal_count` below. Treat the two revenue figures as
          two lenses on the business, not as summable. */}
      <section>
        <SectionTitle>Reservation Revenue (Direct Bookings)</SectionTitle>
        <p className="-mt-2 mb-4 text-xs text-slate-400">
          Room revenue from confirmed/checked-in/checked-out reservations · not included in Revenue above
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {loading ? (
            Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
          ) : (
            <>
              <KpiCard
                label="Reservation Revenue"
                value={data ? formatINR(data.reservationRevenue.total) : '—'}
                sub={
                  data?.reservationRevenue.degraded
                    ? 'Reservation platform not live yet'
                    : `${data?.reservationRevenue.count ?? 0} reservations`
                }
                color="border-l-violet-500"
              />
              <KpiCard
                label="This Month"
                value={data ? formatINR(data.reservationRevenue.this_month) : '—'}
                color="border-l-violet-400"
              />
              <KpiCard
                label="Last Month"
                value={data ? formatINR(data.reservationRevenue.last_month) : '—'}
                color="border-l-slate-300"
              />
              <KpiCard
                label="Linked to Proposals"
                value={data ? formatINR(data.reservationRevenue.linked_to_proposal_revenue) : '—'}
                sub={`${data?.reservationRevenue.linked_to_proposal_count ?? 0} reservations — overlap with Revenue above`}
                color="border-l-amber-400"
              />
            </>
          )}
        </div>
      </section>

      {/* ── Leads + Proposals + Bookings ─────────────────────────────────── */}
      <section>
        <SectionTitle>Pipeline</SectionTitle>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {loading ? (
            Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)
          ) : (
            <>
              <KpiCard
                label="Total Leads"
                value={String(data?.leads.total ?? '—')}
                color="border-l-sky-500"
              />
              <KpiCard
                label="New This Month"
                value={String(data?.leads.new_this_month ?? '—')}
                color="border-l-sky-400"
              />
              <KpiCard
                label="Proposals Sent"
                value={String(data?.proposals.sent ?? '—')}
                color="border-l-amber-400"
              />
              <KpiCard
                label="Accepted"
                value={String(data?.proposals.accepted ?? '—')}
                sub={`${data?.proposals.acceptance_pct ?? 0}% acceptance`}
                color="border-l-emerald-500"
              />
              <KpiCard
                label="Bookings"
                value={String(data?.bookings.total ?? '—')}
                sub={data?.bookings.degraded ? 'Reservation platform not live yet' : undefined}
                color="border-l-violet-400"
              />
              <KpiCard
                label="Confirmed"
                value={String(data?.bookings.confirmed ?? '—')}
                sub={data?.bookings.degraded ? 'Reservation platform not live yet' : undefined}
                color="border-l-violet-500"
              />
            </>
          )}
        </div>
      </section>

      {/* ── Charts ───────────────────────────────────────────────────────── */}
      <section>
        <SectionTitle>Charts</SectionTitle>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">

          {/* Revenue Trend */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-4">
              Revenue Trend — Last 6 Months
            </p>
            {loading ? (
              <div className="h-44 animate-pulse rounded-lg bg-slate-100" />
            ) : !data || data.charts.revenue_by_month.every((r) => r.revenue === 0) ? (
              <div className="flex h-44 items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50">
                <p className="text-xs text-slate-400">No accepted proposals yet</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={176}>
                <BarChart data={data.charts.revenue_by_month} margin={{ top: 0, right: 8, bottom: 0, left: 0 }}>
                  <XAxis
                    dataKey="month"
                    tick={{ fontSize: 10, fill: '#94a3b8' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: '#94a3b8' }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v: number) => formatINR(v)}
                    width={52}
                  />
                  <Tooltip
                    formatter={(v: number) => [formatINR(v), 'Revenue']}
                    contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
                  />
                  <Bar dataKey="revenue" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={40} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Lead Source Breakdown */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-4">
              Lead Source Breakdown
            </p>
            {loading ? (
              <div className="h-44 animate-pulse rounded-lg bg-slate-100" />
            ) : !data || data.charts.leads_by_source.length === 0 ? (
              <div className="flex h-44 items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50">
                <p className="text-xs text-slate-400">No leads yet</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={176}>
                <BarChart
                  data={data.charts.leads_by_source}
                  layout="vertical"
                  margin={{ top: 0, right: 40, bottom: 0, left: 0 }}
                >
                  <XAxis
                    type="number"
                    tick={{ fontSize: 10, fill: '#94a3b8' }}
                    axisLine={false}
                    tickLine={false}
                    allowDecimals={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="source"
                    tick={{ fontSize: 11, fill: '#475569' }}
                    axisLine={false}
                    tickLine={false}
                    width={72}
                  />
                  <Tooltip
                    formatter={(v: number) => [`${v} leads`, 'Count']}
                    contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
                  />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={24}>
                    {data.charts.leads_by_source.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Venue Performance — full width */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-4">
              Venue Performance (Accepted Proposals)
            </p>
            {loading ? (
              <div className="h-44 animate-pulse rounded-lg bg-slate-100" />
            ) : !data || data.charts.venue_performance.length === 0 ? (
              <div className="flex h-44 items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50">
                <p className="text-xs text-slate-400">No venue revenue data yet</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={176}>
                <BarChart
                  data={data.charts.venue_performance}
                  layout="vertical"
                  margin={{ top: 0, right: 70, bottom: 0, left: 0 }}
                >
                  <XAxis
                    type="number"
                    tick={{ fontSize: 10, fill: '#94a3b8' }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v: number) => formatINR(v)}
                  />
                  <YAxis
                    type="category"
                    dataKey="venue"
                    tick={{ fontSize: 11, fill: '#475569' }}
                    axisLine={false}
                    tickLine={false}
                    width={110}
                  />
                  <Tooltip
                    formatter={(v: number) => [formatINR(v), 'Revenue']}
                    contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
                  />
                  <Bar dataKey="revenue" radius={[0, 4, 4, 0]} maxBarSize={28}>
                    {data.charts.venue_performance.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

        </div>
      </section>

      {/* ── Proposal status table ─────────────────────────────────────────── */}
      {!loading && data && data.proposals.total > 0 && (
        <section>
          <SectionTitle>Proposal Breakdown</SectionTitle>
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-100 bg-slate-50">
                <tr>
                  {['Status', 'Count', '% of Total'].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {[
                  { label: 'Accepted',  value: data.proposals.accepted, cls: 'text-emerald-700 bg-emerald-50' },
                  { label: 'Sent',      value: data.proposals.sent,     cls: 'text-sky-700     bg-sky-50'     },
                  { label: 'Rejected',  value: data.proposals.rejected, cls: 'text-red-700     bg-red-50'     },
                  { label: 'All',       value: data.proposals.total,    cls: 'text-slate-700   bg-slate-100'  },
                ].map((row) => (
                  <tr key={row.label} className="hover:bg-slate-50/60">
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${row.cls}`}>
                        {row.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-semibold text-slate-800">{row.value}</td>
                    <td className="px-4 py-3 text-slate-500">
                      {data.proposals.total > 0
                        ? `${Math.round((row.value / data.proposals.total) * 100)}%`
                        : '—'}
                    </td>
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
