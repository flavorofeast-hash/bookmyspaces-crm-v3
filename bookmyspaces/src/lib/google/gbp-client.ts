// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/google/gbp-client.ts
// Google Business Profile API calls -- account/location discovery,
// extracted verbatim (no behavior change) from callback/route.ts so
// gbp-sync-locations (a new re-sync endpoint, no fresh OAuth consent
// required) can reuse it instead of duplicating account/location discovery
// a second time.
// ─────────────────────────────────────────────────────────────────────────────

import { logger } from '@/lib/logger'

export interface DiscoveredLocation {
  /** e.g. "accounts/123/locations/456" -- the id future GBP API calls (Posts, Reviews, ...) will need. */
  externalId: string
  displayName: string
}

/**
 * Completes the "GBP account -> location" step of the connect flow.
 * Business Information API shapes match what
 * src/lib/social/oauth/oauth-service.ts's (now-removed) google_business
 * branch already used for the same purpose before the Facebook/Instagram
 * connector recovery pass trimmed that file down to Facebook/Instagram
 * only -- same endpoints, reused here rather than re-derived from scratch.
 * Never throws: a discovery failure must not lose an otherwise-successful
 * token exchange/refresh, since the token is still useful (e.g. to retry
 * discovery later) even if this step fails today.
 */
export async function discoverAccountsAndLocations(accessToken: string): Promise<DiscoveredLocation[]> {
  try {
    const accountsRes = await fetch('https://mybusinessaccountmanagement.googleapis.com/v1/accounts', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const accountsJson = (await accountsRes.json().catch(() => ({}))) as {
      accounts?: Array<{ name: string; accountName?: string }>
      error?: { code?: number; status?: string; message?: string }
    }
    const accounts = accountsJson.accounts ?? []

    // Logged, not fixed silently, because the actual cause (API not enabled
    // vs. no Business Profile on this Google account vs. something else)
    // changes what the real fix is -- see accounts.google.com/business vs
    // Google Cloud Console API enablement.
    if (!accountsRes.ok) {
      logger.error('gbp-oauth', 'discoverAccountsAndLocations: accounts.list call failed', undefined, {
        status: accountsRes.status,
        googleErrorStatus: accountsJson.error?.status,
        googleErrorMessage: accountsJson.error?.message,
      })
      return []
    }
    if (accounts.length === 0) {
      logger.warn('gbp-oauth', 'discoverAccountsAndLocations: accounts.list succeeded but returned zero Business Profile accounts for this Google account', {
        status: accountsRes.status,
      })
      return []
    }

    const results: DiscoveredLocation[] = []
    for (const account of accounts) {
      const locationsRes = await fetch(
        `https://mybusinessbusinessinformation.googleapis.com/v1/${account.name}/locations?readMask=name,title`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      )
      const locationsJson = (await locationsRes.json().catch(() => ({}))) as {
        locations?: Array<{ name: string; title?: string }>
        error?: { code?: number; status?: string; message?: string }
      }
      if (!locationsRes.ok) {
        logger.error('gbp-oauth', 'discoverAccountsAndLocations: locations.list call failed for an account', undefined, {
          account: account.name,
          status: locationsRes.status,
          googleErrorStatus: locationsJson.error?.status,
          googleErrorMessage: locationsJson.error?.message,
        })
        continue
      }
      for (const loc of locationsJson.locations ?? []) {
        results.push({
          externalId: `${account.name}/${loc.name}`,
          displayName: loc.title ?? account.accountName ?? 'Google Business Profile',
        })
      }
    }
    logger.info('gbp-oauth', 'discoverAccountsAndLocations: discovery complete', {
      accountCount: accounts.length,
      locationCount: results.length,
    })
    return results
  } catch (err) {
    logger.error('gbp-oauth', 'discoverAccountsAndLocations: account/location discovery failed (non-fatal, token already exchanged)', err)
    return []
  }
}
