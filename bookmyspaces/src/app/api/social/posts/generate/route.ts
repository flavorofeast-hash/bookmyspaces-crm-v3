// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/app/api/social/posts/generate/route.ts
// Catalog → AI Content Studio, Phase 2 — POST { packageId, platform } returns
// AI-generated post copy grounded in that package's real catalog data (see
// src/lib/ai/content-generator.ts). Does NOT create a social_posts row --
// this only returns a draft for the operator to review/edit before calling
// the existing POST /api/social/posts to actually save it.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { logger } from '@/lib/logger'
import { requireAuth } from '@/lib/auth-guard'
import { generateSocialContentFromPackage } from '@/lib/ai/content-generator'

const bodySchema = z.object({
  packageId: z.string().uuid(),
  platform: z.enum(['facebook', 'instagram']),
}).strict()

export async function POST(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message ?? 'Invalid request' }, { status: 400 })
  }

  const result = await generateSocialContentFromPackage(parsed.data.packageId, parsed.data.platform)
  if (!result.ok) {
    logger.error('social-posts', 'generate: content generation failed', { error: result.error })
    return NextResponse.json({ error: result.error }, { status: 422 })
  }

  return NextResponse.json({ content: result.value })
}
