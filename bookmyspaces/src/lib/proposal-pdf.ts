// ═══════════════════════════════════════════════════════════════════════════════
// BOOKMYSPACES — PROPOSAL PDF GENERATOR v4
// Production-ready · 2-page A4 · Navy + Gold
// Supports: Event Only · Rooms Only · Event + Rooms
// Future-ready: receipt/invoice generation via same data shape
// ═══════════════════════════════════════════════════════════════════════════════

import { ProposalData } from './scoring'

// ─── Shared types (exported for receipt/invoice reuse) ────────────────────────

export interface RoomLineItem {
  room_type : string
  quantity  : number
  rate      : number
  nights    : number
}

export interface ProposalRenderData extends Record<string, any> {
  proposal_number?  : string
  ai_cover_note?    : string
  created_at?       : string
  room_items?       : RoomLineItem[]
}

// ─── HTML escaping ─────────────────────────────────────────────────────────────
// SECURITY: this file builds a raw HTML string served directly as
// text/html by two routes — /api/proposals/[id]/preview and
// /api/proposals/[id]/pdf — and /preview in particular has no auth guard
// (deliberately public, per RC1's audit of route callers). Every field
// below that ultimately traces back to customer- or staff-entered text
// (client name/phone, event type, special requirements, room/add-on/
// package names, discount reason, inclusions, the AI cover note) is
// escaped before interpolation, closing a real stored-XSS path: a lead's
// name is customer-controllable from the moment it's captured via
// WhatsApp/website chat, and proposal fields are frequently copied
// straight from lead data. Found and fixed during Version 1.0 release
// preparation — see RELEASE_MANAGER_REPORT.md.
function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// ─── Field normalisation ──────────────────────────────────────────────────────
// Handles both ProposalData interface fields AND raw DB column names.
// This is the single source of truth for field mapping. Every string field
// that will end up rendered as HTML text is escaped here, once, so callers
// never have to remember to do it themselves.

function normalise(p: any) {
  const roomItems: RoomLineItem[] = Array.isArray(p.room_items)
    ? p.room_items
        .filter((r: any) => r.room_type && Number(r.rate) > 0)
        .map((r: any) => ({
          room_type : escapeHtml(String(r.room_type)),
          quantity  : Number(r.quantity) || 1,
          rate      : Number(r.rate),
          nights    : Number(r.nights) || 1,
        }))
    : []

  const roomsTotal = roomItems.reduce(
    (s, r) => s + r.quantity * r.rate * r.nights, 0
  )

  const basePrice: number = Number(p.base_price ?? p.subtotal ?? 0)

  const addons: Array<{ name: string; price: number }> =
    Array.isArray(p.addons)
      ? p.addons.map((a: any) => ({ name: escapeHtml(a?.name), price: Number(a?.price) || 0 }))
      : []

  const addonsTotal = addons.reduce((s: number, a: any) => s + Number(a.price ?? 0), 0)

  const discountAmt: number = Number(p.discount_amount ?? p.discount_value ?? 0)

  const totalPrice: number = (() => {
    const stored = Number(p.total_price ?? p.total_amount ?? 0)
    if (stored > 0) return stored
    return Math.max(0, basePrice + addonsTotal + roomsTotal - discountAmt)
  })()

  const advanceRequired: number = Number(
    p.advance_required ?? p.advance_amount ?? Math.round(totalPrice * 0.5)
  )

  const packageName: string = escapeHtml(String(p.package_name ?? p.package ?? ''))
  const venueName: string   = escapeHtml(String(p.venue ?? p.venue_name ?? 'BookMySpaces'))

  const hasEvent  = basePrice > 0 || (packageName.length > 0 && packageName !== 'Rooms Only')
  const hasRooms  = roomItems.length > 0

  return {
    basePrice, addons, addonsTotal,
    roomItems, roomsTotal,
    discountAmt, totalPrice, advanceRequired,
    packageName, venueName,
    hasEvent, hasRooms,
  }
}

// ─── Cover note sanitiser ─────────────────────────────────────────────────────

