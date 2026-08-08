// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/app/api/social/generate/route.ts
// Growth Platform Phase 3 — AI Content Studio (Google Business Post
// Generator + Social Media Content Generator). Pure draft endpoint — never
// creates or publishes a post itself; the caller (Content Studio) takes the
// returned content/hashtags and passes them into the existing POST
// /api/social/posts create flow for the operator to review and save.
// Same requireAuth() pattern as /api/social/posts.
//
// Phase 2 (Social Growth) added `type`: 'post' (default, unchanged
// behavior) | 'hashtags' | 'image_prompt' — same endpoint, same auth, same
// error-shape conventions, just routes to a different content-generator.ts
// function depending on what the operator is regenerating.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { requireAuth } from '@/lib/auth-guard'
import { generateSocialPostDraft, generateHashtags, generateImagePrompt, type GenerateDraftOptions } from '@/lib/social/content-generator'

export async function POST(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response

  try {
    const body = await req.json()
    const { platform, goal, context, type, variant, template } = body as {
      platform?: string; goal?: string; context?: string; type?: string
      // Sprint 2 (AI Content Studio) — optional length/tone variant + occasion template preset.
      variant?: string; template?: string
    }

    if (!platform || typeof platform !== 'string') {
      return NextResponse.json({ error: 'platform is required' }, { status: 400 })
    }
    if (!goal || typeof goal !== 'string' || !goal.trim()) {
      return NextResponse.json({ error: 'goal is required' }, { status: 400 })
    }

    if (type === 'hashtags') {
      const hashtags = await generateHashtags(platform, goal.trim())
      if (hashtags.length === 0) {
        return NextResponse.json({ error: 'AI hashtag generation failed — try again.' }, { status: 502 })
      }
      return NextResponse.json({ hashtags })
    }

    if (type === 'image_prompt') {
      const result = await generateImagePrompt(platform, goal.trim(), context)
      if (!result.prompt) {
        return NextResponse.json({ error: 'AI image prompt generation failed — try again.' }, { status: 502 })
      }
      return NextResponse.json({ imagePrompt: result.prompt })
    }

    const VALID_VARIANTS = ['standard', 'short', 'long', 'emoji']
    const VALID_TEMPLATES = ['wedding', 'birthday', 'corporate', 'rooftop', 'restaurant', 'weekend_stay', 'festival', 'offer']
    const draft = await generateSocialPostDraft(platform, goal.trim(), context, {
      variant: variant && VALID_VARIANTS.includes(variant) ? (variant as GenerateDraftOptions['variant']) : undefined,
      template: template && VALID_TEMPLATES.includes(template) ? (template as GenerateDraftOptions['template']) : undefined,
    })
    if (!draft.content) {
      return NextResponse.json({ error: 'AI draft generation failed — try again or write the post manually.' }, { status: 502 })
    }
    return NextResponse.json({ draft })
  } catch (err) {
    logger.error('social-generate', 'POST /api/social/generate failed', err)
    return NextResponse.json({ error: 'Failed to generate content' }, { status: 500 })
  }
}
