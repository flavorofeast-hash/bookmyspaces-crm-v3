'use client'

// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/app/(crm)/dashboard/operations/page.tsx
// V3 Sprint 4 — Priority 5: Operational Dashboards (the part not already
// covered by the existing Revenue Dashboard at /dashboard/revenue — that
// screen already has leads-by-source, proposal conversion, and revenue
// trend charts, so this one is deliberately just Pending Payments, Repeat
// Guests, and Occupancy, wrapping the one new route this needed,
// GET /api/dashboard/operations).
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { RefreshCw, AlertTriangle, IndianRupee, Repeat, BedDouble, ChevronRight, MapPin, Clock } from 'lucide-react'

interface PendingPayment {
  id: string
  proposalNumber: string | null
  clientName: string | null
  leadId: string | null
  balanceDue: number
}

interface RepeatGuest {
  leadId: string
  name: string | null
  phone: string | null
  acceptedCount: number
}

interface PropertyOccupancy {
  propertyId: string
  propertyName: string
  total: number
  occupied: number
  occupancyPct: number | null
}

interface SiteVisit {
  id: string
  time: string
  customerName: string | null
  customerPhone: string | null
  property: string | null
  purpose: string | null
  guestCount: number | null
  budget: string | null
  status: string
  statusLabel: string
}

interface OperationsSummary {
  pendingPayments: { count: number; totalOutstanding: number; proposals: PendingPayment[] }
  repeatGuests: { count: number; guests: RepeatGuest[] }
  occupancy: {
    degraded: boolean
    date: string
    totalInventory: number
    occupied: number
    occupancyPct: number | null
    byProperty: PropertyOccupancy[]
  }
  todaysSiteVisits: SiteVisit[]
}

function fmtVisitTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })
  } catch {
    return iso
  }
}

const VISIT_STATUS_STYLE: Record<string, string> = {
  pending    : 'bg-blue-100 text-blue-700',
  completed  : 'bg-emerald-100 text-emerald-700',
  skipped    : 'bg-red-100 text-red-700',
  rescheduled: 'bg-amber-100 text-amber-700',
}

function fmtINR(n: number): string {
  if (n >= 100_000) return `₹${(n / 100_000).toFixed(1)}L`
  if (n >= 1_000) return `₹${(n / 1_000).toFixed(1)}K`
  return `₹${n.toLocaleString('en-IN')}`
}

function KpiCard({
  icon: Icon, label, value, sub, color,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  sub?: string
  color: string
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className={`inline-flex items-center justify-center w-9 h-9 rounded-lg bg-gray-50 ${color} mb-3`}>
        <Icon className="w-4.5 h-4.5" />
      </div>
      <div className="text-2xl font-bold text-gray-900">{value}</div>
      <div className="text-xs text-gray-400 mt-1">{label}</div>
      {sub && <div className="text-xs text-gray-400 mt-2">{sub}</div>}
    </div>
  )
}

