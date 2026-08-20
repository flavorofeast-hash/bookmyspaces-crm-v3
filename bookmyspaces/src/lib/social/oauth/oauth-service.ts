// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/social/oauth/oauth-service.ts
// Facebook/Instagram connector recovery — ported from
// release/v1.0.0-stabilization and trimmed to Facebook/Instagram only (see
// oauth-config.ts's header). Dropped from the source version: PKCE handling
// (X only), refreshAccessToken()/renewMetaLongLivedToken() (no caller
// without the source branch's refresh-service.ts, which this recovery does
// not port), and the LinkedIn/Google Business/X branches of
// fetchConnectedIdentity(). Also fixed: two Graph API calls below still
// referenced v19.0 in the source branch, which Meta's changelog documents
// as expired — bumped to v23.0 to match oauth-config.ts and the existing
// live MetaAdapter (adapters/meta-adapter.ts's GRAPH constant).
//
// The actual OAuth2 HTTP calls: build the authorize URL, exchange a code
// for a token, fetch the connected Page/IG account's identity. Same
// Result-shaped-return / plain-fetch conventions as
// src/lib/social/adapters/*.ts — no new HTTP client dependency.
//
// NOT INDEPENDENTLY VERIFIED AGAINST A LIVE PROVIDER in this sandbox (no
// network egress to graph.facebook.com from this environment) — same
// "credential-ready, not live" disclosure as every existing adapter file.
// ─────────────────────────────────────────────────────────────────────────────

import { OAUTH_CONFIGS, getRedirectUri, type OAuthCapablePlatform } from './oauth-config'

type Result<T> = { ok: true; value: T } | { ok: false; error: string }

export interface ExchangedToken {
  accessToken: string
  refreshToken: string | null
  /** Seconds until expiry, per the provider's response — null when the provider didn't return one. */
  expiresInSeconds: number | null
}

export interface ConnectedIdentity {
  externalAccountId: string
  displayName: string
}

function envValue(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`oauth_not_configured: ${name} is not set`)
  return v
}

export function buildAuthorizationUrl(platform: OAuthCapablePlatform, state: string, appBaseUrl: string): string {
  const cfg = OAUTH_CONFIGS[platform]
  const params = new URLSearchParams({
    client_id: envValue(cfg.clientIdEnv),
    redirect_uri: getRedirectUri(platform, appBaseUrl),
    response_type: 'code',
    scope: cfg.scopes.join(','), // Meta's scope separator
    state,
  })
  return `${cfg.authorizeUrl}?${params.toString()}`
}

/** Authorization-code -> access token. */
export async function exchangeCodeForToken(
  platform: OAuthCapablePlatform,
  code: string,
  appBaseUrl: string
): Promise<Result<ExchangedToken>> {
  const cfg = OAUTH_CONFIGS[platform]
  try {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: getRedirectUri(platform, appBaseUrl),
      client_id: envValue(cfg.clientIdEnv),
      client_secret: envValue(cfg.clientSecretEnv),
    })

    const res = await fetch(cfg.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: body.toString(),
    })
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (!res.ok || !json.access_token) {
      return { ok: false, error: `token_exchange_failed: ${(json.error_description as string) ?? (json.error as string) ?? res.status}` }
    }

    let accessToken = json.access_token as string
    let expiresIn = typeof json.expires_in === 'number' ? json.expires_in : null

    // A Graph API "short-lived" user token from the code exchange above
    // must be exchanged again for a long-lived one (~60 days) -- Meta has
    // no refresh_token grant (supportsRefresh: false in oauth-config.ts).
    const longLived = await exchangeMetaLongLivedToken(accessToken)
    if (longLived.ok) {
      accessToken = longLived.value.accessToken
      expiresIn = longLived.value.expiresInSeconds
    }
    // If the long-lived exchange fails, fall back to the short-lived token
    // rather than failing the whole connection -- it still lets the
    // operator publish today.

    return {
      ok: true,
      value: {
        accessToken,
        refreshToken: typeof json.refresh_token === 'string' ? json.refresh_token : null,
        expiresInSeconds: expiresIn,
      },
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'token_exchange_exception' }
  }
}

async function exchangeMetaLongLivedToken(shortLivedToken: string): Promise<Result<ExchangedToken>> {
  try {
    const params = new URLSearchParams({
      grant_type: 'fb_exchange_token',
      client_id: envValue('META_APP_ID'),
      client_secret: envValue('META_APP_SECRET'),
      fb_exchange_token: shortLivedToken,
    })
    const res = await fetch(`https://graph.facebook.com/v23.0/oauth/access_token?${params.toString()}`)
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (!res.ok || !json.access_token) return { ok: false, error: 'meta_long_lived_exchange_failed' }
    return {
      ok: true,
      value: {
        accessToken: json.access_token as string,
        refreshToken: null,
        expiresInSeconds: typeof json.expires_in === 'number' ? json.expires_in : 60 * 24 * 3600, // Meta long-lived tokens are documented as ~60 days when expires_in is absent.
      },
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'meta_long_lived_exchange_exception' }
  }
}

/** Fetches a human-readable identity (id + display name) for the just-connected account, used to populate social_accounts.external_account_id/display_name so the operator doesn't have to paste them manually. Best-effort simplification, disclosed: takes the FIRST Page/connected IG account returned -- an operator managing multiple Pages should verify/correct via the existing manual PATCH /api/social/accounts after connecting. */
export async function fetchConnectedIdentity(
  platform: OAuthCapablePlatform,
  accessToken: string
): Promise<Result<ConnectedIdentity & { pageAccessToken?: string }>> {
  try {
    const res = await fetch(`https://graph.facebook.com/v23.0/me/accounts?fields=id,name,access_token,instagram_business_account&access_token=${encodeURIComponent(accessToken)}`)
    const json = (await res.json().catch(() => ({}))) as { data?: Array<{ id: string; name: string; access_token: string; instagram_business_account?: { id: string; username?: string } }> }
    const page = json.data?.[0]
    if (!page) return { ok: false, error: 'no_facebook_page_found_for_this_account' }

    if (platform === 'instagram') {
      if (!page.instagram_business_account?.id) return { ok: false, error: 'no_instagram_business_account_linked_to_this_page' }
      return {
        ok: true,
        value: {
          externalAccountId: page.instagram_business_account.id,
          displayName: page.instagram_business_account.username ?? page.name,
          pageAccessToken: page.access_token, // IG publishing uses the Page's access token, per Meta's Instagram Graph API model.
        },
      }
    }
    return { ok: true, value: { externalAccountId: page.id, displayName: page.name, pageAccessToken: page.access_token } }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'identity_fetch_exception' }
  }
}
