'use client'

// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/app/(crm)/reservations/page.tsx
// V3 Day 6 — Operator Experience sprint: Reservation Dashboard.
//
// Reads GET /api/reservations (all stats below are derived client-side from
// that one list, matching this codebase's "don't over-abstract" convention
// rather than one API call per stat card) and lets an operator create a new
// reservation end-to-end: pick property/room -> check availability & price
// -> create. Every write goes through reservation-workflow.ts via the API
// routes added this session — no business logic duplicated here.
//
// NOTE: `reservations`/`properties`/`inventory_items` are migration 012
// tables, not yet applied to production in this environment (see
// audit/DAY6_EXECUTION_REPORT.md). Until that migration is applied, this
// screen will legitimately show all-zero stats and an empty property
// picker — that is not a bug in this screen, it's an honest reflection of
// there being no reservation data yet.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState, useCallback, useMemo, Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import {
  Calendar, LogIn, LogOut, Clock, CheckCircle2, IndianRupee,
  Plus, X, RefreshCw, AlertTriangle, ChevronRight, Building2,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

type ReservationStatus = 'inquiry' | 'tentative' | 'confirmed' | 'checked_in' | 'checked_out' | 'cancelled' | 'no_show'

interface ReservationRow {
  id: string
  guestName: string
  guestMobile: string | null
  propertyName: string
  inventoryName: string
  checkInDate: string
  checkOutDate: string
  nights: number
  status: ReservationStatus
  finalRoomRate: number
  mealPlanCharge: number
}

interface Property {
  id: string
  name: string
  slug: string
}

interface InventoryItem {
  id: string
  propertyId: string
  name: string
  inventoryType: string
  propertyName: string
}

interface PriceQuote {
  subtotal: number
  nights: number
  isComplete: boolean
}

// V3 Sprint 3 — Convert Proposal -> Reservation. Data pulled from
// GET /api/proposals?id= to prefill the New Reservation modal when arriving
// via the Proposals page's "Convert to Reservation" link.
interface ProposalPrefill {
  proposalId: string
  guestName: string
  guestMobile: string
  guestEmail: string | null
  propertyId: string | null
  inventoryItemId: string | null
  checkInDate: string | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

function fmtINR(n: number): string {
  if (n >= 100_000) return `₹${(n / 100_000).toFixed(1)}L`
  if (n >= 1_000) return `₹${(n / 1_000).toFixed(0)}K`
  return `₹${n}`
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
  } catch {
    return iso
  }
}

const STATUS_STYLE: Record<ReservationStatus, string> = {
  inquiry: 'bg-gray-100 text-gray-700',
  tentative: 'bg-amber-100 text-amber-700',
  confirmed: 'bg-green-100 text-green-700',
  checked_in: 'bg-blue-100 text-blue-700',
  checked_out: 'bg-gray-100 text-gray-500',
  cancelled: 'bg-red-100 text-red-700',
  no_show: 'bg-red-100 text-red-700',
}

const ACTIVE_STATUSES: ReservationStatus[] = ['inquiry', 'tentative', 'confirmed', 'checked_in']

export default function ReservationDashboardPage() {
  return (
    <Suspense fallback={<div className="text-sm text-gray-400 p-6">Loading…</div>}>
      <ReservationDashboardContent />
    </Suspense>
  )
}

