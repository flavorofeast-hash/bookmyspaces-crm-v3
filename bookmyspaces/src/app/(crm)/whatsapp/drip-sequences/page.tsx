'use client'

// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/app/(crm)/whatsapp/drip-sequences/page.tsx
// Phase 2 (Social + WhatsApp Growth) — Drip Sequences UI. Talks to
// /api/whatsapp/drip-sequences (list/create) and its /enroll sub-route
// (enroll/cancel). Enrollment is by lead ID (no lead search/picker here —
// operators copy the ID from the lead's detail page URL) to keep this page
// scoped; a proper picker is a natural follow-up, not required to make the
// feature genuinely usable today.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { GitBranch, Plus, X, Save, Loader2, Trash2, UserPlus } from 'lucide-react'

interface DripStep {
  id: string
  step_order: number
  delay_days: number
  channel: 'whatsapp' | 'email'
  message_template: string
}

interface DripSequence {
  id: string
  name: string
  description: string | null
  trigger_event: string
  is_active: boolean
  steps: DripStep[]
}

const TRIGGER_EVENTS = [
  { value: 'manual', label: 'Manual enrollment only' },
  { value: 'new_lead', label: 'New lead' },
  { value: 'proposal_sent', label: 'Proposal sent' },
  { value: 'post_stay', label: 'Post-stay' },
  { value: 'dormant', label: 'Dormant / win-back' },
]

