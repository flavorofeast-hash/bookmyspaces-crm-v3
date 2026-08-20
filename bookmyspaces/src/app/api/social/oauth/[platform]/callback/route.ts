// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/app/api/social/oauth/[platform]/callback/route.ts
// Facebook/Instagram connector recovery — ported from
// release/v1.0.0-stabilization, adapted to the trimmed (Facebook/Instagram
// only) oauth-config.ts/oauth-state.ts/oauth-service.ts on main. See
// oauth-config.ts's header for why this recovery excludes LinkedIn/Google
// Business/X. Writes into `social_accounts` (migration 014), confirmed
// present on the live database before this route was written.
//
// The provider redirects the browser back here with ?code=&state=. This is
// a full top-level navigation back to our own origin, so the operator's
// existing session cookie is present -- requireRole() works the same as
// any other authenticated route.
//
// Flow: verify signed state (oauth-state.ts) -> exchange code for a token
// (oauth-service.ts) -> fetch the connected Page/IG account's identity ->
// encrypt the token (token-cipher.ts) -> upsert into social_accounts on
// (platform, external_account_id) -> redirect to Content Studio with a
// success/error banner query param.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth-guard'
import { getSupabaseAdmin } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { isOAuthCapablePlatform, OAUTH_CONFIGS, isAppBaseUrlConfigured, getAppBaseUrl } from '@/lib/social/oauth/oauth-config'
import { decodeOAuthState } from '@/lib/social/oauth/oauth-state'
import { exchangeCodeForToken, fetchConnectedIdentity } from '@/lib/social/oauth/oauth-service'
import { encryptToken, isTokenCipherConfigured } from '@/lib/social/token-cipher'

function redirectWithBanner(appBaseUrl: string, status: 'success' | 'error', platform: string, detail?: string) {
  const url = new URL('/content-studio', appBaseUrl)
  url.searchParams.set('oauth', status)
  url.searchParams.set('platform', platform)
  if (detail) url.searchParams.set('detail', detail.slice(0, 200))
  return NextResponse.redirect(url)
}

export async function GET(req: NextRequest, { params }: { params: { platform: string } }) {
  const platform = params.platform

  // No fallback to any hardcoded domain -- the redirect_uri used here must
  // exactly match what the start route sent to Meta. A plain JSON error,
  // not redirectWithBanner(), because that helper itself needs a correct
  // appBaseUrl to build a safe redirect target.
  if (!isAppBaseUrlConfigured()) {
    logger.error('social-oauth', `GET /api/social/oauth/${platform}/callback failed: NEXT_PUBLIC_APP_URL is not set`)
    return NextResponse.json({ error: 'oauth_not_configured: NEXT_PUBLIC_APP_URL is not set' }, { status: 503 })
  }
  const appBaseUrl = getAppBaseUrl()

  const auth = await requireRole(['admin', 'manager'])
  if (!auth.ok) return auth.response

  if (!isOAuthCapablePlatform(platform)) {
    return redirectWithBanner(appBaseUrl, 'error', platform, 'unsupported_platform')
  }

  const { searchParams } = req.nextUrl
  const providerError = searchParams.get('error')
  if (providerError) {
    return redirectWithBanner(appBaseUrl, 'error', platform, `provider_denied: ${providerError}`)
  }

  const code = searchParams.get('code')
  const stateParam = searchParams.get('state')
  if (!code || !stateParam) {
    return redirectWithBanner(appBaseUrl, 'error', platform, 'missing_code_or_state')
  }

  const state = decodeOAuthState(stateParam)
  if (!state || state.platform !== platform) {
    return redirectWithBanner(appBaseUrl, 'error', platform, 'invalid_or_expired_state')
  }
  // Defense in depth: the state was minted for a specific user id — reject
  // if a different session somehow completed this redirect (e.g. a copied
  // URL), even though the signature alone already prevents tampering.
  if (state.userId !== auth.user.id) {
    return redirectWithBanner(appBaseUrl, 'error', platform, 'state_user_mismatch')
  }

  if (!isTokenCipherConfigured()) {
    return redirectWithBanner(appBaseUrl, 'error', platform, 'encryption_not_configured')
  }

  const tokenResult = await exchangeCodeForToken(platform, code, appBaseUrl)
  if (!tokenResult.ok) {
    logger.error('social-oauth', `token exchange failed for ${platform}`, { error: tokenResult.error })
    return redirectWithBanner(appBaseUrl, 'error', platform, tokenResult.error)
  }

  const identityResult = await fetchConnectedIdentity(platform, tokenResult.value.accessToken)
  if (!identityResult.ok) {
    logger.error('social-oauth', `identity fetch failed for ${platform}`, { error: identityResult.error })
    return redirectWithBanner(appBaseUrl, 'error', platform, identityResult.error)
  }

  // The Page access token (not the user token) is what MetaAdapter needs
  // to publish -- fetchConnectedIdentity() returns it as pageAccessToken.
  const tokenToStore = identityResult.value.pageAccessToken ?? tokenResult.value.accessToken

  try {
    const db = getSupabaseAdmin()
    const tokenExpiresAt = tokenResult.value.expiresInSeconds
      ? new Date(Date.now() + tokenResult.value.expiresInSeconds * 1000).toISOString()
      : null
    const accessTokenEncrypted = encryptToken(tokenToStore)
    // NOTE: the live `social_accounts` table has no refresh_token_encrypted
    // column (verified directly against the schema before writing this --
    // the source branch's version of this route included one, which would
    // have made every upsert here fail with a "column not found" error,
    // the same class of bug found and fixed in `leads.whatsapp_last_message_at`
    // earlier this session). Not needed for Facebook/Instagram anyway --
    // both have supportsRefresh: false in oauth-config.ts, so Meta never
    // issues a refresh_token for either.

    const { error } = await db
      .from('social_accounts')
      .upsert(
        {
          platform,
          display_name: identityResult.value.displayName,
          external_account_id: identityResult.value.externalAccountId,
          access_token_encrypted: accessTokenEncrypted,
          token_expires_at: tokenExpiresAt,
          scopes: OAUTH_CONFIGS[platform].scopes,
          status: 'connected',
          is_active: true,
        },
        { onConflict: 'platform,external_account_id' }
      )
    if (error) throw error

    return redirectWithBanner(appBaseUrl, 'success', platform)
  } catch (err) {
    logger.error('social-oauth', `account upsert failed for ${platform}`, err)
    return redirectWithBanner(appBaseUrl, 'error', platform, 'account_save_failed')
  }
}
