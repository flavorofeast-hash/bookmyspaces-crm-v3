// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/app/api/social/oauth/[platform]/callback/route.ts
// Social Connectivity Priority 1 — the provider redirects the browser back
// here with ?code=&state=. This is a full top-level navigation back to our
// own origin, so the operator's existing session cookie is present —
// requireRole() works the same as any other authenticated route.
//
// Flow: verify signed state (oauth-state.ts) -> exchange code for a token
// (oauth-service.ts) -> fetch the connected account's identity -> encrypt
// both tokens (token-cipher.ts, same as the manual-paste path in
// /api/social/accounts) -> upsert into social_accounts on
// (platform, external_account_id) -> redirect to Content Studio with a
// clear success/error banner query param.
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

  // RC blocker fix — no fallback to any hardcoded domain; the redirect_uri
  // used here must exactly match what the start route sent to the provider
  // (see oauth-config.ts). A plain JSON error, not redirectWithBanner(),
  // because redirectWithBanner() itself needs a correct appBaseUrl to build
  // a safe redirect target — there is nothing safe to redirect to yet.
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

  const tokenResult = await exchangeCodeForToken(platform, code, appBaseUrl, state.codeVerifier)
  if (!tokenResult.ok) {
    logger.error('social-oauth', `token exchange failed for ${platform}`, { error: tokenResult.error })
    return redirectWithBanner(appBaseUrl, 'error', platform, tokenResult.error)
  }

  const identityResult = await fetchConnectedIdentity(platform, tokenResult.value.accessToken)
  if (!identityResult.ok) {
    logger.error('social-oauth', `identity fetch failed for ${platform}`, { error: identityResult.error })
    return redirectWithBanner(appBaseUrl, 'error', platform, identityResult.error)
  }

  // For Facebook/Instagram, the Page access token (not the user token) is
  // what publish-service.ts's MetaAdapter needs — fetchConnectedIdentity()
  // returns it as pageAccessToken when available.
  const tokenToStore = identityResult.value.pageAccessToken ?? tokenResult.value.accessToken

  try {
    const db = getSupabaseAdmin()
    const tokenExpiresAt = tokenResult.value.expiresInSeconds
      ? new Date(Date.now() + tokenResult.value.expiresInSeconds * 1000).toISOString()
      : null
    const accessTokenEncrypted = encryptToken(tokenToStore)
    const refreshTokenEncrypted = tokenResult.value.refreshToken ? encryptToken(tokenResult.value.refreshToken) : null

    // Google Business follow-up: fetchConnectedIdentity() may resolve more
    // than one identity for a single OAuth grant (one per discovered
    // Location under the connected Business Account) — every other platform
    // returns exactly one, so this loop is a no-op single iteration for
    // them, unchanged from before. Each Location becomes its own selectable
    // social_accounts row, sharing the same underlying token — the existing
    // account_id selection pattern (Content Studio -> create post) is what
    // lets an operator pick which Location a post publishes to, with no new
    // UI required.
    const identities = [identityResult.value, ...(identityResult.value.additionalIdentities ?? [])]
    for (const identity of identities) {
      const { error } = await db
        .from('social_accounts')
        .upsert(
          {
            platform,
            display_name: identity.displayName,
            external_account_id: identity.externalAccountId,
            access_token_encrypted: accessTokenEncrypted,
            refresh_token_encrypted: refreshTokenEncrypted,
            token_expires_at: tokenExpiresAt,
            scopes: OAUTH_CONFIGS[platform].scopes,
            status: 'connected',
            is_active: true,
          },
          { onConflict: 'platform,external_account_id' }
        )
      if (error) throw error
    }

    return redirectWithBanner(appBaseUrl, 'success', platform)
  } catch (err) {
    logger.error('social-oauth', `account upsert failed for ${platform}`, err)
    return redirectWithBanner(appBaseUrl, 'error', platform, 'account_save_failed')
  }
}
