// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/social/types.ts
// V3 Phase 5 — Social Media Command Center: adapter contract + shared types.
//
// Every platform integration implements SocialAdapter. The CRM core only
// ever talks to this interface — adding X/YouTube/Threads later means one
// new adapter file registered in adapter-registry.ts, nothing else.
//
// DMs are NOT part of this interface: platform DMs flow through the
// unified conversation platform (ingestInboundMessage) like every other
// messaging channel. This interface covers the public-surface half:
// comments, mentions, reviews, publishing.
// ─────────────────────────────────────────────────────────────────────────────

export type SocialPlatform =
  | 'facebook' | 'instagram' | 'linkedin' | 'google_business' | 'x' | 'youtube' | 'threads'

export type SocialInteractionType = 'comment' | 'mention' | 'review' | 'story_reply' | 'post_reply'

export interface NormalizedInteraction {
  platform: SocialPlatform
  interactionType: SocialInteractionType
  externalId: string
  externalParentId?: string | null
  authorName?: string | null
  authorExternalId?: string | null
  content: string | null
  occurredAt?: string | null
  rawPayload?: Record<string, unknown>
}

export interface PublishInput {
  postType: 'text' | 'image' | 'carousel' | 'video' | 'reel' | 'story'
  content: string | null
  media: { url: string; type: string; alt?: string }[]
}

// Social OAuth -> Publishing credential fix. Resolved from an OAuth-connected
// social_accounts row (see resolvePublishCredentials() in
// src/lib/social/oauth/refresh-service.ts) and passed to publishPost() so the
// adapter uses the SPECIFIC connected account's token instead of a static
// env var. externalAccountId is the page id / IG business account id for
// platforms where the stored connected identity IS the correct publish
// target (Meta); it is null for platforms where posting target is a
// different concept than the connected identity (LinkedIn's organization
// page vs. the connected member, Google Business's location vs. account) —
// those keep their existing env-configured target, only the token moves.
export interface PublishCredentials {
  accessToken: string
  externalAccountId: string | null
}

export interface PublishResult {
  ok: boolean
  externalPostId?: string
  error?: string
}

export interface ReplyResult {
  ok: boolean
  externalReplyId?: string
  error?: string
}

// Phase 2 (Social Growth) — Engagement Analytics. Every field is nullable:
// a platform's Insights/Analytics API may not expose all of them (e.g. X
// has no "saves" concept), and an unconfigured adapter returns ok:false
// rather than fabricated zeros — NULL means "not measured", not "zero".
export interface PostMetrics {
  reach?: number | null
  impressions?: number | null
  clicks?: number | null
  likes?: number | null
  comments?: number | null
  shares?: number | null
  saves?: number | null
}

export interface MetricsResult {
  ok: boolean
  metrics?: PostMetrics
  error?: string
}

export interface SocialAdapter {
  readonly platform: SocialPlatform
  /** True when env/config credentials exist — gates every real API call. */
  isConfigured(): boolean
  /** Verify an incoming webhook (signature/challenge). */
  verifyWebhook(req: Request, rawBody: string): Promise<boolean>
  /** Parse a webhook payload into zero or more normalized interactions. */
  parseWebhook(payload: Record<string, unknown>): NormalizedInteraction[]
  /** Publish a post. `credentials`, when provided (an OAuth-connected account was selected for this post), takes priority over any static env-var token. Must return ok:false (not throw) when unconfigured. */
  publishPost(input: PublishInput, credentials?: PublishCredentials): Promise<PublishResult>
  /** Reply to a comment/mention. Must return ok:false when unconfigured. */
  replyToInteraction(externalId: string, message: string): Promise<ReplyResult>
  /** Fetch reach/impressions/likes/etc. for a published post. Must return ok:false (not throw, not fabricate) when unconfigured. */
  fetchEngagementMetrics(externalPostId: string): Promise<MetricsResult>
}
