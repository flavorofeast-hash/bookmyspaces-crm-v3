// src/lib/email/templates.ts
// ─────────────────────────────────────────────────────────────────────────────
// Reusable email templates. Every function here returns a plain
// { subject, html, text } object — nothing here talks to the database or a
// provider, so these are easy to unit-test and easy to reuse from any route.
// ─────────────────────────────────────────────────────────────────────────────

const BUSINESS_PHONE = '8017035546'
const BUSINESS_NAME = 'BookMySpaces'

export interface EmailTemplate {
  subject: string
  html: string
  text: string
}

function inr(n: number | null | undefined): string {
  return '₹' + Number(n || 0).toLocaleString('en-IN')
}

// Shared visual wrapper so every email looks consistent without repeating
// the same HTML boilerplate in every template function below.
function wrapHtml(bodyHtml: string): string {
  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:24px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;">
          <tr>
            <td style="background:#111827;padding:20px 32px;">
              <span style="color:#ffffff;font-size:20px;font-weight:bold;">${BUSINESS_NAME}</span>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;color:#111827;font-size:14px;line-height:1.6;">
              ${bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px;background:#f9fafb;color:#6b7280;font-size:12px;">
              ${BUSINESS_NAME} · 📞 ${BUSINESS_PHONE} · www.bookmyspaces.in
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

// ─── Proposal ──────────────────────────────────────────────────────────────

export interface ProposalEmailData {
  clientName: string
  proposalNumber: string
  eventType: string
  totalPrice: number
  shareUrl: string
  customMessage?: string
}

export function proposalEmail(data: ProposalEmailData): EmailTemplate {
  const subject = `Your Event Proposal — ${data.proposalNumber} | ${BUSINESS_NAME}`
  const intro = data.customMessage || `Thank you for your interest in ${BUSINESS_NAME}. Please find your event proposal below.`

  const html = wrapHtml(`
    <p>Dear ${data.clientName},</p>
    <p>${intro}</p>
    <table role="presentation" width="100%" cellpadding="6" style="margin:16px 0;">
      <tr><td style="color:#6b7280;">Proposal</td><td><b>${data.proposalNumber}</b></td></tr>
      <tr><td style="color:#6b7280;">Event</td><td>${data.eventType || '—'}</td></tr>
      <tr><td style="color:#6b7280;">Package Value</td><td><b>${inr(data.totalPrice)}</b></td></tr>
    </table>
    <p><a href="${data.shareUrl}" style="display:inline-block;background:#111827;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;">View Your Proposal</a></p>
    <p>To confirm your booking, please reply to this email or WhatsApp us at +91 ${BUSINESS_PHONE}.</p>
    <p>Warm regards,<br/>${BUSINESS_NAME} Team</p>
  `)

  const text = [
    `Dear ${data.clientName},`, '',
    intro, '',
    `Proposal: ${data.proposalNumber}`,
    `Event: ${data.eventType || '—'}`,
    `Package Value: ${inr(data.totalPrice)}`, '',
    `View your complete proposal here: ${data.shareUrl}`, '',
    `To confirm your booking, please reply to this email or WhatsApp us at +91 ${BUSINESS_PHONE}.`, '',
    `Warm regards,`, `${BUSINESS_NAME} Team`, `📞 ${BUSINESS_PHONE} | www.bookmyspaces.in`,
  ].join('\n')

  return { subject, html, text }
}

// ─── Invoice ───────────────────────────────────────────────────────────────

export interface InvoiceEmailData {
  clientName: string
  invoiceNumber: string
  proposalNumber: string
  totalAmount: number
  balanceDue: number
  eventType: string
  eventDate: string | null
}

export function invoiceEmail(data: InvoiceEmailData): EmailTemplate {
  const subject = `Invoice ${data.invoiceNumber} — ${BUSINESS_NAME}`

  const html = wrapHtml(`
    <p>Dear ${data.clientName},</p>
    <p>Please find your invoice details for your upcoming event below.</p>
    <table role="presentation" width="100%" cellpadding="6" style="margin:16px 0;">
      <tr><td style="color:#6b7280;">Invoice</td><td><b>${data.invoiceNumber}</b></td></tr>
      <tr><td style="color:#6b7280;">Proposal</td><td>${data.proposalNumber}</td></tr>
      <tr><td style="color:#6b7280;">Event</td><td>${data.eventType || '—'}</td></tr>
      <tr><td style="color:#6b7280;">Total Amount</td><td><b>${inr(data.totalAmount)}</b></td></tr>
      <tr><td style="color:#6b7280;">Balance Due</td><td><b>${inr(data.balanceDue)}</b></td></tr>
    </table>
    <p>If you have any questions about this invoice, please reply to this email or WhatsApp us at +91 ${BUSINESS_PHONE}.</p>
    <p>Warm regards,<br/>${BUSINESS_NAME} Team</p>
  `)

  const text = [
    `Dear ${data.clientName},`, '',
    `Please find your invoice details for your upcoming event below.`, '',
    `Invoice: ${data.invoiceNumber}`,
    `Proposal: ${data.proposalNumber}`,
    `Event: ${data.eventType || '—'}`,
    `Total Amount: ${inr(data.totalAmount)}`,
    `Balance Due: ${inr(data.balanceDue)}`, '',
    `If you have any questions, please reply to this email or WhatsApp us at +91 ${BUSINESS_PHONE}.`, '',
    `Warm regards,`, `${BUSINESS_NAME} Team`,
  ].join('\n')

  return { subject, html, text }
}

// ─── Payment reminder ──────────────────────────────────────────────────────

export interface PaymentReminderEmailData {
  clientName: string
  proposalNumber: string
  balanceDue: number
  eventType: string
  eventDate: string | null
}

export function paymentReminderEmail(data: PaymentReminderEmailData): EmailTemplate {
  const subject = `Payment Reminder — ${data.proposalNumber} | ${BUSINESS_NAME}`
  const eventDateLabel = data.eventDate
    ? new Date(data.eventDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
    : '—'

  const html = wrapHtml(`
    <p>Dear ${data.clientName},</p>
    <p>This is a friendly reminder about the pending balance for your upcoming event.</p>
    <table role="presentation" width="100%" cellpadding="6" style="margin:16px 0;">
      <tr><td style="color:#6b7280;">Proposal</td><td><b>${data.proposalNumber}</b></td></tr>
      <tr><td style="color:#6b7280;">Event</td><td>${data.eventType || '—'} on ${eventDateLabel}</td></tr>
      <tr><td style="color:#6b7280;">Balance Due</td><td><b>${inr(data.balanceDue)}</b></td></tr>
    </table>
    <p>Please arrange payment at your earliest convenience, or reply to this email / WhatsApp us at +91 ${BUSINESS_PHONE} if you have questions.</p>
    <p>Warm regards,<br/>${BUSINESS_NAME} Team</p>
  `)

  const text = [
    `Dear ${data.clientName},`, '',
    `This is a friendly reminder about the pending balance for your upcoming event.`, '',
    `Proposal: ${data.proposalNumber}`,
    `Event: ${data.eventType || '—'} on ${eventDateLabel}`,
    `Balance Due: ${inr(data.balanceDue)}`, '',
    `Please arrange payment at your earliest convenience, or reply / WhatsApp +91 ${BUSINESS_PHONE}.`, '',
    `Warm regards,`, `${BUSINESS_NAME} Team`,
  ].join('\n')

  return { subject, html, text }
}

// ─── Follow-up ─────────────────────────────────────────────────────────────

export interface FollowUpEmailData {
  clientName: string
  eventType?: string
  customMessage?: string
}

export function followUpEmail(data: FollowUpEmailData): EmailTemplate {
  const subject = `Following up on your ${BUSINESS_NAME} enquiry`
  const message = data.customMessage ||
    `We wanted to follow up on your recent enquiry${data.eventType ? ` for your ${data.eventType}` : ''}. We'd love to help you plan your event.`

  const html = wrapHtml(`
    <p>Dear ${data.clientName},</p>
    <p>${message}</p>
    <p>Feel free to reply to this email or WhatsApp us at +91 ${BUSINESS_PHONE} whenever suits you.</p>
    <p>Warm regards,<br/>${BUSINESS_NAME} Team</p>
  `)

  const text = [
    `Dear ${data.clientName},`, '',
    message, '',
    `Feel free to reply to this email or WhatsApp us at +91 ${BUSINESS_PHONE}.`, '',
    `Warm regards,`, `${BUSINESS_NAME} Team`,
  ].join('\n')

  return { subject, html, text }
}

// ─── Booking confirmation ──────────────────────────────────────────────────

export interface BookingConfirmationEmailData {
  clientName: string
  proposalNumber: string
  eventType: string
  eventDate: string | null
  venue: string | null
  guestCount: number | null
}

export function bookingConfirmationEmail(data: BookingConfirmationEmailData): EmailTemplate {
  const subject = `Booking Confirmed — ${data.proposalNumber} | ${BUSINESS_NAME}`
  const eventDateLabel = data.eventDate
    ? new Date(data.eventDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
    : '—'

  const html = wrapHtml(`
    <p>Dear ${data.clientName},</p>
    <p>We're delighted to confirm your booking with ${BUSINESS_NAME}! Here are your event details:</p>
    <table role="presentation" width="100%" cellpadding="6" style="margin:16px 0;">
      <tr><td style="color:#6b7280;">Proposal</td><td><b>${data.proposalNumber}</b></td></tr>
      <tr><td style="color:#6b7280;">Event</td><td>${data.eventType || '—'}</td></tr>
      <tr><td style="color:#6b7280;">Date</td><td>${eventDateLabel}</td></tr>
      <tr><td style="color:#6b7280;">Venue</td><td>${data.venue || '—'}</td></tr>
      <tr><td style="color:#6b7280;">Guests</td><td>${data.guestCount ?? '—'}</td></tr>
    </table>
    <p>We look forward to making your event memorable. If you have any questions, reply to this email or WhatsApp us at +91 ${BUSINESS_PHONE}.</p>
    <p>Warm regards,<br/>${BUSINESS_NAME} Team</p>
  `)

  const text = [
    `Dear ${data.clientName},`, '',
    `We're delighted to confirm your booking with ${BUSINESS_NAME}! Here are your event details:`, '',
    `Proposal: ${data.proposalNumber}`,
    `Event: ${data.eventType || '—'}`,
    `Date: ${eventDateLabel}`,
    `Venue: ${data.venue || '—'}`,
    `Guests: ${data.guestCount ?? '—'}`, '',
    `We look forward to making your event memorable. Reply or WhatsApp +91 ${BUSINESS_PHONE} with any questions.`, '',
    `Warm regards,`, `${BUSINESS_NAME} Team`,
  ].join('\n')

  return { subject, html, text }
}
