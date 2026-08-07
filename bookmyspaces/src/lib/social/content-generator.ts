// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/social/content-generator.ts
// Growth Platform Phase 3 — AI Content Studio: Google Business Post
// Generator + Social Media Content Generator.
//
// AUDIT FINDING THIS BUILDS ON: Content Studio (src/app/(crm)/content-
// studio/page.tsx) is list+create only — its own header comment says "AI
// captions arrive in later steps." No AI call of any kind existed anywhere
// in the social/content-studio code path before this file (confirmed by a
// full grep of src/lib/social/*). This is genuinely new logic, but reuses
// the exact same direct-Anthropic-client pattern already established in
// src/lib/campaigns.ts (generateCampaignBrief/generateCampaignMessage) —
// NOT src/lib/providers/ai-provider.ts, which wraps the guest-facing
// chatbot's chatWithAI() (its own SYSTEM_PROMPT + knowledge retrieval baked
// in) and is the wrong tool for drafting operator-facing marketing copy.
// ─────────────────────────────────────────────────────────────────────────────

import Anthropic from '@anthropic-ai/sdk'

let _anthropic: Anthropic | null = null
function getAnthropic() {
  if (!_anthropic) _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || '' })
  return _anthropic
}

const PLATFORM_GUIDANCE: Record<string, string> = {
  facebook: 'Warm, conversational, 2-4 sentences. Emojis welcome but not excessive.',
  instagram: 'Punchy, visual-first caption, 2-3 short lines, emoji-friendly, ends with a soft CTA.',
  linkedin: 'Professional tone, no emojis or at most one, focus on the venue/business angle (e.g. corporate events, hospitality quality).',
  google_business: 'Short, informational, local-SEO friendly (mention Kolkata/location), one clear CTA (call/WhatsApp/visit), no emojis or at most one.',
  x: 'Very short (under 200 characters), punchy, at most 1 emoji.',
  youtube: 'A short video description style caption, 2-3 sentences, no heavy hashtag stuffing (YouTube treats hashtags differently than Instagram).',
  threads: 'Casual, conversational, similar to X but slightly longer is fine.',
}

export interface SocialPostDraft {
  content: string
  hashtags: string[]
}

/**
 * Drafts platform-appropriate social copy + hashtags for a given goal
 * (e.g. "promote our Durga Puja banquet package", "announce weekend
 * availability"). Pure draft — the operator reviews/edits in Content
 * Studio before saving as a draft/scheduled post; never posts anything
 * itself (no publish path exists yet — see post-service.ts's own header
 * comment on that gap).
 */
export async function generateSocialPostDraft(
  platform: string,
  goal: string,
  context?: string
): Promise<SocialPostDraft> {
  const guidance = PLATFORM_GUIDANCE[platform] || PLATFORM_GUIDANCE.facebook

  const prompt = `You are a social media copywriter for BookMySpaces, a premium hospitality venue (rooftop events, private dining, room stays) in Kolkata, India, and its property Monurama Homestay.

Platform: ${platform}
Style guidance for this platform: ${guidance}
Post goal: ${goal}
${context ? `Additional context: ${context}` : ''}

Respond with ONLY valid JSON, no markdown fences, in exactly this shape:
{
  "content": "the post caption/copy text, matching the platform style guidance above",
  "hashtags": ["hashtag1", "hashtag2", "hashtag3"]
}

Hashtags: 3-6 relevant tags (no # symbol, no spaces within a tag), mixing venue/location tags (e.g. kolkatawedding, rooftopvenue) with the goal's theme. Fewer, more relevant hashtags for LinkedIn/Google Business; more are fine for Instagram.`

  try {
    const response = await getAnthropic().messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      messages: [{ role: 'user', content: prompt }],
    })
    const text = response.content[0].type === 'text' ? response.content[0].text : '{}'
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim())
    return {
      content: typeof parsed.content === 'string' ? parsed.content : '',
      hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags.filter((h: unknown) => typeof h === 'string') : [],
    }
  } catch {
    return {
      content: '',
      hashtags: [],
    }
  }
}

/**
 * Phase 2 (Social Growth) — standalone hashtag generator, for when the
 * operator already has caption copy (written by hand, or pulled from a
 * template) and just wants fresh tags for it, rather than regenerating the
 * whole post via generateSocialPostDraft above.
 */
export async function generateHashtags(platform: string, topicOrCaption: string): Promise<string[]> {
  const guidance = PLATFORM_GUIDANCE[platform] || PLATFORM_GUIDANCE.facebook
  const prompt = `You are a social media strategist for BookMySpaces, a premium hospitality venue (rooftop events, private dining, room stays) in Kolkata, India, and its property Monurama Homestay.

Platform: ${platform}
Style guidance: ${guidance}
Post topic or caption: ${topicOrCaption}

Respond with ONLY a valid JSON array of 3-8 hashtags (no # symbol, no spaces within a tag, lowercase), mixing venue/location tags with the topic's theme. No markdown fences, no other text — just the array, e.g. ["kolkatawedding","rooftopvenue"].`

  try {
    const response = await getAnthropic().messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }],
    })
    const text = response.content[0].type === 'text' ? response.content[0].text : '[]'
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim())
    return Array.isArray(parsed) ? parsed.filter((h: unknown) => typeof h === 'string') : []
  } catch {
    return []
  }
}

export interface ImagePromptResult {
  prompt: string
}

/**
 * Phase 2 (Social Growth) — AI Image Prompt Generator. Does NOT call an
 * image-generation model itself (no such provider is wired into this
 * codebase) — it drafts a ready-to-use prompt string the operator pastes
 * into whatever image tool they use (Midjourney/DALL-E/Canva AI/etc.),
 * matching this build's "credential-ready, not live" posture: no image
 * provider credentials exist in this environment, so this stays one step
 * short of actually generating pixels rather than faking that capability.
 */
export async function generateImagePrompt(platform: string, goal: string, context?: string): Promise<ImagePromptResult> {
  const prompt = `You are an art director drafting an AI image-generation prompt for a social media post.

Business: BookMySpaces — a premium hospitality venue (rooftop events, private dining, room stays) in Kolkata, India, and its property Monurama Homestay.
Platform: ${platform}
Post goal: ${goal}
${context ? `Additional context: ${context}` : ''}

Write ONE image-generation prompt (for tools like Midjourney/DALL-E), 1-3 sentences, describing: subject, setting/mood, lighting, composition, style (e.g. "warm golden-hour photography, shallow depth of field"). Be concrete and visual. Respond with ONLY the prompt text, no quotes, no markdown, no preamble.`

  try {
    const response = await getAnthropic().messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 250,
      messages: [{ role: 'user', content: prompt }],
    })
    const text = response.content[0].type === 'text' ? response.content[0].text.trim() : ''
    return { prompt: text }
  } catch {
    return { prompt: '' }
  }
}
