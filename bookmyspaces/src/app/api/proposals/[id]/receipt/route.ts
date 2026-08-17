// src/app/api/proposals/[id]/receipt/route.ts
// NO CHANGES to route URL, DB queries, or payment logic.
// CHANGES: amount in words, booking summary, print button, auto-print.
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth-guard'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function inr(n: number): string {
  return '₹' + Number(n).toLocaleString('en-IN')
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return '—'
  try {
    return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
  } catch { return String(d) }
}

function modeLabel(mode: string): string {
  const map: Record<string, string> = {
    cash: 'Cash', upi: 'UPI', card: 'Card',
    bank_transfer: 'Bank Transfer', cheque: 'Cheque',
  }
  return map[mode] ?? mode
}

function modeIcon(mode: string): string {
  const map: Record<string, string> = {
    upi: '📱', cash: '💵', card: '💳',
    bank_transfer: '🏦', cheque: '📄',
  }
  return map[mode] ?? '💰'
}

// SECURITY: same fix as src/app/api/proposals/[id]/invoice/route.ts — this
// route interpolates proposal/payment fields (client name, transaction ref,
// notes, etc.) into a raw HTML string. Escaped for consistency, protecting
// the authenticated staff session behind requireAuth() above.
function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// ─── Amount in words ──────────────────────────────────────────────────────────

function amountInWords(amount: number): string {
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven',
    'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen',
    'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty',
    'Sixty', 'Seventy', 'Eighty', 'Ninety']

  function words(n: number): string {
    if (n === 0) return ''
    if (n < 20)  return ones[n]
    if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 !== 0 ? ' ' + ones[n % 10] : '')
    if (n < 1000) return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 !== 0 ? ' ' + words(n % 100) : '')
    if (n < 100000)  return words(Math.floor(n / 1000)) + ' Thousand' + (n % 1000 !== 0 ? ' ' + words(n % 1000) : '')
    if (n < 10000000) return words(Math.floor(n / 100000)) + ' Lakh' + (n % 100000 !== 0 ? ' ' + words(n % 100000) : '')
    return words(Math.floor(n / 10000000)) + ' Crore' + (n % 10000000 !== 0 ? ' ' + words(n % 10000000) : '')
  }

  const n = Math.round(amount)
  if (n === 0) return 'Zero Rupees Only'
  return 'Rupees ' + words(n).trim() + ' Only'
}

// ─── HTML builder ─────────────────────────────────────────────────────────────

