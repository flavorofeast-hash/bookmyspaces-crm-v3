// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/app/api/admin/ai-prompts/[id]/route.ts
// V3 Phase 2c — POST /activate: re-activate a historical prompt version
// (the rollback path; see prompt-service.ts's versioning model).
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { logger } from '@/lib/logger'
import { requireRole } from '@/lib/auth-guard'
import { activatePromptVersion } from '@/lib/ai/prompt-service'

const idSchema = z.string().uuid()

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requireRole(['admin'])
  if (!auth.ok) return auth.response
  if (!idSchema.safeParse(params.id).success) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 404 })
  }

  const result = await activatePromptVersion(params.id)
  if (!result.ok) {
    logger.error('ai-prompts', `activate ${params.id} failed`, result.error)
    return NextResponse.json({ error: result.error }, { status: 500 })
  }
  return NextResponse.json({ prompt: result.value })
}
