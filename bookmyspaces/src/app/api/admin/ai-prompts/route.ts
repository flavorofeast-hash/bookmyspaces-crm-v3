// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/app/api/admin/ai-prompts/route.ts
// V3 Phase 2c — versioned AI prompts. GET lists every version of every
// prompt; POST creates the next version of a prompt name and activates it.
// admin only — prompt text directly steers customer-facing AI behavior.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { requireRole } from '@/lib/auth-guard'
import { parseBody, createPromptVersionSchema } from '@/lib/validation'
import { listPrompts, createPromptVersion } from '@/lib/ai/prompt-service'

export async function GET() {
  const auth = await requireRole(['admin'])
  if (!auth.ok) return auth.response

  const result = await listPrompts()
  if (!result.ok) {
    logger.error('ai-prompts', 'GET failed', result.error)
    return NextResponse.json({ error: 'Failed to list prompts' }, { status: 500 })
  }
  return NextResponse.json({ prompts: result.value })
}

export async function POST(req: Request) {
  const auth = await requireRole(['admin'])
  if (!auth.ok) return auth.response

  const parsed = await parseBody(req, createPromptVersionSchema)
  if (!parsed.ok) return parsed.response

  const result = await createPromptVersion(parsed.data)
  if (!result.ok) {
    logger.error('ai-prompts', 'POST failed', result.error)
    return NextResponse.json({ error: result.error }, { status: 500 })
  }
  return NextResponse.json({ prompt: result.value }, { status: 201 })
}
