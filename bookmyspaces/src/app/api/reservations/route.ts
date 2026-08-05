// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/app/api/reservations/route.ts
// V3 Day 6 — Operator Experience sprint.
//
// GET  — list reservations for the Reservation Dashboard, with optional
//        status/date filters. Thin wrapper over
//        reservation-service.ts's listReservations().
// POST — create a reservation (Check Availability -> Calculate Price ->
//        Create Reservation, in one call). Thin wrapper over
//        reservation-workflow.ts's createReservationWithQuote() — no new
//        business logic, this route only validates input and shapes the
//        HTTP response.
//
// Reads/writes `reservations` (migration 012, not yet applied to production
// — see audit/DAY6_EXECUTION_REPORT.md). GET degrades to an empty list
// rather than a 500 until the migration lands; POST will genuinely fail
// with a db_error until then, which is surfaced as a 502 (upstream/
// dependency not ready), not silently swallowed.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { requireAuth } from '@/lib/auth-guard'
import { parseBody, createReservationSchema } from '@/lib/validation'
import { listReservations } from '@/lib/reservations/reservation-service'
import { createReservationWithQuote } from '@/lib/reservations/reservation-workflow'
import type { ReservationStatus } from '@/types/reservation'

const ALL_STATUSES: ReservationStatus[] = [
  'inquiry', 'tentative', 'confirmed', 'checked_in', 'checked_out', 'cancelled', 'no_show',
]

export async function GET(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response

  try {
    const { searchParams } = new URL(req.url)
    const statusParam = searchParams.get('status') // comma-separated, e.g. "confirmed,tentative"
    const checkInFrom = searchParams.get('checkInFrom') || undefined
    const checkInTo = searchParams.get('checkInTo') || undefined
    const checkOutFrom = searchParams.get('checkOutFrom') || undefined
    const checkOutTo = searchParams.get('checkOutTo') || undefined
    const propertyId = searchParams.get('propertyId') || undefined

    let status: ReservationStatus[] | undefined
    if (statusParam) {
      const requested = statusParam.split(',').map((s) => s.trim())
      status = requested.filter((s): s is ReservationStatus => (ALL_STATUSES as string[]).includes(s))
    }

    const reservations = await listReservations({ status, checkInFrom, checkInTo, checkOutFrom, checkOutTo, propertyId })

    return NextResponse.json({ reservations, total: reservations.length })
  } catch (error) {
    logger.error('reservations', 'GET failed', error)
    return NextResponse.json({ error: 'Failed to fetch reservations' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response

  const parsed = await parseBody(req, createReservationSchema)
  if (!parsed.ok) return parsed.response
  const body = parsed.data

  try {
    const { reservationResult, quote, proposalLinkError } = await createReservationWithQuote({
      customerId: body.customerId ?? null,
      guestName: body.guestName,
      guestMobile: body.guestMobile ?? null,
      guestEmail: body.guestEmail || null,
      propertyId: body.propertyId,
      inventoryItemId: body.inventoryItemId,
      checkInDate: body.checkInDate,
      checkOutDate: body.checkOutDate,
      adults: body.adults ?? undefined,
      children: body.children ?? undefined,
      roomCount: body.roomCount ?? undefined,
      bookingSource: body.bookingSource ?? undefined,
      specialRequests: body.specialRequests ?? null,
      crmLeadId: body.crmLeadId ?? body.customerId ?? null,
      proposalId: body.proposalId ?? null,
      mealPlanId: body.mealPlanId ?? null,
      addons: body.addons ?? undefined,
    })

    if (!reservationResult.ok) {
      if (reservationResult.error === 'unavailable') {
        return NextResponse.json(
          { error: 'Selected dates are unavailable', conflictingReservationIds: reservationResult.conflictingReservationIds },
          { status: 409 }
        )
      }
      // db_error here almost always means migration 012's `reservations`
      // table isn't applied yet in this environment — 502, not 500, to
      // signal "dependency not ready" rather than "this route is broken".
      logger.error('reservations', 'POST createReservationWithQuote db_error', reservationResult.message)
      return NextResponse.json({ error: 'Could not create reservation', detail: reservationResult.message }, { status: 502 })
    }

    // Production fix (proposal<->reservation link-back): the reservation is
    // real and already committed even if this failed — never surfaced as a
    // non-2xx (that would risk a client retry creating a duplicate
    // reservation). Logged for visibility; returned in the body so the UI
    // can show a non-blocking warning if it chooses to.
    if (proposalLinkError) {
      logger.error('reservations', 'POST proposal link-back failed', proposalLinkError, { reservationId: reservationResult.reservation.id, proposalId: body.proposalId })
    }

    return NextResponse.json(
      { reservation: reservationResult.reservation, quote, ...(proposalLinkError ? { proposalLinkError } : {}) },
      { status: 201 }
    )
  } catch (error) {
    logger.error('reservations', 'POST failed', error)
    return NextResponse.json({ error: 'Failed to create reservation' }, { status: 500 })
  }
}
