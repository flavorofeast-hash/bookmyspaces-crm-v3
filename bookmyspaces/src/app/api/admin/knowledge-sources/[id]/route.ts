// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/app/api/admin/knowledge-sources/[id]/route.ts
// V3 Phase 2c — PATCH update (re-embeds on text change) / DELETE deactivate.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { logger } from '@/lib/logger'
import { requireRole } from '@/lib/auth-guard'
import { parseBody, updateKnowledgeSourceSchema } from '@/lib/validation'
import { updateKnowledgeSource } from '@/lib/knowledge/knowledge-sources-service'

const idSchema = z.string().uuid()

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireRole(['admin', 'manager'])
  if (!auth.ok) return auth.response
  if (!idSchema.safeParse(params.id).success) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 404 })
  }

  const parsed = await parseBody(req, updateKnowledgeSourceSchema)
  if (!parsed.ok) return parsed.response

  const result = await updateKnowledgeSource(params.id, parsed.data)
  if (!result.ok) {
    logger.error('knowledge-sources', `PATCH ${params.id} failed`, result.error)
    return NextResponse.json({ error: result.error }, { status: 500 })
  }
  return NextResponse.json({ source: result.value })
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requireRole(['admin', 'manager'])
  if (!auth.ok) return auth.response
  if (!idSchema.safeParse(params.id).success) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 404 })
  }

  const result = await updateKnowledgeSource(params.id, { is_active: false })
  if (!result.ok) {
    logger.error('knowledge-sources', `DELETE ${params.id} failed`, result.error)
    return NextResponse.json({ error: result.error }, { status: 500 })
  }
  return NextResponse.json({ source: result.value })
}
