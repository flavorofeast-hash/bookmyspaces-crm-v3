// src/app/api/leads/pipeline/route.ts
// GET /api/leads/pipeline
//
// Additive endpoint for the Lead Management page's derived business-pipeline
// view (see src/lib/leads/pipeline-service.ts). Deliberately NOT a change to
// the existing GET /api/leads route — other consumers of /api/leads (Kanban,
// exports, anything else) are untouched, so this cannot introduce a breaking
// API change or regress an existing working workflow. Same query params and
// paging/search semantics as /api/leads, so it's a drop-in replacement for
// the Lead Management page specifically.
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-guard'
import { logger } from '@/lib/logger'
import { fetchLeadsPipelinePage } from '@/lib/leads/pipeline-service'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response

  try {
    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status')
    const source = searchParams.get('source')
    const search = searchParams.get('search')
    const limit = parseInt(searchParams.get('limit') || '50')
    const offset = parseInt(searchParams.get('offset') || '0')

    const { leads, total } = await fetchLeadsPipelinePage({ limit, offset, search, status, source })

    return NextResponse.json({ leads, total, limit, offset })
  } catch (error) {
    logger.error('leads-pipeline', 'GET failed', error)
    return NextResponse.json({ error: 'Failed to fetch lead pipeline' }, { status: 500 })
  }
}
