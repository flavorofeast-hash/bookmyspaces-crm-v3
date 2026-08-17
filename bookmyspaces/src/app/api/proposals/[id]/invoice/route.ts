// src/app/api/proposals/[id]/invoice/route.ts
// NO CHANGES to route URL, DB queries, or calculations.
// CHANGES: amount in words, premium financial summary, payment instructions, hospitality closing.
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth-guard'
import { splitInclusiveTax } from '@/lib/tax'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function inr(n: number): string { return '₹' + Number(n).toLocaleString('en-IN') }

function fmtDate(d: string | null | undefined): string {
  if (!d) return '—'
  try { return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) }
  catch { return String(d) }
}

function modeLabel(mode: string): string {
  const map: Record<string, string> = {
    cash: 'Cash', upi: 'UPI', card: 'Card',
    bank_transfer: 'Bank Transfer', cheque: 'Cheque',
  }
  return map[mode] ?? mode
}

// SECURITY: this route returns a raw HTML string as text/html, built from
// proposal/payment fields that ultimately trace back to customer- or
// staff-entered text (client name, room type, add-on name, receipt
// reference, notes). This route sits behind requireAuth(), but an
// authenticated staff session is still worth protecting — a malicious lead
// name injected via an unauthenticated channel (WhatsApp/website chat) and
// later copied into a proposal could otherwise execute in a logged-in
// staff member's browser. Escaped consistently with the same fix applied
// to src/lib/proposal-pdf.ts (the public, unauthenticated proposal
// preview/PDF route) during Version 1.0 release preparation — see
// RELEASE_MANAGER_REPORT.md.
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
    if (n < 100) return tens[Math.floor(n/10)] + (n%10 ? ' ' + ones[n%10] : '')
    if (n < 1000) return ones[Math.floor(n/100)] + ' Hundred' + (n%100 ? ' ' + words(n%100) : '')
    if (n < 100000)   return words(Math.floor(n/1000))  + ' Thousand' + (n%1000   ? ' ' + words(n%1000)   : '')
    if (n < 10000000) return words(Math.floor(n/100000)) + ' Lakh'    + (n%100000 ? ' ' + words(n%100000) : '')
    return words(Math.floor(n/10000000)) + ' Crore' + (n%10000000 ? ' ' + words(n%10000000) : '')
  }

  const n = Math.round(amount)
  if (n === 0) return 'Zero Rupees Only'
  return 'Rupees ' + words(n).trim() + ' Only'
}

// ─── HTML builder ─────────────────────────────────────────────────────────────

