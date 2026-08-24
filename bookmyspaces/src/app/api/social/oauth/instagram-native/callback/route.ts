// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/app/api/social/oauth/instagram-native/callback/route.ts
// Native Instagram Login OAuth callback. Separate from the classic
// [platform]/callback -- see instagram-native-config.ts's header.
//
// Flow: verify signed state -> exchange code for a long-lived token ->
// fetch IG identity (user id + username, so we/the operator can confirm
// this is actually skyline.monurama) -> encrypt + upsert into
// social_accounts -> subscribe that account's `messages` field to this
// app's webhooks -> verify the subscription actually stuck -> redirect
// with a success/error banner (subscription status included, never the
// token itself).
//
// Writes into the SAME social_accounts table as the classic flow
// (migration 014) -- no schema change needed, per the read-only audit's
// finding that platform/external_account_id/access_token_encrypted/scopes/
// config are all generic enough already. The native-login origin is
// recorded in `config` (authFlow/tokenHost) so it's distinguishable from
// any future classic-flow row without a migration.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth-guard'
import { getSupabaseAdmin } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { isAppBaseUrlConfigured, getAppBaseUrl } from '@/lib/social/oauth/oauth-config'
import { decodeOAuthState } from '@/lib/social/oauth/oauth-state'
import { INSTAGRAM_NATIVE_SCOPES } from '@/lib/social/oauth/instagram-native-config'
import {
  exchangeInstagramNativeCode,
  fetchInstagramNativeIdentity,
  subscribeInstagramMessages,
  verifyInstagramMessagesSubscription,
} from '@/lib/social/oauth/instagram-native-service'
import { encryptToken, isTokenCipherConfigured } from '@/lib/social/token-cipher'

function redirectWithBanner(appBaseUrl: string, status: 'success' | 'error', detail?: string) {
  const url = new URL('/content-studio', appBaseUrl)
  url.searchParams.set('oauth', status)
  url.searchParams.set('platform', 'instagram_native')
  if (detail) url.searchParams.set('detail', detail.slice(0, 200))
  return NextResponse.redirect(url)
}

export async function GET(req: NextRequest) {
  if (!isAppBaseUrlConfigured()) {
    logger.error('social-oauth-ig-native', 'GET callback failed: NEXT_PUBLIC_APP_URL is not set')
    return NextResponse.json({ error: 'oauth_not_configured: NEXT_PUBLIC_APP_URL is not set' }, { status: 503 })
  }
  const appBaseUrl = getAppBaseUrl()

  const auth = await requireRole(['admin', 'manager'])
  if (!auth.ok) return auth.response

  const { searchParams } = req.nextUrl
  const providerError = searchParams.get('error') ?? searchParams.get('error_message')
  if (providerError) {
    return redirectWithBanner(appBaseUrl, 'error', `provider_denied: ${providerError}`)
  }

  const code = searchParams.get('code')
  const stateParam = searchParams.get('state')
  if (!code || !stateParam) {
    return redirectWithBanner(appBaseUrl, 'error', 'missing_code_or_state')
  }

  const state = decodeOAuthState(stateParam)
  if (!state || state.platform !== 'instagram_native') {
    return redirectWithBanner(appBaseUrl, 'error', 'invalid_or_expired_state')
  }
  if (state.userId !== auth.user.id) {
    return redirectWithBanner(appBaseUrl, 'error', 'state_user_mismatch')
  }

  if (!isTokenCipherConfigured()) {
    return redirectWithBanner(appBaseUrl, 'error', 'encryption_not_configured')
  }

  const tokenResult = await exchangeInstagramNativeCode(code, appBaseUrl)
  if (!tokenResult.ok) {
    logger.error('social-oauth-ig-native', 'token exchange failed', undefined, { error: tokenResult.error })
    return redirectWithBanner(appBaseUrl, 'error', tokenResult.error)
  }

  const identityResult = await fetchInstagramNativeIdentity(tokenResult.value.accessToken)
  if (!identityResult.ok) {
    logger.error('social-oauth-ig-native', 'identity fetch failed', undefined, { error: identityResult.error })
    return redirectWithBanner(appBaseUrl, 'error', identityResult.error)
  }
  const { igUserId, username } = identityResult.value

  try {
    const db = getSupabaseAdmin()
    const tokenExpiresAt = tokenResult.value.expiresInSeconds
      ? new Date(Date.now() + tokenResult.value.expiresInSeconds * 1000).toISOString()
      : null
    const accessTokenEncrypted = encryptToken(tokenResult.value.accessToken)

    const { error: upsertError } = await db
      .from('social_accounts')
      .upsert(
        {
          platform: 'instagram',
          display_name: username,
          external_account_id: igUserId,
          access_token_encrypted: accessTokenEncrypted,
          token_expires_at: tokenExpiresAt,
          scopes: INSTAGRAM_NATIVE_SCOPES,
          status: 'connected',
          is_active: true,
          config: { authFlow: 'instagram_native_login', tokenHost: 'graph.instagram.com' },
        },
        { onConflict: 'platform,external_account_id' }
      )
    if (upsertError) throw upsertError
  } catch (err) {
    logger.error('social-oauth-ig-native', 'account upsert failed', err, { igUserId })
    return redirectWithBanner(appBaseUrl, 'error', 'account_save_failed')
  }

  // The step the classic flow's callback never performed -- subscribe this
  // specific IG account's `messages` field to the app's webhooks, then
  // read back the subscription to confirm it actually stuck.
  const subscribeResult = await subscribeInstagramMessages(igUserId, tokenResult.value.accessToken)
  if (!subscribeResult.ok) {
    logger.error('social-oauth-ig-native', 'messages subscription failed', undefined, { igUserId, error: subscribeResult.error })
    return redirectWithBanner(appBaseUrl, 'error', `connected_but_subscribe_failed: ${subscribeResult.error}`)
  }

  const verifyResult = await verifyInstagramMessagesSubscription(igUserId, tokenResult.value.accessToken)
  if (!verifyResult.ok || !verifyResult.value) {
    logger.error('social-oauth-ig-native', 'messages subscription verification failed', undefined, {
      igUserId, verifyOk: verifyResult.ok, subscribed: verifyResult.ok ? verifyResult.value : null,
    })
    return redirectWithBanner(appBaseUrl, 'error', 'connected_but_subscription_not_confirmed')
  }

  logger.info('social-oauth-ig-native', 'Instagram account connected and messages subscription verified', { igUserId, username })
  return redirectWithBanner(appBaseUrl, 'success')
}
