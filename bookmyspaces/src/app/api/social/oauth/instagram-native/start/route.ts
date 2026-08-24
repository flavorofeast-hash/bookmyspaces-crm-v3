// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/app/api/social/oauth/instagram-native/start/route.ts
// Begins the native Instagram Login OAuth flow. Separate route from the
// classic [platform]/start (which stays scoped to facebook/instagram via
// oauth-config.ts's OAUTH_CONFIGS) -- see instagram-native-config.ts's
// header for why this is a distinct implementation.
//
// Same admin/manager-only + signed-stateless-state pattern as the classic
// flow's start route.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth-guard'
import { logger } from '@/lib/logger'
import { isAppBaseUrlConfigured, getAppBaseUrl } from '@/lib/social/oauth/oauth-config'
import { isOAuthStateConfigured, encodeOAuthState } from '@/lib/social/oauth/oauth-state'
import { isInstagramNativeOAuthConfigured } from '@/lib/social/oauth/instagram-native-config'
import { buildInstagramNativeAuthorizationUrl } from '@/lib/social/oauth/instagram-native-service'

export async function GET(_req: NextRequest) {
  const auth = await requireRole(['admin', 'manager'])
  if (!auth.ok) return auth.response

  if (!isOAuthStateConfigured()) {
    return NextResponse.json({ error: 'oauth_not_configured: SOCIAL_OAUTH_STATE_SECRET is not set' }, { status: 503 })
  }
  if (!isInstagramNativeOAuthConfigured()) {
    return NextResponse.json({ error: 'oauth_not_configured: META_IG_LOGIN_APP_ID / META_IG_LOGIN_APP_SECRET are not set' }, { status: 503 })
  }
  if (!isAppBaseUrlConfigured()) {
    return NextResponse.json({ error: 'oauth_not_configured: NEXT_PUBLIC_APP_URL is not set' }, { status: 503 })
  }

  try {
    const appBaseUrl = getAppBaseUrl()

    const state = encodeOAuthState({
      platform: 'instagram_native',
      userId: auth.user.id,
      nonce: crypto.randomUUID(),
      issuedAt: Date.now(),
    })

    const url = buildInstagramNativeAuthorizationUrl(state, appBaseUrl)
    return NextResponse.redirect(url)
  } catch (err) {
    logger.error('social-oauth-ig-native', 'GET /api/social/oauth/instagram-native/start failed', err)
    return NextResponse.json({ error: 'Failed to start OAuth flow' }, { status: 500 })
  }
}
