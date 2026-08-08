// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/social/adapters/linkedin-adapter.ts
// Phase 2 (Social Growth) — LinkedIn adapter (LinkedIn Marketing API /
// Community Management API for organization posts).
//
// CREDENTIAL-READY, NOT LIVE — same posture as meta-adapter.ts's own header
// comment: BookMySpaces has no LinkedIn app credentials in this environment.
// Every method is gated by isConfigured(); until credentials exist, real
// calls return ok:false with a clear reason instead of throwing or
// fabricating a result. `linkedin` was already a valid SocialPlatform enum
// value (migration 014) with no adapter registered — this file fills that
// gap in adapter-registry.ts.
//
// Required env when connecting for real:
//   LINKEDIN_ACCESS_TOKEN     — organization-scoped access token
//   LINKEDIN_ORGANIZATION_URN — e.g. "urn:li:organization:12345"
// ─────────────────────────────────────────────────────────────────────────────

import type {
  SocialAdapter, NormalizedInteraction, PublishInput,
  PublishResult, ReplyResult, MetricsResult, PublishCredentials,
} from '@/lib/social/types'

const API = 'https://api.linkedin.com/v2'

function notConfigured(): { ok: false; error: string } {
  return { ok: false, error: 'linkedin_not_configured: set LINKEDIN_ACCESS_TOKEN / LINKEDIN_ORGANIZATION_URN env vars' }
}

export class LinkedInAdapter implements SocialAdapter {
  readonly platform = 'linkedin' as const

  isConfigured(): boolean {
    return Boolean(process.env.LINKEDIN_ACCESS_TOKEN && process.env.LINKEDIN_ORGANIZATION_URN)
  }

  // LinkedIn does not sign webhooks the way Meta/WhatsApp do — Community
  // Management API webhooks are not part of this build (comments/mentions
  // ingestion is a future step once an app is actually registered). Always
  // false until then, which keeps the webhook route's "not configured"
  // response path exercised safely rather than silently accepting payloads.
  async verifyWebhook(): Promise<boolean> {
    return false
  }

  parseWebhook(): NormalizedInteraction[] {
    return []
  }

  async publishPost(input: PublishInput, credentials?: PublishCredentials): Promise<PublishResult> {
    // OAuth-connected account's token takes priority over the static env
    // fallback. LINKEDIN_ORGANIZATION_URN stays env-configured regardless of
    // credentials source: fetchConnectedIdentity() stores the connected
    // MEMBER's identity (from /v2/userinfo), not the organization/Company
    // Page URN a post is authored as — a different concept (would need the
    // organizationAcls endpoint to resolve, not implemented today; see this
    // file's header comment).
    const accessToken = credentials?.accessToken ?? process.env.LINKEDIN_ACCESS_TOKEN
    if (!accessToken) return notConfigured()
    const author = process.env.LINKEDIN_ORGANIZATION_URN
    if (!author) return { ok: false, error: 'linkedin_not_configured: set LINKEDIN_ORGANIZATION_URN env var' }
    try {
      const res = await fetch(`${API}/ugcPosts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          'X-Restli-Protocol-Version': '2.0.0',
        },
        body: JSON.stringify({
          author,
          lifecycleState: 'PUBLISHED',
          specificContent: {
            'com.linkedin.ugc.ShareContent': {
              shareCommentary: { text: input.content ?? '' },
              shareMediaCategory: input.media.length > 0 ? 'IMAGE' : 'NONE',
            },
          },
          visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
        }),
      })
      if (!res.ok) {
        const errText = await res.text().catch(() => '')
        return { ok: false, error: `linkedin_error_${res.status}${errText ? `: ${errText.slice(0, 200)}` : ''}` }
      }
      const postId = res.headers.get('x-restli-id') || res.headers.get('X-RestLi-Id')
      if (!postId) return { ok: false, error: 'linkedin_error: no post id returned' }
      return { ok: true, externalPostId: postId }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  async replyToInteraction(): Promise<ReplyResult> {
    if (!this.isConfigured()) return notConfigured()
    // Comment-reply requires the Community Management API's social actions
    // endpoint, which needs its own approved app product — deferred until
    // credentials for it exist, per the "not live" scope of this build.
    return { ok: false, error: 'linkedin_reply_not_implemented: Community Management API access not yet provisioned' }
  }

  async fetchEngagementMetrics(): Promise<MetricsResult> {
    if (!this.isConfigured()) return notConfigured()
    // Org Social Metadata / Analytics API also requires the Community
    // Management API product — same deferral as replyToInteraction above.
    return { ok: false, error: 'linkedin_metrics_not_implemented: Community Management API access not yet provisioned' }
  }
}
