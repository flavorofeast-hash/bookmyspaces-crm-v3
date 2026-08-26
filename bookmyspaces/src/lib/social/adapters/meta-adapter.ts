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
import { logger } from '@/lib/logger'
import { callGraphAPI } from '@/lib/social/graph-api-client'
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
    // Confirmed via live diagnostic (4/4 real Meta deliveries): a native-
    // Instagram-Login-connected account's webhooks are signed with the
    // Instagram Login product's own app secret (META_IG_LOGIN_APP_SECRET),
    // not the classic top-level App Secret (META_APP_SECRET) -- these are
    // two separate credential pairs under the same Meta app (see
    // instagram-native-config.ts's header). Facebook has no native-login
    // equivalent in this codebase, so it keeps using META_APP_SECRET.
    const appSecret = this.platform === 'instagram'
      ? (process.env.META_IG_LOGIN_APP_SECRET ?? process.env.META_APP_SECRET)
      : process.env.META_APP_SECRET
    if (!appSecret) {
      logger.warn('meta-adapter', `${this.platform} webhook signature not verified — no app secret configured`)
      return false
    }
    const signature = req.headers.get('x-hub-signature-256')
    if (!signature?.startsWith('sha256=')) {
      logger.warn('meta-adapter', `${this.platform} webhook rejected — missing/malformed x-hub-signature-256 header`)
      return false
    }
    // Compare raw digest bytes (hex-decoded), same as verify-signature.ts's
    // proven WhatsApp implementation -- not the "sha256="-prefixed strings
    // as UTF-8 text. Mathematically equivalent for a genuinely matching
    // signature, but this is the canonical form and rules out any
    // string-vs-binary comparison edge case definitively.
    const expected = crypto.createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex')
    const provided = signature.slice('sha256='.length)

    try {
      const expectedBuf = Buffer.from(expected, 'hex')
      const providedBuf = Buffer.from(provided, 'hex')
      if (expectedBuf.length !== providedBuf.length) {
        logger.warn('meta-adapter', `${this.platform} webhook rejected — signature length mismatch`)
        return false
      }
      const valid = crypto.timingSafeEqual(expectedBuf, providedBuf)
      if (!valid) logger.warn('meta-adapter', `${this.platform} webhook rejected — signature mismatch`)
      return valid
    } catch (err) {
      logger.error('meta-adapter', `${this.platform} webhook signature check threw`, err)
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

      const result = await callGraphAPI<{ id?: string; post_id?: string }>(
        url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
        mediaUrl ? 'publish-fb-photo' : 'publish-fb-feed'
      )
      const externalPostId = result.data?.post_id ?? result.data?.id
      if (!result.ok || !externalPostId) return { ok: false, error: result.error ?? 'graph_error_no_post_id' }
      logger.info('meta-adapter', 'Facebook post published', { externalPostId })
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
    const createResult = await callGraphAPI<{ id?: string }>(
      `${GRAPH}/${igId}/media`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(containerBody) },
      'publish-ig-create-container'
    )
    if (!createResult.ok || !createResult.data?.id) return { ok: false, error: createResult.error ?? 'graph_error_no_container_id' }

    const publishResult = await callGraphAPI<{ id?: string }>(
      `${GRAPH}/${igId}/media_publish`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ creation_id: createResult.data.id, access_token: accessToken }) },
      'publish-ig-media-publish'
    )
    if (!publishResult.ok || !publishResult.data?.id) return { ok: false, error: publishResult.error ?? 'graph_error_no_publish_id' }
    logger.info('meta-adapter', 'Instagram post published', { externalPostId: publishResult.data.id })
    return { ok: true, externalPostId: publishResult.data.id }
  }

  async replyToInteraction(externalId: string, message: string): Promise<ReplyResult> {
    if (!this.isConfigured()) return notConfigured()
    const result = await callGraphAPI<{ id?: string }>(
      `${GRAPH}/${externalId}/comments`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message, access_token: process.env.META_PAGE_ACCESS_TOKEN }) },
      'reply-to-interaction'
    )
    if (!result.ok || !result.data?.id) return { ok: false, error: result.error ?? 'graph_error_no_reply_id' }
    logger.info('meta-adapter', 'Replied to interaction', { externalId, externalReplyId: result.data.id })
    return { ok: true, externalReplyId: result.data.id }
  }
}
