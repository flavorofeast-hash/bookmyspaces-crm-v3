'use client'

// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/app/(crm)/dashboard/leads/page.tsx
// Lead Management — now an intelligent sales pipeline.
//
// RC2 pipeline pass: this page previously badged every lead using only
// leads.status/lead_stage (effectiveStage()), so a lead with an accepted
// proposal and a confirmed reservation still showed "New Inquiry". It now
// fetches from the additive GET /api/leads/pipeline endpoint
// (src/lib/leads/pipeline-service.ts), which derives the REAL business stage
// from related proposals / site visits / reservations in one batched,
// non-N+1 request per page (see that file's header for the exact query
// budget). The original GET /api/leads route is untouched — nothing else
// that reads it is affected.
//
// Everything about search/sort/pagination below is unchanged from before
// this pass; only the data source and the rendered columns changed.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Search, RefreshCw, Upload, Plus, AlertTriangle, ChevronLeft, ChevronRight,
  ArrowUpDown, ArrowUp, ArrowDown, Phone, Mail, FileText, Share2, Download,
  MapPinned, BedDouble, MessageSquare, RotateCcw, CheckCircle2, GitMerge, X, Loader2,
} from 'lucide-react'
import { fmtINR, fmtDate } from '@/lib/format'
import {
  BUSINESS_STAGE_META, PROPOSAL_STATUS_LABEL, reservationStatusLabel, visitStatusLabel,
} from '@/lib/leads/pipeline-stage'
import type { LeadWithPipeline } from '@/lib/leads/pipeline-service'
import { NewLeadModal, leadWorkspaceHref } from '@/components/leads/NewLeadModal'

type SortKey = 'name' | 'phone' | 'email' | 'source' | 'created_at'
type RouterInstance = ReturnType<typeof useRouter>

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'phone', label: 'Phone' },
  { key: 'email', label: 'Email' },
  { key: 'source', label: 'Source' },
  { key: 'created_at', label: 'Created Date' },
]

const PAGE_SIZE = 25

function BusinessStageBadge({ lead }: { lead: LeadWithPipeline }) {
  const meta = BUSINESS_STAGE_META[lead.businessStage]
  return (
    <span
      className="px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap"
      style={{ color: meta?.color, backgroundColor: meta?.bg }}
    >
      {meta?.label ?? lead.businessStage}
    </span>
  )
}

function proposalHref(lead: LeadWithPipeline): string {
  const p = new URLSearchParams({
    lead_id: lead.id,
    name: lead.name || '',
    phone: lead.phone || '',
    event: lead.event_type || '',
    guests: String(lead.guest_count || ''),
    date: lead.event_date || '',
  })
  return `/proposals/new?${p.toString()}`
}

function visitHref(lead: LeadWithPipeline): string {
  const p = new URLSearchParams({ lead_id: lead.id, name: lead.name || '', phone: lead.phone || '' })
  return `/visits/new?${p.toString()}`
}

// ─── Per-row Quick Actions ──────────────────────────────────────────────────
// Conditionally shown per the mission spec. Every action below reuses an
// existing route/behaviour already shipped elsewhere in the app — see
// docs/LEAD_PIPELINE_REPORT.md for the exact source of each:
//   - Email Proposal  -> POST /api/proposals/email, then PATCH /api/proposals
//     status:'sent' — identical to proposals/page.tsx's handleSendEmail().
//   - WhatsApp Proposal -> same wa.me deep-link + status:'sent' pattern as
//     proposals/page.tsx's handleAction('send_via_whatsapp', ...), using the
//     lead's own name/phone (this cell doesn't have proposal.client_name/
//     client_phone loaded — disclosed simplification, same contact in
//     practice).
//   - Copy Public Link -> same share_token clipboard copy as the Copy Link
//     bug fix on the Proposals page.
//   - Complete Visit / Reschedule Visit -> PATCH /api/site-visits/[id],
//     the exact route dashboard/operations/page.tsx already uses to mark a
//     visit completed. "Reschedule" first flips the old visit's status to
//     'rescheduled' (freeing scheduleSiteVisit()'s one-pending-visit guard),
//     then opens /visits/new prefilled for the new date — there is no
//     "change the date on an existing visit" endpoint in this codebase, so
//     this is the closest honest reuse of what already exists.
//   - "Open Proposal" and "Open Visit" reuse the only existing pages that
//     surface that data (no per-proposal or per-visit detail page exists).
//   - "Open Reservation" links to the existing /reservations/[id] page.

