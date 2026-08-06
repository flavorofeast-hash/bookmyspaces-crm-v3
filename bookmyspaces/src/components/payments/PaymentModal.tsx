'use client'

// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/components/payments/PaymentModal.tsx
// Payment module dedup — extracted from src/app/(crm)/proposals/page.tsx so
// both the Proposals page and the Reservation Details page can Record
// Payment against the same single API (POST /api/proposals/[id]/payment)
// without a second implementation. Payments remain proposal-scoped in the DB
// — callers must resolve a proposalId first (the Reservation Details page
// does this via its existing ensureProposalId() helper, already used there
// for Generate Invoice).
//
// Props generalized from the page-specific `proposal: ProposalWithLead` to
// the minimal shape every call site needs. `fallbackTotal`/`fallbackPaid`
// preserve the exact pre-refactor behavior for callers with no linked
// Reservation (Proposals page, accepted-but-not-yet-converted proposal) —
// once a Reservation exists, GET .../payment's `commercial` field takes over
// automatically (unchanged logic, just moved here).
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useRef } from 'react'
import { X, Loader2, IndianRupee, CheckCircle2 } from 'lucide-react'
import { formatINR } from './format'

export interface PaymentModalProps {
  proposalId    : string
  displayName   : string
  displayRef    : string
  fallbackTotal?: number
  fallbackPaid? : number
  onClose       : () => void
  onSuccess     : () => void
}

