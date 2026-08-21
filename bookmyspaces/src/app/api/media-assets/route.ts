// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/app/api/media-assets/route.ts
// Read-only listing for the media asset library (migration 031). Content
// Studio uses this to let an operator pick a real uploaded asset instead of
// typing a raw media URL. No write path here -- import/upload happens
// out-of-band (see the marketing-asset import), this route only lists what
// already exists.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { requireAuth } from '@/lib/auth-guard'
import { getSupabaseAdmin } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response

  try {
    const { searchParams } = new URL(req.url)
    const venueTag = searchParams.get('venue')
    const assetType = searchParams.get('assetType')

    const db = getSupabaseAdmin()
    let query = db
      .from('media_assets')
      .select('id, public_url, original_filename, property_id, venue_tag, asset_type, source, width, height, created_at')
      .order('created_at', { ascending: false })
      .limit(500)

    if (venueTag) query = query.eq('venue_tag', venueTag)
    if (assetType) query = query.eq('asset_type', assetType)

    const { data, error } = await query
    if (error) {
      logger.error('media-assets', 'GET list failed', error)
      return NextResponse.json({ error: 'Failed to list media assets' }, { status: 500 })
    }
    return NextResponse.json({ assets: data ?? [] })
  } catch (err) {
    logger.error('media-assets', 'GET /api/media-assets failed', err)
    return NextResponse.json({ error: 'Failed to list media assets' }, { status: 500 })
  }
}
