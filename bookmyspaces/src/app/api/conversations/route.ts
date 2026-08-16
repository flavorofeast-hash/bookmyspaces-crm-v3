export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth-guard'

export async function GET(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  const supabaseAdmin = getSupabaseAdmin()
  try {
    const { searchParams } = new URL(req.url)
    const channel = searchParams.get('channel')
    const leadId = searchParams.get('lead_id')
    const sessionId = searchParams.get('session_id')
    const limit = parseInt(searchParams.get('limit') || '20')
    const offset = parseInt(searchParams.get('offset') || '0')

    let query = supabaseAdmin
      .from('conversations')
      .select('*, leads(name, phone, email, status)', { count: 'exact' })
      .order('updated_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (channel) query = query.eq('channel', channel)
    if (leadId) query = query.eq('lead_id', leadId)
    if (sessionId) query = query.eq('session_id', sessionId)

    const { data, error, count } = await query
    if (error) throw error

    // BUGFIX: the WhatsApp CRM page's Send handler gates on `selected.phone`
    // (a flat field), but this table has no `phone` column — only
    // `extracted_phone` and the linked lead's `leads.phone`. Without this,
    // `selected?.phone` was always undefined, so Send silently no-op'd
    // before any fetch was made. Prefer the linked lead's phone (kept in
    // sync via the CRM), fall back to the AI-extracted value.
    const enriched = (data ?? []).map((c) => ({
      ...c,
      phone: c.leads?.phone ?? c.extracted_phone ?? null,
    }))

    return NextResponse.json({ conversations: enriched, total: count })
  } catch (err) {
    logger.error('conversations', 'GET /api/conversations error', err)
    return NextResponse.json({ error: 'Failed to fetch conversations' }, { status: 500 })
  }
}
