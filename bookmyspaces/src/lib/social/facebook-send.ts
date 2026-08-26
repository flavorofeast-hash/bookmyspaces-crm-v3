// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/social/facebook-send.ts
// Facebook Messenger outbound send. Approved decision for this pass: reuse
// the existing WhatsApp-style single-Page, global-env-var credential model
// (META_PAGE_ID / META_PAGE_ACCESS_TOKEN) -- the same two vars
// meta-adapter.ts's publishPost() already reads for Facebook -- rather than
// building Facebook Page OAuth (out of scope; Instagram's per-account
// OAuth-connected model does not apply here).
//
// Endpoint verified live against Meta's current docs during the Messenger
// audit pass:
//   POST https://graph.facebook.com/v25.0/{PAGE-ID}/messages
//   body: { messaging_type: 'RESPONSE', recipient: { id: <PSID> }, message: { text } }
// Requires the `pages_messaging` permission (tracked separately -- App
// Review in progress at the time this was written).
// ─────────────────────────────────────────────────────────────────────────────

import { logger } from '@/lib/logger'
import { callGraphAPI } from '@/lib/social/graph-api-client'

const GRAPH = 'https://graph.facebook.com/v25.0'

export interface SendFacebookResult {
  success: boolean
  externalMessageId?: string
  error?: string
}

/**
 * Sends a text message from the connected Facebook Page to a Messenger
 * user (recipientId, the PSID already stored as
 * unified_conversation_channels.channel_identity -- no new id mapping).
 * Never throws; a failure is reported in the result, never as a false
 * "delivered" (see dispatchOutbound's facebook case).
 */
export async function sendFacebookMessage(recipientId: string, text: string): Promise<SendFacebookResult> {
  const pageId = process.env.META_PAGE_ID
  const accessToken = process.env.META_PAGE_ACCESS_TOKEN

  if (!pageId || !accessToken) {
    logger.error('facebook-send', 'META_PAGE_ID / META_PAGE_ACCESS_TOKEN not configured')
    return { success: false, error: 'not_configured' }
  }

  const result = await callGraphAPI<{ recipient_id?: string; message_id?: string }>(
    `${GRAPH}/${pageId}/messages`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_type: 'RESPONSE',
        recipient: { id: recipientId },
        message: { text },
        access_token: accessToken,
      }),
    },
    'facebook-send-message'
  )

  if (!result.ok || !result.data?.message_id) {
    return { success: false, error: result.error ?? 'graph_error_no_message_id' }
  }

  logger.info('facebook-send', 'Facebook Messenger message sent', { pageId })
  return { success: true, externalMessageId: result.data.message_id }
}