function buildInvoiceHTML(proposal: any, invoice: any, payments: any[]): string {
  const today       = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
  const basePrice   = Number(proposal.base_price   || 0)
  const roomItems   = Array.isArray(proposal.room_items) ? proposal.room_items : []
  const addons      = Array.isArray(proposal.addons)     ? proposal.addons     : []
  const discountAmt = Number(proposal.discount_amount    || 0)
  const totalPrice  = Number(proposal.total_price        || 0)
  // Always sum from the payments array — never read the stale proposal.advance_paid snapshot.
  // This matches FinanceModal's logic exactly.
  const advancePaid = payments.reduce((s: number, p: any) => s + Number(p.amount || 0), 0)
  const balanceDue  = Math.max(0, totalPrice - advancePaid)
  const roomsTotal  = roomItems.reduce((s: number, r: any) =>
    s + (Number(r.quantity||0) * Number(r.rate||0) * Number(r.nights||0)), 0)
  const addonsTotal = addons.reduce((s: number, a: any) => s + Number(a.price||0), 0)
  const hasEvent    = basePrice > 0
  const hasRooms    = roomItems.length > 0
  const totalWords  = amountInWords(totalPrice)
  const paidTotal   = advancePaid  // same value — reuse, no second reduce
  // Priority 3 (Taxes) — tax_amount is read from the already-computed,
  // already-persisted invoice row (see splitInclusiveTax() in the POST/GET
  // handler below), not recomputed here, so a later rate change never
  // alters an already-issued invoice's displayed split. 0 (today's default)
  // means this line simply doesn't render — zero visual change for anyone
  // who hasn't configured DEFAULT_TAX_RATE_PERCENT.
  const taxAmount   = Number(invoice.tax_amount || 0)

  const clientName  = escapeHtml(proposal.client_name)
  const clientPhone = escapeHtml(proposal.client_phone)
  const clientEmail = escapeHtml(proposal.client_email)
  const packageName = escapeHtml(proposal.package_name)
  const venueName   = escapeHtml(proposal.venue)
  const eventType   = escapeHtml(proposal.event_type)
  const proposalNumber = escapeHtml(proposal.proposal_number)
  const invoiceNumber  = escapeHtml(invoice.invoice_number)

  const roomRowsHtml = roomItems.map((r: any) => `
    <tr>
      <td class="td">🛏 ${escapeHtml(r.room_type)}</td>
      <td class="td c">${r.quantity} × ${r.nights} night${r.nights>1?'s':''}</td>
      <td class="td r">${inr(r.rate)} / night</td>
      <td class="td r b">${inr(r.quantity*r.rate*r.nights)}</td>
    </tr>`).join('')

  const addonRowsHtml = addons.map((a: any) => `
    <tr>
      <td class="td">+ ${escapeHtml(a.name)}</td>
      <td class="td c">—</td>
      <td class="td r">—</td>
      <td class="td r b">${inr(Number(a.price||0))}</td>
    </tr>`).join('')

  const paymentRowsHtml = payments.map((p: any) => `
    <tr>
      <td class="td mono">${escapeHtml(p.receipt_number) || '—'}</td>
      <td class="td">${fmtDate(p.payment_date)}</td>
      <td class="td" style="text-transform:capitalize">${modeLabel(p.payment_mode||'')}</td>
      ${p.transaction_ref ? `<td class="td mono small">${escapeHtml(p.transaction_ref)}</td>` : '<td class="td" style="color:#aaa">—</td>'}
      <td class="td r b">${inr(Number(p.amount))}</td>
    </tr>`).join('')

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Invoice ${invoiceNumber} — BookMySpaces</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400;500;600&family=DM+Sans:wght@300;400;500;600&display=swap');
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'DM Sans',system-ui,sans-serif;color:#1a1a1a;background:#fff;font-size:12px;line-height:1.45}
.page{max-width:800px;margin:0 auto}

/* ── Header ── */
.header{background:linear-gradient(135deg,#0b1520,#162038);padding:18px 36px;display:flex;justify-content:space-between;align-items:flex-start}
.brand-name{font-family:'Cormorant Garamond',serif;font-size:22px;color:#fff;font-weight:400;letter-spacing:.4px}
.brand-tag{font-size:9px;color:#c9a84c;letter-spacing:.2em;text-transform:uppercase;margin-top:3px}
.inv-meta{text-align:right}
.inv-type{font-size:8.5px;color:rgba(255,255,255,.45);letter-spacing:.18em;text-transform:uppercase;margin-bottom:2px}
.inv-number{font-size:15px;font-weight:700;color:#c9a84c;letter-spacing:.05em}
.inv-date{font-size:9.5px;color:rgba(255,255,255,.4);margin-top:2px}
.gold-rule{height:1px;background:linear-gradient(90deg,#c9a84c,rgba(201,168,76,.08))}

/* ── Title bar ── */
.title-bar{background:#f8f5f0;padding:10px 36px;border-bottom:1px solid #ede8e0;display:flex;justify-content:space-between;align-items:center}
.title-text{font-family:'Cormorant Garamond',serif;font-size:18px;color:#0b1520;font-weight:400}
.status-pill{font-size:8.5px;font-weight:700;padding:3px 10px;border-radius:20px;text-transform:uppercase;letter-spacing:.1em;
  background:${balanceDue<=0?'#dcfce7':'#fef3c7'};
  color:${balanceDue<=0?'#15803d':'#92400e'};
  border:1px solid ${balanceDue<=0?'#86efac':'#fcd34d'}}
.print-btn{display:inline-flex;align-items:center;gap:5px;font-size:10px;font-weight:600;color:#a07830;background:rgba(201,168,76,.1);border:1px solid rgba(201,168,76,.3);border-radius:6px;padding:4px 10px;cursor:pointer;letter-spacing:.06em}

/* ── Parties ── */
.parties{display:grid;grid-template-columns:1fr 1fr;padding:12px 36px;border-bottom:1px solid #f0ede8;gap:20px}
.party-label{font-size:8px;text-transform:uppercase;letter-spacing:.15em;color:#c9a84c;font-weight:600;margin-bottom:4px}
.party-name{font-size:13px;font-weight:700;color:#0b1520;margin-bottom:2px}
.party-detail{font-size:10.5px;color:#6a6a7a;line-height:1.55}

/* ── Sections ── */
.section{padding:10px 36px;border-bottom:1px solid #f0ede8}
.section-label{font-size:8px;letter-spacing:.2em;text-transform:uppercase;color:#c9a84c;font-weight:600;margin-bottom:7px}
table{width:100%;border-collapse:collapse}
.th{background:linear-gradient(135deg,#0b1520,#162038);color:rgba(255,255,255,.7);font-size:8px;text-transform:uppercase;letter-spacing:.12em;padding:5px 9px;font-weight:500;text-align:left}
.th.r{text-align:right}.th.c{text-align:center}
.td{padding:6px 9px;font-size:11px;color:#1a1a1a;border-bottom:1px solid #f0ede8}
.td.r{text-align:right}.td.c{text-align:center}.td.b{font-weight:600;color:#0b1520}
.td.mono{font-family:monospace;font-size:10px;letter-spacing:.03em}
.td.small{font-size:10px;color:#6a6a7a}

/* ── Financial summary ── */
.fin-summary{padding:12px 36px;border-bottom:1px solid #f0ede8;display:flex;gap:20px}
.fin-breakdown{flex:1;background:#f8f5f0;border-radius:9px;padding:12px 16px;border:1px solid #ede8e0}
.fin-row{display:flex;justify-content:space-between;align-items:center;padding:4px 0;font-size:12px}
.fin-lbl{color:#4a4a5a}
.fin-val{font-weight:500;color:#1a1a1a}
.fin-discount{color:#16a34a}
.fin-sep{height:1.5px;background:#c9a84c;margin:6px 0}
.fin-sep-soft{height:1px;background:#ede8e0;margin:4px 0}
.fin-total-row{display:flex;justify-content:space-between;padding:5px 0;font-size:15px;font-weight:700}
.fin-total-lbl{color:#0b1520}
.fin-total-val{color:#c9a84c}
.fin-paid-row{display:flex;justify-content:space-between;padding:3px 0;font-size:12px}
.fin-balance-box{margin-top:8px;background:${balanceDue<=0?'#f0fdf4':'#fef3c7'};border:1px solid ${balanceDue<=0?'#86efac':'#fcd34d'};border-radius:7px;padding:8px 12px;display:flex;justify-content:space-between;align-items:center}
.fin-balance-lbl{font-size:11px;font-weight:700;color:${balanceDue<=0?'#15803d':'#92400e'}}
.fin-balance-val{font-size:16px;font-weight:800;color:${balanceDue<=0?'#15803d':'#d97706'}}
.fin-words{flex:0 0 200px;display:flex;flex-direction:column;gap:10px}
.words-box{background:linear-gradient(135deg,#0b1520,#162038);border-radius:9px;padding:12px 14px}
.words-label{font-size:8px;text-transform:uppercase;letter-spacing:.15em;color:rgba(255,255,255,.45);margin-bottom:4px}
.words-val{font-size:11px;color:#c9a84c;font-style:italic;line-height:1.5}
.pay-instr-box{background:#f8f5f0;border-radius:9px;padding:12px 14px;border:1px solid #ede8e0}
.pay-instr-label{font-size:8px;text-transform:uppercase;letter-spacing:.15em;color:#c9a84c;font-weight:600;margin-bottom:6px}
.pay-instr-row{display:flex;flex-direction:column;margin-bottom:6px}
.pay-instr-key{font-size:8px;text-transform:uppercase;letter-spacing:.1em;color:#8a8a9a;margin-bottom:1px}
.pay-instr-value{font-size:11px;font-weight:600;color:#0b1520}
.pay-instr-note{font-size:9px;color:#6a6a7a;font-style:italic;line-height:1.4;border-top:1px dashed #ede8e0;padding-top:5px;margin-top:4px}

/* ── Footer ── */
.footer{background:#f8f5f0;padding:10px 36px;border-top:1px solid #ede8e0}
.footer-cells{display:flex;border:1px solid #ede8e0;border-radius:7px;overflow:hidden;margin-bottom:7px}
.f-cell{flex:1;padding:6px 10px;border-right:1px solid #ede8e0;background:#fff}
.f-cell:last-child{border-right:none}
.f-lbl{font-size:7.5px;text-transform:uppercase;letter-spacing:.12em;color:#8a8a9a;margin-bottom:1px}
.f-val{font-size:10.5px;font-weight:500;color:#1a1a1a}
.footer-address{font-size:9.5px;color:#6a6a7a}

/* ── Hospitality closing ── */
.hospitality-close{padding:12px 36px;text-align:center;background:linear-gradient(180deg,#fff 0%,#f8f5f0 100%);border-top:1px solid #f0ede8}
.hosp-text{font-family:'Cormorant Garamond',serif;font-size:14px;color:#0b1520;font-weight:400;letter-spacing:.2px;margin-bottom:3px}
.hosp-sub{font-size:9.5px;color:#8a8a9a;line-height:1.55;font-style:italic}

/* ── Closing strip ── */
.closing{padding:8px 36px 12px;text-align:center}
.closing-rule{height:1px;background:linear-gradient(90deg,transparent,rgba(201,168,76,.3) 30%,rgba(201,168,76,.3) 70%,transparent);margin-bottom:8px}
.closing-text{font-size:8.5px;color:#9a9aaa;line-height:1.6}
.closing-ref{display:inline-block;margin-top:5px;font-size:8px;font-weight:600;color:rgba(201,168,76,.65);letter-spacing:.15em;text-transform:uppercase;border-top:1px solid rgba(201,168,76,.2);padding-top:3px}

/* ── Print ── */
@media print{
  @page{size:A4;margin:0}
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
  <div class="inv-meta">
    <div class="inv-type">Tax Invoice</div>
    <div class="inv-number">${invoiceNumber}</div>
    <div class="inv-date">${today}</div>
  </div>
</div>
<div class="gold-rule"></div>

<!-- Title bar -->
<div class="title-bar">
  <div class="title-text">Event &amp; Service Invoice</div>
  <div style="display:flex;align-items:center;gap:10px">
    <div class="status-pill">${balanceDue<=0?'✓ Fully Paid':`Balance Due: ${inr(balanceDue)}`}</div>
    <button class="print-btn no-print" onclick="window.print()">🖨 Print / Save PDF</button>
  </div>
</div>

<!-- Parties -->
<div class="parties">
  <div>
    <div class="party-label">Billed By</div>
    <div class="party-name">BookMySpaces</div>
    <div class="party-detail">Mukundapur, Near Ruby Hospital<br>EM Bypass, Kolkata<br>8017035546 · bookmyspaces.in</div>
  </div>
  <div>
    <div class="party-label">Billed To</div>
    <div class="party-name">${clientName}</div>
    <div class="party-detail">
      ${clientPhone}
      ${clientPhone && clientEmail ? '<br>' : ''}
      ${clientEmail}
    </div>
  </div>
</div>

<!-- Proposal ref -->
<div class="section" style="padding-bottom:8px">
  <div class="section-label">Booking Reference</div>
  <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:7px">
    <div style="background:#f8f5f0;border-radius:7px;padding:7px 10px;border-left:2px solid #c9a84c">
      <div style="font-size:8px;text-transform:uppercase;letter-spacing:.12em;color:#8a8a9a;margin-bottom:2px">Proposal #</div>
      <div style="font-size:11px;font-weight:600">${proposalNumber}</div>
    </div>
    <div style="background:#f8f5f0;border-radius:7px;padding:7px 10px;border-left:2px solid #c9a84c">
      <div style="font-size:8px;text-transform:uppercase;letter-spacing:.12em;color:#8a8a9a;margin-bottom:2px">Event</div>
      <div style="font-size:11px;font-weight:600">${eventType || '—'}</div>
    </div>
    <div style="background:#f8f5f0;border-radius:7px;padding:7px 10px;border-left:2px solid #c9a84c">
      <div style="font-size:8px;text-transform:uppercase;letter-spacing:.12em;color:#8a8a9a;margin-bottom:2px">Event Date</div>
      <div style="font-size:11px;font-weight:600">${fmtDate(proposal.event_date)}</div>
    </div>
  </div>
</div>

<!-- Event package table -->
${hasEvent ? `
<div class="section">
  <div class="section-label">Event Package</div>
  <table>
    <thead>
      <tr>
        <th class="th">Description</th>
        <th class="th c">Venue</th>
        <th class="th r">Amount</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td class="td">${packageName || 'Event Package'}</td>
        <td class="td c">${venueName || '—'}</td>
        <td class="td r b">${inr(basePrice)}</td>
      </tr>
      ${addonRowsHtml}
    </tbody>
  </table>
</div>` : ''}

<!-- Accommodation table -->
${hasRooms ? `
<div class="section">
  <div class="section-label">Accommodation</div>
  <table>
    <thead>
      <tr>
        <th class="th">Room Type</th>
        <th class="th c">Qty × Nights</th>
        <th class="th r">Rate / Night</th>
        <th class="th r">Amount</th>
      </tr>
    </thead>
    <tbody>${roomRowsHtml}</tbody>
  </table>
</div>` : ''}

<!-- ── Premium financial summary ── -->
<div class="fin-summary">

  <div class="fin-breakdown">
    ${hasEvent && basePrice>0 ? `
    <div class="fin-row"><span class="fin-lbl">Package Charges</span><span class="fin-val">${inr(basePrice)}</span></div>` : ''}
    ${addonsTotal>0 ? `
    <div class="fin-row"><span class="fin-lbl">Add-ons</span><span class="fin-val">${inr(addonsTotal)}</span></div>` : ''}
    ${hasRooms ? `
    <div class="fin-row"><span class="fin-lbl">Accommodation</span><span class="fin-val">${inr(roomsTotal)}</span></div>` : ''}
    ${taxAmount>0 ? `
    <div class="fin-row"><span class="fin-lbl" style="color:#8a8a9a">GST (included in total)</span><span class="fin-val" style="color:#8a8a9a">${inr(taxAmount)}</span></div>` : ''}
    ${discountAmt>0 ? `
    <div class="fin-sep-soft"></div>
    <div class="fin-row"><span class="fin-lbl fin-discount">Discount</span><span class="fin-val fin-discount">− ${inr(discountAmt)}</span></div>` : ''}
    <div class="fin-sep"></div>
    <div class="fin-total-row">
      <span class="fin-total-lbl">Grand Total</span>
      <span class="fin-total-val">${inr(totalPrice)}</span>
    </div>
    ${advancePaid>0 ? `
    <div class="fin-sep-soft"></div>
    <div class="fin-paid-row"><span style="color:#15803d">Payments Received</span><span style="color:#15803d;font-weight:600">− ${inr(advancePaid)}</span></div>` : ''}
    <div class="fin-sep-soft"></div>
    <div class="fin-balance-box">
      <span class="fin-balance-lbl">${balanceDue<=0?'✓ Fully Settled':'Balance Due'}</span>
      <span class="fin-balance-val">${inr(balanceDue)}</span>
    </div>
  </div>

  <div class="fin-words">
    <div class="words-box">
      <div class="words-label">Invoice Value in Words</div>
      <div class="words-val">${totalWords}</div>
    </div>
    <div class="pay-instr-box">
      <div class="pay-instr-label">Payment Details</div>
      <div class="pay-instr-row">
        <span class="pay-instr-key">UPI ID</span>
        <span class="pay-instr-value">9836014495@upi</span>
      </div>
      <div class="pay-instr-row">
        <span class="pay-instr-key">Phone / WhatsApp</span>
        <span class="pay-instr-value">8017035546</span>
      </div>
      <div class="pay-instr-note">Please quote Invoice No. ${invoiceNumber} when making payment.</div>
    </div>
  </div>

</div>

<!-- Payment history -->
${payments.length>0 ? `
<div class="section">
  <div class="section-label" style="display:flex;justify-content:space-between;align-items:center">
    <span>Payment History</span>
    <span style="font-size:10px;color:#15803d;font-weight:600">Total Received: ${inr(paidTotal)}</span>
  </div>
  <table>
    <thead>
      <tr>
        <th class="th">Receipt #</th>
        <th class="th">Date</th>
        <th class="th">Mode</th>
        <th class="th">Reference</th>
        <th class="th r">Amount</th>
      </tr>
    </thead>
    <tbody>${paymentRowsHtml}</tbody>
  </table>
</div>` : ''}

<!-- Footer -->
<div class="footer">
  <div class="footer-cells">
    <div class="f-cell">
      <div class="f-lbl">WhatsApp / Call</div>
      <div class="f-val">8017035546</div>
    </div>
    <div class="f-cell">
      <div class="f-lbl">UPI Payment</div>
      <div class="f-val">9836014495@upi</div>
    </div>
    <div class="f-cell">
      <div class="f-lbl">Website</div>
      <div class="f-val">bookmyspaces.in</div>
    </div>
  </div>
  <div class="footer-address">📍 Mukundapur, Near Ruby Hospital, EM Bypass, Kolkata</div>
</div>

<!-- Hospitality closing message -->
<div class="hospitality-close">
  <div class="hosp-text">Thank you for choosing BookMySpaces.</div>
  <div class="hosp-sub">We look forward to hosting your celebration and creating a memorable experience for your guests.<br>For any queries, please reach us at 8017035546 or via WhatsApp.</div>
</div>

<!-- Digital signature strip -->
<div class="closing">
  <div class="closing-rule"></div>
  <div class="closing-text">
    <strong style="color:#6a6a7a">Digitally Generated Invoice</strong> — This document is valid without a physical signature.
  </div>
  <div class="closing-ref">Invoice: ${invoiceNumber} · Proposal: ${proposalNumber}</div>
</div>

</div>

<script>
  window.addEventListener('load', function() {
    var btn = document.querySelector('.print-btn');
    if (btn) btn.style.display = 'inline-flex';
    if (window.location.search.includes('print=1')) window.print();
  });
</script>
</body>
</html>`
}

// ─── GET — unchanged route URL and DB logic ───────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  const supabase = getSupabaseAdmin()
  try {
    const { data: proposal, error: propErr } = await supabase
      .from('proposals')
      .select('*')
      .eq('id', params.id)
      .single()

    if (propErr || !proposal) {
      return new NextResponse('Proposal not found', { status: 404 })
    }

    const { data: payments } = await supabase
      .from('payments')
      .select('*')
      .eq('proposal_id', params.id)
      .order('payment_date', { ascending: true })

    const allPayments = payments ?? []
    const totalPaid   = allPayments.reduce((s: number, p: any) => s + Number(p.amount || 0), 0)
    const balanceDue  = Math.max(0, Number(proposal.total_price || 0) - totalPaid)

    // Idempotent upsert — unchanged from previous version
    const { data: existingInv } = await supabase
      .from('invoices')
      .select('*')
      .eq('proposal_id', params.id)
      .limit(1)
      .maybeSingle()

    let invoice = existingInv

    if (!invoice) {
      // Priority 3 (Taxes) — see src/lib/tax.ts for the full reasoning.
      // Computed once, at invoice creation, same as invoice_number — a
      // rate change afterward should not retroactively alter an already-
      // issued invoice's tax split, matching how invoice_number is stable
      // once assigned (trg_invoice_number, migration 009).
      const tax = splitInclusiveTax(Number(proposal.total_price || 0))

      const { data: newInv, error: invErr } = await supabase
        .from('invoices')
        .insert({
          proposal_id     : params.id,
          subtotal        : Number(proposal.total_price || 0) + Number(proposal.discount_amount || 0),
          discount_amount : Number(proposal.discount_amount || 0),
          tax_amount      : tax.taxAmount,
          total_amount    : Number(proposal.total_price || 0),
          advance_received: totalPaid,
          balance_due     : balanceDue,
          status          : balanceDue <= 0 ? 'paid' : 'sent',
        })
        .select('*')
        .single()

      if (invErr) throw invErr
      invoice = newInv
    } else {
      await supabase.from('invoices').update({
        advance_received: totalPaid,
        balance_due     : balanceDue,
        status          : balanceDue <= 0 ? 'paid' : 'sent',
      }).eq('id', invoice.id)
    }

    // Reservation Platform activation, Phase 5 — Invoice generation.
    // reservations.invoice_id (migration 012) has existed since that schema
    // was drafted but no code path ever populated it. If this proposal was
    // generated FROM a reservation (migration 013's proposals.reservation_id,
    // set by src/lib/proposals/proposal-service.ts's
    // createProposalFromReservation()), link the invoice back onto that
    // reservation here — the one place an invoice is actually resolved for
    // any proposal, reservation-originated or not, so this is the correct
    // single spot for the write rather than duplicating invoice-resolution
    // logic in a separate reservation-scoped route. Best-effort: the invoice
    // response below is already valid regardless of whether this succeeds.
    if (proposal.reservation_id) {
      try {
        await supabase
          .from('reservations')
          .update({ invoice_id: invoice.id })
          .eq('id', proposal.reservation_id)
      } catch {
        // Not fatal — see comment above.
      }
    }

    const html     = buildInvoiceHTML(proposal, invoice, allPayments)
    const filename = `BookMySpaces-Invoice-${invoice.invoice_number}.pdf`

    return new NextResponse(html, {
      headers: {
        'Content-Type'       : 'text/html; charset=utf-8',
        'Content-Disposition': `filename="${filename}"`,
        'Cache-Control'      : 'no-store',
      },
    })
  } catch (err) {
    logger.error('invoice', 'GET failed', err)
    return new NextResponse(
      `Invoice generation failed: ${err instanceof Error ? err.message : String(err)}`,
      { status: 500 }
    )
  }
}