function sanitiseCoverNote(
  raw: string | null | undefined,
  clientName: string,
  eventType: string
): string {
  if (!raw || raw.trim().length < 10) return fallbackNote(clientName, eventType)

  let clean = raw
    .replace(/#{1,6}\s+/g, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/^[-*•]\s+/gm, '')
    .replace(/^_{1,3}|_{1,3}$/gm, '')
    .replace(/`[^`]*`/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  if (/^[A-Z\s]{8,}$|^\d+\.\s|CLIENT:|EVENT DATE:/m.test(clean)) {
    return fallbackNote(clientName, eventType)
  }

  return clean.split('\n').filter(l => l.trim().length > 0).slice(0, 4).join('\n')
}

function fallbackNote(clientName: string, eventType: string): string {
  const name  = (clientName || 'Valued Guest').split(' ')[0]
  const event = (eventType || 'your special occasion').toLowerCase()
  return `Dear ${name},\n\nWe are delighted to present a carefully curated ${event} experience designed exclusively for you. Our team looks forward to creating an unforgettable occasion with exceptional hospitality and personalised service.\n\nWarm regards,\nBookMySpaces Hospitality Team`
}

// ─── Salutation helper ────────────────────────────────────────────────────────

function salutation(name: string): string {
  if (!name) return ''
  const n = name.trim()
  const lower = n.toLowerCase()
  if (lower.startsWith('mr') || lower.startsWith('ms') || lower.startsWith('dr')) return n
  // Simple gender heuristic — default to Mr. for unknown; caller can override via name field
  return `Mr. ${n}`
}

// ─── Default inclusions ───────────────────────────────────────────────────────

function defaultInclusions(pkg: string): string[] {
  const p = pkg.toLowerCase()
  if (p.includes('platinum')) return [
    'Rooftop venue (5 hours)', 'Premium theme decoration', 'Full buffet dinner',
    'DJ music setup', 'Party lighting', 'Welcome drinks', 'Cake table + stage',
    'Full event coordination', 'Setup & cleanup',
  ]
  if (p.includes('gold')) return [
    'Rooftop venue (4 hours)', 'Premium decoration', 'Buffet dinner (expanded)',
    'Sound + microphone', 'Party lighting', 'Cake table setup',
    'Event support staff', 'Setup & cleanup',
  ]
  if (p.includes('silver')) return [
    'Rooftop venue (4 hours)', 'Basic decoration', 'Buffet dinner',
    'Sound system', 'Basic lighting', 'Event staff', 'Setup & cleanup',
  ]
  if (p.includes('rooms only') || p.includes('room')) return []
  return [
    'Venue as agreed', 'Decoration as agreed', 'Food & beverages',
    'Sound & lighting', 'Event support staff', 'Setup & cleanup',
  ]
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

function fmtDate(d: string | null | undefined): string {
  if (!d) return ''
  try { return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) }
  catch { return '' }
}

function validUntil(created?: string): string {
  const base = created ? new Date(created) : new Date()
  base.setDate(base.getDate() + 7)
  return base.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
}

// ─── INR formatter ────────────────────────────────────────────────────────────

function inr(n: number): string {
  return '₹' + Number(n).toLocaleString('en-IN')
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function generateProposalHTML(
  proposal: ProposalData & ProposalRenderData
): string {

  const {
    basePrice, addons, addonsTotal,
    roomItems, roomsTotal,
    discountAmt, totalPrice, advanceRequired,
    packageName, venueName,
    hasEvent, hasRooms,
  } = normalise(proposal)

  const today     = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
  const validTill = validUntil((proposal as any).created_at)
  const propNum   = escapeHtml(String((proposal as any).proposal_number || 'DRAFT'))
  const balance   = totalPrice - advanceRequired
  const coverNote = escapeHtml(sanitiseCoverNote((proposal as any).ai_cover_note, proposal.client_name, proposal.event_type))
  const clientSal = escapeHtml(salutation(proposal.client_name))
  const clientName = escapeHtml(proposal.client_name)
  const clientPhone = escapeHtml(proposal.client_phone)
  const eventType = escapeHtml(proposal.event_type)
  const eventTime = escapeHtml((proposal as any).event_time)
  const specialRequirements = escapeHtml(proposal.special_requirements)
  const discountReason = escapeHtml((proposal as any).discount_reason)
  const inclusionsList: string[] = (hasEvent ? (proposal.inclusions || defaultInclusions(packageName)) : [])
    .map((i: string) => escapeHtml(i))

  // ── Accommodation table rows ───────────────────────────────────────────
  const accomRowsHtml = roomItems.map(r => `
    <tr>
      <td class="accom-td"><span class="accom-icon">🛏</span>${escapeHtml(r.room_type)}</td>
      <td class="accom-td" style="text-align:center">${r.quantity}</td>
      <td class="accom-td" style="text-align:center">${r.nights} night${r.nights > 1 ? 's' : ''}</td>
      <td class="accom-td" style="text-align:right">${inr(r.rate)}</td>
      <td class="accom-td accom-subtotal" style="text-align:right">${inr(r.quantity * r.rate * r.nights)}</td>
    </tr>`).join('')

  // ── Addon rows ─────────────────────────────────────────────────────────
  // SECURITY: room_type/addon name fixed to also go through escapeHtml() —
  // this file's own header comment already claimed "room/add-on/package
  // names" were covered by the Version 1.0 XSS fix, but these two
  // interpolation sites were missed (numeric quantity/rate/nights fields
  // are safe as-is, no escaping needed for numbers). Found during the RC
  // hardening pass's security review.
  const addonsRowsHtml = addons.map((a: any) => `
    <tr>
      <td class="lbl" style="padding:4px 0">${escapeHtml(a.name)}</td>
      <td class="val" style="padding:4px 0">${inr(Number(a.price) || 0)}</td>
    </tr>`).join('')

  // ── Pricing breakdown rows ─────────────────────────────────────────────
  const pricingRows = [
    hasEvent && basePrice > 0 ? `
      <tr>
        <td class="lbl" style="padding:4px 0">${packageName || 'Event Package'}</td>
        <td class="val" style="padding:4px 0">${inr(basePrice)}</td>
      </tr>` : '',
    addonsRowsHtml,
    hasRooms ? `
      <tr>
        <td class="lbl" style="padding:4px 0">Accommodation (${roomItems.length} type${roomItems.length > 1 ? 's' : ''})</td>
        <td class="val" style="padding:4px 0">${inr(roomsTotal)}</td>
      </tr>` : '',
    discountAmt > 0 ? `
      <tr>
        <td style="padding:4px 0;color:#16a34a;font-size:12px">Discount${discountReason ? ` (${discountReason})` : ''}</td>
        <td style="padding:4px 0;text-align:right;color:#16a34a;font-size:12px">− ${inr(discountAmt)}</td>
      </tr>` : '',
  ].filter(Boolean).join('')

  // ── Inclusions list ────────────────────────────────────────────────────
  const inclusionsHtml = inclusionsList.map((i: string) => `<li>${i}</li>`).join('')

  // ── Concierge items ────────────────────────────────────────────────────
  // If rooms are already booked, show "Additional Room Nights" instead of generic entry
  const conciergeItems = [
    {
      icon: '🛏',
      name: hasRooms ? 'Additional Room Nights' : 'Guest Room Accommodation',
      price: hasRooms
        ? `from ${inr(Math.min(...roomItems.map(r => r.rate)))} / night`
        : 'from ₹2,500 / night',
      gold: true,
    },
    { icon: '🌸', name: 'Event Decoration & Setup',      price: 'Customised for your event', gold: false },
    { icon: '🎧', name: 'DJ & Music Arrangements',       price: 'Available on request',      gold: false },
    { icon: '🎸', name: 'Live / Acoustic Performances',  price: 'Available on request',      gold: false },
    { icon: '🍽', name: 'Food & Catering Options',       price: 'Customised for your event', gold: false },
    { icon: '✨', name: 'Custom Celebration Packages',   price: 'Speak with our team',       gold: false },
  ]

  const conciergeHtml = conciergeItems.map(item => `
    <div class="enh-item">
      <span class="enh-item-icon">${item.icon}</span>
      <div>
        <div class="enh-item-name">${item.name}</div>
        <div class="enh-item-price${item.gold ? ' gold' : ''}">${item.price}</div>
      </div>
    </div>`).join('')

  // ── Package card content ───────────────────────────────────────────────
  const packageCardHtml = hasEvent
    ? `<div class="package-tier">BookMySpaces · ${venueName}</div>
       <div class="package-name">${packageName} Package</div>
       <div class="package-price">${inr(basePrice)}</div>`
    : `<div class="package-tier">BookMySpaces · ${venueName}</div>
       <div class="package-name" style="font-size:18px">Accommodation Booking</div>
       <div class="package-price">${inr(roomsTotal)}</div>
       <div style="font-size:11px;color:rgba(255,255,255,.55);margin-top:6px;line-height:1.5">
         ${roomItems.length} room type${roomItems.length > 1 ? 's' : ''} · ${roomItems.reduce((s,r) => s + r.nights, 0)} total night${roomItems.reduce((s,r) => s + r.nights, 0) > 1 ? 's' : ''}
       </div>`

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Proposal ${propNum} — BookMySpaces</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;1,300;1,400&family=DM+Sans:wght@300;400;500;600&display=swap');

/* ── Reset ─────────────────────────────── */
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'DM Sans',system-ui,sans-serif;color:#1a1a1a;background:#fff;font-size:12px;line-height:1.45}
.page{max-width:800px;margin:0 auto}

/* ── Header ─────────────────────────────── */
.header{background:linear-gradient(135deg,#0b1520 0%,#162038 100%);padding:20px 40px 18px;position:relative;overflow:hidden}
.header::before{content:'';position:absolute;top:-50px;right:-50px;width:160px;height:160px;border-radius:50%;background:rgba(201,168,76,.07)}
.header-top{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px}
.brand-name{font-family:'Cormorant Garamond',Georgia,serif;font-size:22px;color:#fff;font-weight:400;letter-spacing:.4px}
.brand-tag{font-size:9px;color:#c9a84c;letter-spacing:.22em;text-transform:uppercase;margin-top:3px}
.proposal-meta{text-align:right}
.proposal-number{font-size:11px;color:rgba(255,255,255,.45);letter-spacing:.08em}
.proposal-date{font-size:10px;color:rgba(255,255,255,.35);margin-top:3px}
.header-for{font-size:9px;letter-spacing:.22em;text-transform:uppercase;color:rgba(201,168,76,.65);margin-bottom:4px}
.header-client-name{font-family:'Cormorant Garamond',Georgia,serif;font-size:34px;font-weight:300;color:#fff;letter-spacing:.4px;line-height:1.1}
.header-event-line{font-size:11px;color:rgba(201,168,76,.8);letter-spacing:.14em;text-transform:uppercase;margin-top:5px}

/* ── Gold rule ──────────────────────────── */
.gold-rule{height:1px;background:linear-gradient(90deg,#c9a84c 0%,rgba(201,168,76,.15) 70%,transparent 100%)}

/* ── Sections ───────────────────────────── */
.section{padding:14px 40px;border-bottom:1px solid #f0ede8}
.section-label{font-size:8.5px;letter-spacing:.22em;text-transform:uppercase;color:#c9a84c;font-weight:600;margin-bottom:9px}

/* ── Cover note ─────────────────────────── */
.cover-note{font-size:12px;color:#2c2c2c;line-height:1.65;font-style:italic;white-space:pre-line;padding:10px 14px;border-left:2px solid #c9a84c;background:#fdfaf6;border-radius:0 6px 6px 0}

/* ── Event details ──────────────────────── */
.details-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.detail-item{background:#f8f5f0;border-radius:7px;padding:8px 10px;border-left:2px solid #c9a84c}
.detail-label{font-size:8.5px;text-transform:uppercase;letter-spacing:.14em;color:#8a8a9a;margin-bottom:2px}
.detail-value{font-size:12px;color:#1a1a1a;font-weight:500}

/* ── Accommodation card ─────────────────── */
.accom-card{background:#f8f5f0;border-radius:9px;border:1px solid #ede8e0;overflow:hidden}
.accom-table{width:100%;border-collapse:collapse}
.accom-th{background:linear-gradient(135deg,#0b1520,#162038);color:rgba(255,255,255,.7);font-size:9px;text-transform:uppercase;letter-spacing:.14em;padding:7px 12px;font-weight:500;text-align:left}
.accom-td{padding:8px 12px;font-size:12px;color:#1a1a1a;border-bottom:1px solid #ede8e0;background:#fff}
.accom-td:first-child{font-weight:500}
.accom-subtotal{font-weight:600;color:#0b1520}
.accom-icon{font-size:13px;margin-right:5px}
.accom-total-row{display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:linear-gradient(135deg,#0b1520,#162038)}
.accom-total-label{font-size:10px;color:rgba(255,255,255,.6);text-transform:uppercase;letter-spacing:.1em}
.accom-total-value{font-size:16px;font-weight:700;color:#c9a84c}

/* ── Package + pricing ──────────────────── */
.pkg-pricing-row{display:flex;gap:14px;align-items:flex-start;padding:14px 40px}
.package-card{flex:1;background:linear-gradient(145deg,#0b1520,#162038);border-radius:10px;padding:16px 18px;color:#fff}
.package-tier{font-size:8.5px;letter-spacing:.22em;text-transform:uppercase;color:#c9a84c;margin-bottom:5px}
.package-name{font-family:'Cormorant Garamond',Georgia,serif;font-size:22px;font-weight:400}
.package-price{font-family:'Cormorant Garamond',Georgia,serif;font-size:26px;font-weight:600;color:#c9a84c;margin-top:4px}
.pricing-wrap{flex:1.1}
.pricing-table{width:100%;border-collapse:collapse}
.pricing-table td{padding:4px 0;font-size:12px}
.lbl{color:#4a4a5a}
.val{text-align:right;color:#1a1a1a;font-weight:500}
.total-row td{padding:8px 0 4px;font-size:16px;font-weight:600;color:#1a1a1a;border-top:1.5px solid #c9a84c}
.advance-box{background:#f0fdf4;border:1px solid #86efac;border-radius:7px;padding:7px 12px;margin-top:8px;display:flex;justify-content:space-between;align-items:center}
.advance-label{color:#16a34a;font-size:11px}
.advance-amount{color:#16a34a;font-size:17px;font-weight:600}

/* ── Inclusions ─────────────────────────── */
.inclusions-list{list-style:none;columns:4;gap:8px}
.inclusions-list li{font-size:11px;color:#3a3a4a;padding:2px 0;line-height:1.4;break-inside:avoid}
.inclusions-list li::before{content:'✔ ';color:#c9a84c;font-weight:600}
.req-box{margin-top:10px;padding:9px 12px;background:#fff8e8;border-radius:7px;border:1px solid rgba(201,168,76,.25);font-size:11px;color:#4a4a5a;line-height:1.5}

/* ── Concierge / Enhancement ────────────── */
.enh-wrap{margin:0 40px 10px;border-radius:9px;overflow:hidden;border:1px solid rgba(201,168,76,.28)}
.enh-header{background:linear-gradient(135deg,#0b1520,#162038);padding:10px 16px;display:flex;align-items:center;justify-content:space-between}
.enh-header-left{display:flex;align-items:center;gap:9px}
.enh-header-icon{font-size:14px;line-height:1}
.enh-header-label{font-size:8px;letter-spacing:.2em;text-transform:uppercase;color:#c9a84c;font-weight:600;margin-bottom:1px}
.enh-header-title{font-size:12px;color:#fff;font-weight:300}
.enh-header-right{font-size:9px;color:rgba(255,255,255,.3);text-align:right;line-height:1.4}
.enh-body{background:linear-gradient(180deg,#f8f5f0,#fff);padding:10px 16px}
.enh-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:7px}
.enh-item{display:flex;align-items:flex-start;gap:6px;padding:7px 9px;background:#fff;border-radius:6px;border:1px solid #ede8e0}
.enh-item-icon{font-size:12px;flex-shrink:0;line-height:1.2;margin-top:1px}
.enh-item-name{font-size:10px;font-weight:600;color:#0b1520;margin-bottom:1px}
.enh-item-price{font-size:9px;color:#8a9aaa}
.enh-item-price.gold{color:#a07830;font-weight:600}
.enh-footer{background:rgba(201,168,76,.05);border-top:1px solid rgba(201,168,76,.14);padding:7px 16px;display:flex;align-items:center;justify-content:space-between}
.enh-footer-text{font-size:9px;color:#5a6a80;line-height:1.4}
.enh-footer-cta{font-size:9px;font-weight:700;color:#a07830;white-space:nowrap;border:1px solid rgba(201,168,76,.28);padding:3px 10px;border-radius:20px;background:rgba(201,168,76,.07)}

/* ── Footer ─────────────────────────────── */
.footer{padding:16px 40px 18px;background:#f8f5f0}
.footer-cta{font-family:'Cormorant Garamond',Georgia,serif;font-size:18px;color:#1a1a1a;margin-bottom:10px}
.contact-row{display:flex;gap:0;flex-wrap:wrap;margin-bottom:10px;border:1px solid #ede8e0;border-radius:8px;overflow:hidden}
.contact-cell{flex:1;padding:8px 12px;border-right:1px solid #ede8e0;background:#fff}
.contact-cell:last-child{border-right:none}
.contact-cell-label{font-size:8px;text-transform:uppercase;letter-spacing:.14em;color:#8a8a9a;margin-bottom:2px}
.contact-cell-value{font-size:11px;color:#1a1a1a;font-weight:500}
.footer-address{font-size:10px;color:#6a6a7a;margin-bottom:8px}
.validity-note{font-size:9.5px;color:#8a8a9a;line-height:1.55;border-top:1px solid #e8e4de;padding-top:8px}

/* ── Closing strip ──────────────────────── */
.closing-strip{padding:16px 40px 20px;text-align:center}
.closing-rule{height:1px;background:linear-gradient(90deg,transparent,rgba(201,168,76,.3) 30%,rgba(201,168,76,.3) 70%,transparent);margin-bottom:14px}
.closing-text{font-size:9.5px;color:#9a9aaa;line-height:1.75;letter-spacing:.01em}
.closing-ref{display:inline-block;margin-top:8px;font-size:9px;font-weight:600;color:rgba(201,168,76,.7);letter-spacing:.18em;text-transform:uppercase;border-top:1px solid rgba(201,168,76,.2);padding-top:6px}

/* ── Print ──────────────────────────────── */
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

<!-- ═══ HEADER ═══ -->
<div class="header">
  <div class="header-top">
    <div>
      <div class="brand-name">BookMySpaces</div>
      <div class="brand-tag">Premium Hospitality · Kolkata</div>
    </div>
    <div class="proposal-meta">
      <div class="proposal-number">Proposal #${propNum}</div>
      <div class="proposal-date">${today}</div>
    </div>
  </div>
  <div class="header-for">Prepared Exclusively For</div>
  <div class="header-client-name">${clientSal}</div>
  <div class="header-event-line">${[
    eventType,
    fmtDate(proposal.event_date)
  ].filter(Boolean).join(' · ')}</div>
</div>
<div class="gold-rule"></div>

<!-- ═══ COVER NOTE ═══ -->
<div class="section">
  <div class="section-label">A Personal Note</div>
  <div class="cover-note">${coverNote}</div>
</div>

<!-- ═══ EVENT DETAILS ═══ -->
<div class="section">
  <div class="section-label">Event Details</div>
  <div class="details-grid">
    <div class="detail-item">
      <div class="detail-label">Client</div>
      <div class="detail-value">${clientName}</div>
    </div>
    ${clientPhone ? `
    <div class="detail-item">
      <div class="detail-label">Contact</div>
      <div class="detail-value">${clientPhone}</div>
    </div>` : ''}
    <div class="detail-item">
      <div class="detail-label">Event Type</div>
      <div class="detail-value">${eventType}</div>
    </div>
    ${proposal.event_date ? `
    <div class="detail-item">
      <div class="detail-label">Date</div>
      <div class="detail-value">${fmtDate(proposal.event_date)}</div>
    </div>` : ''}
    ${eventTime ? `
    <div class="detail-item">
      <div class="detail-label">Time</div>
      <div class="detail-value">${eventTime}</div>
    </div>` : ''}
    ${proposal.guest_count ? `
    <div class="detail-item">
      <div class="detail-label">Guests</div>
      <div class="detail-value">${proposal.guest_count} Guests</div>
    </div>` : ''}
    <div class="detail-item">
      <div class="detail-label">Venue</div>
      <div class="detail-value">${venueName}</div>
    </div>
  </div>
</div>

<!-- ═══ ACCOMMODATION DETAILS — only when rooms exist ═══ -->
${hasRooms ? `
<div class="section">
  <div class="section-label">Accommodation Details</div>
  <div class="accom-card">
    <table class="accom-table">
      <thead>
        <tr>
          <th class="accom-th">Room Type</th>
          <th class="accom-th" style="text-align:center">Qty</th>
          <th class="accom-th" style="text-align:center">Nights</th>
          <th class="accom-th" style="text-align:right">Rate / Night</th>
          <th class="accom-th" style="text-align:right">Subtotal</th>
        </tr>
      </thead>
      <tbody>${accomRowsHtml}</tbody>
    </table>
    <div class="accom-total-row">
      <span class="accom-total-label">Accommodation Subtotal</span>
      <span class="accom-total-value">${inr(roomsTotal)}</span>
    </div>
  </div>
</div>` : ''}

<!-- ═══ PACKAGE + PRICING ═══ -->
<div class="pkg-pricing-row">
  <div class="package-card">${packageCardHtml}</div>
  <div class="pricing-wrap">
    <table class="pricing-table">
      ${pricingRows}
      <tr class="total-row">
        <td>Grand Total</td>
        <td style="text-align:right;color:#c9a84c">${inr(totalPrice)}</td>
      </tr>
    </table>
    <div class="advance-box">
      <div>
        <div class="advance-label" style="font-size:10px;text-transform:uppercase;letter-spacing:.1em;font-weight:600">Advance to Confirm</div>
        <div style="font-size:9px;color:#16a34a;margin-top:1px">Balance due on event day · ${inr(balance)}</div>
      </div>
      <div class="advance-amount">${inr(advanceRequired)}</div>
    </div>
  </div>
</div>

<!-- ═══ INCLUSIONS — only when event package exists ═══ -->
${hasEvent && inclusionsHtml ? `
<div class="section">
  <div class="section-label">What's Included</div>
  <ul class="inclusions-list">${inclusionsHtml}</ul>
  ${specialRequirements ? `
  <div class="req-box">
    <span style="font-size:8.5px;text-transform:uppercase;letter-spacing:.14em;color:#c9a84c;font-weight:600">Special Requirements · </span>${specialRequirements}
  </div>` : ''}
</div>` : specialRequirements ? `
<div class="section">
  <div class="section-label">Special Requirements</div>
  <div class="req-box">${specialRequirements}</div>
</div>` : ''}

<!-- ═══ CONCIERGE SERVICES ═══ -->
<div class="enh-wrap">
  <div class="enh-header">
    <div class="enh-header-left">
      <div class="enh-header-icon">✦</div>
      <div>
        <div class="enh-header-label">Concierge Services</div>
        <div class="enh-header-title">Enhance Your Celebration</div>
      </div>
    </div>
    <div class="enh-header-right">Everything you need,<br>arranged by our team.</div>
  </div>
  <div class="enh-body">
    <div class="enh-grid">${conciergeHtml}</div>
  </div>
  <div class="enh-footer">
    <div class="enh-footer-text">Perfect for birthdays, anniversaries, rooftop events, corporate gatherings &amp; romantic dinners.</div>
    <div class="enh-footer-cta">Ask our team →</div>
  </div>
</div>

<!-- ═══ FOOTER ═══ -->
<div class="footer">
  <div class="footer-cta">Ready to Celebrate? Let's Confirm Your Booking.</div>
  <div class="contact-row">
    <div class="contact-cell">
      <div class="contact-cell-label">WhatsApp / Call</div>
      <div class="contact-cell-value">8017035546</div>
    </div>
    <div class="contact-cell">
      <div class="contact-cell-label">Alternate</div>
      <div class="contact-cell-value">7003853624</div>
    </div>
    <div class="contact-cell">
      <div class="contact-cell-label">UPI Payment</div>
      <div class="contact-cell-value">9836014495@upi</div>
    </div>
    <div class="contact-cell">
      <div class="contact-cell-label">Website</div>
      <div class="contact-cell-value">bookmyspaces.in</div>
    </div>
  </div>
  <div class="footer-address">📍 Mukundapur, Near Ruby Hospital, EM Bypass, Kolkata</div>
  <div class="validity-note">
    This proposal is valid for 7 days from ${today}. Valid until ${validTill}.
    Slot confirmed only upon advance payment receipt.
    BookMySpaces reserves the right to release the date if advance is not received within this period.
  </div>
</div>

<!-- ═══ CLOSING STRIP ═══ -->
<div class="closing-strip">
  <div class="closing-rule"></div>
  <div class="closing-text">
    <strong style="color:#6a6a7a;font-weight:600">Digitally Generated Proposal</strong><br>
    This proposal has been generated through the BookMySpaces Proposal System and is valid without a physical signature.<br>
    For modifications or customisations, please contact our team directly.
  </div>
  <div class="closing-ref">Proposal Reference: ${propNum}</div>
</div>

</div>
</body>
</html>`
}
