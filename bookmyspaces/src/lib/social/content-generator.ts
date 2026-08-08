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

// Sprint 2 (AI Content Studio) — length/tone variants. Additive to the
// existing single-shot generator: same prompt/parse plumbing, one more
// guidance line appended when a variant other than 'standard' is picked.
export type ContentVariant = 'standard' | 'short' | 'long' | 'emoji'

const VARIANT_GUIDANCE: Record<Exclude<ContentVariant, 'standard'>, string> = {
  short: 'Make this the SHORT version: one punchy sentence plus a call to action, as brief as the platform allows.',
  long: 'Make this the LONG version: a longer-form mini-story (roughly double the usual length for this platform), still ending with a clear call to action.',
  emoji: 'Make this the EMOJI version: use relevant emojis liberally throughout the copy (not just at the end) while keeping it readable.',
}

// Sprint 2 (AI Content Studio) — content template categories. Purely a
// prompt-guidance preset (no new table, no new enum column) — the operator
// picks one to steer tone/theme for a specific occasion; the underlying
// generator/JSON-shape/parse logic is unchanged.
export type ContentTemplateCategory =
  | 'wedding' | 'birthday' | 'corporate' | 'rooftop' | 'restaurant' | 'weekend_stay' | 'festival' | 'offer'

const TEMPLATE_GUIDANCE: Record<ContentTemplateCategory, string> = {
  wedding: 'Theme: wedding/reception venue. Evoke romance, celebration, and the venue as the setting for a couple\'s big day.',
  birthday: 'Theme: birthday celebration. Fun, festive, celebratory tone; mention decoration/cake/party vibes where relevant.',
  corporate: 'Theme: corporate/business events (conferences, seminars, team offsites). Professional, emphasizes reliability, AV/facilities, and hospitality quality for business guests.',
  rooftop: 'Theme: rooftop venue/experience. Emphasize skyline views, open-air ambience, evening/sunset appeal.',
  restaurant: 'Theme: dining/restaurant experience. Emphasize cuisine, ambience, and the dining experience itself.',
  weekend_stay: 'Theme: weekend getaway/room stay. Emphasize relaxation, a short escape, and room/property amenities.',
  festival: 'Theme: a festival/seasonal occasion (e.g. Durga Puja, Diwali, Christmas, New Year). Tie the offer/venue to the festive season and its traditions.',
  offer: 'Theme: a limited-time offer/discount/package deal. Create urgency (without being pushy) and lead with the concrete value/saving.',
}

export interface SocialPostDraft {
  content: string
  hashtags: string[]
  /** Optional short headline/title, separate from the body copy — populated when the model returns one; empty string if not applicable for the platform. */
  title: string
  /** Optional standalone call-to-action line, separate from the body copy. */
  cta: string
}

export interface GenerateDraftOptions {
  variant?: ContentVariant
  template?: ContentTemplateCategory
}

/**
 * Drafts platform-appropriate social copy + hashtags for a given goal
 * (e.g. "promote our Durga Puja banquet package", "announce weekend
 * availability"). Pure draft — the operator reviews/edits in Content
 * Studio before saving as a draft/scheduled post; never posts anything
 * itself (publishing is a separate, human-approved step — see
 * publish-service.ts).
 *
 * Sprint 2 (AI Content Studio) additive extension: `options.variant`
 * (short/long/emoji, default 'standard') and `options.template` (occasion
 * preset) steer the SAME prompt/JSON-parse pipeline — no second generator
 * function, no duplicated Anthropic call.
 */
export async function generateSocialPostDraft(
  platform: string,
  goal: string,
  context?: string,
  options?: GenerateDraftOptions
): Promise<SocialPostDraft> {
  const guidance = PLATFORM_GUIDANCE[platform] || PLATFORM_GUIDANCE.facebook
  const variant = options?.variant && options.variant !== 'standard' ? VARIANT_GUIDANCE[options.variant] : null
  const template = options?.template ? TEMPLATE_GUIDANCE[options.template] : null

  const prompt = `You are a social media copywriter for BookMySpaces, a premium hospitality venue (rooftop events, private dining, room stays) in Kolkata, India, and its property Monurama Homestay.

Platform: ${platform}
Style guidance for this platform: ${guidance}
Post goal: ${goal}
${context ? `Additional context: ${context}` : ''}
${template ? `Content theme: ${template}` : ''}
${variant ? `Length/tone instruction: ${variant}` : ''}

Respond with ONLY valid JSON, no markdown fences, in exactly this shape:
{
  "title": "a short headline/title for this post, or an empty string if this platform/format doesn't use a separate title (e.g. Instagram/X usually don't)",
  "content": "the post caption/copy text, matching the platform style guidance above",
  "cta": "a short, standalone call-to-action line (e.g. 'DM us to book your date!'), or an empty string if the CTA is already woven into content",
  "hashtags": ["hashtag1", "hashtag2", "hashtag3"]
}

Hashtags: 3-6 relevant tags (no # symbol, no spaces within a tag), mixing venue/location tags (e.g. kolkatawedding, rooftopvenue) with the goal's theme. Fewer, more relevant hashtags for LinkedIn/Google Business; more are fine for Instagram.`

  try {
    const response = await getAnthropic().messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
    })
    const text = response.content[0].type === 'text' ? response.content[0].text : '{}'
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim())
    return {
      content: typeof parsed.content === 'string' ? parsed.content : '',
      hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags.filter((h: unknown) => typeof h === 'string') : [],
      title: typeof parsed.title === 'string' ? parsed.title : '',
      cta: typeof parsed.cta === 'string' ? parsed.cta : '',
    }
  } catch {
    return {
      content: '',
      hashtags: [],
      title: '',
      cta: '',
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

export interface InteractionReplySuggestion {
  reply: string
}

/**
 * Sprint 3 (Social CRM) — AI-suggested reply for a Unified Social Inbox
 * interaction (comment/mention/review). Operator reviews/edits before
 * sending — same human-approval rule as every other customer-facing AI
 * output in this codebase (DEVELOPER_HANDBOOK.md §6: "no autonomous
 * customer-facing sends, ever"). Reuses this file's existing direct-
 * Anthropic-client pattern (operator-facing marketing/social copy), not
 * ai-provider.ts's customer-facing chatWithAI() and not operator-
 * assistant.ts's runOperatorAssist() — that action is built around a full
 * per-customer AIContext (reservation/proposal history etc.) which a
 * public commenter who isn't yet a resolved lead won't have.
 */
export async function generateInteractionReplySuggestion(
  platform: string,
  interactionType: string,
  content: string | null,
  intent: string | null
): Promise<InteractionReplySuggestion> {
  const prompt = `You are a social media community manager for BookMySpaces, a premium hospitality venue (rooftop events, private dining, room stays) in Kolkata, India, and its property Monurama Homestay.

Platform: ${platform}
Interaction type: ${interactionType}
Detected intent: ${intent ?? 'unclassified'}
Original message: "${content ?? ''}"

Draft a short, warm, on-brand reply (1-3 sentences) the operator can review and post as-is or edit. If this looks like a complaint, be empathetic and invite them to continue over WhatsApp/DM/phone for resolution rather than debating in public. If this looks like an enquiry or booking intent, invite them to DM/WhatsApp for pricing and availability rather than quoting a price publicly. Respond with ONLY the reply text, no quotes, no markdown, no preamble.`

  try {
    const response = await getAnthropic().messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }],
    })
    const text = response.content[0].type === 'text' ? response.content[0].text.trim() : ''
    return { reply: text }
  } catch {
    return { reply: '' }
  }
}
