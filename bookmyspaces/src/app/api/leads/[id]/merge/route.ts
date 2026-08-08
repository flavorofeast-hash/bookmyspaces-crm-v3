// src/app/api/leads/[id]/merge/route.ts
// POST /api/leads/:id/merge — Social Operations Priority 4 (duplicate lead
// prevention). :id is the PRIMARY (surviving) lead; body.duplicateLeadId is
// the lead being merged away. requireRole(['admin','manager']) — a
// destructive-shaped, cross-table write, same tier as /api/social/accounts.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { requireRole } from '@/lib/auth-guard'
import { parseBody, mergeLeadsSchema } from '@/lib/validation'
import { mergeLeads } from '@/lib/leads/lead-merge-service'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireRole(['admin', 'manager'])
  if (!auth.ok) return auth.response

  const primaryLeadId = params.id
  if (!primaryLeadId) return NextResponse.json({ error: 'Lead ID required' }, { status: 400 })

  const parsed = await parseBody(req, mergeLeadsSchema)
  if (!parsed.ok) return parsed.response

  const result = await mergeLeads(primaryLeadId, parsed.data.duplicateLeadId, auth.user.id)
  if (!result.ok) {
    logger.error('leads/merge', 'mergeLeads failed', result.error)
    return NextResponse.json({ error: result.error }, { status: 422 })
  }
  return NextResponse.json({ success: true, ...result.value })
}
