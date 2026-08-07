'use client'

// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/app/(crm)/dashboard/followups/page.tsx
// Phase 3 (Revenue Automation) — AI Follow-up Assistant dashboard. Renders
// GET /api/followups exactly as returned (same "route computes, page
// renders" split as every other dashboard in this codebase) — no scoring
// of its own. Three sections, all backed by existing data:
//   - Overdue: leads whose followup_date has already passed (existing
//     `overdue` field, previously computed but never surfaced in a
//     dedicated dashboard, only inline on the Leads page).
//   - AI-Drafted Follow-ups: rows /api/cron/ai-followup-assistant already
//     writes to follow_ups (AI-recommended action + suggested WhatsApp
//     content), now surfaced for the human-approval step the platform's
//     "human retains final control over customer-facing messages" rule
//     requires — Approve & Send / Dismiss call the new send_now/dismiss
//     actions on /api/followups.
//   - Pending Nurture: leads not contacted in 24h+ (existing `leads` field).
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { RefreshCw, Clock, Sparkles, Check, X, Phone } from 'lucide-react'

interface OverdueLead {
  id: string
  name: string | null
  phone: string | null
  event_type: string | null
  status: string | null
  followup_date: string | null
  last_contacted_at: string | null
}

interface AIDraftedFollowUp {
  id: string
  leadId: string | null
  leadName: string | null
  leadPhone: string | null
  leadStatus: string | null
  message: string | null
  scheduledAt: string | null
  createdAt: string
}

interface FollowUpsResponse {
  leads: OverdueLead[]
  overdue: OverdueLead[]
  aiDrafted: AIDraftedFollowUp[]
  counts: { pending: number; overdue: number; aiDrafted: number }
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export default function FollowUpsDashboardPage() {
  const [data, setData] = useState<FollowUpsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/followups')
      const json = await res.json()
      setData(json)
    } catch {
      toast.error('Failed to load follow-ups')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function approveAndSend(followUpId: string) {
    setBusyId(followUpId)
    try {
      const res = await fetch('/api/followups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'send_now', follow_up_id: followUpId }),
      })
      const json = await res.json()
      if (!res.ok || !json.success) { toast.error(json.error || 'Failed to send'); return }
      toast.success('Follow-up sent.')
      await load()
    } finally {
      setBusyId(null)
    }
  }

  async function dismiss(followUpId: string) {
    setBusyId(followUpId)
    try {
      const res = await fetch('/api/followups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'dismiss', follow_up_id: followUpId }),
      })
      const json = await res.json()
      if (!res.ok) { toast.error(json.error || 'Failed to dismiss'); return }
      toast.success('Dismissed.')
      await load()
    } finally {
      setBusyId(null)
    }
  }

  async function markComplete(leadId: string) {
    setBusyId(leadId)
    try {
      const res = await fetch('/api/followups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'complete', lead_id: leadId }),
      })
      if (!res.ok) { toast.error('Failed to mark complete'); return }
      toast.success('Marked complete.')
      await load()
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
              <Clock className="w-5 h-5" /> Follow-ups
            </h1>
            <p className="text-sm text-gray-500">Overdue follow-ups, AI-drafted outreach awaiting approval, and leads due for nurture — one place, reviewed daily.</p>
          </div>
          <button onClick={load} aria-label="Refresh" className="text-gray-400 hover:text-gray-700"><RefreshCw className="w-4 h-4" /></button>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-6 space-y-6">
        {loading ? (
          <div className="p-8 text-center text-sm text-gray-500">Loading…</div>
        ) : !data ? (
          <div className="p-8 text-center text-sm text-red-500">Failed to load.</div>
        ) : (
          <>
            {/* AI-Drafted Follow-ups */}
            <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-indigo-500" />
                <h2 className="text-sm font-semibold text-gray-800">AI-Drafted Follow-ups</h2>
                <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700">{data.counts.aiDrafted}</span>
              </div>
              {data.aiDrafted.length === 0 ? (
                <div className="p-6 text-center text-sm text-gray-400">No AI-drafted follow-ups waiting for review.</div>
              ) : (
                <ul className="divide-y divide-gray-50">
                  {data.aiDrafted.map((f) => (
                    <li key={f.id} className="px-5 py-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium text-gray-800">{f.leadName ?? 'Unknown lead'}</span>
                            {f.leadStatus && <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{f.leadStatus}</span>}
                            <span className="text-xs text-gray-400">scheduled {fmtDate(f.scheduledAt)}</span>
                          </div>
                          <p className="text-sm text-gray-600 mt-1.5 bg-indigo-50/50 border border-indigo-100 rounded-lg p-2 whitespace-pre-wrap">{f.message}</p>
                        </div>
                        <div className="shrink-0 flex flex-col gap-1.5">
                          <button
                            onClick={() => approveAndSend(f.id)}
                            disabled={busyId === f.id}
                            className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                          >
                            <Check className="w-3.5 h-3.5" /> Approve &amp; Send
                          </button>
                          <button
                            onClick={() => dismiss(f.id)}
                            disabled={busyId === f.id}
                            className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                          >
                            <X className="w-3.5 h-3.5" /> Dismiss
                          </button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Overdue */}
            <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2">
                <Clock className="w-4 h-4 text-red-500" />
                <h2 className="text-sm font-semibold text-gray-800">Overdue Follow-ups</h2>
                <span className="text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-700">{data.counts.overdue}</span>
              </div>
              {data.overdue.length === 0 ? (
                <div className="p-6 text-center text-sm text-gray-400">Nothing overdue.</div>
              ) : (
                <ul className="divide-y divide-gray-50">
                  {data.overdue.map((l) => (
                    <li key={l.id} className="px-5 py-3 flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium text-gray-800">{l.name ?? 'Unknown lead'}</span>
                          {l.event_type && <span className="text-xs text-gray-400">{l.event_type}</span>}
                        </div>
                        <p className="text-xs text-red-600 mt-0.5">Due {fmtDate(l.followup_date)}</p>
                      </div>
                      <div className="shrink-0 flex items-center gap-2">
                        {l.phone && (
                          <a href={`tel:${l.phone}`} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-gray-200 text-gray-600 hover:bg-gray-50">
                            <Phone className="w-3.5 h-3.5" /> {l.phone}
                          </a>
                        )}
                        <button
                          onClick={() => markComplete(l.id)}
                          disabled={busyId === l.id}
                          className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                        >
                          <Check className="w-3.5 h-3.5" /> Mark done
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Pending nurture */}
            <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2">
                <Clock className="w-4 h-4 text-amber-500" />
                <h2 className="text-sm font-semibold text-gray-800">Pending Nurture (24h+ uncontacted)</h2>
                <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">{data.counts.pending}</span>
              </div>
              {data.leads.length === 0 ? (
                <div className="p-6 text-center text-sm text-gray-400">Nothing pending.</div>
              ) : (
                <ul className="divide-y divide-gray-50">
                  {data.leads.slice(0, 25).map((l) => (
                    <li key={l.id} className="px-5 py-3 flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <span className="text-sm font-medium text-gray-800">{l.name ?? 'Unknown lead'}</span>
                        {l.event_type && <span className="text-xs text-gray-400 ml-2">{l.event_type}</span>}
                      </div>
                      <span className="text-xs text-gray-400">last contact {fmtDate(l.last_contacted_at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  )
}
