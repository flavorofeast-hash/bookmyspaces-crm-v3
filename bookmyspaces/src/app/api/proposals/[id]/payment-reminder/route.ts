// src/app/api/proposals/[id]/payment-reminder/route.ts
// Staff-triggered "send a payment reminder" action. Computes the outstanding
// balance from the effective total (Reservation's final_room_rate once one
// exists, else the proposal's total price — see commercial-source.ts) minus
// payments received so far — this works whether or not an invoice row
// exists yet for this proposal.
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth-guard'
import { sendPaymentReminderEmail } from '@/lib/email/send'
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

    // Option A — read-only, never writes to `proposals`. See commercial-source.ts.
    const reservationSource = await resolveReservationSource(proposal)

    const { data: payments } = await db
      .from('payments')
      .select('amount')
      .eq('proposal_id', params.id)

    const totalPaid = (payments || []).reduce((sum, p) => sum + Number(p.amount || 0), 0)
    const effectiveTotal = reservationSource ? reservationSource.grandTotal : Number(proposal.total_price || 0)
    const balanceDue = Math.max(0, effectiveTotal - totalPaid)
    const packageName = reservationSource ? reservationSource.packageName : proposal.package_name
    const venue = reservationSource ? reservationSource.venue : proposal.venue

    const toEmail = recipientEmail || proposal.client_email || (proposal.leads as any)?.email || ''
    const clientName = proposal.client_name || (proposal.leads as any)?.name || 'Valued Client'
    if (!toEmail) return NextResponse.json({ error: 'No recipient email available for this proposal' }, { status: 400 })

    if (balanceDue <= 0) {
      return NextResponse.json({ success: false, error: 'This proposal has no outstanding balance — nothing to remind about.' }, { status: 400 })
    }

    const result = await sendPaymentReminderEmail(
      toEmail,
      {
        clientName,
        proposalNumber: proposal.proposal_number,
        balanceDue,
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
      logger.error('payment-reminder-email', 'Send failed', result.error, { proposal_id: params.id })
      return NextResponse.json({ error: 'Email send failed', detail: result.error }, { status: 502 })
    }

    return NextResponse.json({ success: true, sent_to: toEmail, balance_due: balanceDue, provider_message_id: result.providerMessageId })
  } catch (err) {
    logger.error('payment-reminder-email', 'Route failed', err)
    return NextResponse.json({ error: 'Email send failed' }, { status: 500 })
  }
}
