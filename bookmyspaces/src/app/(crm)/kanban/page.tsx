'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  RefreshCw, Phone, Calendar, Users, Star,
  Brain, FileText, Sparkles, Clock, AlarmClock,
} from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { LEAD_STAGES, VALID_TRANSITIONS, type LeadStage } from '@/modules/leads/types'

// ─── Pipeline config ──────────────────────────────────────────────────────────
// ISS-KANBAN-001: previously kept its own 6-column pipeline keyed off the legacy
// `status` column (new_inquiry/followup_pending/proposal_sent/negotiation/
// confirmed/future_prospect), written via PATCH /api/leads. The Dashboard
// (HotLeadDashboard.tsx) tracks the SAME pipeline via a separate `lead_stage`
// column (NEW/CONTACTED/.../LOST), written via the validated PATCH
// /api/leads/[id]/stage → transitionStage() path. The two never synced: dragging
// a card here didn't move it on the Dashboard and vice versa. Standardized on
// lead_stage (the richer, transition-validated model) as the single source of
// truth; this board now reads/writes it exclusively.

const STAGE_PIPELINE: Array<{ stage: LeadStage; label: string; color: string; bg: string }> = [
  { stage: 'NEW',             label: 'New Inquiry',    color: '#2563eb', bg: '#eff6ff' },
  { stage: 'CONTACTED',       label: 'Contacted',      color: '#0891b2', bg: '#ecfeff' },
  { stage: 'QUALIFIED',       label: 'Qualified',      color: '#4f46e5', bg: '#eef2ff' },
  { stage: 'NEGOTIATING',     label: 'Negotiation',    color: '#ea580c', bg: '#fff7ed' },
  { stage: 'PROPOSAL_SENT',   label: 'Proposal Sent',  color: '#7c3aed', bg: '#f5f3ff' },
  { stage: 'VISIT_SCHEDULED', label: 'Visit Scheduled',color: '#d97706', bg: '#fffbeb' },
  { stage: 'CONFIRMED',       label: 'Confirmed ✓',    color: '#16a34a', bg: '#f0fdf4' },
  { stage: 'LOST',            label: 'Lost',           color: '#4b5563', bg: '#f9fafb' },
]

// Bootstrap mapping for leads not yet migrated to lead_stage (mirrors the
// server-side fallback in lead-stage-manager.ts autoAdvanceStage) — used only
// to decide which column to *display* an unmigrated lead in, never written
// back implicitly. The lead is only actually written to lead_stage once the
// user explicitly drags/moves it.
const STATUS_TO_STAGE: Record<string, LeadStage> = {
  new_inquiry     : 'NEW',
  new             : 'NEW',
  followup_pending: 'CONTACTED',
  proposal_sent   : 'PROPOSAL_SENT',
  negotiation     : 'NEGOTIATING',
  confirmed       : 'CONFIRMED',
  rejected        : 'LOST',
  future_prospect : 'NEW',
}

function effectiveStage(lead: any): LeadStage {
  if (lead.lead_stage && (LEAD_STAGES as readonly string[]).includes(lead.lead_stage)) {
    return lead.lead_stage as LeadStage
  }
  return STATUS_TO_STAGE[lead.status] ?? 'NEW'
}

