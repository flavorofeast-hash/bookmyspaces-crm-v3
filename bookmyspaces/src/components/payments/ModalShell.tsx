'use client'

// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/components/payments/ModalShell.tsx
// Payment module dedup — extracted unchanged from
// src/app/(crm)/proposals/page.tsx. Shared by ReceiptsModal and by
// FinanceModal (which stays local to the Proposals page, out of scope for
// the payment-module refactor, but keeps using this same shell).
// ─────────────────────────────────────────────────────────────────────────────

import { X } from 'lucide-react'
import type { ReactNode } from 'react'

export function ModalShell({title,sub,onClose,children}:{
  title:string; sub:string; onClose:()=>void; children:ReactNode
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 bg-gray-900 text-white flex-shrink-0">
          <div>
            <p className="text-xs text-gray-400 mb-0.5">{sub}</p>
            <p className="text-sm font-bold">{title}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg hover:bg-white/10 transition-colors">
            <X className="w-4 h-4"/>
          </button>
        </div>
        <div className="overflow-y-auto flex-1">{children}</div>
      </div>
    </div>
  )
}
