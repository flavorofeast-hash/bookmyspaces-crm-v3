// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/social/instagram-send.ts
// Instagram DM outbound send — the piece confirmed missing during the
// AI-auto-reply inspection (outbound-dispatcher.ts had no 'instagram' case,
// MetaAdapter had no DM-send method). Follows the same conventions already
// established in this codebase rather than inventing new ones:
//   - callGraphAPI (graph-api-client.ts) for the actual HTTP call, same as
//     meta-adapter.ts's publishPost/replyToInteraction -- retry-with-backoff
//     on 5xx, structured logging, consistent error-shape extraction.
//   - social-account-routing.ts's findConnectedSocialAccount() for the
//     connected-account lookup, same as the inbound path uses.
//   - token-cipher.ts's decryptToken() for the stored credential -- never
//     logged, never returned, decrypted only for the duration of this call.
//
// Endpoint verified live against Meta's current docs (not assumed) during
// the AI-auto-reply planning pass:
//   POST https://graph.instagram.com/v25.0/{ig-user-id}/messages
//   body: { recipient: { id: <IGSID> }, message: { text }, access_token }
// Requires instagram_business_manage_messages -- already granted, it's one
// of the two scopes requested during the native OAuth connect
// (instagram-native-config.ts's INSTAGRAM_NATIVE_SCOPES).
// ─────────────────────────────────────────────────────────────────────────────

import { logger } from '@/lib/logger'
import { getSupabaseAdmin } from '@/lib/supabase'
import { callGraphAPI } from '@/lib/social/graph-api-client'
import { findConnectedSocialAccount } from '@/lib/social/social-account-routing'
import { decryptToken } from '@/lib/social/token-cipher'

const INSTAGRAM_GRAPH_HOST = 'https://graph.instagram.com/v25.0'

export interface SendInstagramResult {
  success: boolean
  externalMessageId?: string
  error?: string
}

/**
 * Sends a text DM from the connected Instagram account (igUserId) to a
 * customer (recipientId, the IGSID already stored as
 * unified_conversation_channels.channel_identity -- no new id mapping).
 * Never throws; a failure is reported in the result, never as a false
 * "delivered" (see dispatchOutbound's instagram case).
 */
export async function sendInstagramMessage(
  igUserId: string,
  recipientId: string,
  text: string
): Promise<SendInstagramResult> {
  const account = await findConnectedSocialAccount('instagram', igUserId)
  if (!account) {
    logger.error('instagram-send', 'no connected/active social_accounts row for this igUserId', undefined, { igUserId })
    return { success: false, error: 'account_not_connected' }
  }

  const db = getSupabaseAdmin()
  const { data: row, error: fetchError } = await db
    .from('social_accounts')
    .select('access_token_encrypted')
    .eq('id', account.id)
    .maybeSingle()

  if (fetchError || !row?.access_token_encrypted) {
    logger.error('instagram-send', 'connected account has no stored token', fetchError, { igUserId })
    return { success: false, error: 'token_not_found' }
  }

  let accessToken: string
  try {
    accessToken = decryptToken(row.access_token_encrypted)
  } catch (err) {
    logger.error('instagram-send', 'token decrypt failed', err, { igUserId })
    return { success: false, error: 'token_decrypt_failed' }
  }

  const result = await callGraphAPI<{ recipient_id?: string; message_id?: string }>(
    `${INSTAGRAM_GRAPH_HOST}/${igUserId}/messages`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient: { id: recipientId }, message: { text }, access_token: accessToken }),
    },
    'instagram-send-message'
  )

  if (!result.ok || !result.data?.message_id) {
    return { success: false, error: result.error ?? 'graph_error_no_message_id' }
  }

  logger.info('instagram-send', 'Instagram message sent', { igUserId })
  return { success: true, externalMessageId: result.data.message_id }
}