function ReservationDashboardContent() {
  const searchParams = useSearchParams()
  const fromProposalId = searchParams.get('fromProposalId')

  const [reservations, setReservations] = useState<ReservationRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showNewModal, setShowNewModal] = useState(false)
  const [proposalPrefill, setProposalPrefill] = useState<ProposalPrefill | null>(null)
  const [proposalPrefillError, setProposalPrefillError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/reservations?status=' + ACTIVE_STATUSES.join(','))
      if (!res.ok) throw new Error('Failed to load reservations')
      const json = await res.json()
      setReservations(json.reservations ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load reservations')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // V3 Sprint 3 — arriving from the Proposals page's "Convert to Reservation"
  // link: fetch the proposal and auto-open the New Reservation modal
  // prefilled with its guest/property/date details. The operator still
  // confirms/adjusts everything (esp. inventory + dates) before creating.
  useEffect(() => {
    if (!fromProposalId) return
    fetch(`/api/proposals?id=${fromProposalId}`)
      .then((r) => r.json())
      .then((json) => {
        const p = json.proposal
        if (!p) {
          setProposalPrefillError('Could not find that proposal — pick details manually.')
          setShowNewModal(true)
          return
        }
        setProposalPrefill({
          proposalId: p.id,
          guestName: p.client_name ?? '',
          guestMobile: p.client_phone ?? '',
          guestEmail: p.client_email ?? null,
          propertyId: p.property_id ?? null,
          inventoryItemId: p.inventory_item_id ?? null,
          checkInDate: p.event_date ?? null,
        })
        setShowNewModal(true)
      })
      .catch(() => {
        setProposalPrefillError('Could not load proposal details — pick details manually.')
        setShowNewModal(true)
      })
  }, [fromProposalId])

  const today = todayISO()

  const stats = useMemo(() => {
    const arrivalsToday = reservations.filter((r) => r.checkInDate === today && r.status !== 'cancelled')
    const departuresToday = reservations.filter((r) => r.checkOutDate === today && r.status === 'checked_in')
    const pendingReservations = reservations.filter((r) => r.status === 'inquiry')
    const pendingConfirmations = reservations.filter((r) => r.status === 'tentative')
    const checkedIn = reservations.filter((r) => r.status === 'checked_in')
    const monthRevenue = reservations
      .filter((r) => r.status !== 'cancelled' && r.status !== 'no_show')
      .reduce((sum, r) => sum + (r.finalRoomRate || 0) + (r.mealPlanCharge || 0), 0)

    return { arrivalsToday, departuresToday, pendingReservations, pendingConfirmations, checkedIn, monthRevenue }
  }, [reservations, today])

  const upcoming = useMemo(() => {
    return [...reservations]
      .filter((r) => r.status !== 'cancelled' && r.status !== 'checked_out')
      .sort((a, b) => a.checkInDate.localeCompare(b.checkInDate))
      .slice(0, 20)
  }, [reservations])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Reservation Dashboard</h1>
          <p className="text-sm text-gray-500 mt-0.5">Arrivals, departures, and reservation pipeline at a glance.</p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/reservations/calendar"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 border border-gray-200"
          >
            <Calendar className="w-3.5 h-3.5" /> Calendar
          </Link>
          <button
            onClick={load}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 border border-gray-200"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
          <button
            onClick={() => setShowNewModal(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-gray-900 text-white hover:bg-gray-800"
          >
            <Plus className="w-4 h-4" /> New Reservation
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
          <AlertTriangle className="w-4 h-4" /> {error}
        </div>
      )}

      {proposalPrefillError && (
        <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-700">
          <AlertTriangle className="w-4 h-4" /> {proposalPrefillError}
        </div>
      )}

      {/* ── Stat cards ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <StatCard icon={LogIn} label="Arrivals Today" value={stats.arrivalsToday.length} color="text-blue-600" />
        <StatCard icon={LogOut} label="Departures Today" value={stats.departuresToday.length} color="text-purple-600" />
        <StatCard icon={Clock} label="Pending Reservations" value={stats.pendingReservations.length} color="text-gray-600" />
        <StatCard icon={AlertTriangle} label="Pending Confirmations" value={stats.pendingConfirmations.length} color="text-amber-600" />
        <StatCard icon={CheckCircle2} label="Checked In Now" value={stats.checkedIn.length} color="text-green-600" />
        <StatCard icon={IndianRupee} label="Active Revenue" value={fmtINR(stats.monthRevenue)} color="text-emerald-600" isText />
      </div>

      {/* ── Upcoming reservations table ─────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700">Upcoming reservations</h2>
          {loading && <RefreshCw className="w-4 h-4 text-gray-300 animate-spin" />}
        </div>

        {!loading && upcoming.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-gray-400">
            No reservations yet.
            {reservations.length === 0 && (
              <div className="mt-1">
                If this feels wrong, check that migration 012 (properties/inventory_items/reservations) has been applied to the live database.
              </div>
            )}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400 uppercase tracking-wide border-b border-gray-100">
                <th className="px-6 py-3 font-medium">Guest</th>
                <th className="px-3 py-3 font-medium">Property / Room</th>
                <th className="px-3 py-3 font-medium">Check-in</th>
                <th className="px-3 py-3 font-medium">Check-out</th>
                <th className="px-3 py-3 font-medium">Status</th>
                <th className="px-6 py-3 font-medium text-right">Rate</th>
              </tr>
            </thead>
            <tbody>
              {upcoming.map((r) => (
                <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="px-6 py-3">
                    <Link href={`/reservations/${r.id}`} className="font-medium text-gray-800 hover:underline">
                      {r.guestName}
                    </Link>
                    {r.guestMobile && <div className="text-xs text-gray-400">{r.guestMobile}</div>}
                  </td>
                  <td className="px-3 py-3 text-gray-600">
                    <div className="flex items-center gap-1.5"><Building2 className="w-3.5 h-3.5 text-gray-300" /> {r.propertyName}</div>
                    <div className="text-xs text-gray-400">{r.inventoryName}</div>
                  </td>
                  <td className="px-3 py-3 text-gray-600">{fmtDate(r.checkInDate)}</td>
                  <td className="px-3 py-3 text-gray-600">{fmtDate(r.checkOutDate)}</td>
                  <td className="px-3 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLE[r.status]}`}>
                      {r.status.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="px-6 py-3 text-right font-medium text-gray-800">
                    {fmtINR(r.finalRoomRate + r.mealPlanCharge)}
                    <Link href={`/reservations/${r.id}`}>
                      <ChevronRight className="w-3.5 h-3.5 inline text-gray-300 ml-1" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showNewModal && (
        <NewReservationModal
          initial={proposalPrefill}
          onClose={() => { setShowNewModal(false); setProposalPrefill(null) }}
          onCreated={() => { setShowNewModal(false); setProposalPrefill(null); load() }}
        />
      )}
    </div>
  )
}

function StatCard({
  icon: Icon, label, value, color, isText,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: number | string
  color: string
  isText?: boolean
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className={`inline-flex items-center justify-center w-8 h-8 rounded-lg bg-gray-50 ${color} mb-2`}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="text-lg font-bold text-gray-900">{isText ? value : value}</div>
      <div className="text-xs text-gray-400 mt-0.5">{label}</div>
    </div>
  )
}

// ─── New Reservation modal ────────────────────────────────────────────────────
// Check Availability -> Calculate Price -> Create Reservation, exactly the
// three steps reservation-workflow.ts already implements — this form just
// calls the two API routes wrapping them in the same order.

function NewReservationModal({
  initial, onClose, onCreated,
}: {
  initial?: ProposalPrefill | null
  onClose: () => void
  onCreated: () => void
}) {
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([])
  const [loadingProps, setLoadingProps] = useState(true)
  const [inventoryItemId, setInventoryItemId] = useState(initial?.inventoryItemId ?? '')
  const [guestName, setGuestName] = useState(initial?.guestName ?? '')
  const [guestMobile, setGuestMobile] = useState(initial?.guestMobile ?? '')
  const [guestEmail, setGuestEmail] = useState(initial?.guestEmail ?? '')
  const [checkInDate, setCheckInDate] = useState(initial?.checkInDate || todayISO())
  const [checkOutDate, setCheckOutDate] = useState('')
  const [quote, setQuote] = useState<PriceQuote | null>(null)
  const [available, setAvailable] = useState<boolean | null>(null)
  const [checking, setChecking] = useState(false)
  const [creating, setCreating] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/properties')
      .then((r) => r.json())
      .then((json) => setInventoryItems(json.inventoryItems ?? []))
      .catch(() => setInventoryItems([]))
      .finally(() => setLoadingProps(false))
  }, [])

  const selectedItem = inventoryItems.find((i) => i.id === inventoryItemId)

  async function handleCheckAvailability() {
    setFormError(null)
    setQuote(null)
    setAvailable(null)
    if (!inventoryItemId || !checkInDate || !checkOutDate) {
      setFormError('Pick a room/hall and both dates first.')
      return
    }
    setChecking(true)
    try {
      const res = await fetch('/api/reservations/availability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inventoryItemId, checkInDate, checkOutDate }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to check availability')
      setAvailable(json.availability.available)
      setQuote(json.quote)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to check availability')
    } finally {
      setChecking(false)
    }
  }

  async function handleCreate() {
    if (!guestName.trim()) {
      setFormError('Guest name is required.')
      return
    }
    setCreating(true)
    setFormError(null)
    try {
      const res = await fetch('/api/reservations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guestName,
          guestMobile: guestMobile || null,
          guestEmail: guestEmail || null,
          propertyId: selectedItem?.propertyId ?? initial?.propertyId,
          inventoryItemId,
          checkInDate,
          checkOutDate,
          bookingSource: 'direct',
          proposalId: initial?.proposalId ?? null,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to create reservation')
      onCreated()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to create reservation')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900">New Reservation</h3>
          <button onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-700">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {initial && (
            <div className="text-sm text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg p-3">
              Prefilled from an accepted proposal. Confirm the room/hall and dates, then create the reservation to link it back to that proposal.
            </div>
          )}

          {loadingProps ? (
            <div className="text-sm text-gray-400 flex items-center gap-2"><RefreshCw className="w-4 h-4 animate-spin" /> Loading properties…</div>
          ) : inventoryItems.length === 0 ? (
            <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
              No rooms or halls have been configured yet. Add inventory_items for a property (via Supabase Table Editor or SQL) before creating a reservation.
            </div>
          ) : (
            <div>
              <label className="text-xs font-medium text-gray-500">Room / Hall</label>
              <select
                value={inventoryItemId}
                onChange={(e) => { setInventoryItemId(e.target.value); setQuote(null); setAvailable(null) }}
                className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
              >
                <option value="">Select…</option>
                {inventoryItems.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.propertyName} — {item.name} ({item.inventoryType.replace(/_/g, ' ')})
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-500">Check-in</label>
              <input
                type="date"
                value={checkInDate}
                onChange={(e) => { setCheckInDate(e.target.value); setQuote(null); setAvailable(null) }}
                className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500">Check-out</label>
              <input
                type="date"
                value={checkOutDate}
                onChange={(e) => { setCheckOutDate(e.target.value); setQuote(null); setAvailable(null) }}
                className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
              />
            </div>
          </div>

          <button
            onClick={handleCheckAvailability}
            disabled={checking}
            className="w-full py-2 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {checking ? 'Checking…' : 'Check Availability & Price'}
          </button>

          {available === false && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
              Not available for these dates — there&apos;s a conflicting reservation.
            </div>
          )}
          {available === true && quote && (
            <div className="text-sm bg-green-50 border border-green-200 rounded-lg p-3">
              <div className="font-medium text-green-800">Available — {quote.nights} night(s)</div>
              <div className="text-green-700">
                Quote: ₹{quote.subtotal.toLocaleString('en-IN')}
                {!quote.isComplete && <span className="text-amber-700"> (some nights have no rate plan yet — lower bound)</span>}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-500">Guest name</label>
              <input
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                placeholder="Priya Sharma"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500">Mobile</label>
              <input
                value={guestMobile}
                onChange={(e) => setGuestMobile(e.target.value)}
                className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                placeholder="98765 43210"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-gray-500">Email (optional)</label>
            <input
              value={guestEmail}
              onChange={(e) => setGuestEmail(e.target.value)}
              className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
              placeholder="priya@example.com"
            />
          </div>

          {formError && <div className="text-sm text-red-700">{formError}</div>}

          <button
            onClick={handleCreate}
            disabled={creating || available === false}
            className="w-full py-2.5 rounded-lg bg-gray-900 text-white text-sm font-medium hover:bg-gray-800 disabled:opacity-50"
          >
            {creating ? 'Creating…' : 'Create Reservation'}
          </button>
        </div>
      </div>
    </div>
  )
}
