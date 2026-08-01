// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/social/dm-send.ts
// Version 2.0 — Omnichannel Communication Platform, Phase 2/3.
//
// Sends a reply back to a Facebook Messenger / Instagram DM conversation via
// the Meta Send API (POST /me/messages) — the one send capability the
// Direct Event Sales Engine's DM capture (dm-capture-service.ts) never had.
//
// Deliberately NOT added to SocialAdapter/meta-adapter.ts: per
// src/lib/social/types.ts's own header, "DMs are NOT part of this
// interface... platform DMs flow through the unified conversation
// platform" — comments/mentions/reviews (SocialAdapter) and DMs
// (meta-lead-capture.ts, dm-capture-service.ts, this file) are already an
// established, deliberate split in this codebase. This file extends that
// same Meta-specific DM half, not the adapter contract.
//
// CREDENTIAL-GATED, same pattern as meta-adapter.ts/meta-lead-capture.ts:
// every real Graph call checks META_PAGE_ACCESS_TOKEN first and returns a
// clean, typed failure instead of throwing when absent. CREDENTIAL-READY,
// NOT LIVE — this project has no Meta app credentials for Pages/IG in any
// environment this code has run in; the request shape below follows Meta's
// documented Send API contract but has never been exercised against a real
// account, same caveat meta-adapter.ts already states for publishPost/
// replyToInteraction.
// ─────────────────────────────────────────────────────────────────────────────

import { logger } from '@/lib/logger'

const GRAPH = 'https://graph.facebook.com/v23.0'

export interface SendDMResult {
  ok: boolean
  externalMessageId?: string
  error?: string
}

export function isMetaDMConfigured(): boolean {
  return Boolean(process.env.META_PAGE_ACCESS_TOKEN)
}

/**
 * Sends a text message to a Messenger/Instagram DM thread, identified by
 * the sender's PSID (the same id dm-capture-service.ts's MessagingEvent
 * carries as senderPsid). Both platforms share the same Graph Send API
 * shape when using a Page-scoped access token with the connected Instagram
 * account — no platform-specific branching needed here, matching this
 * codebase's existing "one Meta adapter for both" convention
 * (meta-adapter.ts's MetaAdapter class).
 */
export async function sendMetaDirectMessage(
  recipientPsid: string,
  message: string
): Promise<SendDMResult> {
  if (!isMetaDMConfigured()) {
    return { ok: false, error: 'meta_not_configured: set META_PAGE_ACCESS_TOKEN' }
  }
  if (!message.trim()) {
    return { ok: false, error: 'empty_message' }
  }

  try {
    const res = await fetch(`${GRAPH}/me/messages?access_token=${encodeURIComponent(process.env.META_PAGE_ACCESS_TOKEN!)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: recipientPsid },
        message: { text: message },
        messaging_type: 'RESPONSE',
      }),
    })
    const json = (await res.json()) as { message_id?: string; error?: { message?: string } }
    if (!res.ok || !json.message_id) {
      const errMsg = json.error?.message ?? `graph_error_${res.status}`
      logger.error('social-dm-send', 'sendMetaDirectMessage failed', { error: errMsg, recipientPsid })
      return { ok: false, error: errMsg }
    }
    return { ok: true, externalMessageId: json.message_id }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    logger.error('social-dm-send', 'sendMetaDirectMessage threw', { error: errMsg })
    return { ok: false, error: errMsg }
  }
}
