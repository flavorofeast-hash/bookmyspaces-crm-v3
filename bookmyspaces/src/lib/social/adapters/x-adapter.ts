// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/social/adapters/x-adapter.ts
// Phase 2 (Social Growth) — X (Twitter) adapter, X API v2.
//
// CREDENTIAL-READY, NOT LIVE — same posture as meta-adapter.ts. `x` was
// already a valid SocialPlatform enum value (migration 014) with no
// adapter registered — this file fills that gap.
//
// Required env when connecting for real:
//   X_ACCESS_TOKEN        — OAuth 2.0 user-context bearer token (posting
//                            scope: tweet.write)
//   X_APP_SECRET           — HMAC key for webhook (Account Activity API)
//                            signature verification, if/when subscribed
// ─────────────────────────────────────────────────────────────────────────────

import crypto from 'crypto'
import type {
  SocialAdapter, NormalizedInteraction, PublishInput,
  PublishResult, ReplyResult, MetricsResult,
} from '@/lib/social/types'

const API = 'https://api.twitter.com/2'

function notConfigured(): { ok: false; error: string } {
  return { ok: false, error: 'x_not_configured: set X_ACCESS_TOKEN env var' }
}

export class XAdapter implements SocialAdapter {
  readonly platform = 'x' as const

  isConfigured(): boolean {
    return Boolean(process.env.X_ACCESS_TOKEN)
  }

  // X Account Activity API (CRC challenge) signs with the app secret the
  // same HMAC-SHA256 way Meta does. Verified here for when a webhook
  // subscription actually exists; parseWebhook stays empty until then.
  async verifyWebhook(req: Request, rawBody: string): Promise<boolean> {
    const appSecret = process.env.X_APP_SECRET
    if (!appSecret) return false
    const signature = req.headers.get('x-twitter-webhooks-signature')
    if (!signature?.startsWith('sha256=')) return false
    const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody).digest('base64')
    try {
      return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    } catch {
      return false
    }
  }

  parseWebhook(): NormalizedInteraction[] {
    // Account Activity API subscription not provisioned yet — no shape to
    // parse against. Returns [] defensively rather than guessing a schema.
    return []
  }

  async publishPost(input: PublishInput): Promise<PublishResult> {
    if (!this.isConfigured()) return notConfigured()
    try {
      const res = await fetch(`${API}/tweets`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.X_ACCESS_TOKEN}`,
        },
        body: JSON.stringify({ text: input.content ?? '' }),
      })
      const json = (await res.json()) as { data?: { id?: string }; errors?: { message?: string }[]; title?: string }
      if (!res.ok || !json.data?.id) {
        return { ok: false, error: json.errors?.[0]?.message ?? json.title ?? `x_error_${res.status}` }
      }
      return { ok: true, externalPostId: json.data.id }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  async replyToInteraction(externalId: string, message: string): Promise<ReplyResult> {
    if (!this.isConfigured()) return notConfigured()
    try {
      const res = await fetch(`${API}/tweets`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.X_ACCESS_TOKEN}`,
        },
        body: JSON.stringify({ text: message, reply: { in_reply_to_tweet_id: externalId } }),
      })
      const json = (await res.json()) as { data?: { id?: string }; errors?: { message?: string }[]; title?: string }
      if (!res.ok || !json.data?.id) {
        return { ok: false, error: json.errors?.[0]?.message ?? json.title ?? `x_error_${res.status}` }
      }
      return { ok: true, externalReplyId: json.data.id }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  async fetchEngagementMetrics(externalPostId: string): Promise<MetricsResult> {
    if (!this.isConfigured()) return notConfigured()
    try {
      const res = await fetch(
        `${API}/tweets/${externalPostId}?tweet.fields=public_metrics`,
        { headers: { Authorization: `Bearer ${process.env.X_ACCESS_TOKEN}` } }
      )
      const json = (await res.json()) as {
        data?: { public_metrics?: { impression_count?: number; like_count?: number; reply_count?: number; retweet_count?: number; bookmark_count?: number } }
        errors?: { message?: string }[]
      }
      if (!res.ok || !json.data) return { ok: false, error: json.errors?.[0]?.message ?? `x_error_${res.status}` }
      const m = json.data.public_metrics ?? {}
      return {
        ok: true,
        metrics: {
          impressions: m.impression_count ?? null,
          reach: null, // X public_metrics has no distinct "reach" figure
          clicks: null, // link-click counts require Ads API, not available here
          likes: m.like_count ?? null,
          comments: m.reply_count ?? null,
          shares: m.retweet_count ?? null,
          saves: m.bookmark_count ?? null,
        },
      }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }
}