export function PaymentModal({
  proposalId, displayName, displayRef, fallbackTotal = 0, fallbackPaid = 0, onClose, onSuccess,
}: PaymentModalProps) {
  // Bug fix: Amount must default to the current outstanding balance
  // (Reservation Total − Total Payments Received when a Reservation is
  // linked, else Proposal Total − Proposal Advance Paid), never a hardcoded
  // or stale value. Seeded synchronously from fallbackTotal/fallbackPaid (the
  // caller's already-known figures — e.g. reservation.finalRoomRate on the
  // Reservation Details page) so the field is correct on first paint, then
  // corrected again once the commercial fetch below resolves (effect further
  // down) — but never after the operator has started typing their own amount.
  const [amount, setAmount] = useState(() => {
    const balance = Math.max(0, fallbackTotal - fallbackPaid)
    return balance > 0 ? String(balance) : ''
  })
  const amountEditedRef = useRef(false)
  const [date,   setDate]   = useState(new Date().toISOString().slice(0,10))
  const [mode,   setMode]   = useState('upi')
  const [ref,    setRef]    = useState('')
  const [notes,  setNotes]  = useState('')
  const [type,   setType]   = useState('advance')
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState<string|null>(null)

  // Production-hardening pass: once a Reservation is linked, its commercial
  // figures (same resolver Invoice/Receipt/Payment Reminder use) must drive
  // this balance preview instead of proposal.total_price/advance_paid — see
  // GET /api/proposals/[id]/payment. Falls back to fallbackTotal/fallbackPaid
  // (unchanged Proposal-based calculation) when `commercial` hasn't loaded
  // yet or no Reservation is linked (source === 'proposal').
  const [commercial, setCommercial] = useState<{ source:'reservation'|'proposal'; total:number; paid:number; balanceDue:number } | null>(null)
  useEffect(()=>{
    let cancelled = false
    fetch(`/api/proposals/${proposalId}/payment`)
      .then(r=>r.json())
      .then(d=>{ if(!cancelled && d?.commercial) setCommercial(d.commercial) })
      .catch(()=>{})
    return ()=>{ cancelled = true }
  }, [proposalId])

  const usingReservation = commercial?.source === 'reservation'
  const previewTotal = usingReservation ? commercial!.total : fallbackTotal
  const previewPaid  = usingReservation ? commercial!.paid  : fallbackPaid
  // Outstanding Balance = Reservation/Proposal Total − Total Payments
  // Received, clamped at 0 — the default Amount can never exceed this.
  const outstandingBalance = Math.max(0, previewTotal - previewPaid)
  const isFullyPaid = previewTotal > 0 && outstandingBalance <= 0

  // Re-derive the default Amount whenever the authoritative total/paid figures
  // change (fallback -> commercial fetch resolving with the Reservation-first
  // values) — but only until the operator edits the field themselves.
  useEffect(()=>{
    if (amountEditedRef.current) return
    setAmount(outstandingBalance > 0 ? String(outstandingBalance) : '')
  }, [outstandingBalance])

  async function submit(e:React.FormEvent) {
    e.preventDefault()
    if (isFullyPaid) return
    if (!amount||parseFloat(amount)<=0){setError('Enter a valid amount');return}
    setSaving(true)
    try {
      const res=await fetch(`/api/proposals/${proposalId}/payment`,{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({amount:parseFloat(amount),payment_date:date,payment_mode:mode,transaction_ref:ref||null,notes:notes||null,payment_type:type}),
      })
      if (!res.ok){const d=await res.json().catch(()=>({}));throw new Error(d.error??`Error ${res.status}`)}
      onSuccess()
    } catch(err:any){setError(err.message??'Failed to record payment');setSaving(false)}
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 bg-gray-900 text-white">
          <div>
            <p className="text-xs text-gray-400 mb-0.5">Record Payment</p>
            <p className="text-sm font-bold">{displayName} · {displayRef}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"><X className="w-4 h-4"/></button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          {error&&<div className="px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">{error}</div>}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-widest mb-1.5">Amount (₹) *</label>
              <input type="number" value={amount} onChange={e=>{ amountEditedRef.current = true; setAmount(e.target.value) }} required
                disabled={isFullyPaid}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-400"/>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-widest mb-1.5">Date</label>
              <input type="date" value={date} onChange={e=>setDate(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"/>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-widest mb-1.5">Payment Mode</label>
              <select value={mode} onChange={e=>setMode(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none bg-white">
                <option value="upi">UPI</option><option value="cash">Cash</option>
                <option value="card">Card</option><option value="bank_transfer">Bank Transfer</option>
                <option value="cheque">Cheque</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-widest mb-1.5">Payment Type</label>
              <select value={type} onChange={e=>setType(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none bg-white">
                <option value="advance">Advance</option><option value="partial">Partial</option>
                <option value="final">Final Payment</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-widest mb-1.5">Transaction Reference</label>
            <input type="text" value={ref} onChange={e=>setRef(e.target.value)} placeholder="UPI ref / cheque no."
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"/>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-widest mb-1.5">Notes</label>
            <textarea value={notes} onChange={e=>setNotes(e.target.value)} rows={2} placeholder="Optional notes…"
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"/>
          </div>
          {previewTotal>0&&(
            <div className="bg-gray-50 rounded-xl px-4 py-3 text-xs space-y-1">
              <div className="flex justify-between text-gray-500">
                <span>{usingReservation?'Reservation Total':'Proposal Total'}</span><span className="font-medium text-gray-700">{formatINR(previewTotal)}</span>
              </div>
              {previewPaid>0&&(
                <div className="flex justify-between text-blue-600">
                  <span>Already Paid</span><span className="font-medium">− {formatINR(previewPaid)}</span>
                </div>
              )}
              {amount&&parseFloat(amount)>0&&(
                <div className="flex justify-between text-green-600 border-t border-gray-200 pt-1 mt-1">
                  <span>Balance After This</span>
                  <span className="font-bold">{formatINR(Math.max(0,previewTotal-previewPaid-parseFloat(amount)))}</span>
                </div>
              )}
            </div>
          )}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
            <button type="submit" disabled={saving||isFullyPaid}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-gray-900 text-white rounded-xl text-sm font-bold hover:bg-gray-800 disabled:opacity-60">
              {isFullyPaid
                ? <><CheckCircle2 className="w-4 h-4"/>Fully Paid</>
                : saving
                  ? <><Loader2 className="w-4 h-4 animate-spin"/>Saving…</>
                  : <><IndianRupee className="w-4 h-4"/>Record Payment</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
