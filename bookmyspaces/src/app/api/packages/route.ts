export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { requireAuth } from '@/lib/auth-guard'
import { listPackages, createPackage } from '@/lib/packages/package-service'
import type { EventType } from '@/lib/events/event-types'

export async function GET(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  try {
    const { searchParams } = new URL(req.url)
    const activeOnly = searchParams.get('active') !== 'false'
    const eventType = searchParams.get('event_type') as EventType | null
    const venue = searchParams.get('venue')

    const packages = await listPackages({
      activeOnly,
      eventType: eventType ?? undefined,
      venue: venue ?? undefined,
    })
    return NextResponse.json({ packages })
  } catch (err) {
    logger.error('packages', 'GET /api/packages failed', err)
    return NextResponse.json({ error: 'Failed to fetch packages' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  try {
    const body = await req.json()
    if (!body.name || !body.venue || body.basePrice == null) {
      return NextResponse.json({ error: 'name, venue, and basePrice are required' }, { status: 400 })
    }
    const created = await createPackage(body)
    if (!created) return NextResponse.json({ error: 'Failed to create package' }, { status: 500 })
    return NextResponse.json({ package: created }, { status: 201 })
  } catch (err) {
    logger.error('packages', 'POST /api/packages failed', err)
    return NextResponse.json({ error: 'Failed to create package' }, { status: 500 })
  }
}