// ─── Timezone helper ──────────────────────────────────────────────────────────
// Converts a UTC ISO string to the YYYY-MM-DDTHH:mm format required by
// datetime-local inputs, expressed in the browser's local timezone.
// "2026-06-03T12:00:00.000Z" → "2026-06-03T17:30" for IST (UTC+5:30)
function toLocalDatetimeInput(utcIso: string): string {
  const d      = new Date(utcIso)
  const offset = d.getTimezoneOffset() * 60000       // minutes → ms
  const local  = new Date(d.getTime() - offset)
  return local.toISOString().slice(0, 16)            // "YYYY-MM-DDTHH:mm"
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function KanbanPage() {
  const [leads,               setLeads]               = useState<any[]>([])
  const [isLoading,           setIsLoading]           = useState(true)
  const [draggedId,           setDraggedId]           = useState<string | null>(null)
  const [selectedLead,        setSelectedLead]        = useState<any | null>(null)
  const [leadContext,         setLeadContext]         = useState<{ activities: any[]; proposals: any[]; summary: any } | null>(null)
  const [isLoadingContext,    setIsLoadingContext]    = useState(false)
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false)
  const [isScoringAll,        setIsScoringAll]        = useState(false)
  const [scoreResult,         setScoreResult]         = useState<string | null>(null)
  const [stageError,          setStageError]          = useState<string | null>(null)

  // ── Data fetching ────────────────────────────────────────────────────────

  const fetchLeads = useCallback(async () => {
    setIsLoading(true)
    try {
      const res  = await fetch('/api/leads?limit=200')
      const data = await res.json()
      const normalized = (data.leads || []).map((l: any) =>
        l.status === 'new' ? { ...l, status: 'new_inquiry' } : l
      )
      setLeads(normalized)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => { fetchLeads() }, [fetchLeads])

  // ── Actions ──────────────────────────────────────────────────────────────

  const updateStage = async (id: string, stage: LeadStage) => {
    const prevLeads = leads
    setLeads(prev => prev.map(l => l.id === id ? { ...l, lead_stage: stage } : l))
    try {
      const res = await fetch(`/api/leads/${id}/stage`, {
        method : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({ stage, reason: 'kanban drag-and-drop' }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({} as any))
        setLeads(prevLeads) // revert optimistic move — transition was rejected
        setStageError(data.error || `Could not move lead to ${stage}`)
      }
    } catch {
      setLeads(prevLeads)
      setStageError('Network error while updating stage')
    }
  }

  const scoreAllLeads = async () => {
    setIsScoringAll(true)
    setScoreResult(null)
    try {
      const res  = await fetch('/api/analytics', {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({ action: 'score_leads' }),
      })
      const data = await res.json()
      setScoreResult(`✅ AI scored ${data.scored} leads`)
      fetchLeads()
    } catch {
      setScoreResult('❌ Scoring failed')
    } finally {
      setIsScoringAll(false)
    }
  }

  // ── Drag & drop ──────────────────────────────────────────────────────────

  const leadsByStage = (stage: LeadStage) =>
    leads
      .filter(l => effectiveStage(l) === stage)
      .sort((a, b) => (b.ai_score || b.lead_score || 5) - (a.ai_score || a.lead_score || 5))

  const handleDragOver  = (e: React.DragEvent) => e.preventDefault()
  const handleDrop      = (stage: LeadStage) => {
    if (draggedId) updateStage(draggedId, stage)
    setDraggedId(null)
  }

  // ── Proposal link builder ────────────────────────────────────────────────

  function proposalHref(lead: any): string {
    const p = new URLSearchParams({
      lead_id: lead.id,
      name   : lead.name     || '',
      phone  : lead.phone    || '',
      event  : lead.event_type || '',
      guests : String(lead.guest_count || ''),
      date   : lead.event_date || '',
    })
    return `/proposals/new?${p.toString()}`
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen" style={{ background: 'var(--cream)', fontFamily: 'var(--font-body)' }}>

      {/* ── Navigation ── */}
      <nav
        className="sticky top-0 z-40 px-6 py-4 flex items-center justify-between"
        style={{ background: 'rgba(248,245,240,0.95)', backdropFilter: 'blur(12px)', borderBottom: '1px solid var(--border)' }}
      >
        <div className="flex items-center gap-4">
          <div className="text-xl font-light" style={{ fontFamily: 'var(--font-display)', color: 'var(--charcoal)' }}>
            BookMySpaces <span className="text-sm" style={{ color: 'var(--gold)' }}>Kanban</span>
          </div>
          <span className="text-sm" style={{ color: 'var(--muted)' }}>
            {leads.length} leads · Drag to move stages
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={scoreAllLeads}
            disabled={isScoringAll}
            className="flex items-center gap-2 text-sm px-3 py-2 rounded-lg disabled:opacity-50"
            style={{ border: '1px solid var(--border)', background: 'white', color: 'var(--slate)' }}
          >
            {isScoringAll ? <RefreshCw size={13} className="animate-spin" /> : <Brain size={13} />}
            AI Score All
          </button>

          <button
            onClick={fetchLeads}
            className="p-2 rounded-lg hover:bg-white"
            aria-label="Refresh leads"
          >
            <RefreshCw size={15} style={{ color: 'var(--slate)' }} className={isLoading ? 'animate-spin' : ''} />
          </button>

          <a
            href="/proposals/new"
            className="text-sm px-4 py-2 rounded-lg text-white"
            style={{ background: 'var(--charcoal)' }}
          >
            + New Proposal
          </a>

          <a
            href="/dashboard"
            className="text-sm px-3 py-2 rounded-lg"
            style={{ border: '1px solid var(--border)', background: 'white', color: 'var(--slate)' }}
          >
            ← List View
          </a>
        </div>
      </nav>

      {/* ── Score result toast ── */}
      {scoreResult && (
        <div
          className="mx-6 mt-4 px-4 py-2 rounded-lg text-sm"
          style={{ background: '#f0fdf4', color: '#16a34a', border: '1px solid #86efac' }}
        >
          {scoreResult}
        </div>
      )}

      {/* ── Stage error toast ── */}
      {stageError && (
        <div
          className="mx-6 mt-4 px-4 py-2 rounded-lg text-sm flex items-center justify-between gap-3"
          style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fca5a5' }}
        >
          <span>⚠️ {stageError}</span>
          <button onClick={() => setStageError(null)} className="text-xs underline flex-shrink-0">Dismiss</button>
        </div>
      )}

      {/* ── Kanban board ── */}
      <div className="p-6 overflow-x-auto">
        <div className="flex gap-4 min-w-max">
          {STAGE_PIPELINE.map(col => {
            const colLeads = leadsByStage(col.stage)
            return (
              <div
                key={col.stage}
                className="w-72 flex-shrink-0 rounded-2xl overflow-hidden"
                style={{ background: 'white', border: '1px solid var(--border)' }}
                onDragOver={handleDragOver}
                onDrop={() => handleDrop(col.stage)}
              >
                {/* Column header */}
                <div
                  className="px-4 py-3 flex items-center justify-between"
                  style={{ background: col.bg, borderBottom: `2px solid ${col.color}20` }}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm" style={{ color: col.color }}>{col.label}</span>
                    <span
                      className="text-xs px-2 py-0.5 rounded-full font-semibold"
                      style={{ background: col.color, color: 'white' }}
                    >
                      {colLeads.length}
                    </span>
                  </div>
                </div>

                {/* Cards */}
                <div className="p-3 space-y-2 min-h-[200px] max-h-[calc(100vh-200px)] overflow-y-auto">
                  {colLeads.length === 0 && (
                    <div className="text-center py-8 text-xs" style={{ color: 'var(--muted)' }}>
                      Drop leads here
                    </div>
                  )}
                  {colLeads.map(lead => (
                    <LeadCard
                      key={lead.id}
                      lead={lead}
                      accentColor={col.color}
                      onDragStart={() => setDraggedId(lead.id)}
                      onClick={() => setSelectedLead(lead)}
                    />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Detail panel ── */}
      {selectedLead && (
        <>
          <div className="fixed inset-0 bg-black/20 z-40" onClick={() => setSelectedLead(null)} />
          <div
            className="fixed inset-y-0 right-0 w-96 z-50 overflow-y-auto shadow-2xl"
            style={{ background: 'white', borderLeft: '1px solid var(--border)' }}
          >
            <div className="p-6">

              {/* Header */}
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-light" style={{ fontFamily: 'var(--font-display)' }}>
                  {selectedLead.name || 'Unknown Guest'}
                </h2>
                <button onClick={() => setSelectedLead(null)} className="text-gray-400 hover:text-gray-600" aria-label="Close lead details">✕</button>
              </div>

              {/* AI Score */}
              {(selectedLead.ai_score || selectedLead.lead_score) && (
                <div
                  className="mb-4 p-4 rounded-xl"
                  style={{ background: 'rgba(201,168,76,0.08)', border: '1px solid rgba(201,168,76,0.2)' }}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs uppercase tracking-wider" style={{ color: 'var(--gold)' }}>AI Score</span>
                    <div className="flex gap-0.5">
                      {Array.from({ length: 10 }).map((_, i) => (
                        <div
                          key={i}
                          className="w-3 h-3 rounded-sm"
                          style={{ background: i < (selectedLead.ai_score || selectedLead.lead_score || 5) ? '#c9a84c' : '#e8e4de' }}
                        />
                      ))}
                    </div>
                  </div>
                  <div className="text-2xl font-light" style={{ fontFamily: 'var(--font-display)', color: 'var(--charcoal)' }}>
                    {selectedLead.ai_score || selectedLead.lead_score}/10
                  </div>
                  {selectedLead.ai_score_reason && (
                    <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>{selectedLead.ai_score_reason}</p>
                  )}
                </div>
              )}

              {/* Lead details */}
              <div className="space-y-3 text-sm">
                {selectedLead.phone && (
                  <div className="flex items-center justify-between">
                    <span style={{ color: 'var(--muted)' }}>Phone</span>
                    <a
                      href={`https://wa.me/91${selectedLead.phone}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 font-medium"
                      style={{ color: '#25D366' }}
                    >
                      <Phone size={12} /> {selectedLead.phone}
                    </a>
                  </div>
                )}
                {selectedLead.event_type && (
                  <div className="flex items-center justify-between">
                    <span style={{ color: 'var(--muted)' }}>Event</span>
                    <span style={{ color: 'var(--charcoal)' }}>{selectedLead.event_type}</span>
                  </div>
                )}
                {selectedLead.event_date && (
                  <div className="flex items-center justify-between">
                    <span style={{ color: 'var(--muted)' }}>Date</span>
                    <span style={{ color: 'var(--charcoal)' }}>
                      {format(parseISO(selectedLead.event_date), 'dd MMM yyyy')}
                    </span>
                  </div>
                )}
                {selectedLead.guest_count && (
                  <div className="flex items-center justify-between">
                    <span style={{ color: 'var(--muted)' }}>Guests</span>
                    <span style={{ color: 'var(--charcoal)' }}>{selectedLead.guest_count} pax</span>
                  </div>
                )}
                {selectedLead.budget && (
                  <div className="flex items-center justify-between">
                    <span style={{ color: 'var(--muted)' }}>Budget</span>
                    <span style={{ color: 'var(--charcoal)' }}>{selectedLead.budget}</span>
                  </div>
                )}
              </div>

              {/* Action buttons */}
              <div className="mt-6 space-y-2">
                {selectedLead.phone && (
                  <a
                    href={`https://wa.me/91${selectedLead.phone}?text=Hi ${selectedLead.name || 'there'}! Following up on your event inquiry 😊`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block w-full text-center py-2.5 rounded-lg text-white text-sm font-medium"
                    style={{ background: '#25D366' }}
                  >
                    WhatsApp Follow-up
                  </a>
                )}

                <a
                  href={proposalHref(selectedLead)}
                  className="block w-full text-center py-2.5 rounded-lg text-sm font-medium border"
                  style={{ borderColor: 'var(--gold)', color: 'var(--gold)', background: 'rgba(201,168,76,0.06)' }}
                >
                  Create Proposal
                </a>

                {/* Stage quick-move buttons — only shows stages the state machine
                    actually allows next (VALID_TRANSITIONS in modules/leads/types.ts),
                    so these buttons never trigger the same rejection a free drag might. */}
                <div className="flex gap-2">
                  {STAGE_PIPELINE
                    .filter(p => VALID_TRANSITIONS[effectiveStage(selectedLead)]?.includes(p.stage))
                    .slice(0, 2)
                    .map(p => (
                      <button
                        key={p.stage}
                        onClick={() => {
                          updateStage(selectedLead.id, p.stage)
                          setSelectedLead({ ...selectedLead, lead_stage: p.stage })
                        }}
                        className="flex-1 py-2 rounded-lg text-xs font-medium"
                        style={{ background: p.bg, color: p.color, border: `1px solid ${p.color}30` }}
                      >
                        → {p.label}
                      </button>
                    ))
                  }
                </div>
              </div>

              {/* ── Follow-up scheduler ── */}
              <div className="mt-4 border-t pt-4" style={{ borderColor: 'var(--border)' }}>
                <p className="text-xs font-semibold mb-2 uppercase tracking-wider" style={{ color: 'var(--slate)' }}>
                  Schedule Follow-up
                </p>
                <div className="flex gap-2">
                  <input
                    type="datetime-local"
                    id="kfup-date"
                    className="flex-1 text-xs px-2 py-1.5 rounded-lg border"
                    style={{ borderColor: 'var(--border)', color: 'var(--charcoal)' }}
                    defaultValue={
                      selectedLead.followup_date
                        ? toLocalDatetimeInput(selectedLead.followup_date)
                        : ''
                    }
                  />
                  <button
                    onClick={async () => {
                      const val = (document.getElementById('kfup-date') as HTMLInputElement)?.value
                      if (!val) return
                      const utcValue = new Date(val).toISOString()
                      await fetch('/api/followups', {
                        method : 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body   : JSON.stringify({ action: 'schedule', lead_id: selectedLead.id, followup_date: utcValue }),
                      })
                      setSelectedLead({ ...selectedLead, followup_date: utcValue })
                    }}
                    className="text-xs px-3 py-1.5 rounded-lg text-white"
                    style={{ background: 'var(--gold)' }}
                  >
                    Set
                  </button>
                </div>
                {selectedLead.followup_date && (
                  <button
                    onClick={async () => {
                      await fetch('/api/followups', {
                        method : 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body   : JSON.stringify({ action: 'complete', lead_id: selectedLead.id }),
                      })
                      setSelectedLead({ ...selectedLead, followup_date: null })
                    }}
                    className="mt-1 text-xs w-full py-1 rounded-lg"
                    style={{ border: '1px solid #86efac', color: '#16a34a', background: '#f0fdf4' }}
                  >
                    ✓ Mark Complete
                  </button>
                )}
              </div>

              {/* ── AI Intelligence Summary ── */}
              <div className="mt-4 border-t pt-4" style={{ borderColor: 'var(--border)' }}>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--slate)' }}>
                    AI Intelligence
                  </p>
                  <button
                    onClick={async () => {
                      setIsGeneratingSummary(true)
                      try {
                        const res = await fetch('/api/leads/summary', {
                          method : 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body   : JSON.stringify({ lead_id: selectedLead.id }),
                        })
                        if (res.ok) {
                          const d = await res.json()
                          setLeadContext(prev => ({ ...(prev || { activities: [], proposals: [] }), summary: d.summary }))
                        }
                      } catch {}
                      finally { setIsGeneratingSummary(false) }
                    }}
                    disabled={isGeneratingSummary}
                    className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg disabled:opacity-50"
                    style={{ background: 'rgba(201,168,76,0.1)', color: 'var(--gold-dark)', border: '1px solid rgba(201,168,76,0.3)' }}
                  >
                    {isGeneratingSummary ? <RefreshCw size={10} className="animate-spin" /> : <Sparkles size={10} />}
                    {isGeneratingSummary ? 'Analysing...' : 'Analyse'}
                  </button>
                </div>

                {leadContext?.summary && (
                  <div className="space-y-2 text-xs">
                    {leadContext.summary.summary && (
                      <p style={{ color: 'var(--slate)', lineHeight: 1.6 }}>{leadContext.summary.summary}</p>
                    )}
                    <div className="flex flex-wrap gap-1 mt-2">
                      {leadContext.summary.lead_quality && (
                        <span
                          className="px-2 py-0.5 rounded-full"
                          style={{
                            background: leadContext.summary.lead_quality === 'hot' ? '#fef2f2'
                                      : leadContext.summary.lead_quality === 'warm' ? '#fffbeb' : '#f0f9ff',
                            color     : leadContext.summary.lead_quality === 'hot' ? '#dc2626'
                                      : leadContext.summary.lead_quality === 'warm' ? '#d97706' : '#0369a1',
                          }}
                        >
                          {leadContext.summary.lead_quality === 'hot' ? '🔥'
                            : leadContext.summary.lead_quality === 'warm' ? '⚡' : '❄️'} {leadContext.summary.lead_quality}
                        </span>
                      )}
                      {leadContext.summary.urgency && (
                        <span className="px-2 py-0.5 rounded-full" style={{ background: '#f5f3ff', color: '#7c3aed' }}>
                          ⏱ {leadContext.summary.urgency} urgency
                        </span>
                      )}
                    </div>
                    {leadContext.summary.recommended_action && (
                      <p
                        className="mt-2 px-2 py-1.5 rounded-lg text-xs"
                        style={{ background: 'rgba(201,168,76,0.08)', color: 'var(--charcoal)', borderLeft: '3px solid var(--gold)' }}
                      >
                        Next: {leadContext.summary.recommended_action}
                      </p>
                    )}
                  </div>
                )}

                {!leadContext?.summary && selectedLead.inquiry_summary && (
                  <p className="text-xs" style={{ color: 'var(--muted)' }}>{selectedLead.inquiry_summary}</p>
                )}
              </div>

              {/* ── Proposals ── */}
              {(leadContext?.proposals?.length ?? 0) > 0 && (
                <div className="mt-4 border-t pt-4" style={{ borderColor: 'var(--border)' }}>
                  <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--slate)' }}>Proposals</p>
                  <div className="space-y-1">
                    {(leadContext?.proposals || []).map((p: any) => (
                      <div
                        key={p.id}
                        className="flex items-center justify-between text-xs py-1.5 px-2 rounded-lg"
                        style={{ background: '#f5f3ff' }}
                      >
                        <div>
                          <span className="font-medium" style={{ color: '#7c3aed' }}>{p.proposal_number}</span>
                          <span className="ml-1" style={{ color: 'var(--muted)' }}>{p.package_name}</span>
                        </div>
                        <span
                          className="px-1.5 py-0.5 rounded-full"
                          style={{
                            background: p.status === 'accepted' ? '#f0fdf4' : '#f5f3ff',
                            color     : p.status === 'accepted' ? '#16a34a' : '#7c3aed',
                          }}
                        >
                          {p.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Activity timeline ── */}
              {isLoadingContext && (
                <div className="mt-4 border-t pt-3 text-center text-xs" style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
                  <RefreshCw size={11} className="animate-spin inline mr-1" /> Loading...
                </div>
              )}

              {!isLoadingContext && (leadContext?.activities?.length ?? 0) > 0 && (
                <div className="mt-4 border-t pt-4" style={{ borderColor: 'var(--border)' }}>
                  <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--slate)' }}>
                    Activity Timeline
                  </p>
                  <div className="space-y-2.5 max-h-44 overflow-y-auto pr-1">
                    {(leadContext?.activities || []).map((a: any) => (
                      <div key={a.id} className="flex gap-2 text-xs">
                        <div
                          className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0"
                          style={{
                            background: a.action === 'proposal_created'     ? '#7c3aed'
                                      : a.action === 'followup_completed'   ? '#16a34a'
                                      : a.action === 'note_added'           ? '#0369a1'
                                      : a.action === 'ai_summary_generated' ? '#c9a84c'
                                      : '#d1d5db',
                          }}
                        />
                        <div>
                          <p style={{ color: 'var(--charcoal)' }}>{a.description}</p>
                          <p style={{ color: 'var(--muted)' }}>
                            {new Date(a.created_at).toLocaleString('en-IN', {
                              day: '2-digit', month: 'short',
                              hour: '2-digit', minute: '2-digit',
                              timeZone: 'Asia/Kolkata',
                            })}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Add note ── */}
              <div className="mt-4 border-t pt-4" style={{ borderColor: 'var(--border)' }}>
                <p className="text-xs font-semibold mb-2 uppercase tracking-wider" style={{ color: 'var(--slate)' }}>
                  Add Note
                </p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    id="kfup-note"
                    placeholder="Type a note..."
                    className="flex-1 text-xs px-2 py-1.5 rounded-lg border"
                    style={{ borderColor: 'var(--border)', color: 'var(--charcoal)' }}
                    onKeyDown={async (e) => {
                      if (e.key !== 'Enter') return
                      const val = (e.target as HTMLInputElement).value.trim()
                      if (!val) return
                      await fetch('/api/followups', {
                        method : 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body   : JSON.stringify({ action: 'note', lead_id: selectedLead.id, note: val }),
                      })
                      ;(e.target as HTMLInputElement).value = ''
                    }}
                  />
                  <button
                    onClick={async () => {
                      const inp = document.getElementById('kfup-note') as HTMLInputElement
                      const val = inp?.value.trim()
                      if (!val) return
                      await fetch('/api/followups', {
                        method : 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body   : JSON.stringify({ action: 'note', lead_id: selectedLead.id, note: val }),
                      })
                      inp.value = ''
                    }}
                    className="text-xs px-3 py-1.5 rounded-lg text-white"
                    style={{ background: 'var(--charcoal)' }}
                  >
                    Save
                  </button>
                </div>
              </div>

              {/* Footer */}
              <div className="mt-4 text-xs" style={{ color: 'var(--muted)' }}>
                Created {format(parseISO(selectedLead.created_at), 'dd MMM yyyy, HH:mm')} · {selectedLead.source}
              </div>

            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ─── Lead card ────────────────────────────────────────────────────────────────

function LeadCard({
  lead, accentColor, onDragStart, onClick,
}: {
  lead       : any
  accentColor: string
  onDragStart: () => void
  onClick    : () => void
}) {
  const score      = lead.ai_score || lead.lead_score || 5
  const scoreColor = score >= 8 ? '#16a34a' : score >= 5 ? '#d97706' : '#dc2626'
  const hasProposal = !!lead.proposal_sent_at

  const now     = new Date()
  const fDate   = lead.followup_date ? new Date(lead.followup_date) : null
  const isOverdue  = fDate && fDate < now
  const isDueToday = fDate && !isOverdue && fDate.toDateString() === now.toDateString()

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onClick={onClick}
      className="p-3 rounded-xl cursor-grab active:cursor-grabbing"
      style={{ background: 'var(--cream)', border: '1px solid var(--border)', borderLeft: `3px solid ${accentColor}` }}
    >
      {/* Name + score */}
      <div className="flex items-start justify-between mb-2">
        <div>
          <p className="font-medium text-sm" style={{ color: 'var(--charcoal)' }}>
            {lead.name || 'Unknown'}
          </p>
          {lead.phone && (
            <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{lead.phone}</p>
          )}
        </div>
        <div
          className="flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full"
          style={{ background: `${scoreColor}15`, color: scoreColor }}
        >
          <Star size={9} /> {score}
        </div>
      </div>

      {/* Follow-up badge */}
      {fDate && (
        <div
          className="mb-2 flex items-center gap-1 text-xs px-2 py-0.5 rounded-full w-fit"
          style={{
            background: isOverdue ? '#fef2f2' : isDueToday ? '#fffbeb' : '#f0fdf4',
            color     : isOverdue ? '#dc2626' : isDueToday ? '#d97706' : '#16a34a',
            border    : `1px solid ${isOverdue ? '#fca5a5' : isDueToday ? '#fcd34d' : '#86efac'}`,
          }}
        >
          {isOverdue ? <AlarmClock size={9} /> : <Clock size={9} />}
          {isOverdue
            ? 'Overdue'
            : isDueToday
            ? 'Due today'
            : new Date(lead.followup_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
        </div>
      )}

      {/* Proposal sent badge */}
      {hasProposal && (
        <div
          className="mb-1 inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full"
          style={{ background: '#f5f3ff', color: '#7c3aed', border: '1px solid #ddd6fe' }}
        >
          <FileText size={8} /> Proposal sent
        </div>
      )}

      {/* Event details */}
      <div className="space-y-1">
        {lead.event_type && (
          <p className="text-xs" style={{ color: 'var(--slate)' }}>🎉 {lead.event_type}</p>
        )}
        <div className="flex items-center gap-3">
          {lead.event_date && (
            <span className="text-xs flex items-center gap-1" style={{ color: 'var(--muted)' }}>
              <Calendar size={10} /> {format(parseISO(lead.event_date), 'dd MMM')}
            </span>
          )}
          {lead.guest_count && (
            <span className="text-xs flex items-center gap-1" style={{ color: 'var(--muted)' }}>
              <Users size={10} /> {lead.guest_count}
            </span>
          )}
        </div>
        {lead.budget && (
          <p className="text-xs font-medium" style={{ color: 'var(--gold-dark)' }}>
            Budget: {lead.budget}
          </p>
        )}
      </div>

      {/* Footer */}
      <div className="mt-2 flex items-center justify-between">
        <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: '#f3f4f6', color: '#6b7280' }}>
          {lead.source}
        </span>
        <span className="text-xs" style={{ color: 'var(--muted)' }}>
          {format(parseISO(lead.created_at), 'dd MMM')}
        </span>
      </div>
    </div>
  )
}
