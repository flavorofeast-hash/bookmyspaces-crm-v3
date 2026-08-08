// ─────────────────────────────────────────────────────────────────────────────
// Social Operations Priority 4 — Unified Inbox merge (social_interactions +
// reviews + unified_conversations). requireAuth() only (not requireRole) —
// same posture as GET /api/inbox and GET /api/social/interactions, which
// this route sits alongside; it exposes no credentials, only content
// already visible via those existing routes individually.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { requireAuth } from '@/lib/auth-guard'
import { getUnifiedInbox } from '@/lib/social/unified-inbox-service'

export async function GET(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response

  const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') || '30', 10) || 30, 100)
  const offset = Math.max(parseInt(req.nextUrl.searchParams.get('offset') || '0', 10) || 0, 0)

  try {
    const result = await getUnifiedInbox(limit, offset)
    return NextResponse.json(result)
  } catch (err) {
    logger.error('social/unified-inbox', 'GET failed', err)
    return NextResponse.json({ error: 'Failed to load unified inbox' }, { status: 500 })
  }
}
