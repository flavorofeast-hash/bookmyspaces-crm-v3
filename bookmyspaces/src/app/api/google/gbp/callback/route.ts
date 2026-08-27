// src/app/api/google/gbp/callback/route.ts
// Google Business Profile OAuth — step 2 of 2 (see ../connect/route.ts).
//
// Exchanges the authorization code Google redirects back with for an
// access + refresh token pair, then persists them (encrypted, server-side
// only) so the OAuth foundation is actually usable and verifiable -- not
// just a one-time log line. The access/refresh tokens themselves are never
// returned to the browser at any point; only a plain success/error
// redirect is.
//
// Storage choice: the existing `settings` table, under a key
// ('google_gbp_oauth') that is NOT one of settings-service.ts's
// SECTION_KEYS -- getAppSettings()/getSettingsSection() only ever merge
// keys in that list, so this row is invisible to /api/settings and the
// Settings UI by construction, not by convention. Encrypted with AES-256-GCM
// using the SOCIAL_TOKEN_ENCRYPTION_KEY that already exists in this
// project's env (provisioned for the not-yet-built social OAuth flow,
// reused here rather than adding a second token-encryption secret for the
// same class of problem). No new table/migration -- in scope for a
// "foundation" pass; which Google account/location this token belongs to,
// refresh-token rotation, and multi-location support are explicitly out
// of scope here (see connect/route.ts header).

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth-guard'
import { getSupabaseAdmin } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { decodeGbpOAuthState } from '@/lib/google/gbp-oauth-state'
import { discoverAccountsAndLocations } from '@/lib/google/gbp-client'
import { encryptGbpToken as encryptToken } from '@/lib/google/gbp-crypto'

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const SETTINGS_CATEGORY = 'integration'
const SETTINGS_KEY = 'google_gbp_oauth'

interface GoogleTokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
  scope: string
  token_type: string
}

export async function GET(req: NextRequest) {
  const auth = await requireRole(['admin', 'manager'])
  if (!auth.ok) return auth.response

  const { searchParams, origin } = new URL(req.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const googleError = searchParams.get('error')

  function redirectResult(query: string): NextResponse {
    return NextResponse.redirect(`${origin}/settings?${query}`)
  }

  if (googleError) {
    logger.warn('gbp-oauth', 'callback: Google returned an error (user denied or misconfigured)', { googleError })
    return redirectResult(`gbp_error=${encodeURIComponent(googleError)}`)
  }

  // CSRF check: the state param is self-verifying (HMAC-signed, see
  // ../connect/route.ts) -- no cookie/session lookup needed. Also confirms
  // the state was minted for THIS user, not just any authenticated session.
  const decodedState = state ? decodeGbpOAuthState(state) : null
  if (!code || !decodedState) {
    logger.error('gbp-oauth', 'callback: missing/invalid/expired state -- rejecting as possible CSRF', {
      hasCode: Boolean(code),
      hasState: Boolean(state),
      stateValid: Boolean(decodedState),
    })
    return redirectResult('gbp_error=invalid_state')
  }
  if (decodedState.userId !== auth.user.id) {
    logger.error('gbp-oauth', 'callback: state was minted for a different user -- rejecting', {
      stateUserId: decodedState.userId,
      sessionUserId: auth.user.id,
    })
    return redirectResult('gbp_error=invalid_state')
  }

  const clientId = process.env.GOOGLE_GBP_CLIENT_ID
  const clientSecret = process.env.GOOGLE_GBP_CLIENT_SECRET
  const redirectUri = process.env.GOOGLE_GBP_REDIRECT_URI

  if (!clientId || !clientSecret || !redirectUri) {
    logger.error('gbp-oauth', 'callback: missing GOOGLE_GBP_CLIENT_ID/CLIENT_SECRET/REDIRECT_URI')
    return redirectResult('gbp_error=not_configured')
  }

  try {
    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    })

    if (!tokenRes.ok) {
      const errBody = await tokenRes.text()
      logger.error('gbp-oauth', 'callback: token exchange failed', undefined, { status: tokenRes.status, errBody })
      return redirectResult('gbp_error=token_exchange_failed')
    }

    const tokens = (await tokenRes.json()) as GoogleTokenResponse

    logger.info('gbp-oauth', 'callback: token exchange succeeded', {
      hasRefreshToken: Boolean(tokens.refresh_token),
      scope: tokens.scope,
      tokenType: tokens.token_type,
    })

    // Verify the GRANTED scope, not just that OAuth succeeded -- Google can
    // return a token whose actual scope differs from what was requested.
    // Non-fatal (discovery below will surface the real failure mode if this
    // is actually the cause), but logged distinctly so it's not confused
    // with an API-not-enabled or no-Business-Profile failure.
    if (!tokens.scope?.includes('business.manage')) {
      logger.error('gbp-oauth', 'callback: granted scope does not include business.manage — discovery will likely fail', undefined, {
        grantedScope: tokens.scope,
      })
    }

    // Completes the flow's last leg -- "GBP account -> location" -- before
    // persisting, so the CRM (via /api/google/gbp/status) has something
    // real to show immediately after connecting, not just "connected: true"
    // with no location. Best-effort: an empty result here still means the
    // token itself saves fine; discoverAccountsAndLocations() never throws.
    const { locations, diagnostic } = await discoverAccountsAndLocations(tokens.access_token)

    const db = getSupabaseAdmin()
    const { error: saveError } = await db
      .from('settings')
      .upsert(
        {
          category: SETTINGS_CATEGORY,
          key: SETTINGS_KEY,
          value: {
            access_token_enc: encryptToken(tokens.access_token),
            refresh_token_enc: tokens.refresh_token ? encryptToken(tokens.refresh_token) : null,
            scope: tokens.scope,
            token_type: tokens.token_type,
            expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
            connected_at: new Date().toISOString(),
            locations,
            discovery_diagnostic: diagnostic,
          },
          updated_by: auth.user.email ?? auth.user.id,
        },
        { onConflict: 'category,key' }
      )

    if (saveError) {
      logger.error('gbp-oauth', 'callback: token exchange succeeded but saving failed', saveError)
      return redirectResult('gbp_error=save_failed')
    }

    logger.info('gbp-oauth', 'callback: connected and tokens stored', {
      by: auth.user.email ?? auth.user.id,
      hasRefreshToken: Boolean(tokens.refresh_token),
      scope: tokens.scope,
      accountCount: diagnostic.accountCount,
      locationCount: locations.length,
      accountsHttpStatus: diagnostic.accountsHttpStatus,
      accountsErrorStatus: diagnostic.accountsError?.googleErrorStatus ?? null,
      accountsErrorMessage: diagnostic.accountsError?.googleErrorMessage ?? null,
    })

    return redirectResult('gbp_connected=1')
  } catch (err) {
    logger.error('gbp-oauth', 'callback: unhandled exception during token exchange', err)
    return redirectResult('gbp_error=unexpected')
  }
}
