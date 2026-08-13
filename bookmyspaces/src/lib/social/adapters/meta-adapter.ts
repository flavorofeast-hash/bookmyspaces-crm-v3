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
  PublishResult, ReplyResult,
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

  async publishPost(input: PublishInput): Promise<PublishResult> {
    if (!this.isConfigured()) return notConfigured()
    const accessToken = process.env.META_PAGE_ACCESS_TOKEN
    const mediaUrl = input.media[0]?.url

    try {
      if (this.platform === 'facebook') {
        const pageId = process.env.META_PAGE_ID
        if (!pageId) return { ok: false, error: 'meta_not_configured: missing META_PAGE_ID' }

        // Page feed publish: text-only posts go to /feed (message param).
        // Posts with an image go to /photos (url + caption) — /feed has no
        // image-attachment param; passing url/image_url there is silently
        // ignored by Graph and only the text would ever post.
        const url = mediaUrl ? `${GRAPH}/${pageId}/photos` : `${GRAPH}/${pageId}/feed`
        const body: Record<string, unknown> = mediaUrl
          ? { url: mediaUrl, caption: input.content ?? '', access_token: accessToken }
          : { message: input.content ?? '', access_token: accessToken }

        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        const json = (await res.json()) as { id?: string; post_id?: string; error?: { message?: string } }
        const externalPostId = json.post_id ?? json.id
        if (!res.ok || !externalPostId) return { ok: false, error: json.error?.message ?? `graph_error_${res.status}` }
        return { ok: true, externalPostId }
      }

      // Instagram Content Publishing API is always two-step, even for a
      // single image: create a media container, then publish that
      // container's creation_id. There is no one-call publish endpoint.
      const igId = process.env.META_IG_ID
      if (!igId) return { ok: false, error: 'meta_not_configured: missing META_IG_ID' }
      if (!mediaUrl) return { ok: false, error: 'instagram_requires_media: Instagram posts require at least one image or video URL' }

      const isVideo = input.media[0]?.type?.startsWith('video') || input.postType === 'video' || input.postType === 'reel'
      const containerBody: Record<string, unknown> = {
        caption: input.content ?? '',
        access_token: accessToken,
        ...(isVideo
          ? { video_url: mediaUrl, media_type: input.postType === 'reel' ? 'REELS' : 'VIDEO' }
          : { image_url: mediaUrl }),
      }
      const createRes = await fetch(`${GRAPH}/${igId}/media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(containerBody),
      })
      const createJson = (await createRes.json()) as { id?: string; error?: { message?: string } }
      if (!createRes.ok || !createJson.id) return { ok: false, error: createJson.error?.message ?? `graph_error_${createRes.status}` }

      const publishRes = await fetch(`${GRAPH}/${igId}/media_publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creation_id: createJson.id, access_token: accessToken }),
      })
      const publishJson = (await publishRes.json()) as { id?: string; error?: { message?: string } }
      if (!publishRes.ok || !publishJson.id) return { ok: false, error: publishJson.error?.message ?? `graph_error_${publishRes.status}` }
      return { ok: true, externalPostId: publishJson.id }
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
}
