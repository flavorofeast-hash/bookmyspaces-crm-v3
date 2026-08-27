// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/google/gbp-client.ts
// Google Business Profile API calls -- account/location discovery.
//
// Endpoints verified live against Google's current API reference during
// this pass (not assumed):
//   accounts.list   -> GET https://mybusinessaccountmanagement.googleapis.com/v1/accounts
//   locations.list  -> GET https://mybusinessbusinessinformation.googleapis.com/v1/{account}/locations?readMask=...
// These are two SEPARATE Google Cloud APIs ("My Business Account
// Management API" and "My Business Business Information API") that must
// each be individually enabled in the Cloud project -- a valid OAuth scope
// (business.manage) does not imply either API is enabled. A documented,
// common real-world failure: Account Management API not enabled/quota=0
// blocks accounts.list even when Business Information API works fine.
//
// Returns full diagnostics alongside the discovered locations so a zero-
// location result is never silently indistinguishable from "no Business
// Profile" vs "API not enabled" vs "wrong scope" vs a transient error --
// exactly the ambiguity that made the original "No locations discovered
// yet" UI unable to say anything more specific.
// ─────────────────────────────────────────────────────────────────────────────

import { logger } from '@/lib/logger'

export interface DiscoveredLocation {
  /** e.g. "accounts/123/locations/456" -- the id future GBP API calls (Posts, Reviews, ...) will need. */
  externalId: string
  displayName: string
}

export interface AccountDiscoveryError {
  httpStatus: number
  googleErrorStatus: string | null
  googleErrorMessage: string | null
}

export interface PerAccountResult {
  accountName: string
  locationsHttpStatus: number
  locationCount: number
  error: AccountDiscoveryError | null
}

export interface DiscoveryDiagnostic {
  accountsHttpStatus: number | null
  accountsError: AccountDiscoveryError | null
  accountCount: number
  perAccount: PerAccountResult[]
  totalLocationCount: number
  /** ISO timestamp of this discovery attempt -- lets the UI show "last checked" even when it found nothing. */
  attemptedAt: string
}

export interface DiscoveryOutcome {
  locations: DiscoveredLocation[]
  diagnostic: DiscoveryDiagnostic
}

function extractGoogleError(json: { error?: { code?: number; status?: string; message?: string } }): AccountDiscoveryError | null {
  if (!json.error) return null
  return {
    httpStatus: json.error.code ?? 0,
    googleErrorStatus: json.error.status ?? null,
    googleErrorMessage: json.error.message ?? null,
  }
}

/**
 * Completes the "GBP account -> location" step of the connect flow.
 * Never throws: a discovery failure must not lose an otherwise-successful
 * token exchange/refresh, since the token is still useful (e.g. to retry
 * discovery later) even if this step fails today.
 */
export async function discoverAccountsAndLocations(accessToken: string): Promise<DiscoveryOutcome> {
  const attemptedAt = new Date().toISOString()

  try {
    const accountsRes = await fetch('https://mybusinessaccountmanagement.googleapis.com/v1/accounts', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const accountsJson = (await accountsRes.json().catch(() => ({}))) as {
      accounts?: Array<{ name: string; accountName?: string }>
      error?: { code?: number; status?: string; message?: string }
    }
    const accounts = accountsJson.accounts ?? []
    const accountsError = extractGoogleError(accountsJson)

    // Logged, not fixed silently, because the actual cause (API not enabled
    // vs. no Business Profile on this Google account vs. something else)
    // changes what the real fix is -- see accounts.google.com/business vs
    // Google Cloud Console API enablement.
    if (!accountsRes.ok) {
      logger.error('gbp-oauth', 'discoverAccountsAndLocations: accounts.list call failed', undefined, {
        status: accountsRes.status,
        googleErrorStatus: accountsError?.googleErrorStatus ?? null,
        googleErrorMessage: accountsError?.googleErrorMessage ?? null,
      })
      return {
        locations: [],
        diagnostic: {
          accountsHttpStatus: accountsRes.status, accountsError, accountCount: 0,
          perAccount: [], totalLocationCount: 0, attemptedAt,
        },
      }
    }
    if (accounts.length === 0) {
      logger.warn('gbp-oauth', 'discoverAccountsAndLocations: accounts.list succeeded but returned zero Business Profile accounts for this Google account', {
        status: accountsRes.status,
      })
      return {
        locations: [],
        diagnostic: {
          accountsHttpStatus: accountsRes.status, accountsError: null, accountCount: 0,
          perAccount: [], totalLocationCount: 0, attemptedAt,
        },
      }
    }

    const results: DiscoveredLocation[] = []
    const perAccount: PerAccountResult[] = []
    for (const account of accounts) {
      const locationsRes = await fetch(
        `https://mybusinessbusinessinformation.googleapis.com/v1/${account.name}/locations?readMask=name,title`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      )
      const locationsJson = (await locationsRes.json().catch(() => ({}))) as {
        locations?: Array<{ name: string; title?: string }>
        error?: { code?: number; status?: string; message?: string }
      }
      const locationsError = extractGoogleError(locationsJson)
      if (!locationsRes.ok) {
        logger.error('gbp-oauth', 'discoverAccountsAndLocations: locations.list call failed for an account', undefined, {
          account: account.name,
          status: locationsRes.status,
          googleErrorStatus: locationsError?.googleErrorStatus ?? null,
          googleErrorMessage: locationsError?.googleErrorMessage ?? null,
        })
        perAccount.push({ accountName: account.name, locationsHttpStatus: locationsRes.status, locationCount: 0, error: locationsError })
        continue
      }
      const foundHere = locationsJson.locations ?? []
      for (const loc of foundHere) {
        results.push({
          externalId: `${account.name}/${loc.name}`,
          displayName: loc.title ?? account.accountName ?? 'Google Business Profile',
        })
      }
      perAccount.push({ accountName: account.name, locationsHttpStatus: locationsRes.status, locationCount: foundHere.length, error: null })
    }
    logger.info('gbp-oauth', 'discoverAccountsAndLocations: discovery complete', {
      accountCount: accounts.length,
      locationCount: results.length,
    })
    return {
      locations: results,
      diagnostic: {
        accountsHttpStatus: accountsRes.status, accountsError: null, accountCount: accounts.length,
        perAccount, totalLocationCount: results.length, attemptedAt,
      },
    }
  } catch (err) {
    logger.error('gbp-oauth', 'discoverAccountsAndLocations: account/location discovery failed (non-fatal, token already exchanged)', err)
    return {
      locations: [],
      diagnostic: {
        accountsHttpStatus: null,
        accountsError: { httpStatus: 0, googleErrorStatus: 'EXCEPTION', googleErrorMessage: err instanceof Error ? err.message : String(err) },
        accountCount: 0, perAccount: [], totalLocationCount: 0, attemptedAt,
      },
    }
  }
}
