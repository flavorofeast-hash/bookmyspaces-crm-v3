'use client'

// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/app/(crm)/reservations/calendar/page.tsx
// V3 Sprint 4 — Priority 3: Reservation Calendar.
//
// A grid view (inventory items x dates) over the exact same two routes the
// Reservation Dashboard already uses — GET /api/properties (inventory list)
// and GET /api/reservations (bookings) — no new API, no new business logic.
// Coverage for each cell is computed client-side (reservation.checkInDate
// <= date < reservation.checkOutDate, the same half-open interval
// availability-service.ts uses), rather than asking the API for a
// date-range-overlap query it doesn't currently expose; simplest thing that
// works correctly for a 14-day window over <=200 reservations.
//
// Multi-property (grouped by property, then by inventory type — Rooms,
// Suites, Banquet Hall, Rooftop, Restaurant Event Area, etc. per the master
// spec's "Do NOT design only for hotel rooms" requirement). Same
// migration-012-not-applied degradation message as the Reservation
// Dashboard when there's no inventory yet — this is not a bug in this
// screen, it's this project's established honest-empty-state convention.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState, useCallback, useMemo } from 'react'
import Link from 'next/link'
import {
  ChevronLeft, ChevronRight, RefreshCw, AlertTriangle, CalendarDays, Building2,
} from 'lucide-react'

type ReservationStatus = 'inquiry' | 'tentative' | 'confirmed' | 'checked_in' | 'checked_out' | 'cancelled' | 'no_show'

interface Property {
  id: string
  name: string
  slug: string
}

interface InventoryItem {
  id: string
  propertyId: string
  propertyName: string
  name: string
  inventoryType: string
}

interface ReservationRow {
  id: string
  guestName: string
  inventoryItemId: string
  checkInDate: string
  checkOutDate: string
  status: ReservationStatus
}

const STATUS_STYLE: Record<ReservationStatus, string> = {
  inquiry: 'bg-gray-200 text-gray-700',
  tentative: 'bg-amber-200 text-amber-800',
  confirmed: 'bg-green-200 text-green-800',
  checked_in: 'bg-blue-200 text-blue-800',
  checked_out: 'bg-gray-100 text-gray-400',
  cancelled: 'bg-white text-gray-300',
  no_show: 'bg-white text-gray-300',
}

const VISIBLE_STATUSES: ReservationStatus[] = ['inquiry', 'tentative', 'confirmed', 'checked_in', 'checked_out']

const INVENTORY_TYPE_LABEL: Record<string, string> = {
  room: 'Rooms',
  suite: 'Suites',
  apartment: 'Apartments',
  banquet_hall: 'Banquet Halls',
  conference_hall: 'Conference Halls',
  rooftop: 'Rooftop',
  restaurant_event_area: 'Restaurant Event Area',
  wedding_venue: 'Wedding Venues',
  birthday_venue: 'Birthday Venues',
  meeting_room: 'Meeting Rooms',
}

const WINDOW_DAYS = 14

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return toISODate(d)
}

function fmtDayHeader(iso: string): { weekday: string; day: string } {
  const d = new Date(iso + 'T00:00:00Z')
  return {
    weekday: d.toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'UTC' }),
    day: d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: 'UTC' }),
  }
}