function QuickActionsCell({
  lead, onRefresh, router, onMergeClick,
}: {
  lead: LeadWithPipeline
  onRefresh: () => void
  router: RouterInstance
  onMergeClick: (lead: LeadWithPipeline) => void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const btnClass =
    'inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium border whitespace-nowrap transition-colors disabled:opacity-50'

  async function markProposalSent(proposalId: string) {
    await fetch('/api/proposals', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: proposalId, status: 'sent' }),
    }).catch(() => null)
  }

  async function handleEmailProposal(proposalId: string) {
    setBusy('email')
    try {
      const res = await fetch('/api/proposals/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proposal_id: proposalId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        alert(data.error ? `Could not send email: ${data.error}` : 'Could not send email.')
        return
      }
      if (data.method === 'mailto' && data.mailto_url) window.open(data.mailto_url, '_blank')
      await markProposalSent(proposalId)
      onRefresh()
    } catch {
      alert('Could not send email — please try again.')
    } finally {
      setBusy(null)
    }
  }

  async function handleWhatsAppProposal(proposalId: string, shareToken: string) {
    if (!lead.phone) return
    const msg = encodeURIComponent(
      `Dear ${lead.name ?? 'Sir/Ma\'am'}, please find your proposal: ${window.location.origin}/proposals/share/${shareToken}`
    )
    window.open(`https://wa.me/${lead.phone.replace(/\D/g, '')}?text=${msg}`, '_blank')
    setBusy('whatsapp')
    await markProposalSent(proposalId)
    setBusy(null)
    onRefresh()
  }

  async function handleCompleteVisit(visitId: string) {
    setBusy('complete-visit')
    try {
      const res = await fetch(`/api/site-visits/${visitId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'completed' }),
      })
      if (!res.ok) throw new Error()
      onRefresh()
    } catch {
      alert('Could not update this visit — please try again.')
    } finally {
      setBusy(null)
    }
  }

  async function handleRescheduleVisit(visitId: string) {
    setBusy('reschedule-visit')
    try {
      const res = await fetch(`/api/site-visits/${visitId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'rescheduled' }),
      })
      if (!res.ok) throw new Error()
      router.push(visitHref(lead))
    } catch {
      alert('Could not reschedule this visit — please try again.')
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-wrap gap-1.5" onClick={(e) => e.stopPropagation()}>
      {lead.primaryProposal ? (
        <>
          <Link href="/proposals" className={`${btnClass} border-blue-200 text-blue-700 hover:bg-blue-50`}>
            <FileText className="w-3 h-3" /> Open Proposal
          </Link>
          {lead.primaryProposal.share_token && (
            <button
              type="button"
              onClick={() => {
                const token = lead.primaryProposal!.share_token
                if (token) navigator.clipboard.writeText(`${window.location.origin}/proposals/share/${token}`)
              }}
              className={`${btnClass} border-violet-200 text-violet-700 hover:bg-violet-50`}
            >
              <Share2 className="w-3 h-3" /> Copy Public Link
            </button>
          )}
          <a
            href={`/api/proposals/${lead.primaryProposal.id}/pdf`}
            target="_blank"
            rel="noopener noreferrer"
            className={`${btnClass} border-gray-200 text-gray-600 hover:bg-gray-50`}
          >
            <Download className="w-3 h-3" /> PDF
          </a>
          <button
            type="button"
            disabled={busy === 'email'}
            onClick={() => handleEmailProposal(lead.primaryProposal!.id)}
            className={`${btnClass} border-blue-200 text-blue-700 hover:bg-blue-50`}
          >
            <Mail className="w-3 h-3" /> Email
          </button>
          {lead.primaryProposal.share_token && (
            <button
              type="button"
              disabled={busy === 'whatsapp' || !lead.phone}
              onClick={() => handleWhatsAppProposal(lead.primaryProposal!.id, lead.primaryProposal!.share_token!)}
              className={`${btnClass} border-transparent text-white`}
              style={{ background: '#25D366' }}
            >
              <MessageSquare className="w-3 h-3" /> WhatsApp
            </button>
          )}
        </>
      ) : (
        <Link href={proposalHref(lead)} className={`${btnClass} border-blue-200 text-blue-700 hover:bg-blue-50`}>
          <FileText className="w-3 h-3" /> Create Proposal
        </Link>
      )}

      {(lead.hasScheduledVisit || lead.hasCompletedVisit) && (
        <Link href="/dashboard/operations" className={`${btnClass} border-amber-200 text-amber-700 hover:bg-amber-50`}>
          <MapPinned className="w-3 h-3" /> Open Visit
        </Link>
      )}
      {lead.hasScheduledVisit && lead.latestVisitId && (
        <>
          <button
            type="button"
            disabled={busy === 'reschedule-visit'}
            onClick={() => handleRescheduleVisit(lead.latestVisitId!)}
            className={`${btnClass} border-amber-200 text-amber-700 hover:bg-amber-50`}
          >
            <RotateCcw className="w-3 h-3" /> Reschedule Visit
          </button>
          <button
            type="button"
            disabled={busy === 'complete-visit'}
            onClick={() => handleCompleteVisit(lead.latestVisitId!)}
            className={`${btnClass} border-teal-200 text-teal-700 hover:bg-teal-50`}
          >
            <CheckCircle2 className="w-3 h-3" /> Complete Visit
          </button>
        </>
      )}

      {lead.hasAnyReservation && lead.reservationId && (
        <Link
          href={`/reservations/${lead.reservationId}`}
          className={`${btnClass} border-emerald-200 text-emerald-700 hover:bg-emerald-50`}
        >
          <BedDouble className="w-3 h-3" /> Open Reservation
        </Link>
      )}

      {/* Social Operations Priority 4 — duplicate lead prevention. Opens
          MergeLeadModal below, reusing this same page's GET /api/leads/
          pipeline search for finding the duplicate and the existing
          POST /api/leads/[id]/merge API (no new endpoint). */}
      <button
        type="button"
        onClick={() => onMergeClick(lead)}
        className={`${btnClass} border-gray-200 text-gray-500 hover:bg-gray-50`}
      >
        <GitMerge className="w-3 h-3" /> Merge Duplicate
      </button>
    </div>
  )
}