function buildReceiptHTML(proposal: any, payment: any): string {
  const today      = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
  const amt        = Number(payment.amount)
  const totalPrice = Number(proposal.total_price || 0)
  const advancePaid = Number(proposal.advance_paid || amt)
  const balanceDue  = Math.max(0, totalPrice - advancePaid)
  const words       = amountInWords(amt)
  const payType     = (payment.payment_type || 'advance').replace('_', ' ')

  const receiptNumber   = escapeHtml(payment.receipt_number)
  const clientName      = escapeHtml(proposal.client_name)
  const clientPhone     = escapeHtml(proposal.client_phone)
  const proposalNumber  = escapeHtml(proposal.proposal_number)
  const eventType       = escapeHtml(proposal.event_type)
  const paymentMode     = escapeHtml(payment.payment_mode)
  const transactionRef  = escapeHtml(payment.transaction_ref)
  const notes           = escapeHtml(payment.notes)
  const payTypeEsc      = escapeHtml(payType)

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Receipt ${receiptNumber} — BookMySpaces</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400;500;600&family=DM+Sans:wght@300;400;500;600&display=swap');
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'DM Sans',system-ui,sans-serif;color:#1a1a1a;background:#fff;font-size:12px;line-height:1.45}
.page{max-width:600px;margin:0 auto}

/* ── Header ── */
.header{background:linear-gradient(135deg,#0b1520 0%,#162038 100%);padding:18px 32px;display:flex;justify-content:space-between;align-items:flex-start}
.brand-name{font-family:'Cormorant Garamond',serif;font-size:20px;color:#fff;font-weight:400;letter-spacing:.3px}
.brand-tag{font-size:9px;color:#c9a84c;letter-spacing:.2em;text-transform:uppercase;margin-top:2px}
.receipt-badge{text-align:right}
.receipt-type{font-size:8.5px;color:rgba(255,255,255,.45);letter-spacing:.18em;text-transform:uppercase;margin-bottom:2px}
.receipt-num{font-size:15px;font-weight:700;color:#c9a84c;letter-spacing:.06em}
.receipt-date{font-size:9.5px;color:rgba(255,255,255,.4);margin-top:2px}

/* ── Gold rule ── */
.gold-rule{height:1px;background:linear-gradient(90deg,#c9a84c 0%,rgba(201,168,76,.08) 100%)}

/* ── Title bar ── */
.title-bar{background:#f8f5f0;padding:10px 32px;border-bottom:1px solid #ede8e0;display:flex;justify-content:space-between;align-items:center}
.title-text{font-family:'Cormorant Garamond',serif;font-size:18px;color:#0b1520;font-weight:400}
.print-btn{display:inline-flex;align-items:center;gap:5px;font-size:10px;font-weight:600;color:#a07830;background:rgba(201,168,76,.1);border:1px solid rgba(201,168,76,.3);border-radius:6px;padding:4px 10px;cursor:pointer;letter-spacing:.06em}
.no-print .print-btn{display:inline-flex}

/* ── Amount hero ── */
.amount-hero{background:linear-gradient(135deg,#0b1520,#162038);margin:14px 32px;border-radius:10px;padding:16px 20px;display:flex;justify-content:space-between;align-items:flex-start}
.amount-col{}
.amount-lbl{font-size:8.5px;color:rgba(255,255,255,.45);text-transform:uppercase;letter-spacing:.18em;margin-bottom:3px}
.amount-val{font-family:'Cormorant Garamond',serif;font-size:30px;font-weight:600;color:#c9a84c;line-height:1}
.amount-words{font-size:9.5px;color:rgba(255,255,255,.4);margin-top:5px;font-style:italic;line-height:1.4}
.mode-pill{display:flex;flex-direction:column;align-items:center;background:rgba(201,168,76,.14);border:1px solid rgba(201,168,76,.28);border-radius:8px;padding:8px 14px;flex-shrink:0}
.mode-icon{font-size:18px;line-height:1;margin-bottom:3px}
.mode-lbl{font-size:9px;color:#c9a84c;font-weight:700;text-transform:uppercase;letter-spacing:.1em}

/* ── Detail grid ── */
.detail-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:0 32px;margin-bottom:12px}
.d-item{background:#f8f5f0;border-radius:7px;padding:8px 10px;border-left:2px solid #c9a84c}
.d-lbl{font-size:8px;text-transform:uppercase;letter-spacing:.14em;color:#8a8a9a;margin-bottom:2px}
.d-val{font-size:11px;color:#1a1a1a;font-weight:500;line-height:1.3}

/* ── Purpose box ── */
.purpose-box{margin:0 32px 12px;background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:10px 14px;display:flex;align-items:center;gap:10px}
.purpose-icon{font-size:16px;flex-shrink:0}
.purpose-label{font-size:8px;text-transform:uppercase;letter-spacing:.12em;color:#15803d;margin-bottom:1px;font-weight:600}
.purpose-text{font-size:11px;color:#166534;font-weight:500}

/* ── Booking summary ── */
.summary-box{margin:0 32px 12px;background:#fff;border:1px solid #ede8e0;border-radius:8px;overflow:hidden}
.summary-header{background:linear-gradient(135deg,#0b1520,#162038);padding:6px 14px}
.summary-header-text{font-size:8.5px;letter-spacing:.18em;text-transform:uppercase;color:#c9a84c;font-weight:600}
.summary-rows{padding:10px 14px}
.summary-row{display:flex;justify-content:space-between;align-items:center;padding:3px 0;font-size:11px}
.summary-lbl{color:#4a4a5a}
.summary-val{font-weight:500;color:#1a1a1a}
.summary-sep{border-top:1px solid #ede8e0;margin:6px 0}
.summary-balance{display:flex;justify-content:space-between;padding:6px 0;font-size:13px;font-weight:700}
.summary-balance-lbl{color:${balanceDue<=0?'#15803d':'#92400e'}}
.summary-balance-val{color:${balanceDue<=0?'#15803d':'#d97706'}}

/* ── Ref box ── */
.ref-box{margin:0 32px 12px;background:#f8f5f0;border-radius:7px;padding:8px 12px;display:flex;justify-content:space-between;align-items:center}
.ref-lbl{font-size:8.5px;text-transform:uppercase;letter-spacing:.12em;color:#8a8a9a}
.ref-val{font-size:11px;font-weight:600;font-family:monospace;color:#1a1a1a;letter-spacing:.04em}

/* ── Notes ── */
.notes-box{margin:0 32px 12px;background:#fff8e8;border:1px solid rgba(201,168,76,.25);border-radius:7px;padding:8px 12px;font-size:10.5px;color:#4a4a5a;line-height:1.5}

/* ── Footer ── */
.footer{background:#f8f5f0;border-top:1px solid #ede8e0;padding:10px 32px;display:flex;gap:0;margin-top:2px}
.f-cell{flex:1;padding-right:16px}
.f-lbl{font-size:8px;text-transform:uppercase;letter-spacing:.12em;color:#9a9aaa;margin-bottom:1px}
.f-val{font-size:10.5px;color:#1a1a1a;font-weight:500}

/* ── Closing ── */
.closing{padding:10px 32px 14px;text-align:center}
.closing-rule{height:1px;background:linear-gradient(90deg,transparent,rgba(201,168,76,.3) 30%,rgba(201,168,76,.3) 70%,transparent);margin-bottom:9px}
.closing-text{font-size:9px;color:#9a9aaa;line-height:1.6}
.closing-ref{display:inline-block;margin-top:5px;font-size:8px;font-weight:600;color:rgba(201,168,76,.65);letter-spacing:.16em;text-transform:uppercase;border-top:1px solid rgba(201,168,76,.2);padding-top:4px}

/* ── Print ── */
@media print{
  @page{size:A5;margin:0}
  *{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}
  body{overflow:visible!important}
  .no-print{display:none!important}
}
</style>
</head>
<body>
<div class="page">

<!-- Header -->
<div class="header">
  <div>
    <div class="brand-name">BookMySpaces</div>
    <div class="brand-tag">Premium Hospitality · Kolkata</div>
  </div>
  <div class="receipt-badge">
    <div class="receipt-type">Money Receipt</div>
    <div class="receipt-num">${receiptNumber}</div>
    <div class="receipt-date">${fmtDate(payment.payment_date)}</div>
  </div>
</div>
<div class="gold-rule"></div>

<!-- Title bar -->
<div class="title-bar">
  <div class="title-text">Payment Acknowledgement</div>
  <button class="print-btn no-print" onclick="window.print()">🖨 Print / Save PDF</button>
</div>

<!-- Amount hero -->
<div class="amount-hero">
  <div class="amount-col">
    <div class="amount-lbl">Amount Received</div>
    <div class="amount-val">${inr(amt)}</div>
    <div class="amount-words">${words}</div>
  </div>
  <div class="mode-pill">
    <div class="mode-icon">${modeIcon(payment.payment_mode)}</div>
    <div class="mode-lbl">${modeLabel(paymentMode)}</div>
  </div>
</div>

<!-- Detail grid -->
<div class="detail-grid">
  <div class="d-item">
    <div class="d-lbl">Received From</div>
    <div class="d-val">${clientName}</div>
  </div>
  <div class="d-item">
    <div class="d-lbl">Contact</div>
    <div class="d-val">${clientPhone || '—'}</div>
  </div>
  <div class="d-item">
    <div class="d-lbl">Proposal Reference</div>
    <div class="d-val">${proposalNumber}</div>
  </div>
  <div class="d-item">
    <div class="d-lbl">Event</div>
    <div class="d-val">${eventType || '—'}</div>
  </div>
  <div class="d-item">
    <div class="d-lbl">Payment Date</div>
    <div class="d-val">${fmtDate(payment.payment_date)}</div>
  </div>
  <div class="d-item">
    <div class="d-lbl">Payment Type</div>
    <div class="d-val" style="text-transform:capitalize">${payTypeEsc}</div>
  </div>
</div>

<!-- Purpose -->
<div class="purpose-box">
  <div class="purpose-icon">✓</div>
  <div>
    <div class="purpose-label">Purpose</div>
    <div class="purpose-text">${payTypeEsc.charAt(0).toUpperCase()+payTypeEsc.slice(1)} payment received against Proposal ${proposalNumber}</div>
  </div>
</div>

<!-- Booking summary -->
<div class="summary-box">
  <div class="summary-header"><div class="summary-header-text">Booking Summary</div></div>
  <div class="summary-rows">
    <div class="summary-row">
      <span class="summary-lbl">Booking Value</span>
      <span class="summary-val">${inr(totalPrice)}</span>
    </div>
    <div class="summary-row">
      <span class="summary-lbl">Amount Received (This Payment)</span>
      <span class="summary-val" style="color:#15803d">${inr(amt)}</span>
    </div>
    ${advancePaid > amt ? `
    <div class="summary-row">
      <span class="summary-lbl">Total Received to Date</span>
      <span class="summary-val" style="color:#15803d">${inr(advancePaid)}</span>
    </div>` : ''}
    <div class="summary-sep"></div>
    <div class="summary-balance">
      <span class="summary-balance-lbl">${balanceDue <= 0 ? '✓ Fully Settled' : 'Balance Due'}</span>
      <span class="summary-balance-val">${inr(balanceDue)}</span>
    </div>
  </div>
</div>

<!-- Transaction ref -->
${transactionRef ? `
<div class="ref-box">
  <span class="ref-lbl">Transaction Reference</span>
  <span class="ref-val">${transactionRef}</span>
</div>` : ''}

<!-- Notes -->
${notes ? `
<div class="notes-box">
  <span style="font-size:8px;text-transform:uppercase;letter-spacing:.12em;color:#c9a84c;font-weight:600">Notes · </span>${notes}
</div>` : ''}

<!-- Footer -->
<div class="footer">
  <div class="f-cell">
    <div class="f-lbl">WhatsApp / Call</div>
    <div class="f-val">8017035546</div>
  </div>
  <div class="f-cell">
    <div class="f-lbl">UPI Payment</div>
    <div class="f-val">9836014495@upi</div>
  </div>
  <div class="f-cell">
    <div class="f-lbl">Address</div>
    <div class="f-val">Mukundapur, EM Bypass, Kolkata</div>
  </div>
</div>

<!-- Closing -->
<div class="closing">
  <div class="closing-rule"></div>
  <div class="closing-text">
    <strong style="color:#6a6a7a">Digitally Generated Receipt</strong><br>
    This receipt has been generated through the BookMySpaces system and is valid without a physical signature.<br>
    <em style="color:#b0a080">Thank you for choosing BookMySpaces. We look forward to hosting your celebration.</em>
  </div>
  <div class="closing-ref">Receipt No: ${receiptNumber}</div>
</div>

</div>

<!-- Auto-print on screen load -->
<script>
  window.addEventListener('load', function() {
    setTimeout(function() {
      var btn = document.querySelector('.print-btn');
      if (btn) btn.style.display = 'inline-flex';
      // Only auto-print if ?print=1 in URL
      if (window.location.search.includes('print=1')) {
        window.print();
      }
    }, 500);
  });
</script>
</body>
</html>`
}

// ─── GET — unchanged route URL and DB logic ───────────────────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  const supabase = getSupabaseAdmin()
  try {
    const { searchParams } = new URL(req.url)
    const paymentId = searchParams.get('payment_id')

    const { data: proposal, error: propErr } = await supabase
      .from('proposals')
      .select('*')
      .eq('id', params.id)
      .single()

    if (propErr || !proposal) {
      return new NextResponse('Proposal not found', { status: 404 })
    }

    const { data: payments, error: payErr } = paymentId
      ? await supabase.from('payments').select('*').eq('id', paymentId).single()
          .then(r => ({ data: r.data ? [r.data] : null, error: r.error }))
      : await supabase.from('payments').select('*')
          .eq('proposal_id', params.id)
          .order('created_at', { ascending: false })
          .limit(1)

    if (payErr || !payments || payments.length === 0) {
      return new NextResponse('No payment found for this proposal', { status: 404 })
    }

    const payment  = payments[0]
    const html     = buildReceiptHTML(proposal, payment)
    const filename = `BookMySpaces-Receipt-${payment.receipt_number}.pdf`

    return new NextResponse(html, {
      headers: {
        'Content-Type'       : 'text/html; charset=utf-8',
        'Content-Disposition': `filename="${filename}"`,
        'Cache-Control'      : 'no-store',
      },
    })
  } catch (err) {
    logger.error('receipt', 'GET failed', err)
    return new NextResponse(
      `Receipt generation failed: ${err instanceof Error ? err.message : String(err)}`,
      { status: 500 }
    )
  }
}
