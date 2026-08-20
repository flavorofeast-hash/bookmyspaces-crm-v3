// src/app/api/google/gbp/status/route.ts
// Read-only connection status for the CRM's "GBP account -> location -> CRM"
// step -- lets the Settings page show whether Google Business is connected
// and which locations were discovered, without ever exposing the encrypted
// tokens themselves (or anything derived from them) to the browser.
//
// Same role gate as connect/callback (admin/manager) -- connection status
// is account-management information, not general staff-visible data.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth-guard'
import { getSupabaseAdmin } from '@/lib/supabase'
import { logger } from '@/lib/logger'

const SETTINGS_CATEGORY = 'integration'
const SETTINGS_KEY = 'google_gbp_oauth'

interface StoredGbpSettings {
  scope?: string
  expires_at?: string
  connected_at?: string
  locations?: Array<{ externalId: string; displayName: string }>
}

export async function GET() {
  const auth = await requireRole(['admin', 'manager'])
  if (!auth.ok) return auth.response

  try {
    const db = getSupabaseAdmin()
    const { data, error } = await db
      .from('settings')
      .select('value, updated_at, updated_by')
      .eq('category', SETTINGS_CATEGORY)
      .eq('key', SETTINGS_KEY)
      .maybeSingle()

    if (error) {
      logger.error('gbp-oauth', 'status: read failed', error)
      return NextResponse.json({ error: 'Failed to read connection status' }, { status: 500 })
    }

    if (!data) {
      return NextResponse.json({ connected: false, locations: [] })
    }

    const value = data.value as StoredGbpSettings
    return NextResponse.json({
      connected: true,
      connectedAt: value.connected_at ?? data.updated_at,
      connectedBy: data.updated_by ?? null,
      scope: value.scope ?? null,
      expiresAt: value.expires_at ?? null,
      locations: value.locations ?? [],
    })
  } catch (err) {
    logger.error('gbp-oauth', 'status: unhandled exception', err)
    return NextResponse.json({ error: 'Failed to read connection status' }, { status: 500 })
  }
}
