// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/reviews.ts
// Growth Engine Epic 1 — Review Engine.
//
// AI reply drafting reuses the exact direct-Anthropic-client pattern already
// established in src/lib/campaigns.ts / src/lib/social/content-generator.ts
// (own dedicated prompt, no ai-provider.ts — that wraps the guest chatbot's
// own system prompt and is the wrong tool here). Analytics reuses the
// "fetch once, reduce in JS" contract from revenue-intelligence.ts.
//
// NO EXTERNAL REVIEW API: this system has no Google/Meta review-fetching
// integration (explicitly out of scope for this phase). Every `reviews` row
// is entered manually by an operator via POST /api/reviews after they see
// the review on the actual platform — this file does not pretend otherwise.
// ─────────────────────────────────────────────────────────────────────────────

import Anthropic from '@anthropic-ai/sdk'
import { getSupabaseAdmin } from '@/lib/supabase'

let _anthropic: Anthropic | null = null
function getAnthropic() {
  if (!_anthropic) _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || '' })
  return _anthropic
}

export async function generateReviewReplyDraft(params: {
  rating: number | null
  content: string | null
  authorName?: string | null
}): Promise<string> {
  const prompt = `You are replying, on behalf of BookMySpaces (a premium hospitality venue in Kolkata), to a guest review.

Reviewer: ${params.authorName || 'a guest'}
Rating: ${params.rating !== null ? `${params.rating}/5` : 'not given'}
Review text: ${params.content || '(no text provided)'}

Write a short, warm, genuine reply (2-4 sentences):
- If the rating is 4-5: thank them warmly, mention something specific from their review if possible.
- If the rating is 3 or below, or the text mentions a problem: apologize sincerely, do not be defensive, invite them to contact us directly to make it right (phone 9051459463), without being generic.
- Sign off naturally as "Team BookMySpaces" or similar.
- No emojis in excess (0-2 max). No markdown.

Return ONLY the reply text, no preamble.`

  try {
    const response = await getAnthropic().messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 250,
      messages: [{ role: 'user', content: prompt }],
    })
    return response.content[0].type === 'text'
      ? response.content[0].text.trim()
      : 'Thank you so much for your feedback — we truly appreciate you taking the time to share it. — Team BookMySpaces'
  } catch {
    return 'Thank you so much for your feedback — we truly appreciate you taking the time to share it. — Team BookMySpaces'
  }
}

interface ReviewRow {
  id: string
  platform: string
  rating: number | null
  response_status: string
  review_date: string | null
}

interface ReviewRequestRow {
  id: string
  status: string
  requested_at: string
}

export interface ReviewAnalytics {
  totalReviews: number
  avgRating: number | null
  ratingDistribution: Record<string, number> // '1'..'5' -> count
  byPlatform: Array<{ platform: string; count: number; avgRating: number | null }>
  responseRatePct: number // reviews with response_status in (approved, posted) / total
  requests: {
    total: number
    requested: number
    reminded: number
    completed: number
    declined: number
    requestToReviewPct: number // completed / total
  }
}

// Bounded, two-query, in-memory aggregation — same performance contract as
// revenue-intelligence.ts (fetch once, reduce in JS), not per-row queries.
export async function computeReviewAnalytics(): Promise<ReviewAnalytics> {
  const db = getSupabaseAdmin()
  const [reviewsResult, requestsResult] = await Promise.all([
    db.from('reviews').select('id, platform, rating, response_status, review_date'),
    db.from('review_requests').select('id, status, requested_at'),
  ])

  const reviews = (reviewsResult.data ?? []) as unknown as ReviewRow[]
  const requests = (requestsResult.data ?? []) as unknown as ReviewRequestRow[]

  const rated = reviews.filter((r) => r.rating !== null)
  const avgRating = rated.length > 0
    ? Math.round((rated.reduce((s, r) => s + (r.rating ?? 0), 0) / rated.length) * 10) / 10
    : null

  const ratingDistribution: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 }
  for (const r of rated) {
    const bucket = String(Math.round(r.rating!))
    if (ratingDistribution[bucket] !== undefined) ratingDistribution[bucket]++
  }

  const platformMap = new Map<string, { count: number; ratingSum: number; ratingCount: number }>()
  for (const r of reviews) {
    if (!platformMap.has(r.platform)) platformMap.set(r.platform, { count: 0, ratingSum: 0, ratingCount: 0 })
    const b = platformMap.get(r.platform)!
    b.count++
    if (r.rating !== null) { b.ratingSum += r.rating; b.ratingCount++ }
  }
  const byPlatform = Array.from(platformMap.entries()).map(([platform, b]) => ({
    platform,
    count: b.count,
    avgRating: b.ratingCount > 0 ? Math.round((b.ratingSum / b.ratingCount) * 10) / 10 : null,
  }))

  const respondedCount = reviews.filter((r) => r.response_status === 'approved' || r.response_status === 'posted').length
  const responseRatePct = reviews.length > 0 ? Math.round((respondedCount / reviews.length) * 1000) / 10 : 0

  const requestedCount = requests.filter((r) => r.status === 'requested').length
  const remindedCount = requests.filter((r) => r.status === 'reminded').length
  const completedCount = requests.filter((r) => r.status === 'completed').length
  const declinedCount = requests.filter((r) => r.status === 'declined').length

  return {
    totalReviews: reviews.length,
    avgRating,
    ratingDistribution,
    byPlatform,
    responseRatePct,
    requests: {
      total: requests.length,
      requested: requestedCount,
      reminded: remindedCount,
      completed: completedCount,
      declined: declinedCount,
      requestToReviewPct: requests.length > 0 ? Math.round((completedCount / requests.length) * 1000) / 10 : 0,
    },
  }
}
