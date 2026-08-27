// src/app/api/google/gbp/sync-locations/route.ts
// Re-runs GBP account/location discovery using the ALREADY-connected
// account's stored credentials (refreshing the access token first if
// needed via gbp-token.ts) -- no fresh OAuth consent screen required.
//
// Built because the GBP audit found a real connected account
// (connected_at set, correct scope, refresh token stored) with
// locations: [] and no way to retry discovery short of disconnecting and
// reconnecting. This also doubles as the foundation for a future
// scheduled reconciliation job (Phase 3 priority 9) -- accepts either an
// authenticated staff session (manual "Sync now" from Settings) or a
// CRON_SECRET bearer token (same pattern as src/app/api/cron/*), so it can
// be wired to a cron schedule later without a second implementation.
//
// Cooldown/backoff: mybusinessaccountmanagement.googleapis.com has an
// easily-exhausted "requests per minute" quota (confirmed in production --
// a single connect attempt hit RESOURCE_EXHAUSTED). This endpoint is the
// ONLY code path that ever calls that API (see callback/route.ts, which
// deliberately does not), but it can still be hit repeatedly by a double
// click, a second browser tab, or an impatient retry -- so a request within
// COOLDOWN_MS of the last attempt is served the cached result instead of
// calling Google again, and the cooldown escalates (capped) after
// consecutive quota errors instead of hammering an already-exhausted quota.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth-guard'
import { getSupabaseAdmin } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { getValidGbpAccessToken } from '@/lib/google/gbp-token'
import { discoverAccountsAndLocations } from '@/lib/google/gbp-client'

const SETTINGS_CATEGORY = 'integration'
const SETTINGS_KEY = 'google_gbp_oauth'
const BASE_COOLDOWN_MS = 30_000
const MAX_COOLDOWN_MS = 30 * 60_000

async function isAuthorized(req: NextRequest): Promise<boolean> {
  const cronSecret = process.env.CRON_SECRET
  const bearer = req.headers.get('authorization')?.replace('Bearer ', '').trim()
  if (cronSecret && bearer === cronSecret) return true

  const auth = await requireRole(['admin', 'manager'])
  return auth.ok
}

export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = getSupabaseAdmin()
  const { data: existing } = await db
    .from('settings')
    .select('value')
    .eq('category', SETTINGS_CATEGORY)
    .eq('key', SETTINGS_KEY)
    .maybeSingle()

  if (!existing) {
    return NextResponse.json({ error: 'not_connected' }, { status: 404 })
  }

  const existingValue = existing.value as Record<string, unknown>
  const priorDiagnostic = (existingValue.discovery_diagnostic ?? null) as { accountsError?: { googleErrorStatus?: string | null } | null } | null
  const priorAttemptAt = existingValue.last_discovery_attempt_at ? new Date(existingValue.last_discovery_attempt_at as string).getTime() : 0
  const consecutiveQuotaErrors = typeof existingValue.consecutive_quota_errors === 'number' ? existingValue.consecutive_quota_errors : 0
  const wasQuotaExceeded = priorDiagnostic?.accountsError?.googleErrorStatus === 'RESOURCE_EXHAUSTED'
  const cooldownMs = wasQuotaExceeded
    ? Math.min(MAX_COOLDOWN_MS, BASE_COOLDOWN_MS * 2 ** consecutiveQuotaErrors)
    : BASE_COOLDOWN_MS
  const elapsedSinceLastAttempt = priorAttemptAt ? Date.now() - priorAttemptAt : Infinity

  // Never call Google again inside the cooldown window -- serves the cached
  // result instead. This is what actually prevents concurrent/duplicate
  // discovery requests (a double click, a second tab, an impatient retry)
  // from hammering a quota that may already be exhausted.
  if (priorAttemptAt && elapsedSinceLastAttempt < cooldownMs) {
    logger.warn('gbp-oauth', 'sync-locations: throttled — serving cached result instead of calling Google again', {
      elapsedSinceLastAttemptMs: elapsedSinceLastAttempt,
      cooldownMs,
      wasQuotaExceeded,
    })
    const cachedLocations = (existingValue.locations ?? []) as unknown[]
    return NextResponse.json(
      {
        throttled: true,
        retryAfterMs: cooldownMs - elapsedSinceLastAttempt,
        locationCount: cachedLocations.length,
        locations: cachedLocations,
        diagnostic: existingValue.discovery_diagnostic ?? null,
      },
      { status: 429 }
    )
  }

  const tokenResult = await getValidGbpAccessToken()
  if (!tokenResult.ok) {
    logger.error('gbp-oauth', 'sync-locations: could not obtain a valid access token', undefined, { reason: tokenResult.error })
    return NextResponse.json({ error: tokenResult.error }, { status: tokenResult.error === 'not_connected' ? 404 : 502 })
  }

  // Exactly ONE discovery attempt per request past this point -- no retry
  // loop, no re-fetch on failure. discoverAccountsAndLocations() itself
  // never retries either (see gbp-client.ts).
  const { locations, diagnostic } = await discoverAccountsAndLocations(tokenResult.accessToken)
  const isQuotaError = diagnostic.accountsError?.googleErrorStatus === 'RESOURCE_EXHAUSTED'

  const { error: saveError } = await db
    .from('settings')
    .update({
      value: {
        ...existingValue,
        locations,
        discovery_diagnostic: diagnostic,
        last_discovery_attempt_at: diagnostic.attemptedAt,
        consecutive_quota_errors: isQuotaError ? consecutiveQuotaErrors + 1 : 0,
      },
    })
    .eq('category', SETTINGS_CATEGORY)
    .eq('key', SETTINGS_KEY)

  if (saveError) {
    logger.error('gbp-oauth', 'sync-locations: saving refreshed locations failed', saveError)
    return NextResponse.json({ error: 'save_failed' }, { status: 500 })
  }

  logger.info('gbp-oauth', 'sync-locations: locations resynced', {
    locationCount: locations.length,
    accountCount: diagnostic.accountCount,
    accountsHttpStatus: diagnostic.accountsHttpStatus,
    accountsErrorStatus: diagnostic.accountsError?.googleErrorStatus ?? null,
    accountsErrorMessage: diagnostic.accountsError?.googleErrorMessage ?? null,
  })
  return NextResponse.json({ locationCount: locations.length, locations, diagnostic })
}
