// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/google/gbp-token.ts
// The missing piece found during the GBP audit: nothing anywhere refreshed
// the stored GBP access token. Google access tokens are short-lived
// (~1 hour); callback/route.ts stores expires_at but nothing ever read it
// or called the refresh_token grant, so any GBP API call made more than an
// hour after connecting would fail. Every downstream GBP feature (location
// re-discovery, review sync, business info) depends on this existing.
//
// getValidGbpAccessToken() is the single entry point every future GBP API
// caller should use -- it never returns an expired token, and never
// requires a fresh OAuth consent screen for an already-connected account.
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabaseAdmin } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { encryptGbpToken, decryptGbpToken } from '@/lib/google/gbp-crypto'

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const SETTINGS_CATEGORY = 'integration'
const SETTINGS_KEY = 'google_gbp_oauth'
// Refresh a little before actual expiry -- avoids a request racing a token
// that expires mid-flight.
const EXPIRY_SAFETY_MARGIN_MS = 2 * 60_000

interface StoredGbpSettings {
  access_token_enc?: string
  refresh_token_enc?: string | null
  scope?: string
  token_type?: string
  expires_at?: string
  connected_at?: string
  locations?: Array<{ externalId: string; displayName: string }>
}

export type GbpTokenResult =
  | { ok: true; accessToken: string }
  | { ok: false; error: 'not_connected' | 'no_refresh_token' | 'not_configured' | 'refresh_failed' }

interface GoogleRefreshResponse {
  access_token: string
  expires_in: number
  scope: string
  token_type: string
}

/**
 * Returns a currently-valid GBP access token, refreshing it first if the
 * stored one is expired/near-expiry. Never logs or returns the refresh
 * token. The access token itself is returned to the caller for immediate
 * use in a Google API request -- callers must not log or persist it
 * themselves beyond that single use.
 */
export async function getValidGbpAccessToken(): Promise<GbpTokenResult> {
  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('settings')
    .select('value')
    .eq('category', SETTINGS_CATEGORY)
    .eq('key', SETTINGS_KEY)
    .maybeSingle()

  if (error || !data) {
    if (error) logger.error('gbp-oauth', 'getValidGbpAccessToken: settings read failed', error)
    return { ok: false, error: 'not_connected' }
  }

  const value = data.value as StoredGbpSettings
  const expiresAt = value.expires_at ? new Date(value.expires_at).getTime() : 0
  const stillValid = expiresAt - EXPIRY_SAFETY_MARGIN_MS > Date.now()

  if (stillValid && value.access_token_enc) {
    try {
      return { ok: true, accessToken: decryptGbpToken(value.access_token_enc) }
    } catch (err) {
      logger.error('gbp-oauth', 'getValidGbpAccessToken: stored access token failed to decrypt, attempting refresh', err)
      // fall through to refresh
    }
  }

  if (!value.refresh_token_enc) {
    logger.error('gbp-oauth', 'getValidGbpAccessToken: access token expired and no refresh token stored — reconnect required')
    return { ok: false, error: 'no_refresh_token' }
  }

  const clientId = process.env.GOOGLE_GBP_CLIENT_ID
  const clientSecret = process.env.GOOGLE_GBP_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    logger.error('gbp-oauth', 'getValidGbpAccessToken: missing GOOGLE_GBP_CLIENT_ID/CLIENT_SECRET')
    return { ok: false, error: 'not_configured' }
  }

  let refreshToken: string
  try {
    refreshToken = decryptGbpToken(value.refresh_token_enc)
  } catch (err) {
    logger.error('gbp-oauth', 'getValidGbpAccessToken: stored refresh token failed to decrypt — reconnect required', err)
    return { ok: false, error: 'no_refresh_token' }
  }

  try {
    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'refresh_token',
      }),
    })

    if (!res.ok) {
      const errBody = await res.text()
      logger.error('gbp-oauth', 'getValidGbpAccessToken: refresh_token grant failed', undefined, { status: res.status, errBody })
      return { ok: false, error: 'refresh_failed' }
    }

    const tokens = (await res.json()) as GoogleRefreshResponse
    const newExpiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()

    const { error: saveError } = await db
      .from('settings')
      .update({
        value: {
          ...value,
          access_token_enc: encryptGbpToken(tokens.access_token),
          scope: tokens.scope ?? value.scope,
          token_type: tokens.token_type ?? value.token_type,
          expires_at: newExpiresAt,
        },
      })
      .eq('category', SETTINGS_CATEGORY)
      .eq('key', SETTINGS_KEY)

    if (saveError) {
      // The fresh token is still usable for this one call even if
      // persisting it failed -- don't throw away a successful refresh.
      logger.error('gbp-oauth', 'getValidGbpAccessToken: refreshed token succeeded but saving failed (using it anyway for this call)', saveError)
    } else {
      logger.info('gbp-oauth', 'getValidGbpAccessToken: access token refreshed', { expiresAt: newExpiresAt })
    }

    return { ok: true, accessToken: tokens.access_token }
  } catch (err) {
    logger.error('gbp-oauth', 'getValidGbpAccessToken: refresh request threw', err)
    return { ok: false, error: 'refresh_failed' }
  }
}