export default function DripSequencesPage() {
  const [sequences, setSequences] = useState<DripSequence[]>([])
  const [loading, setLoading] = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [triggerEvent, setTriggerEvent] = useState('manual')
  const [steps, setSteps] = useState<{ delay_days: number; channel: 'whatsapp' | 'email'; message_template: string }[]>([
    { delay_days: 0, channel: 'whatsapp', message_template: '' },
  ])

  const [enrollSequenceId, setEnrollSequenceId] = useState<string | null>(null)
  const [enrollLeadId, setEnrollLeadId] = useState('')
  const [enrolling, setEnrolling] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/whatsapp/drip-sequences')
      const data = await res.json()
      setSequences(Array.isArray(data.sequences) ? data.sequences : [])
    } catch {
      setSequences([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  function resetForm() {
    setName(''); setDescription(''); setTriggerEvent('manual')
    setSteps([{ delay_days: 0, channel: 'whatsapp', message_template: '' }])
  }

  function updateStep(i: number, patch: Partial<(typeof steps)[number]>) {
    setSteps((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const res = await fetch('/api/whatsapp/drip-sequences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), description: description.trim() || undefined, trigger_event: triggerEvent, steps }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error || 'Failed to save sequence'); return }
      toast.success('Sequence created.')
      resetForm()
      setFormOpen(false)
      await load()
    } finally {
      setSaving(false)
    }
  }

  async function handleEnroll(sequenceId: string) {
    if (!enrollLeadId.trim()) return
    setEnrolling(true)
    try {
      const res = await fetch('/api/whatsapp/drip-sequences/enroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sequenceId, leadId: enrollLeadId.trim() }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error || 'Failed to enroll lead'); return }
      toast.success('Lead enrolled — first step scheduled.')
      setEnrollLeadId('')
      setEnrollSequenceId(null)
    } finally {
      setEnrolling(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
              <GitBranch className="w-5 h-5" /> Drip Sequences
            </h1>
            <p className="text-sm text-gray-500">Multi-step, delay-based WhatsApp follow-up sequences. Drained daily by the drip-sequences cron.</p>
          </div>
          <button
            onClick={() => setFormOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
          >
            <Plus className="w-4 h-4" /> New Sequence
          </button>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-6">
        {formOpen && (
          <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-blue-200 p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-gray-900">New Sequence</h2>
              <button type="button" onClick={() => setFormOpen(false)} aria-label="Close" className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name<span className="text-red-500 ml-0.5">*</span></label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  placeholder="e.g. New Lead Nurture"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Trigger</label>
                <select
                  value={triggerEvent}
                  onChange={(e) => setTriggerEvent(e.target.value)}
                  aria-label="Trigger event"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {TRIGGER_EVENTS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
                <p className="text-xs text-gray-400 mt-1">Every trigger is enrolled by hand today via the Enroll button — automatic enrollment on the event is a future step.</p>
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="mb-2 flex items-center justify-between">
              <label className="block text-sm font-medium text-gray-700">Steps</label>
              <button
                type="button"
                onClick={() => setSteps((p) => [...p, { delay_days: 1, channel: 'whatsapp', message_template: '' }])}
                className="text-xs text-blue-600 hover:text-blue-800 font-medium"
              >
                + Add step
              </button>
            </div>
            <div className="space-y-3 mb-4">
              {steps.map((s, i) => (
                <div key={i} className="rounded-lg border border-gray-200 p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-semibold text-gray-500">Step {i + 1}</span>
                    <input
                      type="number"
                      min={0}
                      value={s.delay_days}
                      onChange={(e) => updateStep(i, { delay_days: parseInt(e.target.value, 10) || 0 })}
                      aria-label={`Step ${i + 1} delay in days`}
                      className="w-20 px-2 py-1 border border-gray-200 rounded text-xs"
                    />
                    <span className="text-xs text-gray-400">days after {i === 0 ? 'enrollment' : 'previous step'}</span>
                    <select
                      value={s.channel}
                      onChange={(e) => updateStep(i, { channel: e.target.value as 'whatsapp' | 'email' })}
                      aria-label={`Step ${i + 1} channel`}
                      className="ml-auto px-2 py-1 border border-gray-200 rounded text-xs"
                    >
                      <option value="whatsapp">WhatsApp</option>
                      <option value="email">Email (not sent — no email provider configured)</option>
                    </select>
                    {steps.length > 1 && (
                      <button type="button" onClick={() => setSteps((p) => p.filter((_, idx) => idx !== i))} aria-label={`Remove step ${i + 1}`} className="text-red-400 hover:text-red-600">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <textarea
                    value={s.message_template}
                    onChange={(e) => updateStep(i, { message_template: e.target.value })}
                    required
                    rows={2}
                    placeholder="Message — use {{name}} as a placeholder for the lead's name"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setFormOpen(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">Cancel</button>
              <button
                type="submit"
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-60"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save Sequence
              </button>
            </div>
          </form>
        )}

        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-sm text-gray-500">Loading…</div>
          ) : sequences.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-500">No sequences yet. Use “New Sequence” to create your first one.</div>
          ) : (
            <ul className="divide-y divide-gray-50">
              {sequences.map((seq) => (
                <li key={seq.id} className="px-5 py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-gray-800">{seq.name}</span>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{seq.steps.length} step{seq.steps.length === 1 ? '' : 's'}</span>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">{TRIGGER_EVENTS.find((t) => t.value === seq.trigger_event)?.label ?? seq.trigger_event}</span>
                      </div>
                      {seq.description && <p className="text-xs text-gray-500 mt-1">{seq.description}</p>}
                      <ol className="mt-2 space-y-1">
                        {seq.steps.map((st) => (
                          <li key={st.id} className="text-xs text-gray-500">
                            Day {st.delay_days} ({st.channel}): <span className="text-gray-700">{st.message_template.slice(0, 80)}{st.message_template.length > 80 ? '…' : ''}</span>
                          </li>
                        ))}
                      </ol>
                    </div>
                    <div className="shrink-0">
                      {enrollSequenceId === seq.id ? (
                        <div className="flex items-center gap-1.5">
                          <input
                            value={enrollLeadId}
                            onChange={(e) => setEnrollLeadId(e.target.value)}
                            placeholder="Lead ID"
                            aria-label="Lead ID to enroll"
                            className="w-40 px-2 py-1 border border-gray-200 rounded text-xs"
                          />
                          <button
                            onClick={() => handleEnroll(seq.id)}
                            disabled={enrolling || !enrollLeadId.trim()}
                            className="text-xs px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                          >
                            {enrolling ? '…' : 'Go'}
                          </button>
                          <button onClick={() => { setEnrollSequenceId(null); setEnrollLeadId('') }} aria-label="Cancel enroll" className="text-gray-400 hover:text-gray-600">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setEnrollSequenceId(seq.id)}
                          className="text-xs px-2 py-1 rounded border border-gray-200 text-gray-600 hover:bg-gray-50 inline-flex items-center gap-1"
                        >
                          <UserPlus className="w-3.5 h-3.5" /> Enroll lead
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
