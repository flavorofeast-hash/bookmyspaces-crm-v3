// src/app/api/proposals/track-view/route.ts
// POST /api/proposals/track-view
// Called by the share page when a customer opens a proposal.
// Increments viewed_count, sets first_viewed_at on first view, updates last_viewed_at.
// Always returns 200 — tracking failure must never break proposal viewing.

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json() as { proposal_id?: string; share_token?: string }

    if (!body.proposal_id && !body.share_token) {
      return NextResponse.json({ tracked: false, error: 'proposal_id or share_token required' })
    }

    const db = getSupabaseAdmin()

    // Resolve proposal_id from share_token if needed
    let proposalId = body.proposal_id
    if (!proposalId && body.share_token) {
      const { data } = await db
        .from('proposals')
        .select('id, viewed_count, first_viewed_at, status')
        .eq('share_token', body.share_token)
        .single()
      if (!data) return NextResponse.json({ tracked: false })
      proposalId = data.id as string
    }

    // Fetch current state
    const { data: current } = await db
      .from('proposals')
      .select('id, viewed_count, first_viewed_at, status')
      .eq('id', proposalId)
      .single()

    if (!current) return NextResponse.json({ tracked: false })

    const now            = new Date().toISOString()
    const isFirstView    = !current.first_viewed_at
    const currentCount   = (current.viewed_count as number) ?? 0

    // Calculate engagement score: increases with each view, capped at 100
    const newCount         = currentCount + 1
    const engagementScore  = Math.min(newCount * 15, 100)

    const updatePayload: Record<string, unknown> = {
      viewed_count    : newCount,
      last_viewed_at  : now,
      engagement_score: engagementScore,
      updated_at      : now,
    }

    if (isFirstView) {
      updatePayload.first_viewed_at = now
      // Auto-advance status from 'sent' → 'viewed' on first view
      if (current.status === 'sent') {
        updatePayload.status = 'viewed'
      }
    }

    const { error } = await db
      .from('proposals')
      .update(updatePayload)
      .eq('id', proposalId)

    if (error) {
      logger.error('proposals-track-view', 'update failed', error)
    }

    return NextResponse.json({
      tracked         : !error,
      view_count      : newCount,
      first_view      : isFirstView,
      engagement_score: engagementScore,
    })

  } catch (err: unknown) {
    // Never let tracking crash — proposal viewing must always work
    logger.error('proposals-track-view', 'non-fatal error', err)
    return NextResponse.json({ tracked: false })
  }
}
