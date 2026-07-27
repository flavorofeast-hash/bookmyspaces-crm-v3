// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/app/api/properties/route.ts
// V3 Day 6 — Operator Experience sprint.
//
// Thin route over property-service.ts's listActiveProperties()/
// listActiveInventoryItems()/listActiveMealPlans()/listActiveAddonServices()
// — no new business logic. Powers the "which property/room/hall am I
// booking" pickers on the Reservation Dashboard's create-reservation flow
// and the Reservation Calendar, plus (Reservation Platform activation,
// Phases 3-4) the New Reservation modal's optional meal-plan and add-on
// pickers.
//
// mealPlans/addonServices are deliberately exposed from this already-
// `requireAuth()`-gated route rather than reused from
// /api/admin/catalog/{meal-plans,addon-services}, which are
// `requireRole(['admin','manager'])`-gated — any authenticated operator
// creating a reservation needs to see active meal plans/add-ons, not just
// admins.
//
// Reads from `properties`/`inventory_items`/`meal_plans`/`addon_services`
// (migration 012, not yet applied to production — see
// audit/DAY6_EXECUTION_REPORT.md). All four service functions already
// return an empty array rather than throwing when the tables don't exist
// yet, so this route degrades to `{ properties: [] }` instead of a 500
// until the migration is applied.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { requireAuth } from '@/lib/auth-guard'
import { listActiveProperties, listActiveInventoryItems, listActiveMealPlans, listActiveAddonServices } from '@/lib/reservations/property-service'

export async function GET() {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response

  try {
    const [properties, inventoryItems, mealPlans, addonServices] = await Promise.all([
      listActiveProperties(),
      listActiveInventoryItems(),
      listActiveMealPlans(),
      listActiveAddonServices(),
    ])

    return NextResponse.json({ properties, inventoryItems, mealPlans, addonServices })
  } catch (error) {
    logger.error('properties', 'GET failed', error)
    return NextResponse.json({ error: 'Failed to fetch properties' }, { status: 500 })
  }
}