// Social Operations Priority 4 — duplicate lead merge modal. Reuses GET
// /api/leads/pipeline (this page's own search endpoint) to find the
// duplicate lead by name/phone/email, then POST /api/leads/[id]/merge to
// merge it into `primary`. No new search API, no new merge API — this is
// purely a UI trigger for logic that already existed server-side with zero
// UI before this pass.
function MergeLeadModal({
  primary, onClose, onMerged,
}: {
  primary: LeadWithPipeline
  onClose: () => void
  onMerged: () => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<LeadWithPipeline[]>([])
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState<LeadWithPipeline | null>(null)
  const [merging, setMerging] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    if (!query.trim()) return
    setSearching(true)
    setError(null)
    try {
      const params = new URLSearchParams({ limit: '10', offset: '0', search: query.trim() })
      const res = await fetch(`/api/leads/pipeline?${params.toString()}`)
      const json = await res.json()
      setResults((json.leads ?? []).filter((l: LeadWithPipeline) => l.id !== primary.id))
    } catch {
      setError('Search failed — please try again.')
    } finally {
      setSearching(false)
    }
  }

  async function handleConfirmMerge() {
    if (!selected) return
    setMerging(true)
    setError(null)
    try {
      const res = await fetch(`/api/leads/${primary.id}/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ duplicateLeadId: selected.id }),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.error || 'Merge failed'); return }
      onMerged()
      onClose()
    } catch {
      setError('Merge failed — please try again.')
    } finally {
      setMerging(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2"><GitMerge className="w-4 h-4" /> Merge Duplicate Lead</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X className="w-4 h-4" /></button>
        </div>
        <p className="text-xs text-gray-500 mb-4">
          Merging into <span className="font-medium text-gray-700">{primary.name || 'this lead'}</span>{primary.phone ? ` (${primary.phone})` : ''}.
          The duplicate is never deleted — its activity, social interactions, reviews, and proposals are reassigned here, and any missing name/phone/email/notes are filled in.
        </p>

        <form onSubmit={handleSearch} className="flex gap-2 mb-3">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search the duplicate by name, phone, or email…"
            className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/10"
          />
          <button type="submit" disabled={searching} className="px-3 py-2 rounded-lg text-sm font-medium bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-50">
            {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Search'}
          </button>
        </form>

        {results.length > 0 && (
          <ul className="max-h-56 overflow-y-auto divide-y divide-gray-50 border border-gray-100 rounded-lg mb-4">
            {results.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => setSelected(r)}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${selected?.id === r.id ? 'bg-blue-50' : ''}`}
                >
                  <span className="font-medium text-gray-800">{r.name || 'Unnamed lead'}</span>
                  <span className="text-xs text-gray-400 ml-2">{r.phone || r.email || '—'}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {error && <p className="text-xs text-red-600 mb-3">{error}</p>}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium border border-gray-200 text-gray-600 hover:bg-gray-50">Cancel</button>
          <button
            onClick={handleConfirmMerge}
            disabled={!selected || merging}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
          >
            {merging ? <Loader2 className="w-4 h-4 animate-spin inline" /> : `Merge into ${primary.name || 'this lead'}`}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function LeadManagementPage() {
  const router = useRouter()
  const [leads, setLeads] = useState<LeadWithPipeline[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [offset, setOffset] = useState(0)
  const [sortKey, setSortKey] = useState<SortKey>('created_at')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [showNewLeadModal, setShowNewLeadModal] = useState(false)
  const [mergeLeadSource, setMergeLeadSource] = useState<LeadWithPipeline | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) })
      if (search.trim()) params.set('search', search.trim())
      const res = await fetch(`/api/leads/pipeline?${params.toString()}`)
      if (!res.ok) throw new Error('Failed to load leads')
      const json = await res.json()
      setLeads(json.leads ?? [])
      setTotal(json.total ?? 0)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load leads')
    } finally {
      setLoading(false)
    }
  }, [search, offset])

  useEffect(() => { load() }, [load])

  const sortedLeads = useMemo(() => {
    const copy = [...leads]
    copy.sort((a, b) => {
      const av = String(a[sortKey] ?? '')
      const bv = String(b[sortKey] ?? '')
      const cmp = av.localeCompare(bv, undefined, { numeric: true, sensitivity: 'base' })
      return sortDir === 'asc' ? cmp : -cmp
    })
    return copy
  }, [leads, sortKey, sortDir])

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault()
    setOffset(0)
    setSearch(searchInput)
  }

  const from = total === 0 ? 0 : offset + 1
  const to = Math.min(offset + PAGE_SIZE, total)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Lead Management</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Sales pipeline view — stage is derived from actual proposals, visits and reservations.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => load()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
          <Link
            href="/dashboard/leads/import"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-gray-900 text-white hover:bg-gray-800"
          >
            <Upload className="w-3.5 h-3.5" /> Import
          </Link>
          <button
            type="button"
            onClick={() => setShowNewLeadModal(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-gray-900 text-white hover:bg-gray-800"
          >
            <Plus className="w-3.5 h-3.5" /> New Lead
          </button>
        </div>
      </div>

      {showNewLeadModal && (
        <NewLeadModal
          onClose={() => setShowNewLeadModal(false)}
          onCreated={(leadId) => {
            setShowNewLeadModal(false)
            router.push(leadWorkspaceHref(leadId))
          }}
        />
      )}

      {mergeLeadSource && (
        <MergeLeadModal
          primary={mergeLeadSource}
          onClose={() => setMergeLeadSource(null)}
          onMerged={load}
        />
      )}

      <form onSubmit={handleSearchSubmit} className="flex gap-2">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search by name, phone, email…"
            className="w-full border border-gray-200 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/10"
          />
        </div>
        <button
          type="submit"
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-gray-900 text-white hover:bg-gray-800"
        >
          Search
        </button>
      </form>

      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
          <AlertTriangle className="w-4 h-4" /> {error}
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-400 uppercase tracking-wide border-b border-gray-100">
              {COLUMNS.map(({ key, label }) => (
                <th key={key} className="px-4 py-3 font-medium whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => toggleSort(key)}
                    className="inline-flex items-center gap-1 hover:text-gray-700"
                  >
                    {label}
                    {sortKey === key
                      ? (sortDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)
                      : <ArrowUpDown className="w-3 h-3 opacity-30" />}
                  </button>
                </th>
              ))}
              <th className="px-4 py-3 font-medium whitespace-nowrap">Business Stage</th>
              <th className="px-4 py-3 font-medium whitespace-nowrap">Proposal</th>
              <th className="px-4 py-3 font-medium whitespace-nowrap">Visit</th>
              <th className="px-4 py-3 font-medium whitespace-nowrap">Reservation</th>
              <th className="px-4 py-3 font-medium whitespace-nowrap">Est. Revenue</th>
              <th className="px-4 py-3 font-medium whitespace-nowrap">Pipeline Value</th>
              <th className="px-4 py-3 font-medium whitespace-nowrap">Last Activity</th>
              <th className="px-4 py-3 font-medium whitespace-nowrap">Quick Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={COLUMNS.length + 8} className="px-4 py-12 text-center text-gray-400">
                  <RefreshCw className="w-5 h-5 animate-spin inline mr-2" /> Loading leads…
                </td>
              </tr>
            ) : sortedLeads.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS.length + 8} className="px-4 py-12 text-center text-gray-400">
                  No leads found{search ? ` for "${search}"` : ''}.
                </td>
              </tr>
            ) : (
              sortedLeads.map((lead) => (
                <tr
                  key={lead.id}
                  onClick={() => router.push(`/dashboard/leads/${lead.id}`)}
                  className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer align-top"
                >
                  <td className="px-4 py-3 font-medium text-gray-800">{lead.name || 'Unnamed lead'}</td>
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                    {lead.phone && <span className="inline-flex items-center gap-1"><Phone className="w-3 h-3 text-gray-300" /> {lead.phone}</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {lead.email && <span className="inline-flex items-center gap-1"><Mail className="w-3 h-3 text-gray-300" /> {lead.email}</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{lead.source || '—'}</td>
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{fmtDate(lead.created_at)}</td>
                  <td className="px-4 py-3"><BusinessStageBadge lead={lead} /></td>
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                    {lead.primaryProposal ? (
                      <div>
                        <div className="font-medium text-gray-800">{lead.primaryProposal.proposal_number || '—'}</div>
                        <div className="text-xs text-gray-400">{PROPOSAL_STATUS_LABEL[lead.primaryProposal.status] ?? lead.primaryProposal.status}</div>
                        {lead.proposalCount > 1 && (
                          <div className="text-xs text-gray-400">+{lead.proposalCount - 1} more</div>
                        )}
                      </div>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                    {lead.hasScheduledVisit || lead.hasCompletedVisit ? (
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          lead.hasCompletedVisit && !lead.hasScheduledVisit
                            ? 'bg-teal-50 text-teal-700'
                            : 'bg-amber-50 text-amber-700'
                        }`}
                      >
                        {visitStatusLabel(lead.latestVisitStatus) ?? 'Scheduled'}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                    {lead.hasAnyReservation ? (
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          lead.hasActiveReservation
                            ? 'bg-emerald-50 text-emerald-700'
                            : lead.hasCancelledReservation
                            ? 'bg-red-50 text-red-700'
                            : 'bg-gray-100 text-gray-500'
                        }`}
                      >
                        {reservationStatusLabel(lead.reservationStatus)}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                    {lead.estimated_revenue != null ? fmtINR(lead.estimated_revenue) : '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                    {lead.pipelineValue ? fmtINR(lead.pipelineValue) : '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{fmtDate(lead.lastActivityAt)}</td>
                  <td className="px-4 py-3"><QuickActionsCell lead={lead} onRefresh={load} router={router} onMergeClick={setMergeLeadSource} /></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-gray-500">
        <div>{total > 0 ? `Showing ${from}–${to} of ${total}` : 'No leads'}</div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
            disabled={offset === 0 || loading}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50"
          >
            <ChevronLeft className="w-3.5 h-3.5" /> Prev
          </button>
          <button
            type="button"
            onClick={() => setOffset((o) => o + PAGE_SIZE)}
            disabled={offset + PAGE_SIZE >= total || loading}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50"
          >
            Next <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}
