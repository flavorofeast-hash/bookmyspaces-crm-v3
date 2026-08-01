// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/app/api/dashboard/operations/route.ts
// V3 Sprint 4 — Priority 5: Operational Dashboards.
//
// Complements the existing Revenue Dashboard (/api/dashboard/revenue, which
// already covers leads-by-source, proposal conversion, and revenue trends —
// not rebuilt here) with the three operational metrics that dashboard
// doesn't: Pending Payments, Repeat Guests (both read the LIVE `proposals`
// table's payment_status/balance_due columns, synced by the existing
// sync_proposal_payment_status() trigger — migration 009, no new writes),
// and Occupancy (reads `reservations`/`inventory_items`, migration 012 —
// degrades to `occupancy.degraded: true` rather than throwing until that
// migration is applied, same contract as every other Reservation Platform
// read in this codebase).
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth-guard'
import { listSiteVisitsForDate, siteVisitStatusLabel } from '@/lib/visits/site-visit-service'

const BLOCKING_STATUSES = ['inquiry', 'tentative', 'confirmed', 'checked_in']

interface PendingPaymentRow {
  id: string
  proposal_number: string | null
  client_name: string | null
  lead_id: string | null
  balance_due: number | null
}

interface RepeatGuestAccumulator {
  leadId: string
  name: string | null
  phone: string | null
  acceptedCount: number
}

export async function GET() {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response

  const supabase = getSupabaseAdmin()

  try {
    // ── Pending Payments — accepted proposals with an outstanding balance ──
    const { data: pendingRows, error: pendingError } = await supabase
      .from('proposals')
      .select('id, proposal_number, client_name, lead_id, balance_due')
      .eq('status', 'accepted')
      .gt('balance_due', 0)
      .order('balance_due', { ascending: false })

    if (pendingError) throw pendingError
    const pending = (pendingRows ?? []) as PendingPaymentRow[]
    const totalOutstanding = pending.reduce((sum, p) => sum + (Number(p.balance_due) || 0), 0)

    // ── Repeat Guests — leads with more than one accepted proposal ─────────
    const { data: acceptedRows, error: acceptedError } = await supabase
      .from('proposals')
      .select('lead_id, client_name, client_phone')
      .eq('status', 'accepted')
      .not('lead_id', 'is', null)

    if (acceptedError) throw acceptedError

    const byLead = new Map<string, RepeatGuestAccumulator>()
    for (const row of (acceptedRows ?? []) as Array<{ lead_id: string; client_name: string | null; client_phone: string | null }>) {
      const existing = byLead.get(row.lead_id)
      if (existing) {
        existing.acceptedCount += 1
      } else {
        byLead.set(row.lead_id, { leadId: row.lead_id, name: row.client_name, phone: row.client_phone, acceptedCount: 1 })
      }
    }
    const repeatGuests = Array.from(byLead.values())
      .filter((g) => g.acceptedCount >= 2)
      .sort((a, b) => b.acceptedCount - a.acceptedCount)

    // ── Occupancy — today's booked vs. total active inventory ──────────────
    const today = new Date().toISOString().slice(0, 10)
    let occupancy: {
      degraded: boolean
      date: string
      totalInventory: number
      occupied: number
      occupancyPct: number | null
      byProperty: Array<{ propertyId: string; propertyName: string; total: number; occupied: number; occupancyPct: number | null }>
    } = { degraded: false, date: today, totalInventory: 0, occupied: 0, occupancyPct: null, byProperty: [] }

    try {
      const [{ data: items, error: itemsError }, { data: todayRes, error: resError }] = await Promise.all([
        supabase.from('inventory_items').select('id, property_id, properties(name)').eq('is_active', true),
        supabase
          .from('reservations')
          .select('inventory_item_id')
          .in('status', BLOCKING_STATUSES)
          .lte('check_in_date', today)
          .gt('check_out_date', today),
      ])

      if (itemsError || resError) throw itemsError ?? resError

      const occupiedIds = new Set((todayRes ?? []).map((r: { inventory_item_id: string }) => r.inventory_item_id))
      const byPropertyMap = new Map<string, { propertyId: string; propertyName: string; total: number; occupied: number }>()

      for (const item of (items ?? []) as Array<{ id: string; property_id: string; properties: { name: string } | { name: string }[] | null }>) {
        const property = Array.isArray(item.properties) ? item.properties[0] : item.properties
        const key = item.property_id
        if (!byPropertyMap.has(key)) {
          byPropertyMap.set(key, { propertyId: key, propertyName: property?.name ?? 'Unknown property', total: 0, occupied: 0 })
        }
        const entry = byPropertyMap.get(key)!
        entry.total += 1
        if (occupiedIds.has(item.id)) entry.occupied += 1
      }

      const totalInventory = (items ?? []).length
      const occupied = occupiedIds.size

      occupancy = {
        degraded: false,
        date: today,
        totalInventory,
        occupied,
        occupancyPct: totalInventory > 0 ? Math.round((occupied / totalInventory) * 1000) / 10 : null,
        byProperty: Array.from(byPropertyMap.values()).map((p) => ({
          ...p,
          occupancyPct: p.total > 0 ? Math.round((p.occupied / p.total) * 1000) / 10 : null,
        })),
      }
    } catch {
      occupancy = { degraded: true, date: today, totalInventory: 0, occupied: 0, occupancyPct: null, byProperty: [] }
    }

    // ── Today's Site Visits (Sprint 1 — Revenue Capture Pipeline) ──────────
    const todaysVisitsRaw = await listSiteVisitsForDate(today).catch((err) => {
      logger.error('dashboard/operations', 'listSiteVisitsForDate failed', err)
      return []
    })
    const todaysSiteVisits = todaysVisitsRaw.map((v) => ({
      id          : v.id,
      time        : v.scheduledAt,
      customerName: v.customerName,
      customerPhone: v.customerPhone,
      property    : v.property,
      purpose     : v.purpose,
      guestCount  : v.guestCount,
      budget      : v.budget,
      status      : v.status,
      statusLabel : siteVisitStatusLabel(v.status),
    }))

    return NextResponse.json({
      pendingPayments: {
        count: pending.length,
        totalOutstanding,
        proposals: pending.slice(0, 15).map((p) => ({
          id: p.id,
          proposalNumber: p.proposal_number,
          clientName: p.client_name,
          leadId: p.lead_id,
          balanceDue: Number(p.balance_due) || 0,
        })),
      },
      repeatGuests: {
        count: repeatGuests.length,
        guests: repeatGuests.slice(0, 15),
      },
      occupancy,
      todaysSiteVisits,
    })
  } catch (error) {
    logger.error('dashboard/operations', 'GET failed', error)
    return NextResponse.json({ error: 'Failed to load operations dashboard' }, { status: 500 })
  }
}
