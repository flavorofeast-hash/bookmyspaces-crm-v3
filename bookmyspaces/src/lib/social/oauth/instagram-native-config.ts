// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/social/oauth/instagram-native-config.ts
// Native "Instagram API with Instagram Login" OAuth config — separate from
// oauth-config.ts's OAUTH_CONFIGS.instagram, which is the OLDER "Instagram
// API with Facebook Login" flow (Page-linked IG Business accounts,
// graph.facebook.com, instagram_manage_messages). skyline.monurama is a
// native-login account (IGAA-prefixed tokens, confirmed only resolvable
// against graph.instagram.com earlier in this investigation) — the classic
// flow cannot connect it. This file intentionally does not touch, import
// from, or reuse oauth-config.ts.
//
// Endpoints and scope names verified live against Meta's current developer
// docs (developers.facebook.com/documentation/instagram-platform) before
// writing this file:
//   - authorize:            https://www.instagram.com/oauth/authorize
//   - code -> short-lived:  https://api.instagram.com/oauth/access_token
//   - short -> long-lived:  https://graph.instagram.com/access_token
//   - refresh long-lived:   https://graph.instagram.com/refresh_access_token
//   - all subsequent calls: https://graph.instagram.com (never graph.facebook.com)
// Old scope names (instagram_basic, instagram_manage_messages, etc.) are
// deprecated by Meta — using only the current instagram_business_* names.
//
// Requires its own app credential pair from the SAME Meta app: App
// Dashboard -> Instagram -> "API setup with Instagram login" -> Business
// login settings shows a distinct Instagram App ID / Instagram App Secret,
// different from META_APP_ID/META_APP_SECRET (which stay reserved for the
// Webhooks product's signature verification + the classic flow, both
// already working -- not touched by this file).
// ─────────────────────────────────────────────────────────────────────────────

export const INSTAGRAM_AUTHORIZE_URL = 'https://www.instagram.com/oauth/authorize'
export const INSTAGRAM_TOKEN_URL = 'https://api.instagram.com/oauth/access_token'
export const INSTAGRAM_GRAPH_HOST = 'https://graph.instagram.com'

// Narrowest scope set for inbound-DM capture: identity + messaging only.
// Not requesting instagram_business_content_publish or
// instagram_business_manage_comments -- this pass is inbound-DM-only, per
// the explicit "no outbound yet" boundary.
export const INSTAGRAM_NATIVE_SCOPES = ['instagram_business_basic', 'instagram_business_manage_messages']

const CLIENT_ID_ENV = 'META_IG_LOGIN_APP_ID'
const CLIENT_SECRET_ENV = 'META_IG_LOGIN_APP_SECRET'

export function isInstagramNativeOAuthConfigured(): boolean {
  return Boolean(process.env[CLIENT_ID_ENV] && process.env[CLIENT_SECRET_ENV])
}

export function getInstagramNativeClientId(): string {
  const v = process.env[CLIENT_ID_ENV]
  if (!v) throw new Error(`oauth_not_configured: ${CLIENT_ID_ENV} is not set`)
  return v
}

export function getInstagramNativeClientSecret(): string {
  const v = process.env[CLIENT_SECRET_ENV]
  if (!v) throw new Error(`oauth_not_configured: ${CLIENT_SECRET_ENV} is not set`)
  return v
}

export function getInstagramNativeRedirectUri(appBaseUrl: string): string {
  return `${appBaseUrl.replace(/\/$/, '')}/api/social/oauth/instagram-native/callback`
}
