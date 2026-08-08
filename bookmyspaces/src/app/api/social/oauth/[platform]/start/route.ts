// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/app/api/social/oauth/[platform]/start/route.ts
// Social Connectivity Priority 1 — begins the OAuth2 dance for one
// platform. Admin/manager only (connecting a social account is an
// account-management action, same role gate as POST/PATCH
// /api/social/accounts). Redirects the browser to the provider's
// authorize screen; state is a signed, stateless token (oauth-state.ts) —
// no server-side session/DB row needed to survive the redirect round trip.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth-guard'
import { logger } from '@/lib/logger'
import { isOAuthCapablePlatform, isOAuthConfigured } from '@/lib/social/oauth/oauth-config'
import { isOAuthStateConfigured, encodeOAuthState, generatePkcePair } from '@/lib/social/oauth/oauth-state'
import { buildAuthorizationUrl } from '@/lib/social/oauth/oauth-service'

export async function GET(req: NextRequest, { params }: { params: { platform: string } }) {
  const auth = await requireRole(['admin', 'manager'])
  if (!auth.ok) return auth.response

  const platform = params.platform
  if (!isOAuthCapablePlatform(platform)) {
    return NextResponse.json({ error: `OAuth is not supported for platform "${platform}"` }, { status: 400 })
  }
  if (!isOAuthStateConfigured()) {
    return NextResponse.json({ error: 'oauth_not_configured: SOCIAL_OAUTH_STATE_SECRET is not set' }, { status: 503 })
  }
  if (!isOAuthConfigured(platform)) {
    return NextResponse.json({ error: `oauth_not_configured: client id/secret env vars are not set for ${platform}` }, { status: 503 })
  }

  try {
    const appBaseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://bookmyspaces.in'
    const pkce = platform === 'x' ? generatePkcePair() : null

    const state = encodeOAuthState({
      platform,
      userId: auth.user.id,
      nonce: crypto.randomUUID(),
      issuedAt: Date.now(),
      codeVerifier: pkce?.codeVerifier,
    })

    const url = buildAuthorizationUrl(platform, state, appBaseUrl, pkce?.codeChallenge)
    return NextResponse.redirect(url)
  } catch (err) {
    logger.error('social-oauth', `GET /api/social/oauth/${platform}/start failed`, err)
    return NextResponse.json({ error: 'Failed to start OAuth flow' }, { status: 500 })
  }
}
