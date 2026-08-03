'use client'

// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/components/leads/NewLeadModal.tsx
// Manual Lead Creation (RC2). Same modal shell pattern as
// src/app/(crm)/reservations/page.tsx's NewReservationModal (fixed inset-0
// overlay, bg-white rounded-xl card, X close button, gray-900 primary
// button) — reused for visual consistency, not redesigned.
//
// Posts to the existing POST /api/leads (src/app/api/leads/route.ts), which
// already resolves duplicate phone numbers via resolveIdentity() and returns
// { lead, duplicate: true } instead of creating a second row — this modal
// only needed to surface that response, not implement duplicate detection
// itself.
//
// Source mapping: `leads.source` has a production DB CHECK constraint
// (leads_source_check — see ALLOWED_LEAD_SOURCES in
// src/app/api/leads/import/route.ts) that only accepts a fixed list of
// values. Several of the spec's required Source options (Phone, Walk-in,
// Google, Email) aren't in that list, and adding them requires a migration —
// out of scope here ("do NOT change database schema unless absolutely
// required"). Each option's DB_VALUE below maps to the nearest accepted
// value (falls back to 'other'), same defensive-mapping pattern the import
// route already uses (resolveSource()). The exact label the user picked is
// never lost — it's still shown in this form and can be captured verbatim
// in Notes/Preferred Channel by the person filling it in.
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from 'react'
import { X, AlertTriangle } from 'lucide-react'

export interface SourceOption {
  label: string
  dbValue: string
}

export const SOURCE_OPTIONS: SourceOption[] = [
  { label: 'Phone', dbValue: 'other' },
  { label: 'Walk-in', dbValue: 'other' },
  { label: 'WhatsApp', dbValue: 'whatsapp' },
  { label: 'Website', dbValue: 'website' },
  { label: 'Facebook', dbValue: 'facebook' },
  { label: 'Instagram', dbValue: 'instagram' },
  { label: 'Google', dbValue: 'other' },
  { label: 'Referral', dbValue: 'referral' },
  { label: 'Email', dbValue: 'other' },
  { label: 'Other', dbValue: 'other' },
]

/** Lead Workspace route for a given lead id — extracted so the redirect target is unit-testable without rendering the component. */
export function leadWorkspaceHref(leadId: string): string {
  return `/dashboard/leads/${leadId}`
}

interface FormState {
  name: string
  phone: string
  email: string
  eventType: string
  eventDate: string
  guests: string
  budget: string
  company: string
  city: string
  state: string
  preferredChannel: string
  sourceLabel: string
  notes: string
}

const EMPTY_FORM: FormState = {
  name: '', phone: '', email: '', eventType: '', eventDate: '', guests: '',
  budget: '', company: '', city: '', state: '', preferredChannel: '',
  sourceLabel: SOURCE_OPTIONS[0].label, notes: '',
}

const inputClass = 'mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/10'
const labelClass = 'text-xs font-medium text-gray-500'

export function NewLeadModal({
  onClose, onCreated,
}: {
  onClose: () => void
  onCreated: (leadId: string) => void
}) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [errors, setErrors] = useState<{ name?: string; phone?: string }>({})
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [duplicate, setDuplicate] = useState<{ leadId: string } | null>(null)

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function validate(): boolean {
    const next: { name?: string; phone?: string } = {}
    if (!form.name.trim()) next.name = 'Name is required.'
    if (!form.phone.trim()) next.phone = 'Phone is required.'
    setErrors(next)
    return Object.keys(next).length === 0
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    setDuplicate(null)
    if (!validate()) return

    const source = SOURCE_OPTIONS.find((o) => o.label === form.sourceLabel) ?? SOURCE_OPTIONS[SOURCE_OPTIONS.length - 1]

    setSubmitting(true)
    try {
      const res = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          phone: form.phone.trim(),
          email: form.email.trim() || null,
          event_type: form.eventType.trim() || null,
          event_date: form.eventDate || null,
          guest_count: form.guests.trim() || null,
          budget: form.budget.trim() || null,
          company: form.company.trim() || null,
          city: form.city.trim() || null,
          state: form.state.trim() || null,
          preferred_channel: form.preferredChannel.trim() || null,
          source: source.dbValue,
          notes: form.notes.trim() || null,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setFormError(data.error ?? 'Failed to create lead.')
        return
      }
      if (data.duplicate) {
        setDuplicate({ leadId: data.lead.id })
        return
      }
      onCreated(data.lead.id)
    } catch {
      setFormError('Failed to create lead — please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900">New Lead</h3>
          <button onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-700">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {duplicate && (
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <div className="flex-1">
                <div className="font-medium">Lead already exists</div>
                <p className="mt-0.5">A lead with this phone number is already in the system.</p>
                <button
                  type="button"
                  onClick={() => onCreated(duplicate.leadId)}
                  className="mt-2 inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-600 text-white hover:bg-amber-700"
                >
                  Open Existing Lead
                </button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Name *</label>
              <input value={form.name} onChange={(e) => set('name', e.target.value)} className={inputClass} placeholder="Priya Sharma" />
              {errors.name && <p className="text-xs text-red-600 mt-1">{errors.name}</p>}
            </div>
            <div>
              <label className={labelClass}>Phone *</label>
              <input value={form.phone} onChange={(e) => set('phone', e.target.value)} className={inputClass} placeholder="98765 43210" />
              {errors.phone && <p className="text-xs text-red-600 mt-1">{errors.phone}</p>}
            </div>
          </div>

          <div>
            <label className={labelClass}>Email</label>
            <input value={form.email} onChange={(e) => set('email', e.target.value)} className={inputClass} placeholder="priya@example.com" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Event Type</label>
              <input value={form.eventType} onChange={(e) => set('eventType', e.target.value)} className={inputClass} placeholder="Wedding" />
            </div>
            <div>
              <label className={labelClass}>Event Date</label>
              <input type="date" value={form.eventDate} onChange={(e) => set('eventDate', e.target.value)} className={inputClass} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Guests</label>
              <input type="number" min={1} value={form.guests} onChange={(e) => set('guests', e.target.value)} className={inputClass} placeholder="150" />
            </div>
            <div>
              <label className={labelClass}>Budget</label>
              <input value={form.budget} onChange={(e) => set('budget', e.target.value)} className={inputClass} placeholder="3L" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Company</label>
              <input value={form.company} onChange={(e) => set('company', e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Preferred Channel</label>
              <input value={form.preferredChannel} onChange={(e) => set('preferredChannel', e.target.value)} className={inputClass} placeholder="Call after 6pm" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>City</label>
              <input value={form.city} onChange={(e) => set('city', e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>State</label>
              <input value={form.state} onChange={(e) => set('state', e.target.value)} className={inputClass} />
            </div>
          </div>

          <div>
            <label className={labelClass}>Source</label>
            <select value={form.sourceLabel} onChange={(e) => set('sourceLabel', e.target.value)} className={inputClass}>
              {SOURCE_OPTIONS.map((o) => (
                <option key={o.label} value={o.label}>{o.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelClass}>Notes</label>
            <textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} className={`${inputClass} min-h-[72px]`} />
          </div>

          {formError && <div className="text-sm text-red-700">{formError}</div>}

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-2.5 rounded-lg bg-gray-900 text-white text-sm font-medium hover:bg-gray-800 disabled:opacity-50"
          >
            {submitting ? 'Creating…' : 'Create Lead'}
          </button>
        </form>
      </div>
    </div>
  )
}
