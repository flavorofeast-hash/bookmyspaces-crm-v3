// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/social/oauth/instagram-native-service.ts
// Native Instagram Login OAuth calls — separate from oauth-service.ts (the
// classic Facebook-Login flow). See instagram-native-config.ts's header for
// why this is a distinct implementation, not a variant of the existing one.
//
// Flow: authorize -> code -> short-lived token (1hr) -> long-lived token
// (60d) -> identity (IG user id + username) -> subscribe that account's
// `messages` field to this app's webhooks -> verify the subscription stuck.
// The subscribe/verify step is the one piece the classic flow's callback
// never did (confirmed by grepping the whole repo for "subscribed_apps"
// before this file existed -- zero matches) and is the actual missing
// piece for inbound Instagram DMs to reach the webhook route.
//
// Never logs an access token. Graph/Instagram error bodies are logged only
// after being reduced to a plain message string (never the full JSON,
// which could otherwise echo a token back in some error paths, same class
// of leak this session's manual Graph API checks already guarded against).
// ─────────────────────────────────────────────────────────────────────────────

import { logger } from '@/lib/logger'
import { callGraphAPI } from '@/lib/social/graph-api-client'
import {
  INSTAGRAM_AUTHORIZE_URL,
  INSTAGRAM_TOKEN_URL,
  INSTAGRAM_GRAPH_HOST,
  INSTAGRAM_NATIVE_SCOPES,
  getInstagramNativeClientId,
  getInstagramNativeClientSecret,
  getInstagramNativeRedirectUri,
} from './instagram-native-config'

type Result<T> = { ok: true; value: T } | { ok: false; error: string }

export interface InstagramNativeToken {
  accessToken: string
  expiresInSeconds: number | null
}

export interface InstagramNativeIdentity {
  igUserId: string
  username: string
}

export function buildInstagramNativeAuthorizationUrl(state: string, appBaseUrl: string): string {
  const params = new URLSearchParams({
    client_id: getInstagramNativeClientId(),
    redirect_uri: getInstagramNativeRedirectUri(appBaseUrl),
    response_type: 'code',
    scope: INSTAGRAM_NATIVE_SCOPES.join(','),
    state,
  })
  return `${INSTAGRAM_AUTHORIZE_URL}?${params.toString()}`
}

/** Authorization-code -> short-lived (1hr) token. Instagram's own token endpoint, distinct response shape from Graph's -- not routed through callGraphAPI. */
async function exchangeCodeForShortLivedToken(code: string, appBaseUrl: string): Promise<Result<string>> {
  try {
    const body = new URLSearchParams({
      client_id: getInstagramNativeClientId(),
      client_secret: getInstagramNativeClientSecret(),
      grant_type: 'authorization_code',
      redirect_uri: getInstagramNativeRedirectUri(appBaseUrl),
      code,
    })
    const res = await fetch(INSTAGRAM_TOKEN_URL, { method: 'POST', body })
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
    const accessToken = json.access_token as string | undefined
    if (!res.ok || !accessToken) {
      const reason = typeof json.error_message === 'string' ? json.error_message : `status_${res.status}`
      return { ok: false, error: `short_lived_token_exchange_failed: ${reason}` }
    }
    return { ok: true, value: accessToken }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'short_lived_token_exchange_exception' }
  }
}

/** Short-lived -> long-lived (60d) token. */
async function exchangeLongLivedToken(shortLivedToken: string): Promise<Result<InstagramNativeToken>> {
  const params = new URLSearchParams({
    grant_type: 'ig_exchange_token',
    client_secret: getInstagramNativeClientSecret(),
    access_token: shortLivedToken,
  })
  const result = await callGraphAPI<{ access_token?: string; expires_in?: number }>(
    `${INSTAGRAM_GRAPH_HOST}/access_token?${params.toString()}`,
    { method: 'GET' },
    'instagram-native-long-lived-exchange'
  )
  if (!result.ok || !result.data?.access_token) {
    return { ok: false, error: result.error ?? 'long_lived_token_exchange_failed' }
  }
  return {
    ok: true,
    value: {
      accessToken: result.data.access_token,
      expiresInSeconds: typeof result.data.expires_in === 'number' ? result.data.expires_in : 60 * 24 * 3600,
    },
  }
}

/** Full code -> long-lived token chain, mirroring oauth-service.ts's exchangeCodeForToken() shape for the classic flow. */
export async function exchangeInstagramNativeCode(code: string, appBaseUrl: string): Promise<Result<InstagramNativeToken>> {
  const shortLived = await exchangeCodeForShortLivedToken(code, appBaseUrl)
  if (!shortLived.ok) return shortLived

  const longLived = await exchangeLongLivedToken(shortLived.value)
  if (longLived.ok) return longLived

  // If the long-lived exchange fails, fall back to the short-lived token
  // (1hr) rather than failing the whole connection -- same fallback
  // philosophy as oauth-service.ts's classic-flow exchange.
  logger.warn('social-oauth-ig-native', 'long-lived token exchange failed, using short-lived token', { error: longLived.error })
  return { ok: true, value: { accessToken: shortLived.value, expiresInSeconds: 3600 } }
}

/** IG user id + username for the just-connected account -- lets the operator/us confirm this is actually skyline.monurama before storing anything. */
export async function fetchInstagramNativeIdentity(accessToken: string): Promise<Result<InstagramNativeIdentity>> {
  const result = await callGraphAPI<{ user_id?: string; username?: string }>(
    `${INSTAGRAM_GRAPH_HOST}/me?fields=user_id,username&access_token=${encodeURIComponent(accessToken)}`,
    { method: 'GET' },
    'instagram-native-identity'
  )
  if (!result.ok || !result.data?.user_id) {
    return { ok: false, error: result.error ?? 'identity_fetch_failed' }
  }
  return { ok: true, value: { igUserId: result.data.user_id, username: result.data.username ?? result.data.user_id } }
}

/** Subscribes this IG account's `messages` field to the app's webhooks -- the exact step the classic flow's callback never performed. */
export async function subscribeInstagramMessages(igUserId: string, accessToken: string): Promise<Result<true>> {
  const result = await callGraphAPI<{ success?: boolean }>(
    `${INSTAGRAM_GRAPH_HOST}/${igUserId}/subscribed_apps?subscribed_fields=messages&access_token=${encodeURIComponent(accessToken)}`,
    { method: 'POST' },
    'instagram-native-subscribe'
  )
  if (!result.ok) return { ok: false, error: result.error ?? 'subscribe_failed' }
  return { ok: true, value: true }
}

/** Read-back confirmation that the subscription actually stuck. */
export async function verifyInstagramMessagesSubscription(igUserId: string, accessToken: string): Promise<Result<boolean>> {
  const result = await callGraphAPI<{ data?: Array<{ subscribed_fields?: string[] }> }>(
    `${INSTAGRAM_GRAPH_HOST}/${igUserId}/subscribed_apps?access_token=${encodeURIComponent(accessToken)}`,
    { method: 'GET' },
    'instagram-native-verify-subscription'
  )
  if (!result.ok) return { ok: false, error: result.error ?? 'verify_subscription_failed' }
  const subscribed = (result.data?.data ?? []).some((entry) => (entry.subscribed_fields ?? []).includes('messages'))
  return { ok: true, value: subscribed }
}
