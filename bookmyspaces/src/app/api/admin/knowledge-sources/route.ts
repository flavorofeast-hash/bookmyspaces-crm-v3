// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/app/api/admin/knowledge-sources/route.ts
// V3 Phase 2c — CRM-editable knowledge base (admin CRUD over
// `knowledge_sources`). GET list / POST create. admin+manager only.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30 // embedding generation can take a few seconds

import { NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { requireRole } from '@/lib/auth-guard'
import { parseBody, createKnowledgeSourceSchema } from '@/lib/validation'
import { listKnowledgeSources, createKnowledgeSource } from '@/lib/knowledge/knowledge-sources-service'

export async function GET(req: Request) {
  const auth = await requireRole(['admin', 'manager'])
  if (!auth.ok) return auth.response

  const includeInactive = new URL(req.url).searchParams.get('includeInactive') === '1'
  const result = await listKnowledgeSources({ includeInactive })
  if (!result.ok) {
    logger.error('knowledge-sources', 'GET failed', result.error)
    return NextResponse.json({ error: 'Failed to list knowledge sources' }, { status: 500 })
  }
  return NextResponse.json({ sources: result.value })
}

export async function POST(req: Request) {
  const auth = await requireRole(['admin', 'manager'])
  if (!auth.ok) return auth.response

  const parsed = await parseBody(req, createKnowledgeSourceSchema)
  if (!parsed.ok) return parsed.response

  const result = await createKnowledgeSource(parsed.data)
  if (!result.ok) {
    logger.error('knowledge-sources', 'POST failed', result.error)
    return NextResponse.json({ error: result.error }, { status: 500 })
  }
  return NextResponse.json({ source: result.value }, { status: 201 })
}
