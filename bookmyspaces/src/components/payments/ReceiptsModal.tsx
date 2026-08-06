'use client'

// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/components/payments/ReceiptsModal.tsx
// Payment module dedup — extracted from src/app/(crm)/proposals/page.tsx.
// Renders payment history + "Generate Receipt" (view/print) for every
// recorded payment against a given proposalId. Same underlying API
// (GET /api/proposals/[id]/payment, GET /api/proposals/[id]/receipt) reused
// by both the Proposals page and the Reservation Details page — no second
// implementation.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect } from 'react'
import { Loader2, Receipt } from 'lucide-react'
import { ModalShell } from './ModalShell'
import { fmtINRFull, fmtDate, modeLabel, modeIcon, type PaymentRecord } from './format'

export interface ReceiptsModalProps {
  proposalId : string
  displayName: string
  displayRef : string
  onClose    : () => void
}

export function ReceiptsModal({ proposalId, displayName, displayRef, onClose }: ReceiptsModalProps) {
  const [payments, setPayments] = useState<PaymentRecord[]>([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState<string|null>(null)

  useEffect(()=>{
    setLoading(true)
    fetch(`/api/proposals/${proposalId}/payment`)
      .then(r=>r.json())
      .then(d=>{
        setPayments(Array.isArray(d.payments)?d.payments:[])
        setLoading(false)
      })
      .catch(()=>{setError('Failed to load payments');setLoading(false)})
  },[proposalId])

  return (
    <ModalShell
      title={`Advance Receipts — ${displayRef}`}
      sub={displayName}
      onClose={onClose}
    >
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-5 h-5 animate-spin text-gray-400"/>
        </div>
      ) : error ? (
        <div className="p-5 text-sm text-red-600">{error}</div>
      ) : payments.length === 0 ? (
        <div className="p-8 text-center">
          <Receipt className="w-10 h-10 text-gray-200 mx-auto mb-3"/>
          <p className="text-sm text-gray-400 font-medium">No payments recorded yet.</p>
          <p className="text-xs text-gray-300 mt-1">Receipts will appear here after recording a payment.</p>
        </div>
      ) : (
        <div className="divide-y divide-gray-100">
          {/* Summary header */}
          <div className="px-5 py-3 bg-gray-50 flex items-center justify-between">
            <span className="text-xs text-gray-500">{payments.length} payment{payments.length!==1?'s':''} recorded</span>
            <span className="text-xs font-bold text-emerald-700">
              Total: {fmtINRFull(payments.reduce((s,p)=>s+Number(p.amount),0))}
            </span>
          </div>

          {payments.map((p,i)=>(
            <div key={p.id} className="px-5 py-4">
              {/* Row header */}
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-base">{modeIcon(p.payment_mode)}</span>
                  <div>
                    <p className="text-xs font-bold text-gray-800 font-mono tracking-wide">{p.receipt_number}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{fmtDate(p.payment_date)}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-base font-black text-gray-900">{fmtINRFull(Number(p.amount))}</p>
                  <p className="text-xs text-gray-400 capitalize mt-0.5">{modeLabel(p.payment_mode)}</p>
                </div>
              </div>

              {/* Meta row */}
              <div className="flex items-center gap-2 flex-wrap mb-3">
                <span className="inline-flex items-center px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-full border border-gray-200 capitalize">
                  {(p.payment_type||'advance').replace('_',' ')}
                </span>
                {p.transaction_ref && (
                  <span className="inline-flex items-center px-2 py-0.5 bg-blue-50 text-blue-700 text-xs rounded-full border border-blue-200 font-mono">
                    {p.transaction_ref}
                  </span>
                )}
                {p.notes && (
                  <span className="text-xs text-gray-400 italic truncate max-w-[180px]">{p.notes}</span>
                )}
              </div>

              {/* Action buttons */}
              <div className="flex gap-2">
                <button
                  onClick={()=>window.open(`/api/proposals/${proposalId}/receipt?payment_id=${p.id}`,'_blank')}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-teal-50 text-teal-700 border border-teal-200 rounded-lg text-xs font-semibold hover:bg-teal-100 transition-colors">
                  <Receipt className="w-3.5 h-3.5"/> View Receipt
                </button>
                <button
                  onClick={()=>window.open(`/api/proposals/${proposalId}/receipt?payment_id=${p.id}&print=1`,'_blank')}
                  className="inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-gray-100 text-gray-700 border border-gray-200 rounded-lg text-xs font-semibold hover:bg-gray-200 transition-colors">
                  🖨 Print
                </button>
              </div>

              {i < payments.length-1 && <div className="mt-4 border-b border-dashed border-gray-100"/>}
            </div>
          ))}
        </div>
      )}
    </ModalShell>
  )
}
