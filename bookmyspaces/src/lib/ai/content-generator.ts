// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/ai/content-generator.ts
// Catalog → AI Content Studio, Phase 2 — generates Facebook/Instagram post
// copy grounded in a real `packages` row (src/lib/packages/package-service.ts).
//
// Anti-hallucination by construction, not by instruction alone: every price,
// capacity, and inclusion the model is allowed to reference is interpolated
// into the prompt from the DB row itself. The model is told never to state a
// number/fact absent from that block, but the real guarantee is that nothing
// downstream (post-service.ts, the UI) ever re-derives those numbers from
// the model's output -- the catalog fields on the created social_posts row
// come from `package_id`, not from parsing the AI's caption text.
// ─────────────────────────────────────────────────────────────────────────────

import Anthropic from '@anthropic-ai/sdk'
import { getPackageById } from '@/lib/packages/package-service'
import { getSettingsSection } from '@/lib/settings/settings-service'
import { logger } from '@/lib/logger'

let _anthropic: Anthropic | null = null
function getAnthropic(): Anthropic {
  if (!_anthropic) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured')
    _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  }
  return _anthropic
}

export type ContentPlatform = 'facebook' | 'instagram'

export interface GeneratedSocialContent {
  headline: string
  caption: string
  ctaText: string
  hashtags: string[]
  imageConcept: string
  targetAudience: string[]
}

type Result<T> = { ok: true; value: T } | { ok: false; error: string }

export async function generateSocialContentFromPackage(
  packageId: string,
  platform: ContentPlatform
): Promise<Result<GeneratedSocialContent>> {
  const pkg = await getPackageById(packageId)
  if (!pkg) return { ok: false, error: 'Package not found' }
  if (!pkg.isActive) return { ok: false, error: 'Package is not active' }

  const priceUnitLabel: Record<string, string> = {
    per_event: 'per event',
    per_person: 'per person',
    per_hour: 'per hour',
    per_night: 'per night',
  }

  const facts = [
    `Package name: ${pkg.name}`,
    `Venue: ${pkg.venue}${pkg.hall ? ` (${pkg.hall})` : ''}`,
    `Price: Rs. ${pkg.basePrice.toLocaleString('en-IN')} ${priceUnitLabel[pkg.priceUnit] ?? ''}`.trim(),
    `Max guests: ${pkg.maxGuests}`,
    `Duration: ${pkg.durationHours} hours`,
    pkg.inclusions.length ? `Inclusions: ${pkg.inclusions.join(', ')}` : null,
    pkg.exclusions.length ? `Does not include: ${pkg.exclusions.join(', ')}` : null,
    pkg.eventTypes.length ? `Suitable for: ${pkg.eventTypes.join(', ')}` : null,
    pkg.description ? `Description: ${pkg.description}` : null,
  ].filter(Boolean).join('\n')

  const prompt = `You are writing a ${platform} post promoting a real, bookable event package for BookMySpaces (a hospitality brand with two properties, Skyline Serenity and MonuRama Homestay). Use ONLY the facts below. Never invent, round differently, or imply a price, guest capacity, inclusion, or offer that is not stated here. Any number in your output must appear verbatim in the facts.

FACTS:
${facts}

Return ONLY JSON, no explanation, in this exact shape:
{"headline":"...","caption":"...","ctaText":"...","hashtags":["...","..."],"imageConcept":"...","targetAudience":["...","..."]}

Rules:
- headline: max 60 characters, no clickbait, no emoji spam
- caption: ${platform === 'instagram' ? '80-150 words, line breaks and light emoji are fine' : '40-100 words, conversational, minimal emoji'}
- ctaText: a short action phrase, e.g. "Book your date on WhatsApp"
- hashtags: 5-10 relevant tags, plain words without a # prefix
- imageConcept: one sentence describing what photo or graphic would pair with this post (no image is generated — this is a brief for whoever selects one)
- targetAudience: 2-4 short audience descriptors, e.g. "young couples", "corporate event planners"`

  try {
    const aiSettings = await getSettingsSection('ai')
    const response = await getAnthropic().messages.create({
      model: aiSettings.model,
      max_tokens: 700,
      messages: [{ role: 'user', content: prompt }],
    })
    const text = response.content[0]?.type === 'text' ? response.content[0].text : ''
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return { ok: false, error: 'AI did not return valid JSON' }

    const raw = JSON.parse(jsonMatch[0]) as Record<string, unknown>
    return {
      ok: true,
      value: {
        headline: String(raw.headline ?? '').slice(0, 100),
        caption: String(raw.caption ?? ''),
        ctaText: String(raw.ctaText ?? ''),
        hashtags: Array.isArray(raw.hashtags) ? raw.hashtags.map(String).slice(0, 15) : [],
        imageConcept: String(raw.imageConcept ?? ''),
        targetAudience: Array.isArray(raw.targetAudience) ? raw.targetAudience.map(String).slice(0, 6) : [],
      },
    }
  } catch (err) {
    logger.error('content-generator', 'generateSocialContentFromPackage failed', err)
    return { ok: false, error: 'AI generation failed' }
  }
}
