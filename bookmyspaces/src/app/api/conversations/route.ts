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
    //
    // ROOT CAUSE (this pass, "some conversations 400"): two data-shape gaps
    // in that fix. (1) `c.leads` is a to-one embed but this codebase's own
    // /api/inbox route defensively unwraps the same kind of embed via
    // Array.isArray — mirrored here in case PostgREST ever returns it as
    // a single-element array. (2) `??` only falls through on null/undefined,
    // not `""` — a lead saved with an empty-string phone (e.g. created via
    // POST /api/leads, which allows `phone: null`/omitted) was read as a
    // "valid" but blank value instead of falling back to extracted_phone.
    // Conversations/leads with genuinely no phone captured anywhere (never
    // messaged over WhatsApp, no number given in website chat or manual
    // entry) still correctly resolve to null — that's real missing data,
    // not a bug — and now surfaces as an accurate, actionable 400 from
    // /api/whatsapp/send instead of a misleading pass-through.
    const enriched = (data ?? []).map((c) => {
      const leadRow = Array.isArray(c.leads) ? c.leads[0] : c.leads
      const leadPhone = typeof leadRow?.phone === 'string' ? leadRow.phone.trim() : ''
      const extractedPhone = typeof c.extracted_phone === 'string' ? c.extracted_phone.trim() : ''
      return { ...c, phone: leadPhone || extractedPhone || null }
    })

    return NextResponse.json({ conversations: enriched, total: count })
  } catch (err) {
    logger.error('conversations', 'GET /api/conversations error', err)
    return NextResponse.json({ error: 'Failed to fetch conversations' }, { status: 500 })
  }
}
