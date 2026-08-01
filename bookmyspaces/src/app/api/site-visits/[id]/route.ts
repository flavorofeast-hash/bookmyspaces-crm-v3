export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-guard'
import { logger } from '@/lib/logger'
import { updateSiteVisitStatus } from '@/lib/visits/site-visit-service'
import { runVisitToProposalConversion } from '@/lib/leads/visit-to-proposal'

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

    // Sprint 2 — Revenue Conversion Engine: a visit just marked 'completed'
    // is the trigger for the Visit -> Proposal Draft pipeline. Best-effort —
    // never lets a drafting failure turn a successful status update into an
    // error response; the operator can still create a proposal manually.
    let draftProposalId: string | null = null
    if (status === 'completed') {
      const conversion = await runVisitToProposalConversion(params.id)
      draftProposalId = conversion.draftProposalId
    }

    return NextResponse.json({ success: true, draftProposalId })
  } catch (err) {
    logger.error('site-visits/[id]', 'PATCH failed', err)
    return NextResponse.json({ error: 'Failed to update site visit' }, { status: 500 })
  }
}
