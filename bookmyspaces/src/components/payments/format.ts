// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/components/payments/format.ts
// Payment module dedup — pure extraction from
// src/app/(crm)/proposals/page.tsx (byte-for-byte, behavior unchanged) so the
// shared PaymentModal/ReceiptsModal (and any other future payment surface,
// e.g. Reservation Details) don't redeclare these.
// ─────────────────────────────────────────────────────────────────────────────

export interface PaymentRecord {
  id             : string
  receipt_number : string
  amount         : number
  payment_date   : string
  payment_mode   : string
  transaction_ref: string|null
  notes          : string|null
  payment_type   : string
  created_at     : string
}

export function formatINR(n:number):string {
  if (n>=100_000) return `₹${(n/100_000).toFixed(1)}L`
  if (n>=1_000)   return `₹${(n/1_000).toFixed(0)}K`
  return `₹${n}`
}

export function fmtINRFull(n:number):string {
  return '₹' + Number(n).toLocaleString('en-IN')
}

export function fmtDate(iso:string|null|undefined):string {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}) }
  catch { return iso }
}

export function modeLabel(m:string):string {
  const map:Record<string,string>={cash:'Cash',upi:'UPI',card:'Card',bank_transfer:'Bank Transfer',cheque:'Cheque'}
  return map[m]??m
}

export function modeIcon(m:string):string {
  const map:Record<string,string>={upi:'📱',cash:'💵',card:'💳',bank_transfer:'🏦',cheque:'📄'}
  return map[m]??'💰'
}
