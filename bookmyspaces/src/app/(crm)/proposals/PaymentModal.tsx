'use client'

import { useState } from 'react'
import { X, Loader2, IndianRupee } from 'lucide-react'
import { computeOutstanding, validatePaymentAmount } from '@/lib/payment-validation'

export interface PaymentModalProposal {
  id             : string
  client_name    : string | null
  proposal_number: string | null
  total_price    : number | null
  advance_paid   : number | null
}

function formatINR(n: number): string {
  if (n >= 100_000) return `₹${(n / 100_000).toFixed(1)}L`
  if (n >= 1_000)   return `₹${(n / 1_000).toFixed(0)}K`
  return `₹${n}`
}

export function PaymentModal({
  proposal, onClose, onSuccess,
}: {
  proposal: PaymentModalProposal; onClose: () => void; onSuccess: () => void
}) {
  const outstanding = computeOutstanding(proposal.total_price, proposal.advance_paid)

  const [amount, setAmount] = useState(outstanding > 0 ? String(outstanding) : '')
  const [date,   setDate]   = useState(new Date().toISOString().slice(0, 10))
  const [mode,   setMode]   = useState('upi')
  const [ref,    setRef]    = useState('')
  const [notes,  setNotes]  = useState('')
  const [type,   setType]   = useState('advance')
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const validationError = validatePaymentAmount(parseFloat(amount || '0'), outstanding)
    if (validationError) { setError(validationError); return }
    setSaving(true)
    try {
      const res = await fetch(`/api/proposals/${proposal.id}/payment`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: parseFloat(amount), payment_date: date, payment_mode: mode, transaction_ref: ref || null, notes: notes || null, payment_type: type }),
      })
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error ?? `Error ${res.status}`) }
      onSuccess()
    } catch (err: any) { setError(err.message ?? 'Failed to record payment'); setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 bg-gray-900 text-white">
          <div>
            <p className="text-xs text-gray-400 mb-0.5">Record Payment</p>
            <p className="text-sm font-bold">{proposal.client_name} · {proposal.proposal_number}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"><X className="w-4 h-4"/></button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          {error && <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">{error}</div>}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="payment-amount" className="block text-xs font-semibold text-gray-500 uppercase tracking-widest mb-1.5">Amount (₹) *</label>
              <input id="payment-amount" type="number" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="25000" required
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"/>
            </div>
            <div>
              <label htmlFor="payment-date" className="block text-xs font-semibold text-gray-500 uppercase tracking-widest mb-1.5">Date</label>
              <input id="payment-date" type="date" value={date} onChange={e=>setDate(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"/>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="payment-mode" className="block text-xs font-semibold text-gray-500 uppercase tracking-widest mb-1.5">Payment Mode</label>
              <select id="payment-mode" value={mode} onChange={e=>setMode(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none bg-white">
                <option value="upi">UPI</option><option value="cash">Cash</option>
                <option value="card">Card</option><option value="bank_transfer">Bank Transfer</option>
                <option value="cheque">Cheque</option>
              </select>
            </div>
            <div>
              <label htmlFor="payment-type" className="block text-xs font-semibold text-gray-500 uppercase tracking-widest mb-1.5">Payment Type</label>
              <select id="payment-type" value={type} onChange={e=>setType(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none bg-white">
                <option value="advance">Advance</option><option value="partial">Partial</option>
                <option value="final">Final Payment</option>
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="payment-ref" className="block text-xs font-semibold text-gray-500 uppercase tracking-widest mb-1.5">Transaction Reference</label>
            <input id="payment-ref" type="text" value={ref} onChange={e=>setRef(e.target.value)} placeholder="UPI ref / cheque no."
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"/>
          </div>
          <div>
            <label htmlFor="payment-notes" className="block text-xs font-semibold text-gray-500 uppercase tracking-widest mb-1.5">Notes</label>
            <textarea id="payment-notes" value={notes} onChange={e=>setNotes(e.target.value)} rows={2} placeholder="Optional notes…"
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"/>
          </div>
          {proposal.total_price && (
            <div className="bg-gray-50 rounded-xl px-4 py-3 text-xs space-y-1">
              <div className="flex justify-between text-gray-500">
                <span>Proposal Total</span><span className="font-medium text-gray-700">{formatINR(proposal.total_price)}</span>
              </div>
              {(proposal.advance_paid??0)>0 && (
                <div className="flex justify-between text-blue-600">
                  <span>Already Paid</span><span className="font-medium">− {formatINR(proposal.advance_paid??0)}</span>
                </div>
              )}
              {amount && parseFloat(amount)>0 && (
                <div className="flex justify-between text-green-600 border-t border-gray-200 pt-1 mt-1">
                  <span>Balance After This</span>
                  <span className="font-bold">{formatINR(Math.max(0, outstanding - parseFloat(amount)))}</span>
                </div>
              )}
            </div>
          )}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
            <button type="submit" disabled={saving}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-gray-900 text-white rounded-xl text-sm font-bold hover:bg-gray-800 disabled:opacity-60">
              {saving?<><Loader2 className="w-4 h-4 animate-spin"/>Saving…</>:<><IndianRupee className="w-4 h-4"/>Record Payment</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
