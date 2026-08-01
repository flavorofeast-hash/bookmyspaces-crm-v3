'use client'

// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/app/(crm)/visits/new/page.tsx
// Sprint 1 — Revenue Capture Pipeline: Visit Scheduling.
//
// Standalone form mirroring src/app/(crm)/proposals/new/page.tsx's UX
// pattern (sticky header, Section/Label/Input primitives, query-param
// prefill) — the same shape CRM staff already know from creating a
// proposal, applied to scheduling a site visit. POSTs to
// POST /api/site-visits, which resolves-or-creates the lead exactly like
// proposal creation does (ensureLeadForProposal's pattern, reused via
// scheduleSiteVisit()).
// ─────────────────────────────────────────────────────────────────────────────

import { useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  MapPin, User, Phone, Mail, Calendar, Clock, Users, IndianRupee,
  MessageSquare, ArrowLeft, Sparkles, ChevronRight, CheckCircle2,
  AlertCircle, Loader2,
} from 'lucide-react'

interface FormState {
  lead_id     : string
  name        : string
  phone       : string
  email       : string
  property    : string
  visit_date  : string
  visit_time  : string
  purpose     : string
  guest_count : string
  budget      : string
}

const EMPTY: FormState = {
  lead_id: '', name: '', phone: '', email: '',
  property: 'Monurama Homestay', visit_date: '', visit_time: '',
  purpose: '', guest_count: '', budget: '',
}

const PROPERTIES = ['Monurama Homestay', 'Skyline Serenity']

function Label({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-widest mb-1.5">
      {children}{required && <span className="text-red-400 ml-0.5">*</span>}
    </label>
  )
}

function Input({ value, onChange, placeholder, type = 'text', required, icon: Icon }: {
  value: string; onChange: (v: string) => void; placeholder?: string
  type?: string; required?: boolean; icon?: React.ElementType
}) {
  return (
    <div className="relative">
      {Icon && <Icon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />}
      <input type={type} value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder} required={required}
        className={`w-full border border-gray-200 rounded-lg py-2.5 text-sm text-gray-900 bg-white
          focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors placeholder:text-gray-400
          ${Icon ? 'pl-9 pr-3' : 'px-3'}`}
      />
    </div>
  )
}

function SelectField({ value, onChange, options, icon: Icon }: {
  value: string; onChange: (v: string) => void; options: string[]; icon?: React.ElementType
}) {
  return (
    <div className="relative">
      {Icon && <Icon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />}
      <select value={value} onChange={e => onChange(e.target.value)}
        className={`w-full border border-gray-200 rounded-lg py-2.5 text-sm text-gray-900 bg-white
          focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none
          ${Icon ? 'pl-9 pr-8' : 'px-3 pr-8'}`}
      >
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
      <ChevronRight className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 rotate-90 pointer-events-none" />
    </div>
  )
}

function Section({ title, icon: Icon, children }: {
  title: string; icon: React.ElementType; children: React.ReactNode
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
      <div className="flex items-center gap-2.5 px-5 py-4 border-b border-gray-100 bg-gray-50/60">
        <div className="p-1.5 bg-blue-100 rounded-lg"><Icon className="w-3.5 h-3.5 text-blue-600" /></div>
        <h2 className="text-sm font-bold text-gray-800">{title}</h2>
      </div>
      <div className="p-5">{children}</div>
    </div>
  )
}

