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

export interface SocialAdapter {
  readonly platform: SocialPlatform
  /** True when env/config credentials exist — gates every real API call. */
  isConfigured(): boolean
  /** Verify an incoming webhook (signature/challenge). */
  verifyWebhook(req: Request, rawBody: string): Promise<boolean>
  /** Parse a webhook payload into zero or more normalized interactions. */
  parseWebhook(payload: Record<string, unknown>): NormalizedInteraction[]
  /** Publish a post. Must return ok:false (not throw) when unconfigured. */
  publishPost(input: PublishInput): Promise<PublishResult>
  /** Reply to a comment/mention. Must return ok:false when unconfigured. */
  replyToInteraction(externalId: string, message: string): Promise<ReplyResult>
}
