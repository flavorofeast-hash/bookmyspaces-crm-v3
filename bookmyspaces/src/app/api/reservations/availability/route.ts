// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/app/api/reservations/availability/route.ts
// V3 Day 6 — Operator Experience sprint.
//
// POST — Check Availability + Calculate Price for a candidate stay, without
// creating anything. Thin wrapper over availability-service.ts's
// checkAvailability() and reservation-workflow.ts's calculatePrice() — the
// exact two steps createReservationWithQuote() also runs, exposed
// separately so the "New Reservation" UI can show a live quote as the
// operator picks dates, before committing to create the reservation.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { requireAuth } from '@/lib/auth-guard'
import { parseBody, checkAvailabilitySchema } from '@/lib/validation'
import { checkAvailability } from '@/lib/reservations/availability-service'
import { calculatePrice } from '@/lib/reservations/reservation-workflow'

export async function POST(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response

  const parsed = await parseBody(req, checkAvailabilitySchema)
  if (!parsed.ok) return parsed.response
  const { inventoryItemId, checkInDate, checkOutDate, roomCount, mealPlanId, addons } = parsed.data

  if (checkOutDate <= checkInDate) {
    return NextResponse.json({ error: 'checkOutDate must be after checkInDate' }, { status: 400 })
  }

  try {
    const availability = await checkAvailability(inventoryItemId, checkInDate, checkOutDate)
    const quote = await calculatePrice(inventoryItemId, checkInDate, checkOutDate, roomCount ?? 1, mealPlanId, addons)

    return NextResponse.json({ availability, quote })
  } catch (error) {
    logger.error('reservations/availability', 'POST failed', error)
    return NextResponse.json({ error: 'Failed to check availability' }, { status: 500 })
  }
}