export default function OperationsDashboardPage() {
  const [data, setData] = useState<OperationsSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/dashboard/operations')
      if (!res.ok) throw new Error('Failed to load operations dashboard')
      setData(await res.json())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load operations dashboard')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Operations Dashboard</h1>
          <p className="text-sm text-gray-500 mt-0.5">Today&apos;s site visits, pending payments, repeat guests, and occupancy.</p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/visits/new"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-white bg-gray-900 hover:bg-gray-800"
          >
            <MapPin className="w-3.5 h-3.5" /> Schedule Visit
          </Link>
          <Link
            href="/dashboard/revenue"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 border border-gray-200"
          >
            Revenue Dashboard
          </Link>
          <button
            onClick={load}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 border border-gray-200"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
        </div>
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
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <KpiCard
              icon={IndianRupee}
              label="Pending Payments"
              value={String(data.pendingPayments.count)}
              sub={data.pendingPayments.count > 0 ? `${fmtINR(data.pendingPayments.totalOutstanding)} outstanding` : undefined}
              color="text-amber-600"
            />
            <KpiCard
              icon={Repeat}
              label="Repeat Guests"
              value={String(data.repeatGuests.count)}
              sub="2+ accepted proposals"
              color="text-indigo-600"
            />
            <KpiCard
              icon={BedDouble}
              label="Occupancy Today"
              value={data.occupancy.degraded ? '—' : `${data.occupancy.occupancyPct ?? 0}%`}
              sub={data.occupancy.degraded ? undefined : `${data.occupancy.occupied} / ${data.occupancy.totalInventory} booked`}
              color="text-emerald-600"
            />
          </div>

          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="text-sm font-semibold text-gray-700">Today&apos;s Site Visits</h2>
              <Link href="/visits/new" className="text-xs font-medium text-blue-600 hover:underline">+ Schedule</Link>
            </div>
            {data.todaysSiteVisits.length === 0 ? (
              <p className="text-sm text-gray-400 px-6 py-8 text-center">No site visits scheduled for today.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-400 uppercase tracking-wide border-b border-gray-100">
                    <th className="px-6 py-2.5 font-medium">Time</th>
                    <th className="px-3 py-2.5 font-medium">Customer</th>
                    <th className="px-3 py-2.5 font-medium">Mobile</th>
                    <th className="px-3 py-2.5 font-medium">Property</th>
                    <th className="px-3 py-2.5 font-medium">Purpose</th>
                    <th className="px-3 py-2.5 font-medium">Guests</th>
                    <th className="px-3 py-2.5 font-medium">Budget</th>
                    <th className="px-6 py-2.5 font-medium text-right">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.todaysSiteVisits.map((v) => (
                    <tr key={v.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                      <td className="px-6 py-3 text-gray-700 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1"><Clock className="w-3 h-3 text-gray-300" />{fmtVisitTime(v.time)}</span>
                      </td>
                      <td className="px-3 py-3 text-gray-800">{v.customerName ?? 'Unnamed'}</td>
                      <td className="px-3 py-3 text-gray-600">{v.customerPhone ?? '—'}</td>
                      <td className="px-3 py-3 text-gray-600">{v.property ?? '—'}</td>
                      <td className="px-3 py-3 text-gray-500">{v.purpose ?? '—'}</td>
                      <td className="px-3 py-3 text-gray-600">{v.guestCount ?? '—'}</td>
                      <td className="px-3 py-3 text-gray-600">{v.budget ?? '—'}</td>
                      <td className="px-6 py-3 text-right">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${VISIT_STATUS_STYLE[v.status] ?? 'bg-gray-100 text-gray-700'}`}>
                          {v.statusLabel}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {data.occupancy.degraded && (
            <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
              <AlertTriangle className="w-4 h-4" />
              Occupancy isn&apos;t available yet — the Reservation module&apos;s database migration hasn&apos;t been applied in this environment. Pending Payments and Repeat Guests above are live.
            </div>
          )}

          {!data.occupancy.degraded && data.occupancy.byProperty.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h2 className="text-sm font-semibold text-gray-700 mb-4">Occupancy by property</h2>
              <div className="space-y-3">
                {data.occupancy.byProperty.map((p) => (
                  <div key={p.propertyId} className="flex items-center gap-3">
                    <div className="w-36 text-sm text-gray-700 shrink-0">{p.propertyName}</div>
                    <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden">
                      <div className="h-full bg-emerald-500" style={{ width: `${p.occupancyPct ?? 0}%` }} />
                    </div>
                    <div className="w-24 text-xs text-gray-500 text-right shrink-0">{p.occupied}/{p.total} ({p.occupancyPct ?? 0}%)</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h2 className="text-sm font-semibold text-gray-700 mb-4">Pending payments</h2>
              {data.pendingPayments.proposals.length === 0 ? (
                <p className="text-sm text-gray-400">No accepted proposals with an outstanding balance.</p>
              ) : (
                <ul className="space-y-3">
                  {data.pendingPayments.proposals.map((p) => (
                    <li key={p.id}>
                      <Link href="/proposals" className="flex items-center justify-between gap-2 group">
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-gray-800 truncate">
                            {p.proposalNumber ?? p.id.slice(0, 8)} — {p.clientName ?? 'Unknown'}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0 text-sm font-semibold text-amber-700">
                          {fmtINR(p.balanceDue)}
                          <ChevronRight className="w-3.5 h-3.5 text-gray-300 group-hover:text-gray-500" />
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h2 className="text-sm font-semibold text-gray-700 mb-4">Repeat guests</h2>
              {data.repeatGuests.guests.length === 0 ? (
                <p className="text-sm text-gray-400">No repeat guests yet (2+ accepted proposals from the same customer).</p>
              ) : (
                <ul className="space-y-3">
                  {data.repeatGuests.guests.map((g) => (
                    <li key={g.leadId}>
                      <Link href={`/customers/${g.leadId}`} className="flex items-center justify-between gap-2 group">
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-gray-800 truncate">{g.name ?? 'Unnamed customer'}</div>
                          {g.phone && <div className="text-xs text-gray-400">{g.phone}</div>}
                        </div>
                        <div className="flex items-center gap-1 shrink-0 text-sm font-semibold text-indigo-700">
                          {g.acceptedCount} bookings
                          <ChevronRight className="w-3.5 h-3.5 text-gray-300 group-hover:text-gray-500" />
                        </div>
                      </Link>
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
