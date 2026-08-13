export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { getSupabaseAdmin } from '@/lib/supabase'
import { generateProposalHTML } from '@/lib/proposal-pdf'

// SECURITY (verified, no change): intentionally unauthenticated, same as the
// sibling /pdf route (see its comment + SECURITY_REVIEW.md finding #7). The
// 'sent' -> 'viewed' status flip below IS the proposal-view-tracking feature
// for anonymous customers opening their share link — requireAuth() here
// would silently break that tracking and the customer-facing preview itself.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
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
