// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/social/oauth/oauth-service.ts
// Social Connectivity Priority 1 — the actual OAuth2 HTTP calls: build the
// authorize URL, exchange a code for a token, fetch the connected
// account's identity, and (where supported) refresh an expiring token.
//
// Same Result-shaped-return / plain-fetch conventions as
// src/lib/social/adapters/*.ts — no new HTTP client dependency. Every
// function degrades to { ok: false, error } rather than throwing, per
// DEVELOPER_HANDBOOK.md §10.
//
// NOT INDEPENDENTLY VERIFIED AGAINST A LIVE PROVIDER in this sandbox (no
// real app credentials, no network egress to graph.facebook.com/
// linkedin.com/googleapis.com/twitter.com from this environment). Endpoint
// shapes below match each platform's current public API documentation as
// of this writing — re-verify against a real app before relying on this in
// production, same "credential-ready, not live" disclosure as every
// existing adapter file.
// ─────────────────────────────────────────────────────────────────────────────

import { OAUTH_CONFIGS, getRedirectUri, type OAuthCapablePlatform } from './oauth-config'

type Result<T> = { ok: true; value: T } | { ok: false; error: string }

export interface ExchangedToken {
  accessToken: string
  refreshToken: string | null
  /** Seconds until expiry, per the provider's response — null when the provider didn't return one (treated as "does not expire" for that call, e.g. a Meta long-lived token). */
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

export function buildAuthorizationUrl(
  platform: OAuthCapablePlatform,
  state: string,
  appBaseUrl: string,
  codeChallenge?: string
): string {
  const cfg = OAUTH_CONFIGS[platform]
  const params = new URLSearchParams({
    client_id: envValue(cfg.clientIdEnv),
    redirect_uri: getRedirectUri(platform, appBaseUrl),
    response_type: 'code',
    scope: cfg.scopes.join(platform === 'linkedin' ? ' ' : ','),
    state,
  })
  if (cfg.usesPkce && codeChallenge) {
    params.set('code_challenge', codeChallenge)
    params.set('code_challenge_method', 'S256')
  }
  return `${cfg.authorizeUrl}?${params.toString()}`
}

/** Authorization-code -> access token. Body encoding differs by provider (Meta/Google/X want form-encoded POST; LinkedIn also form-encoded) — all four confidential-client platforms here use the same application/x-www-form-urlencoded shape, so one implementation covers them. */
export async function exchangeCodeForToken(
  platform: OAuthCapablePlatform,
  code: string,
  appBaseUrl: string,
  codeVerifier?: string
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
    if (cfg.usesPkce && codeVerifier) body.set('code_verifier', codeVerifier)

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

    // Meta-specific: a Graph API "short-lived" user token from the code
    // exchange above must be exchanged again for a long-lived one (~60
    // days) — Meta has no refresh_token grant (supportsRefresh: false);
    // this second call is how a Meta connection is kept alive long-term,
    // repeated periodically by refresh-service.ts using the SAME long-lived
    // token as its own input (Meta's long-lived-token exchange is
    // idempotent/renewing, not a one-time upgrade).
    if (platform === 'facebook' || platform === 'instagram') {
      const longLived = await exchangeMetaLongLivedToken(accessToken)
      if (longLived.ok) {
        accessToken = longLived.value.accessToken
        expiresIn = longLived.value.expiresInSeconds
      }
      // If the long-lived exchange fails, fall back to the short-lived
      // token rather than failing the whole connection — a short-lived
      // token still lets the operator publish today; status will surface
      // as token_expired soon via refresh-service.ts's health check.
    }

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

/** Public wrapper — refresh-service.ts calls this to "renew" a Meta connection (Meta has no refresh_token grant; renewal is re-running the same long-lived-token exchange against the CURRENT still-valid access token). */
export async function renewMetaLongLivedToken(currentAccessToken: string): Promise<Result<ExchangedToken>> {
  return exchangeMetaLongLivedToken(currentAccessToken)
}

async function exchangeMetaLongLivedToken(shortLivedToken: string): Promise<Result<ExchangedToken>> {
  try {
    const params = new URLSearchParams({
      grant_type: 'fb_exchange_token',
      client_id: envValue('META_APP_ID'),
      client_secret: envValue('META_APP_SECRET'),
      fb_exchange_token: shortLivedToken,
    })
    const res = await fetch(`https://graph.facebook.com/v19.0/oauth/access_token?${params.toString()}`)
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

/** refresh_token grant — only called for platforms with supportsRefresh (LinkedIn, Google Business, X). Meta is handled by re-running the long-lived exchange above, not this function (see refresh-service.ts). */
export async function refreshAccessToken(platform: OAuthCapablePlatform, refreshToken: string): Promise<Result<ExchangedToken>> {
  const cfg = OAUTH_CONFIGS[platform]
  if (!cfg.supportsRefresh) return { ok: false, error: `platform_${platform}_does_not_support_refresh_token_grant` }
  try {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
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
      return { ok: false, error: `refresh_failed: ${(json.error_description as string) ?? (json.error as string) ?? res.status}` }
    }
    return {
      ok: true,
      value: {
        accessToken: json.access_token as string,
        // Some providers (Google) don't rotate the refresh_token on every
        // refresh — keep the existing one when the response omits a new one.
        refreshToken: typeof json.refresh_token === 'string' ? json.refresh_token : refreshToken,
        expiresInSeconds: typeof json.expires_in === 'number' ? json.expires_in : null,
      },
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'refresh_exception' }
  }
}

/** Fetches a human-readable identity (id + display name) for the just-connected account, used to populate social_accounts.external_account_id/display_name so the operator doesn't have to paste them manually. Best-effort simplification, disclosed: for Meta this takes the FIRST Page/connected IG account returned — an operator managing multiple Pages should verify/correct via the existing manual PATCH /api/social/accounts after connecting. `additionalIdentities` (Google Business only) carries every OTHER discovered Location beyond the first, so the callback route can upsert one social_accounts row per Location — the same "multiple connectable accounts of one platform" pattern already used for any platform, reused rather than a new selection UI. */
export async function fetchConnectedIdentity(platform: OAuthCapablePlatform, accessToken: string): Promise<Result<ConnectedIdentity & { pageAccessToken?: string; additionalIdentities?: ConnectedIdentity[] }>> {
  try {
    if (platform === 'facebook' || platform === 'instagram') {
      const res = await fetch(`https://graph.facebook.com/v19.0/me/accounts?fields=id,name,access_token,instagram_business_account&access_token=${encodeURIComponent(accessToken)}`)
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
    }

    if (platform === 'linkedin') {
      const res = await fetch('https://api.linkedin.com/v2/userinfo', { headers: { Authorization: `Bearer ${accessToken}` } })
      const json = (await res.json().catch(() => ({}))) as { sub?: string; name?: string }
      if (!res.ok || !json.sub) return { ok: false, error: 'linkedin_userinfo_failed' }
      return { ok: true, value: { externalAccountId: json.sub, displayName: json.name ?? 'LinkedIn Account' } }
    }

    if (platform === 'google_business') {
      const res = await fetch('https://mybusinessaccountmanagement.googleapis.com/v1/accounts', { headers: { Authorization: `Bearer ${accessToken}` } })
      const json = (await res.json().catch(() => ({}))) as { accounts?: Array<{ name: string; accountName?: string }> }
      const account = json.accounts?.[0]
      if (!account) return { ok: false, error: 'no_google_business_account_found' }

      // Location discovery (Social OAuth -> Publishing credential fix,
      // Google Business follow-up): a Business Account cannot itself
      // receive a localPosts publish — a specific LOCATION under it can
      // (google-business-adapter.ts's own header comment already documents
      // the "accounts/{accountId}/locations/{id}" shape a publish call
      // needs). One extra discovery call here, at OAuth-connect time only —
      // never repeated on every publish — so the resolved Location id can be
      // persisted into social_accounts.external_account_id and reused from
      // there going forward (resolvePublishCredentials() already surfaces
      // whatever is stored there as credentials.externalAccountId).
      const locationsRes = await fetch(
        `https://mybusinessbusinessinformation.googleapis.com/v1/${account.name}/locations?readMask=name,title`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      )
      const locationsJson = (await locationsRes.json().catch(() => ({}))) as { locations?: Array<{ name: string; title?: string }> }
      const locations = locationsJson.locations ?? []
      if (locations.length === 0) return { ok: false, error: 'no_google_business_location_found_for_this_account' }

      const toIdentity = (loc: { name: string; title?: string }): ConnectedIdentity => ({
        externalAccountId: `${account.name}/${loc.name}`,
        displayName: loc.title ?? account.accountName ?? 'Google Business Profile',
      })

      const [first, ...rest] = locations.map(toIdentity)
      return { ok: true, value: { ...first, additionalIdentities: rest.length > 0 ? rest : undefined } }
    }

    if (platform === 'x') {
      const res = await fetch('https://api.twitter.com/2/users/me', { headers: { Authorization: `Bearer ${accessToken}` } })
      const json = (await res.json().catch(() => ({}))) as { data?: { id: string; username?: string; name?: string } }
      if (!res.ok || !json.data?.id) return { ok: false, error: 'x_users_me_failed' }
      return { ok: true, value: { externalAccountId: json.data.id, displayName: json.data.name ?? json.data.username ?? 'X Account' } }
    }

    return { ok: false, error: `unsupported_platform_${platform}` }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'identity_fetch_exception' }
  }
}
