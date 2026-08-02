'use client'

// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/components/leads/LeadProposals.tsx
// Lead Workspace v1 — extraction, not a rewrite. The exact Proposals list
// block that previously lived inline in
// src/app/(crm)/customers/[id]/page.tsx, moved here unchanged so both the
// Customer Profile page and the new Lead Workspace render the same
// GET /api/proposals?lead_id= data without duplicating the JSX.
// Presentational only — the caller fetches the proposals and passes them in.
// ─────────────────────────────────────────────────────────────────────────────

import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { fmtINR, fmtDate } from '@/lib/format'

export interface ProposalSummary {
  id: string
  proposal_number: string | null
  package_name: string | null
  total_price: number | null
  status: string
  created_at: string
}

export function LeadProposals({ proposals }: { proposals: ProposalSummary[] }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <h2 className="text-sm font-semibold text-gray-700 mb-4">Proposals</h2>
      {proposals.length === 0 ? (
        <p className="text-sm text-gray-400">No proposals yet.</p>
      ) : (
        <ul className="space-y-3">
          {proposals.map((p) => (
            <li key={p.id}>
              <Link
                href={`/proposals`}
                className="flex items-center justify-between gap-2 group"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium text-gray-800 truncate">
                    {p.proposal_number ?? p.id.slice(0, 8)} — {p.package_name ?? 'Custom'}
                  </div>
                  <div className="text-xs text-gray-400">{fmtDate(p.created_at)} · {p.status}</div>
                </div>
                <div className="flex items-center gap-1 shrink-0 text-sm font-semibold text-gray-700">
                  {fmtINR(p.total_price)}
                  <ChevronRight className="w-3.5 h-3.5 text-gray-300 group-hover:text-gray-500" />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
