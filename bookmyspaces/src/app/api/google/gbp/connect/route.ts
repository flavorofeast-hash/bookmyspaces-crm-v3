// src/app/api/google/gbp/connect/route.ts
// Google Business Profile OAuth — step 1 of 2 (see ../callback/route.ts).
//
// Starts the OAuth 2.0 authorization-code flow for Google Business Profile
// management (scope: business.manage). Deliberately kept separate from
// src/app/api/auth/* -- that path owns Supabase's staff-login session and
// is explicitly off-limits for this change; this route requests a
// narrowly-scoped, unrelated Google API grant that has nothing to do with
// who's logged into the CRM.
//
// Foundation only, per scope: this route and its callback prove the OAuth
// mechanics end-to-end and persist the resulting tokens (encrypted) so the
// foundation is actually verifiable. Picking a specific GBP account/
// location, refresh-token rotation, and multi-location support are NOT
// built here -- that's GBP account/location management, a separate pass.
//
// State handling: HMAC-signed, stateless (src/lib/google/gbp-oauth-state.ts)
// -- not a cookie. A production test showed the cookie arriving at the
// callback but not matching what was set here, on a single request with no
// duplicate connect/callback calls in the logs; same root cause
// src/lib/social/oauth/oauth-state.ts's header already documents for
// Facebook/Instagram ("serverless has no reliable place to stash a CSRF
// nonce between the redirect-out and the provider's redirect-back"). Signed
// state carries everything the callback needs in the state param itself, so
// there's nothing to stash.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { requireRole } from '@/lib/auth-guard'
import { logger } from '@/lib/logger'
import { encodeGbpOAuthState, isGbpOAuthStateConfigured } from '@/lib/google/gbp-oauth-state'

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const SCOPE = 'https://www.googleapis.com/auth/business.manage'

export async function GET(req: NextRequest) {
  // Connecting the business's Google account is a higher-stakes action
  // than ordinary staff use -- requires admin/manager, same as the other
  // account-level routes (see requireRole() callers elsewhere in the app).
  const auth = await requireRole(['admin', 'manager'])
  if (!auth.ok) return auth.response

  const clientId = process.env.GOOGLE_GBP_CLIENT_ID
  const redirectUri = process.env.GOOGLE_GBP_REDIRECT_URI

  if (!clientId || !redirectUri) {
    logger.error('gbp-oauth', 'connect: missing GOOGLE_GBP_CLIENT_ID or GOOGLE_GBP_REDIRECT_URI')
    return NextResponse.json(
      { error: 'Google Business Profile OAuth is not configured yet.' },
      { status: 500 }
    )
  }

  if (!isGbpOAuthStateConfigured()) {
    logger.error('gbp-oauth', 'connect: missing SOCIAL_OAUTH_STATE_SECRET')
    return NextResponse.json(
      { error: 'Google Business Profile OAuth is not configured yet.' },
      { status: 500 }
    )
  }

  // CSRF protection: HMAC-signed state carrying the requesting user's id and
  // a random single-use nonce (the actual CSRF-defeating value), verified
  // in the callback without needing any cookie/session lookup.
  const state = encodeGbpOAuthState({
    userId: auth.user.id,
    nonce: crypto.randomBytes(16).toString('hex'),
    issuedAt: Date.now(),
  })

  const authUrl = new URL(GOOGLE_AUTH_URL)
  authUrl.searchParams.set('client_id', clientId)
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('scope', SCOPE)
  authUrl.searchParams.set('access_type', 'offline') // request a refresh token
  authUrl.searchParams.set('prompt', 'consent')       // force a refresh_token even on a repeat connect
  authUrl.searchParams.set('state', state)

  logger.info('gbp-oauth', 'connect: redirecting to Google consent screen', { by: auth.user.email ?? auth.user.id })

  return NextResponse.redirect(authUrl.toString())
}
