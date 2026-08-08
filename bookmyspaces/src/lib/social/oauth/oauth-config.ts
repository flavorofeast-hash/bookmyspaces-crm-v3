// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/social/oauth/oauth-config.ts
// Social Growth Platform — Production Readiness Pass. Social Connectivity
// Priority 1: real OAuth for Facebook/Instagram/LinkedIn/Google Business/X.
//
// Per-platform OAuth2 config, one shared shape. No new SDK dependency — the
// existing adapters (meta-adapter.ts, x-adapter.ts, etc.) already call
// provider REST APIs with plain fetch(); oauth-service.ts does the same for
// the authorization-code/token/refresh endpoints.
//
// CREDENTIAL-READY, NOT LIVE (same disclosed posture as every adapter's own
// header comment): no real client id/secret exists in any environment this
// code has run in. Each platform requires a registered developer app +
// (for Meta) app review before scopes like pages_manage_posts/
// instagram_content_publish are grantable in production. This module is the
// real, correct implementation of the OAuth2 dance — it does not fabricate
// a working connection, it makes one possible once real app credentials are
// set in env.
// ─────────────────────────────────────────────────────────────────────────────

import type { SocialPlatform } from '@/lib/social/types'

export type OAuthCapablePlatform = 'facebook' | 'instagram' | 'linkedin' | 'google_business' | 'x'

export interface OAuthPlatformConfig {
  platform: OAuthCapablePlatform
  /** Env var names holding the app's client id/secret — never hardcoded, never stored in the DB. */
  clientIdEnv: string
  clientSecretEnv: string
  authorizeUrl: string
  tokenUrl: string
  scopes: string[]
  /** X uses OAuth 2.0 + PKCE; the others use a confidential-client authorization-code grant. */
  usesPkce: boolean
  /** Whether this platform's token endpoint supports a refresh_token grant. Meta does not (see refresh-service.ts's long-lived-token-exchange note). */
  supportsRefresh: boolean
}

// Instagram Business accounts authenticate via the SAME Facebook Login /
// Graph API OAuth flow as Facebook Pages (Meta's own documented model —
// "Instagram Graph API" rides Facebook Login, there is no separate
// Instagram OAuth authorize endpoint). One config, reused for both
// platform keys with different requested scopes.
export const OAUTH_CONFIGS: Record<OAuthCapablePlatform, OAuthPlatformConfig> = {
  facebook: {
    platform: 'facebook',
    clientIdEnv: 'META_APP_ID',
    clientSecretEnv: 'META_APP_SECRET',
    authorizeUrl: 'https://www.facebook.com/v19.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v19.0/oauth/access_token',
    scopes: ['pages_show_list', 'pages_manage_posts', 'pages_read_engagement', 'pages_messaging', 'leads_retrieval'],
    usesPkce: false,
    supportsRefresh: false, // Meta: no refresh_token grant — short-lived token is exchanged for a long-lived one instead (see refresh-service.ts).
  },
  instagram: {
    platform: 'instagram',
    clientIdEnv: 'META_APP_ID',
    clientSecretEnv: 'META_APP_SECRET',
    authorizeUrl: 'https://www.facebook.com/v19.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v19.0/oauth/access_token',
    scopes: ['instagram_basic', 'instagram_content_publish', 'instagram_manage_comments', 'instagram_manage_messages', 'pages_show_list'],
    usesPkce: false,
    supportsRefresh: false,
  },
  linkedin: {
    platform: 'linkedin',
    clientIdEnv: 'LINKEDIN_CLIENT_ID',
    clientSecretEnv: 'LINKEDIN_CLIENT_SECRET',
    authorizeUrl: 'https://www.linkedin.com/oauth/v2/authorization',
    tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken',
    // 'openid'/'profile' added for the userinfo identity call (oauth-service.ts)
    // — LinkedIn's org-posting scopes alone don't return an identifiable "me".
    scopes: ['openid', 'profile', 'w_member_social', 'r_organization_social', 'w_organization_social', 'rw_organization_admin'],
    usesPkce: false,
    supportsRefresh: true,
  },
  google_business: {
    platform: 'google_business',
    clientIdEnv: 'GOOGLE_BUSINESS_CLIENT_ID',
    clientSecretEnv: 'GOOGLE_BUSINESS_CLIENT_SECRET',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: ['https://www.googleapis.com/auth/business.manage'],
    usesPkce: false,
    supportsRefresh: true,
  },
  x: {
    platform: 'x',
    clientIdEnv: 'X_CLIENT_ID',
    clientSecretEnv: 'X_CLIENT_SECRET',
    authorizeUrl: 'https://twitter.com/i/oauth2/authorize',
    tokenUrl: 'https://api.twitter.com/2/oauth2/token',
    scopes: ['tweet.read', 'tweet.write', 'users.read', 'offline.access'],
    usesPkce: true,
    supportsRefresh: true,
  },
}

export function isOAuthCapablePlatform(value: string): value is OAuthCapablePlatform {
  return Object.prototype.hasOwnProperty.call(OAUTH_CONFIGS, value)
}

/** True when both client id/secret env vars are set for this platform — gates the start route the same way adapter.isConfigured() gates a publish call. */
export function isOAuthConfigured(platform: OAuthCapablePlatform): boolean {
  const cfg = OAUTH_CONFIGS[platform]
  return Boolean(process.env[cfg.clientIdEnv] && process.env[cfg.clientSecretEnv])
}

export function getRedirectUri(platform: OAuthCapablePlatform, appBaseUrl: string): string {
  return `${appBaseUrl.replace(/\/$/, '')}/api/social/oauth/${platform}/callback`
}

/** Maps a platform key back to the SocialPlatform union used elsewhere in src/lib/social/**. Same set of 5 by construction — kept as a function (not a cast) so a future platform addition fails loudly if the union and this config drift. */
export function toSocialPlatform(platform: OAuthCapablePlatform): SocialPlatform {
  return platform
}
