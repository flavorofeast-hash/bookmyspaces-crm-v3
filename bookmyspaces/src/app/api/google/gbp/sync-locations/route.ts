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

  const tokenResult = await getValidGbpAccessToken()
  if (!tokenResult.ok) {
    logger.error('gbp-oauth', 'sync-locations: could not obtain a valid access token', undefined, { reason: tokenResult.error })
    return NextResponse.json({ error: tokenResult.error }, { status: tokenResult.error === 'not_connected' ? 404 : 502 })
  }

  const locations = await discoverAccountsAndLocations(tokenResult.accessToken)

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

  const { error: saveError } = await db
    .from('settings')
    .update({ value: { ...(existing.value as Record<string, unknown>), locations } })
    .eq('category', SETTINGS_CATEGORY)
    .eq('key', SETTINGS_KEY)

  if (saveError) {
    logger.error('gbp-oauth', 'sync-locations: saving refreshed locations failed', saveError)
    return NextResponse.json({ error: 'save_failed' }, { status: 500 })
  }

  logger.info('gbp-oauth', 'sync-locations: locations resynced', { locationCount: locations.length })
  return NextResponse.json({ locationCount: locations.length, locations })
}
