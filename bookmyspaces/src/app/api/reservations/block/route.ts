// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/app/api/reservations/block/route.ts
// Sprint 1, Priority 1 — smallest practical admin capability for a manual
// availability override. Thin wrapper over reservation-workflow.ts's
// createManualBlock() — no new business logic here, same posture as the
// existing POST /api/reservations route being a thin wrapper over
// createReservationWithQuote().
//
// Deliberately its own route rather than a mode flag on POST /api/reservations:
// createReservationSchema requires guestName/pricing-adjacent fields a block
// doesn't have, and mixing "real booking" and "manual block" request shapes
// into one schema/route would make both harder to read for no real benefit.
//
// Reads/writes `reservations` (migration 012, not yet applied to production —
// see MIGRATION_012_013_DEPLOYMENT_VALIDATION.md). Same db_error -> 502
// convention as POST /api/reservations for the same reason.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { requireAuth } from '@/lib/auth-guard'
import { parseBody, createManualBlockSchema } from '@/lib/validation'
import { createManualBlock } from '@/lib/reservations/reservation-workflow'

export async function POST(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response

  const parsed = await parseBody(req, createManualBlockSchema)
  if (!parsed.ok) return parsed.response
  const body = parsed.data

  try {
    const result = await createManualBlock({
      propertyId: body.propertyId,
      inventoryItemId: body.inventoryItemId,
      checkInDate: body.checkInDate,
      checkOutDate: body.checkOutDate,
      reason: body.reason,
      createdBy: auth.user.email ?? null,
    })

    if (!result.ok) {
      if (result.error === 'unavailable') {
        return NextResponse.json(
          { error: 'Selected dates are already unavailable for this item', conflictingReservationIds: result.conflictingReservationIds },
          { status: 409 }
        )
      }
      // Type-level only for this call site: createManualBlock() calls
      // createReservation() directly (no proposalId ever supplied), so this
      // variant cannot actually occur here — createReservation() itself
      // never produces it, only createReservationWithQuote()'s duplicate-
      // conversion guard does. Handled for exhaustiveness/type-safety since
      // CreateReservationResult is a shared union with POST /api/reservations.
      if (result.error === 'already_converted') {
        return NextResponse.json(
          { error: 'This proposal has already been converted to a reservation', reservationId: result.reservationId },
          { status: 409 }
        )
      }
      logger.error('reservations/block', 'POST createManualBlock db_error', result.message)
      return NextResponse.json({ error: 'Could not create manual block', detail: result.message }, { status: 502 })
    }

    return NextResponse.json({ reservation: result.reservation }, { status: 201 })
  } catch (error) {
    logger.error('reservations/block', 'POST failed', error)
    return NextResponse.json({ error: 'Failed to create manual block' }, { status: 500 })
  }
}
