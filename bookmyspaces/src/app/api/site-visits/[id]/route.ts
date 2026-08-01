export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-guard'
import { logger } from '@/lib/logger'
import { updateSiteVisitStatus } from '@/lib/visits/site-visit-service'

const VALID_STATUSES = ['pending', 'completed', 'skipped', 'rescheduled'] as const

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response

  try {
    const body = await req.json()
    const { status } = body

    if (!VALID_STATUSES.includes(status)) {
      return NextResponse.json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` }, { status: 400 })
    }

    const ok = await updateSiteVisitStatus(params.id, status)
    if (!ok) return NextResponse.json({ error: 'Failed to update site visit' }, { status: 500 })

    return NextResponse.json({ success: true })
  } catch (err) {
    logger.error('site-visits/[id]', 'PATCH failed', err)
    return NextResponse.json({ error: 'Failed to update site visit' }, { status: 500 })
  }
}
