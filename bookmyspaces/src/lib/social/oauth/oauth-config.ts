// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/social/oauth/oauth-config.ts
// Facebook/Instagram connector recovery — ported from
// release/v1.0.0-stabilization (which built real OAuth for five platforms)
// and trimmed to exactly the two this pass restores. LinkedIn/Google
// Business/X are deliberately NOT included: Google Business already has its
// own, separate OAuth implementation on main (src/app/api/google/gbp/*,
// GOOGLE_GBP_CLIENT_ID/SECRET/REDIRECT_URI) and must not be duplicated or
// collided with here; LinkedIn/X were never part of this recovery's scope.
//
// Per-platform OAuth2 config. No new SDK dependency — plain fetch(), same
// convention as the existing MetaAdapter (adapters/meta-adapter.ts).
//
// CREDENTIAL-READY: uses the same META_APP_ID/META_APP_SECRET already live
// for the Meta social/WhatsApp integration on this app — no new env vars
// needed for Facebook/Instagram specifically.
// ─────────────────────────────────────────────────────────────────────────────

import type { SocialPlatform } from '@/lib/social/types'

export type OAuthCapablePlatform = 'facebook' | 'instagram'

export interface OAuthPlatformConfig {
  platform: OAuthCapablePlatform
  /** Env var names holding the app's client id/secret — never hardcoded, never stored in the DB. */
  clientIdEnv: string
  clientSecretEnv: string
  authorizeUrl: string
  tokenUrl: string
  scopes: string[]
  supportsRefresh: boolean
}

// Instagram Business accounts authenticate via the SAME Facebook Login /
// Graph API OAuth flow as Facebook Pages (Meta's own documented model —
// there is no separate Instagram OAuth authorize endpoint). One config
// shape, reused for both platform keys with different requested scopes.
// Graph API version matches meta-adapter.ts's own GRAPH constant (v23.0) —
// the source branch this was ported from still referenced v19.0 in a
// couple of spots, which Meta's own changelog documents as expired.
export const OAUTH_CONFIGS: Record<OAuthCapablePlatform, OAuthPlatformConfig> = {
  facebook: {
    platform: 'facebook',
    clientIdEnv: 'META_APP_ID',
    clientSecretEnv: 'META_APP_SECRET',
    authorizeUrl: 'https://www.facebook.com/v23.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v23.0/oauth/access_token',
    scopes: ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'pages_manage_metadata'],
    supportsRefresh: false, // Meta: no refresh_token grant -- short-lived token is exchanged for a long-lived one instead (see oauth-service.ts).
  },
  instagram: {
    platform: 'instagram',
    clientIdEnv: 'META_APP_ID',
    clientSecretEnv: 'META_APP_SECRET',
    authorizeUrl: 'https://www.facebook.com/v23.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v23.0/oauth/access_token',
    scopes: ['instagram_basic', 'instagram_content_publish', 'instagram_manage_comments', 'instagram_manage_messages', 'pages_show_list'],
    supportsRefresh: false,
  },
}

export function isOAuthCapablePlatform(value: string): value is OAuthCapablePlatform {
  return Object.prototype.hasOwnProperty.call(OAUTH_CONFIGS, value)
}

/** True when both client id/secret env vars are set for this platform. */
export function isOAuthConfigured(platform: OAuthCapablePlatform): boolean {
  const cfg = OAUTH_CONFIGS[platform]
  return Boolean(process.env[cfg.clientIdEnv] && process.env[cfg.clientSecretEnv])
}

export function getRedirectUri(platform: OAuthCapablePlatform, appBaseUrl: string): string {
  return `${appBaseUrl.replace(/\/$/, '')}/api/social/oauth/${platform}/callback`
}

// The redirect_uri sent to Meta's authorize endpoint MUST byte-for-byte
// match the redirect_uri sent again during the token exchange, and must be
// the URL the app is actually registered under. NEXT_PUBLIC_APP_URL is the
// only source for this -- no hardcoded domain fallback.

/** True when NEXT_PUBLIC_APP_URL is set. */
export function isAppBaseUrlConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_APP_URL)
}

/** The one and only source for the OAuth redirect_uri's base -- throws rather than falling back to any hardcoded domain. Callers must check isAppBaseUrlConfigured() first. */
export function getAppBaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_APP_URL
  if (!url) throw new Error('oauth_not_configured: NEXT_PUBLIC_APP_URL is not set')
  return url
}

/** Maps a platform key back to the SocialPlatform union used elsewhere in src/lib/social/**. */
export function toSocialPlatform(platform: OAuthCapablePlatform): SocialPlatform {
  return platform
}
