// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/social/adapters/google-business-adapter.ts
// Phase 2 (Social Growth) — Google Business Profile adapter (Business
// Profile API: My Business Business Information + Performance APIs).
//
// CREDENTIAL-READY, NOT LIVE — same posture as meta-adapter.ts.
// `google_business` was already a valid SocialPlatform enum value
// (migration 014) with no adapter registered — this file fills that gap.
// Google Business Profile has no comment/mention webhook surface (reviews
// are handled by the existing separate Review Engine, migration 033/034 —
// NOT this adapter's parseWebhook), so verifyWebhook/parseWebhook are
// intentionally inert here.
//
// Required env when connecting for real:
//   GOOGLE_BUSINESS_ACCESS_TOKEN — OAuth 2.0 access token (refreshed
//                                  out-of-band; this adapter does not
//                                  manage the refresh-token flow itself)
//   GOOGLE_BUSINESS_LOCATION_ID  — "accounts/{accountId}/locations/{id}"
// ─────────────────────────────────────────────────────────────────────────────

import type {
  SocialAdapter, NormalizedInteraction, PublishInput,
  PublishResult, ReplyResult, MetricsResult,
} from '@/lib/social/types'

const MYBUSINESS_API = 'https://mybusinessbusinessinformation.googleapis.com/v1'
const PERFORMANCE_API = 'https://businessprofileperformance.googleapis.com/v1'

function notConfigured(): { ok: false; error: string } {
  return { ok: false, error: 'google_business_not_configured: set GOOGLE_BUSINESS_ACCESS_TOKEN / GOOGLE_BUSINESS_LOCATION_ID env vars' }
}

export class GoogleBusinessAdapter implements SocialAdapter {
  readonly platform = 'google_business' as const

  isConfigured(): boolean {
    return Boolean(process.env.GOOGLE_BUSINESS_ACCESS_TOKEN && process.env.GOOGLE_BUSINESS_LOCATION_ID)
  }

  // No webhook surface for Business Profile posts (reviews come through
  // the Review Engine's own ingestion path, not this adapter).
  async verifyWebhook(): Promise<boolean> {
    return false
  }

  parseWebhook(): NormalizedInteraction[] {
    return []
  }

  async publishPost(input: PublishInput): Promise<PublishResult> {
    if (!this.isConfigured()) return notConfigured()
    const location = process.env.GOOGLE_BUSINESS_LOCATION_ID
    try {
      const res = await fetch(`${MYBUSINESS_API}/${location}/localPosts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.GOOGLE_BUSINESS_ACCESS_TOKEN}`,
        },
        body: JSON.stringify({
          languageCode: 'en-US',
          summary: input.content ?? '',
          topicType: 'STANDARD',
          ...(input.media[0]?.url
            ? { media: [{ mediaFormat: 'PHOTO', sourceUrl: input.media[0].url }] }
            : {}),
        }),
      })
      const json = (await res.json()) as { name?: string; error?: { message?: string } }
      if (!res.ok || !json.name) return { ok: false, error: json.error?.message ?? `gbp_error_${res.status}` }
      return { ok: true, externalPostId: json.name }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  async replyToInteraction(): Promise<ReplyResult> {
    // "Interactions" (comments/mentions) don't exist on Business Profile
    // posts the way they do on FB/IG — replying to a REVIEW is handled by
    // the Review Engine (src/lib/reviews.ts's generateReviewReplyDraft +
    // posting flow), not this adapter. Always a clear no-op here.
    return { ok: false, error: 'google_business_reply_not_applicable: use the Review Engine for review replies' }
  }

  async fetchEngagementMetrics(externalPostId: string): Promise<MetricsResult> {
    if (!this.isConfigured()) return notConfigured()
    try {
      // Business Profile Performance API reports per-location daily metrics
      // keyed by metric name, not per-post — closest available proxy is
      // BUSINESS_IMPRESSIONS_DESKTOP_SEARCH-style location metrics filtered
      // to the post's date range. Included for completeness once credentials
      // exist; today this always resolves through the ok:false branch below
      // in this sandbox (no live token).
      const location = process.env.GOOGLE_BUSINESS_LOCATION_ID
      const res = await fetch(
        `${PERFORMANCE_API}/${location}:fetchMultiDailyMetricsTimeSeries?dailyMetrics=BUSINESS_IMPRESSIONS_DESKTOP_SEARCH&dailyMetrics=BUSINESS_IMPRESSIONS_MOBILE_SEARCH&dailyMetrics=CALL_CLICKS&dailyMetrics=WEBSITE_CLICKS`,
        { headers: { Authorization: `Bearer ${process.env.GOOGLE_BUSINESS_ACCESS_TOKEN}` } }
      )
      const json = (await res.json()) as { multiDailyMetricTimeSeries?: unknown; error?: { message?: string } }
      if (!res.ok || json.error) return { ok: false, error: json.error?.message ?? `gbp_error_${res.status}` }
      // Post-specific engagement (likes/comments/shares) is not exposed by
      // this API at all — Business Profile posts don't carry those
      // concepts. Only impression-adjacent, location-level figures exist.
      void externalPostId
      return {
        ok: false,
        error: 'gbp_metrics_not_post_scoped: Business Profile Performance API reports location-level search/click metrics only, not per-post engagement',
      }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }
}
