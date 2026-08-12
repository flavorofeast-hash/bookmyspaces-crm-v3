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
    // Graph API v19.0 expired 2026-05-21 per developers.facebook.com/docs/
    // graph-api/changelog (confirmed live during this audit, today's date is
    // past that cutoff) — bumped to v23.0 to match meta-adapter.ts's own
    // GRAPH constant (adapters/meta-adapter.ts line 27), so the OAuth
    // endpoints and the Graph API calls made with the resulting token are on
    // the same, still-current (valid until 2027-10-08) version.
    authorizeUrl: 'https://www.facebook.com/v23.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v23.0/oauth/access_token',
    // RC fix — "Invalid Scopes" from Facebook's OAuth dialog: pages_messaging
    // (needs pages_manage_metadata as a co-requisite) and leads_retrieval
    // (needs Ads Management Standard Access + ads_management/ads_read/
    // business_management/pages_manage_ads — the Marketing API product,
    // which this app has not added and doesn't need) are not requestable by
    // this app's current Meta App Dashboard configuration. Neither is a
    // stated CRM requirement (no Lead Ads, no Messenger inbox), so both are
    // dropped rather than pursuing product/App Review setup for unused
    // scopes. pages_manage_metadata added in leads_retrieval's place — it's
    // the actual permission Meta's docs list for "receive page webhooks"
    // (one of this app's real requirements), and pages_show_list is already
    // its only dependency, already present below.
    scopes: ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'pages_manage_metadata'],
    usesPkce: false,
    supportsRefresh: false, // Meta: no refresh_token grant — short-lived token is exchanged for a long-lived one instead (see refresh-service.ts).
  },
  instagram: {
    platform: 'instagram',
    clientIdEnv: 'META_APP_ID',
    clientSecretEnv: 'META_APP_SECRET',
    // Same expired-v19.0 -> v23.0 fix as facebook above (shared Meta Login /
    // Graph API OAuth endpoint, see this file's header comment).
    authorizeUrl: 'https://www.facebook.com/v23.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v23.0/oauth/access_token',
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

// RC blocker fix — the redirect_uri sent to Facebook/Instagram (Meta),
// Google Business, LinkedIn, and X's authorize endpoint MUST byte-for-byte
// match the redirect_uri sent again during the token exchange, and must be
// the URL those apps are actually registered under. NEXT_PUBLIC_APP_URL is
// the only source for this — no hardcoded domain fallback, because a silent
// fallback to the wrong domain (e.g. bookmyspaces.in instead of the real
// crm.bookmyspaces.in production host) produces a redirect_uri mismatch
// error from the provider, or worse, silently registers/exchanges against
// a domain nobody controls.

/** True when NEXT_PUBLIC_APP_URL is set — gates the OAuth start/callback routes the same way isOAuthConfigured()/isOAuthStateConfigured() do. */
export function isAppBaseUrlConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_APP_URL)
}

/** The one and only source for the OAuth redirect_uri's base — throws rather than falling back to any hardcoded domain. Callers must check isAppBaseUrlConfigured() first and fail gracefully (matching every other "not configured" check in this file) instead of letting this throw reach the user. */
export function getAppBaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_APP_URL
  if (!url) throw new Error('oauth_not_configured: NEXT_PUBLIC_APP_URL is not set')
  return url
}

/** Maps a platform key back to the SocialPlatform union used elsewhere in src/lib/social/**. Same set of 5 by construction — kept as a function (not a cast) so a future platform addition fails loudly if the union and this config drift. */
export function toSocialPlatform(platform: OAuthCapablePlatform): SocialPlatform {
  return platform
}
