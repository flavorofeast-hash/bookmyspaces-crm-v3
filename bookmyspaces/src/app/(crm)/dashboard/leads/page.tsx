'use client'

// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/app/(crm)/dashboard/leads/page.tsx
// Lead Management — the missing destination for the Import page's
// "View All Leads" button (previously 404'd because this file didn't exist).
//
// Reuses, unchanged: GET /api/leads (search/limit/offset, already returns
// every column via select('*'), including all Migration 018 fields), the
// shared Lead type + stage-badge mapping (src/modules/leads/types.ts), and
// the same light-theme card/table styling already used throughout the CRM
// (Customers, Customer Profile, Kanban). Column sorting is client-side, over
// the currently loaded page of results — no changes to the existing
// GET /api/leads route were needed or made.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Search, RefreshCw, Upload, AlertTriangle, ChevronLeft, ChevronRight,
  ArrowUpDown, ArrowUp, ArrowDown, Phone, Mail,
} from 'lucide-react'
import { type Lead, STAGE_PIPELINE, effectiveStage } from '@/modules/leads/types'

type SortKey = 'name' | 'phone' | 'email' | 'company' | 'city' | 'state' | 'source' | 'preferred_channel' | 'created_at'

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'phone', label: 'Phone' },
  { key: 'email', label: 'Email' },
  { key: 'company', label: 'Company' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State' },
  { key: 'source', label: 'Source' },
  { key: 'preferred_channel', label: 'Preferred Channel' },
  { key: 'created_at', label: 'Created Date' },
]

const PAGE_SIZE = 25

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
  } catch {
    return iso
  }
}

function StageBadge({ lead }: { lead: Pick<Lead, 'lead_stage' | 'status'> }) {
  const stage = effectiveStage(lead)
  const meta = STAGE_PIPELINE.find((s) => s.stage === stage)
  return (
    <span
      className="px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap"
      style={{ color: meta?.color, backgroundColor: meta?.bg }}
    >
      {meta?.label ?? stage}
    </span>
  )
}

export default function LeadManagementPage() {
  const router = useRouter()
  const [leads, setLeads] = useState<Lead[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [offset, setOffset] = useState(0)
  const [sortKey, setSortKey] = useState<SortKey>('created_at')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) })
      if (search.trim()) params.set('search', search.trim())
      const res = await fetch(`/api/leads?${params.toString()}`)
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
          <p className="text-sm text-gray-500 mt-0.5">All leads and customers, including bulk-imported records.</p>
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
        </div>
      </div>

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
              <th className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={COLUMNS.length + 1} className="px-4 py-12 text-center text-gray-400">
                  <RefreshCw className="w-5 h-5 animate-spin inline mr-2" /> Loading leads…
                </td>
              </tr>
            ) : sortedLeads.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS.length + 1} className="px-4 py-12 text-center text-gray-400">
                  No leads found{search ? ` for "${search}"` : ''}.
                </td>
              </tr>
            ) : (
              sortedLeads.map((lead) => (
                <tr
                  key={lead.id}
                  onClick={() => router.push(`/dashboard/leads/${lead.id}`)}
                  className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer"
                >
                  <td className="px-4 py-3 font-medium text-gray-800">{lead.name || 'Unnamed lead'}</td>
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                    {lead.phone && <span className="inline-flex items-center gap-1"><Phone className="w-3 h-3 text-gray-300" /> {lead.phone}</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {lead.email && <span className="inline-flex items-center gap-1"><Mail className="w-3 h-3 text-gray-300" /> {lead.email}</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{lead.company || '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{lead.city || '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{lead.state || '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{lead.source || '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{lead.preferred_channel || '—'}</td>
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{fmtDate(lead.created_at)}</td>
                  <td className="px-4 py-3"><StageBadge lead={lead} /></td>
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