function NewVisitInner() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [form, setForm] = useState<FormState>(() => ({
    ...EMPTY,
    lead_id    : searchParams.get('lead_id') ?? '',
    name       : searchParams.get('name') ?? '',
    phone      : searchParams.get('phone') ?? '',
    property   : searchParams.get('property') ?? 'Monurama Homestay',
    purpose    : searchParams.get('purpose') ?? '',
    guest_count: searchParams.get('guests') ?? '',
    budget     : searchParams.get('budget') ?? '',
  }))

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  function setStr(field: keyof FormState) {
    return (value: string) => setForm(prev => ({ ...prev, [field]: value }))
  }

  const isSkyline = form.property === 'Skyline Serenity'

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    window.scrollTo({ top: 0, behavior: 'smooth' })

    if (!form.name.trim()) { setError('Customer name is required.'); return }
    if (!form.phone.trim() && !form.email.trim()) { setError('Provide at least a phone or email.'); return }
    if (!form.visit_date) { setError('Visit date is required.'); return }
    if (!form.visit_time) { setError('Visit time is required.'); return }

    setSaving(true)
    try {
      const res = await fetch('/api/site-visits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lead_id    : form.lead_id || null,
          name       : form.name.trim(),
          phone      : form.phone.trim() || null,
          email      : form.email.trim() || null,
          property   : form.property,
          visit_date : form.visit_date,
          visit_time : form.visit_time,
          purpose    : form.purpose.trim() || null,
          guest_count: form.guest_count ? parseInt(form.guest_count, 10) : null,
          budget     : form.budget.trim() || null,
        }),
      })

      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error ?? `Server error ${res.status}`)
      }

      await res.json()
      setSuccess(true)
      setTimeout(() => router.push('/dashboard/operations'), 900)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to schedule visit.')
      setSaving(false)
    }
  }

  if (success) return (
    <div className="min-h-screen bg-gray-50/60 flex items-center justify-center">
      <div className="text-center space-y-3">
        <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto">
          <CheckCircle2 className="w-8 h-8 text-emerald-600" />
        </div>
        <h2 className="text-lg font-bold text-gray-900">Visit Scheduled</h2>
        <p className="text-sm text-gray-500">Redirecting…</p>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50/60">
      <header className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-gray-200 px-6 py-3">
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => router.back()}
              className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors">
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div>
              <h1 className="text-sm font-black text-gray-900 flex items-center gap-2">
                <MapPin className="w-4 h-4 text-blue-600" /> Schedule Site Visit
              </h1>
              {form.lead_id && <p className="text-xs text-gray-400">Linked to lead · {form.lead_id.slice(0, 8)}…</p>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => router.back()}
              className="px-3 py-2 border border-gray-200 rounded-lg text-xs text-gray-600 hover:bg-gray-50">
              Cancel
            </button>
            <button type="submit" form="visit-form" disabled={saving}
              className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700 disabled:opacity-60">
              {saving ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Scheduling…</> : <><Sparkles className="w-3.5 h-3.5" />Schedule Visit</>}
            </button>
          </div>
        </div>
      </header>

      <form id="visit-form" onSubmit={handleSubmit} className="max-w-3xl mx-auto px-6 py-6 space-y-4">
        {error && (
          <div className="flex items-start gap-2.5 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />{error}
          </div>
        )}

        <Section title="Customer" icon={User}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <Label required>Full Name</Label>
              <Input value={form.name} onChange={setStr('name')} placeholder="Rahul Sharma" icon={User} required />
            </div>
            <div>
              <Label>Phone</Label>
              <Input value={form.phone} onChange={setStr('phone')} placeholder="9XXXXXXXXX" type="tel" icon={Phone} />
            </div>
            <div>
              <Label>Email</Label>
              <Input value={form.email} onChange={setStr('email')} placeholder="client@email.com" type="email" icon={Mail} />
            </div>
          </div>
        </Section>

        <Section title="Visit Details" icon={MapPin}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label required>Property</Label>
              <SelectField value={form.property} onChange={setStr('property')} options={PROPERTIES} icon={MapPin} />
              {isSkyline && (
                <p className="mt-1.5 text-xs text-amber-700">Skyline Serenity is accommodation-only — not for weddings or events.</p>
              )}
            </div>
            <div>
              <Label>Purpose</Label>
              <Input value={form.purpose} onChange={setStr('purpose')} placeholder="Wedding site visit — Rooftop" icon={MessageSquare} />
            </div>
            <div>
              <Label required>Visit Date</Label>
              <Input value={form.visit_date} onChange={setStr('visit_date')} type="date" icon={Calendar} required />
            </div>
            <div>
              <Label required>Visit Time</Label>
              <Input value={form.visit_time} onChange={setStr('visit_time')} type="time" icon={Clock} required />
            </div>
            <div>
              <Label>Guest Count</Label>
              <Input value={form.guest_count} onChange={setStr('guest_count')} placeholder="45" type="number" icon={Users} />
              {!isSkyline && Number(form.guest_count) > 100 && (
                <p className="mt-1.5 text-xs text-red-600">Monurama caps at 100 guests property-wide.</p>
              )}
            </div>
            <div>
              <Label>Budget</Label>
              <Input value={form.budget} onChange={setStr('budget')} placeholder="1.5-2L" icon={IndianRupee} />
            </div>
          </div>
        </Section>

        <div className="flex justify-end gap-3 pt-2 pb-8">
          <button type="button" onClick={() => router.back()}
            className="px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50">
            Cancel
          </button>
          <button type="submit" disabled={saving}
            className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700 disabled:opacity-60 shadow-sm">
            {saving ? <><Loader2 className="w-4 h-4 animate-spin" />Scheduling…</> : <><Sparkles className="w-4 h-4" />Schedule Visit</>}
          </button>
        </div>
      </form>
    </div>
  )
}

export default function NewVisitPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50/60 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
      </div>
    }>
      <NewVisitInner />
    </Suspense>
  )
}
