// src/app/api/proposals/[id]/invoice/email/route.ts
// Sends the invoice-summary email to a customer. Separate from the existing
// src/app/api/proposals/[id]/invoice/route.ts, which only renders an invoice
// page/PDF for staff — this route is the new "actually email it" action.
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth-guard'
import { sendInvoiceEmail } from '@/lib/email/send'
import { resolveReservationSource } from '@/lib/reservations/commercial-source'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  const db = getSupabaseAdmin()

  try {
    const body = await req.json().catch(() => ({}))
    const recipientEmail: string | undefined = body?.recipient_email

    const { data: proposal, error: propErr } = await db
      .from('proposals')
      .select('*, leads(name, phone, email)')
      .eq('id', params.id)
      .single()
    if (propErr || !proposal) return NextResponse.json({ error: 'Proposal not found' }, { status: 404 })

    const { data: invoice } = await db
      .from('invoices')
      .select('invoice_number, total_amount, balance_due')
      .eq('proposal_id', params.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    // Option A — if an invoice row already exists, its total_amount/
    // balance_due are used as-is (already sourced from the Reservation at
    // creation time, see /invoice/route.ts). Only the fallback for "no
    // invoice generated yet" needs to change: it must resolve the
    // Reservation itself rather than falling back to the (possibly stale)
    // Proposal — read-only, never writes to `proposals`. See commercial-source.ts.
    // Issue 2 (production-hardening pass): resolve regardless of whether an
    // invoice row exists — needed for Package/Venue below even when the
    // total/balance fall through to invoice.total_amount/balance_due.
    const reservationSource = await resolveReservationSource(proposal)
    const fallbackTotal = reservationSource ? reservationSource.grandTotal : Number(proposal.total_price || 0)
    const packageName = reservationSource ? reservationSource.packageName : proposal.package_name
    const venue = reservationSource ? reservationSource.venue : proposal.venue

    const toEmail = recipientEmail || proposal.client_email || (proposal.leads as any)?.email || ''
    const clientName = proposal.client_name || (proposal.leads as any)?.name || 'Valued Client'
    if (!toEmail) return NextResponse.json({ error: 'No recipient email available for this proposal' }, { status: 400 })

    const result = await sendInvoiceEmail(
      toEmail,
      {
        clientName,
        invoiceNumber: invoice?.invoice_number || `${proposal.proposal_number}-INV`,
        proposalNumber: proposal.proposal_number,
        totalAmount: invoice?.total_amount ?? fallbackTotal,
        balanceDue: invoice?.balance_due ?? fallbackTotal,
        eventType: proposal.event_type,
        eventDate: proposal.event_date,
        packageName,
        venue,
      },
      { to: toEmail, relatedEntityType: 'proposal', relatedEntityId: params.id }
    )

    if (result.providerNotConfigured) {
      return NextResponse.json({
        success: false,
        error: 'No email provider configured yet. Set RESEND_API_KEY in your environment to enable sending.',
      }, { status: 503 })
    }
    if (!result.success) {
      logger.error('invoice-email', 'Send failed', result.error, { proposal_id: params.id })
      return NextResponse.json({ error: 'Email send failed', detail: result.error }, { status: 502 })
    }

    return NextResponse.json({ success: true, sent_to: toEmail, provider_message_id: result.providerMessageId })
  } catch (err) {
    logger.error('invoice-email', 'Route failed', err)
    return NextResponse.json({ error: 'Email send failed' }, { status: 500 })
  }
}
