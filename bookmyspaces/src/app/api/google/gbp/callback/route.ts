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
import crypto from 'crypto'
import { requireRole } from '@/lib/auth-guard'
import { getSupabaseAdmin } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { decodeGbpOAuthState } from '@/lib/google/gbp-oauth-state'

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

interface DiscoveredLocation {
  /** e.g. "accounts/123/locations/456" -- the id future GBP API calls (Posts, Reviews, ...) will need. */
  externalId: string
  displayName: string
}

// Completes the "GBP account -> location" step of the connect flow. Business
// Information API shapes match what src/lib/social/oauth/oauth-service.ts's
// (now-removed) google_business branch already used for the same purpose
// before the Facebook/Instagram connector recovery pass trimmed that file
// down to Facebook/Instagram only -- same endpoints, reused here rather than
// re-derived from scratch. Never throws: a discovery failure must not lose
// an otherwise-successful token exchange, since the token is still useful
// (e.g. to retry discovery later) even if this step fails today.
async function discoverAccountsAndLocations(accessToken: string): Promise<DiscoveredLocation[]> {
  try {
    const accountsRes = await fetch('https://mybusinessaccountmanagement.googleapis.com/v1/accounts', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const accountsJson = (await accountsRes.json().catch(() => ({}))) as {
      accounts?: Array<{ name: string; accountName?: string }>
      error?: { code?: number; status?: string; message?: string }
    }
    const accounts = accountsJson.accounts ?? []

    // Previously silent on both branches below -- "0 locations" and "API call
    // failed" were indistinguishable in production logs (confirmed live: a
    // successful connect with hasRefreshToken:true, correct scope, and
    // locationCount:0 gave no way to tell whether Google rejected the
    // accounts.list call or the account genuinely has none). Logged, not
    // fixed silently, because the actual cause (API not enabled vs. no
    // Business Profile on this Google account vs. something else) changes
    // what the real fix is -- see accounts.google.com/business vs Google
    // Cloud Console API enablement.
    if (!accountsRes.ok) {
      logger.error('gbp-oauth', 'callback: accounts.list call failed', undefined, {
        status: accountsRes.status,
        googleErrorStatus: accountsJson.error?.status,
        googleErrorMessage: accountsJson.error?.message,
      })
      return []
    }
    if (accounts.length === 0) {
      logger.warn('gbp-oauth', 'callback: accounts.list succeeded but returned zero Business Profile accounts for this Google account', {
        status: accountsRes.status,
      })
      return []
    }

    const results: DiscoveredLocation[] = []
    for (const account of accounts) {
      const locationsRes = await fetch(
        `https://mybusinessbusinessinformation.googleapis.com/v1/${account.name}/locations?readMask=name,title`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      )
      const locationsJson = (await locationsRes.json().catch(() => ({}))) as {
        locations?: Array<{ name: string; title?: string }>
        error?: { code?: number; status?: string; message?: string }
      }
      if (!locationsRes.ok) {
        logger.error('gbp-oauth', 'callback: locations.list call failed for an account', undefined, {
          account: account.name,
          status: locationsRes.status,
          googleErrorStatus: locationsJson.error?.status,
          googleErrorMessage: locationsJson.error?.message,
        })
        continue
      }
      for (const loc of locationsJson.locations ?? []) {
        results.push({
          externalId: `${account.name}/${loc.name}`,
          displayName: loc.title ?? account.accountName ?? 'Google Business Profile',
        })
      }
    }
    logger.info('gbp-oauth', 'callback: discovery complete', {
      accountCount: accounts.length,
      locationCount: results.length,
    })
    return results
  } catch (err) {
    logger.error('gbp-oauth', 'callback: account/location discovery failed (non-fatal, token already exchanged)', err)
    return []
  }
}

// AES-256-GCM, keyed off SOCIAL_TOKEN_ENCRYPTION_KEY. sha256 of the raw
// env value derives a fixed 32-byte key regardless of the secret's own
// length/format -- standard practice, not an assumption about that var's
// original shape. Output: "iv.authTag.ciphertext", all base64.
function encryptToken(plaintext: string): string {
  const secret = process.env.SOCIAL_TOKEN_ENCRYPTION_KEY
  if (!secret) throw new Error('SOCIAL_TOKEN_ENCRYPTION_KEY is not set')
  const key = crypto.createHash('sha256').update(secret).digest()
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return [iv.toString('base64'), authTag.toString('base64'), ciphertext.toString('base64')].join('.')
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

    // Completes the flow's last leg -- "GBP account -> location" -- before
    // persisting, so the CRM (via /api/google/gbp/status) has something
    // real to show immediately after connecting, not just "connected: true"
    // with no location. Best-effort: an empty array here still means the
    // token itself saves fine; discoverAccountsAndLocations() never throws.
    const locations = await discoverAccountsAndLocations(tokens.access_token)

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
      locationCount: locations.length,
    })

    return redirectResult('gbp_connected=1')
  } catch (err) {
    logger.error('gbp-oauth', 'callback: unhandled exception during token exchange', err)
    return redirectResult('gbp_error=unexpected')
  }
}
