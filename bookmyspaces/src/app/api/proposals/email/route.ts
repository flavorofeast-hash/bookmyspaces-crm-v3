export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth-guard'
import { sendProposalEmail } from '@/lib/email/send'

export async function POST(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  const supabaseAdmin = getSupabaseAdmin()
  try {
    const { proposal_id, recipient_email, custom_message } = await req.json()
    if (!proposal_id) return NextResponse.json({ error: 'proposal_id required' }, { status: 400 })

    const { data: proposal, error } = await supabaseAdmin.from('proposals').select('*, leads(name, phone, email)').eq('id', proposal_id).single()
    if (error || !proposal) return NextResponse.json({ error: 'Proposal not found' }, { status: 404 })

    const shareUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://bookmyspaces.in'}/proposals/share/${proposal.share_token}`
    const toEmail = recipient_email || proposal.client_email || (proposal.leads as any)?.email || ''
    const clientName = proposal.client_name || (proposal.leads as any)?.name || 'Valued Client'

    if (!toEmail) {
      return NextResponse.json({ error: 'No recipient email available for this proposal' }, { status: 400 })
    }

    // ISS-041: real, server-side send via the shared email system (see
    // src/lib/email/send.ts) — replaces the old mailto:-only implementation.
    // If no email provider is configured yet (RESEND_API_KEY unset), this
    // falls back to the same mailto: link as before, so the button never
    // breaks — it just degrades to "open in your own email client" until a
    // provider is set up.
    const result = await sendProposalEmail(
      toEmail,
      {
        clientName,
        proposalNumber: proposal.proposal_number,
        eventType: proposal.event_type,
        totalPrice: proposal.total_price,
        shareUrl,
        customMessage: custom_message,
      },
      { to: toEmail, relatedEntityType: 'proposal', relatedEntityId: proposal_id }
    )

    const { error: statusUpdateError } = await supabaseAdmin
      .from('proposals')
      .update({ email_sent_at: new Date().toISOString(), status: proposal.status === 'draft' ? 'sent' : proposal.status })
      .eq('id', proposal_id)
    if (statusUpdateError) {
      // Non-fatal: ISS-042 requires the failure to be visible instead of silently swallowed.
      logger.error('proposals-email', 'Failed to update proposal email_sent_at/status', statusUpdateError)
    }

    if (result.providerNotConfigured) {
      const subject = `Your Event Proposal — ${proposal.proposal_number} | BookMySpaces`
      const mailtoBody = [
        `Dear ${clientName},`, '',
        custom_message || `Thank you for your interest in BookMySpaces. Please find your event proposal below.`, '',
        `📋 Proposal: ${proposal.proposal_number}`,
        `🎪 Event: ${proposal.event_type || '-'}`,
        `💰 Package Value: ₹${(proposal.total_price || 0).toLocaleString('en-IN')}`, '',
        `View your complete proposal here:`, shareUrl, '',
        `To confirm your booking, please reply to this email or WhatsApp us at +91 8017035546.`, '',
        `Warm regards,`, `BookMySpaces Team`, `📞 8017035546 | www.bookmyspaces.in`,
      ].join('\n')
      const mailtoUrl = `mailto:${toEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(mailtoBody)}`
      return NextResponse.json({ success: true, method: 'mailto', mailto_url: mailtoUrl, sent_to: toEmail, note: 'No email provider configured — use mailto_url to open in email client' })
    }

    if (!result.success) {
      logger.error('proposals-email', 'Real email send failed', result.error, { proposal_id })
      return NextResponse.json({ error: 'Email send failed', detail: result.error }, { status: 502 })
    }

    return NextResponse.json({ success: true, method: 'email', sent_to: toEmail, provider_message_id: result.providerMessageId })
  } catch (err) {
    logger.error('proposals-email', 'Email route failed', err)
    return NextResponse.json({ error: 'Email send failed' }, { status: 500 })
  }
}
