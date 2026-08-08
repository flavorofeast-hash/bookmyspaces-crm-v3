// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/social/adapters/meta-adapter.ts
// V3 Phase 5 — Facebook + Instagram adapter (Meta Graph API).
//
// CREDENTIAL-READY, NOT LIVE: BookMySpaces has no Meta app credentials for
// Pages/IG in this environment. Everything that talks to Graph is gated by
// isConfigured(); until META_PAGE_ACCESS_TOKEN (+ page/app ids) exist in
// env, real calls return ok:false with a clear reason instead of throwing.
// Webhook verification reuses the exact HMAC approach already proven in
// the WhatsApp webhook (src/lib/whatsapp/verify-signature.ts pattern) —
// Meta signs all its webhooks the same way (X-Hub-Signature-256 with the
// app secret).
//
// Required env when connecting for real:
//   META_APP_SECRET            — webhook signature verification
//   META_VERIFY_TOKEN          — GET hub.challenge handshake
//   META_PAGE_ACCESS_TOKEN     — Page/IG Graph calls
//   META_PAGE_ID / META_IG_ID  — target account ids
// ─────────────────────────────────────────────────────────────────────────────

import crypto from 'crypto'
import type {
  SocialAdapter, SocialPlatform, NormalizedInteraction, PublishInput,
  PublishResult, ReplyResult, MetricsResult, PublishCredentials,
} from '@/lib/social/types'

const GRAPH = 'https://graph.facebook.com/v23.0'

function notConfigured(): { ok: false; error: string } {
  return { ok: false, error: 'meta_not_configured: set META_PAGE_ACCESS_TOKEN / META_APP_SECRET env vars' }
}

export class MetaAdapter implements SocialAdapter {
  constructor(readonly platform: Extract<SocialPlatform, 'facebook' | 'instagram'>) {}

  isConfigured(): boolean {
    return Boolean(process.env.META_PAGE_ACCESS_TOKEN && process.env.META_APP_SECRET)
  }

  async verifyWebhook(req: Request, rawBody: string): Promise<boolean> {
    const appSecret = process.env.META_APP_SECRET
    if (!appSecret) return false
    const signature = req.headers.get('x-hub-signature-256')
    if (!signature?.startsWith('sha256=')) return false
    const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex')
    try {
      return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    } catch {
      return false
    }
  }

  // Meta webhook shape: { entry: [{ changes: [{ field, value }] }] }.
  // Comments/mentions arrive as field 'feed' (FB) or 'comments'/'mentions'
  // (IG). This parser is deliberately defensive — unknown shapes yield [].
  parseWebhook(payload: Record<string, unknown>): NormalizedInteraction[] {
    const out: NormalizedInteraction[] = []
    const entries = Array.isArray(payload.entry) ? payload.entry : []
    for (const entry of entries) {
      const changes = Array.isArray((entry as Record<string, unknown>).changes)
        ? ((entry as Record<string, unknown>).changes as Record<string, unknown>[])
        : []
      for (const change of changes) {
        const field = String(change.field ?? '')
        const value = (change.value ?? {}) as Record<string, unknown>
        const item = String(value.item ?? '')
        const isComment = field === 'comments' || (field === 'feed' && item === 'comment')
        const isMention = field === 'mentions' || (field === 'feed' && item === 'mention')
        if (!isComment && !isMention) continue

        const from = (value.from ?? {}) as Record<string, unknown>
        const externalId = String(value.comment_id ?? value.id ?? '')
        if (!externalId) continue

        out.push({
          platform: this.platform,
          interactionType: isMention ? 'mention' : 'comment',
          externalId,
          externalParentId: value.post_id ? String(value.post_id) : null,
          authorName: from.name ? String(from.name) : null,
          authorExternalId: from.id ? String(from.id) : null,
          content: value.message ? String(value.message) : value.text ? String(value.text) : null,
          rawPayload: value,
        })
      }
    }
    return out
  }