export default function ReservationCalendarPage() {
  const [properties, setProperties] = useState<Property[]>([])
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([])
  const [reservations, setReservations] = useState<ReservationRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [propertyFilter, setPropertyFilter] = useState<string>('')
  const [windowStart, setWindowStart] = useState<string>(toISODate(new Date()))

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [propsRes, resRes] = await Promise.all([
        fetch('/api/properties'),
        fetch('/api/reservations?status=' + VISIBLE_STATUSES.join(',')),
      ])
      if (!propsRes.ok || !resRes.ok) throw new Error('Failed to load calendar data')
      const propsJson = await propsRes.json()
      const resJson = await resRes.json()
      setProperties(propsJson.properties ?? [])
      setInventoryItems(propsJson.inventoryItems ?? [])
      setReservations(resJson.reservations ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load calendar data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const days = useMemo(
    () => Array.from({ length: WINDOW_DAYS }, (_, i) => addDays(windowStart, i)),
    [windowStart]
  )

  const visibleItems = useMemo(
    () => inventoryItems.filter((item) => !propertyFilter || item.propertyId === propertyFilter),
    [inventoryItems, propertyFilter]
  )

  // Group visible inventory items by type, preserving a stable, readable order.
  const grouped = useMemo(() => {
    const groups = new Map<string, InventoryItem[]>()
    for (const item of visibleItems) {
      const key = item.inventoryType
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(item)
    }
    return Array.from(groups.entries())
  }, [visibleItems])

  // inventoryItemId -> date -> covering reservation (or undefined if free)
  const coverage = useMemo(() => {
    const map = new Map<string, Map<string, ReservationRow>>()
    for (const r of reservations) {
      if (!map.has(r.inventoryItemId)) map.set(r.inventoryItemId, new Map())
      const byDate = map.get(r.inventoryItemId)!
      for (const d of days) {
        if (r.checkInDate <= d && d < r.checkOutDate) byDate.set(d, r)
      }
    }
    return map
  }, [reservations, days])

  const todayISO = toISODate(new Date())

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <CalendarDays className="w-5 h-5 text-gray-400" /> Reservation Calendar
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">Rooms, suites, banquet halls, and event spaces across every property.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/reservations"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 border border-gray-200"
          >
            Back to Dashboard
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

      <div className="flex items-center justify-between flex-wrap gap-3 bg-white rounded-xl border border-gray-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <Building2 className="w-4 h-4 text-gray-400" />
          <select
            value={propertyFilter}
            onChange={(e) => setPropertyFilter(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm"
          >
            <option value="">All properties</option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setWindowStart((d) => addDays(d, -WINDOW_DAYS))}
            className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-50"
            aria-label="Previous 14 days"
          >
            <ChevronLeft className="w-4 h-4 text-gray-500" />
          </button>
          <button
            onClick={() => setWindowStart(todayISO)}
            className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-medium text-gray-600 hover:bg-gray-50"
          >
            Today
          </button>
          <button
            onClick={() => setWindowStart((d) => addDays(d, WINDOW_DAYS))}
            className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-50"
            aria-label="Next 14 days"
          >
            <ChevronRight className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        <div className="flex items-center gap-3 text-xs text-gray-500">
          {(['tentative', 'confirmed', 'checked_in'] as ReservationStatus[]).map((s) => (
            <span key={s} className="flex items-center gap-1.5">
              <span className={`w-3 h-3 rounded ${STATUS_STYLE[s]}`} />
              {s.replace(/_/g, ' ')}
            </span>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        {loading ? (
          <div className="px-6 py-10 text-center text-sm text-gray-400 flex items-center justify-center gap-2">
            <RefreshCw className="w-4 h-4 animate-spin" /> Loading calendar…
          </div>
        ) : visibleItems.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-gray-400">
            No rooms or halls have been configured yet.
            <div className="mt-1">
              Add rooms and venues on the Catalog page — the Reservation Calendar will show them here once configured.
            </div>
          </div>
        ) : (
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="sticky left-0 bg-white px-4 py-2 text-left font-medium text-gray-500 min-w-[180px]">Room / Hall</th>
                {days.map((d) => {
                  const { weekday, day } = fmtDayHeader(d)
                  return (
                    <th key={d} className={`px-2 py-2 text-center font-medium min-w-[64px] ${d === todayISO ? 'bg-indigo-50 text-indigo-700' : 'text-gray-500'}`}>
                      <div>{weekday}</div>
                      <div className="text-[11px] text-gray-400">{day}</div>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {grouped.map(([type, items]) => (
                <FragmentGroup key={type} type={type} items={items} days={days} coverage={coverage} todayISO={todayISO} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function FragmentGroup({
  type, items, days, coverage, todayISO,
}: {
  type: string
  items: InventoryItem[]
  days: string[]
  coverage: Map<string, Map<string, ReservationRow>>
  todayISO: string
}) {
  return (
    <>
      <tr className="bg-gray-50">
        <td colSpan={days.length + 1} className="sticky left-0 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
          {INVENTORY_TYPE_LABEL[type] ?? type.replace(/_/g, ' ')}
        </td>
      </tr>
      {items.map((item) => (
        <tr key={item.id} className="border-b border-gray-50">
          <td className="sticky left-0 bg-white px-4 py-2 text-gray-700">
            <div className="font-medium">{item.name}</div>
            <div className="text-[11px] text-gray-400">{item.propertyName}</div>
          </td>
          {days.map((d) => {
            const res = coverage.get(item.id)?.get(d)
            return (
              <td key={d} className={`px-1 py-2 text-center ${d === todayISO ? 'bg-indigo-50/40' : ''}`}>
                {res ? (
                  <Link
                    href={`/reservations/${res.id}`}
                    title={`${res.guestName} — ${res.status.replace(/_/g, ' ')}`}
                    className={`block rounded px-1 py-1 truncate font-medium ${STATUS_STYLE[res.status]}`}
                  >
                    {res.guestName.split(' ')[0]}
                  </Link>
                ) : (
                  <span className="block rounded px-1 py-1 text-gray-200">·</span>
                )}
              </td>
            )
          })}
        </tr>
      ))}
    </>
  )
}
