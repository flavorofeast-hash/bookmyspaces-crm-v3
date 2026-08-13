export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { getSupabaseAdmin } from '@/lib/supabase'
import { generateProposalHTML } from '@/lib/proposal-pdf'
import { requireAuth } from '@/lib/auth-guard'

// SECURITY: previously unauthenticated — any caller who could guess/enumerate
// a proposal UUID could read full client PII/pricing and flip its status to
// 'viewed'. The client-facing share flow uses a separate token-based route
// (src/app/api/proposal/share/[token]/route.ts); this id-keyed route is for
// CRM staff previewing from within the authenticated app.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  const supabaseAdmin = getSupabaseAdmin()
  try {
    const { data: proposal, error } = await supabaseAdmin.from('proposals').select('*').eq('id', params.id).single()
    if (error || !proposal) return new NextResponse('Proposal not found', { status: 404 })

    if (proposal.status === 'sent') {
      await supabaseAdmin.from('proposals').update({ status: 'viewed', viewed_at: new Date().toISOString() }).eq('id', params.id)
    }

    const html = generateProposalHTML(proposal as any)
    return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' } })
  } catch (err) {
    logger.error('proposals-preview', 'Proposal preview error', err)
    return new NextResponse('Error generating proposal', { status: 500 })
  }
}
