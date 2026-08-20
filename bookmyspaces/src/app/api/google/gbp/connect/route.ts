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

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { requireRole } from '@/lib/auth-guard'
import { logger } from '@/lib/logger'

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const SCOPE = 'https://www.googleapis.com/auth/business.manage'
// Next.js route modules may only export handler functions (GET, POST, ...)
// and a small fixed set of config values -- not arbitrary constants -- so
// this name is duplicated (not imported) in ../callback/route.ts. Keep the
// two in sync if it ever changes.
const GBP_OAUTH_STATE_COOKIE = 'gbp_oauth_state'

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

  // CSRF protection: a random, single-use state value carried in an
  // httpOnly cookie across the redirect round-trip and compared against
  // the `state` Google echoes back to the callback. No server-side state
  // storage needed -- the browser itself carries the proof.
  const state = crypto.randomBytes(32).toString('hex')

  const authUrl = new URL(GOOGLE_AUTH_URL)
  authUrl.searchParams.set('client_id', clientId)
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('scope', SCOPE)
  authUrl.searchParams.set('access_type', 'offline') // request a refresh token
  authUrl.searchParams.set('prompt', 'consent')       // force a refresh_token even on a repeat connect
  authUrl.searchParams.set('state', state)

  logger.info('gbp-oauth', 'connect: redirecting to Google consent screen', { by: auth.user.email ?? auth.user.id })

  const response = NextResponse.redirect(authUrl.toString())
  response.cookies.set(GBP_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: true,
    // 'lax', not 'strict' -- this cookie must survive Google's top-level
    // redirect back to our callback, which strict would block.
    sameSite: 'lax',
    maxAge: 600, // 10 minutes -- long enough for the consent screen, short-lived by design
    path: '/api/google/gbp',
  })
  return response
}
