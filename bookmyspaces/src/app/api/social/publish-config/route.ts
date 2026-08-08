// ─────────────────────────────────────────────────────────────────────────────
// Content Operations Priority 5 — Approval workflow toggle. GET/PATCH over
// publish-config.ts (settings table, category='social_publish'). Gated
// requireRole(['admin','manager']) — this is a workflow-control setting,
// same tier as social account management.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { requireRole } from '@/lib/auth-guard'
import { getPublishConfig, setPublishConfig } from '@/lib/social/publish-config'

export async function GET() {
  const auth = await requireRole(['admin', 'manager'])
  if (!auth.ok) return auth.response
  const config = await getPublishConfig()
  return NextResponse.json({ config })
}

export async function PATCH(req: NextRequest) {
  const auth = await requireRole(['admin', 'manager'])
  if (!auth.ok) return auth.response

  let body: { requireApproval?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (typeof body.requireApproval !== 'boolean') {
    return NextResponse.json({ error: 'requireApproval must be a boolean' }, { status: 400 })
  }

  const result = await setPublishConfig({ requireApproval: body.requireApproval }, auth.user.id)
  if (!result.ok) {
    logger.error('social/publish-config', 'PATCH failed', result.error)
    return NextResponse.json({ error: result.error }, { status: 500 })
  }
  const config = await getPublishConfig()
  return NextResponse.json({ config })
}