  async publishPost(input: PublishInput, credentials?: PublishCredentials): Promise<PublishResult> {
    // OAuth-connected account's stored token/page id take priority over the
    // static env fallback — see PublishCredentials header comment (types.ts).
    // Meta is the one platform where the connected identity IS the correct
    // publish target (fetchConnectedIdentity stores the Page id / IG business
    // account id, and the Page Access Token, exactly what publishing needs).
    const accessToken = credentials?.accessToken ?? process.env.META_PAGE_ACCESS_TOKEN
    if (!accessToken) return notConfigured()
    const pageId = credentials?.externalAccountId ?? (this.platform === 'facebook' ? process.env.META_PAGE_ID : process.env.META_IG_ID)
    if (!pageId) return { ok: false, error: `meta_not_configured: missing ${this.platform === 'facebook' ? 'META_PAGE_ID' : 'META_IG_ID'}` }

    try {
      // Text/photo publish — the minimal viable surface; reels/stories need
      // the two-step container flow and are added when credentials exist to
      // test against.
      const url = this.platform === 'facebook'
        ? `${GRAPH}/${pageId}/feed`
        : `${GRAPH}/${pageId}/media`
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: input.content ?? '',
          ...(input.media[0]?.url ? { url: input.media[0].url, image_url: input.media[0].url } : {}),
          access_token: accessToken,
        }),
      })
      const json = (await res.json()) as { id?: string; error?: { message?: string } }
      if (!res.ok || !json.id) return { ok: false, error: json.error?.message ?? `graph_error_${res.status}` }
      return { ok: true, externalPostId: json.id }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  async replyToInteraction(externalId: string, message: string): Promise<ReplyResult> {
    if (!this.isConfigured()) return notConfigured()
    try {
      const res = await fetch(`${GRAPH}/${externalId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, access_token: process.env.META_PAGE_ACCESS_TOKEN }),
      })
      const json = (await res.json()) as { id?: string; error?: { message?: string } }
      if (!res.ok || !json.id) return { ok: false, error: json.error?.message ?? `graph_error_${res.status}` }
      return { ok: true, externalReplyId: json.id }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  // FB posts and IG media use different Insights metric names. Both are
  // requested from the same /{id}/insights endpoint; reactions/comments/
  // shares on FB come back from the plain object fields (not insights) so
  // they're fetched in one combined call with `fields=`.
  async fetchEngagementMetrics(externalPostId: string): Promise<MetricsResult> {
    if (!this.isConfigured()) return notConfigured()
    const token = process.env.META_PAGE_ACCESS_TOKEN
    try {
      if (this.platform === 'facebook') {
        const metricNames = ['post_impressions', 'post_impressions_unique', 'post_clicks']
        const [objRes, insightsRes] = await Promise.all([
          fetch(`${GRAPH}/${externalPostId}?fields=shares,reactions.summary(true),comments.summary(true)&access_token=${token}`),
          fetch(`${GRAPH}/${externalPostId}/insights?metric=${metricNames.join(',')}&access_token=${token}`),
        ])
        const obj = (await objRes.json()) as {
          shares?: { count?: number }; reactions?: { summary?: { total_count?: number } };
          comments?: { summary?: { total_count?: number } }; error?: { message?: string }
        }
        const insights = (await insightsRes.json()) as { data?: { name: string; values: { value: number }[] }[]; error?: { message?: string } }
        if (!objRes.ok || obj.error) return { ok: false, error: obj.error?.message ?? `graph_error_${objRes.status}` }
        const byName = (name: string) => insights.data?.find((d) => d.name === name)?.values?.[0]?.value
        return {
          ok: true,
          metrics: {
            impressions: byName('post_impressions') ?? null,
            reach: byName('post_impressions_unique') ?? null,
            clicks: byName('post_clicks') ?? null,
            likes: obj.reactions?.summary?.total_count ?? null,
            comments: obj.comments?.summary?.total_count ?? null,
            shares: obj.shares?.count ?? null,
            saves: null, // not exposed for FB page posts
          },
        }
      }

      // Instagram media
      const igMetrics = ['impressions', 'reach', 'likes', 'comments', 'saved', 'shares']
      const res = await fetch(`${GRAPH}/${externalPostId}/insights?metric=${igMetrics.join(',')}&access_token=${token}`)
      const json = (await res.json()) as { data?: { name: string; values: { value: number }[] }[]; error?: { message?: string } }
      if (!res.ok || json.error) return { ok: false, error: json.error?.message ?? `graph_error_${res.status}` }
      const byName = (name: string) => json.data?.find((d) => d.name === name)?.values?.[0]?.value
      return {
        ok: true,
        metrics: {
          impressions: byName('impressions') ?? null,
          reach: byName('reach') ?? null,
          clicks: null, // not an IG media insight metric
          likes: byName('likes') ?? null,
          comments: byName('comments') ?? null,
          shares: byName('shares') ?? null,
          saves: byName('saved') ?? null,
        },
      }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }
}
