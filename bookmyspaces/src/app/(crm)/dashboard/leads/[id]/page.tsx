'use client'

// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/app/(crm)/dashboard/leads/[id]/page.tsx
// Lead Detail — reached by clicking a row on the new Lead Management page.
//
// Reuses, unchanged: GET /api/customers/[id] — this endpoint already reads
// the `leads` table with select('*') and is already auth-protected via
// requireAuth(), so it returns every Migration 018 field with zero backend
// changes. No new API route was created for this page. The existing Customer
// Profile page (src/app/(crm)/customers/[id]/page.tsx) was left untouched —
// it's a different, richer screen (timeline, proposals, AI assistant) built
// around event/venue fields, not the Migration 018 contact/marketing fields
// this task asked to display, so a separate, focused detail view was built
// here instead of overloading that screen.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import {
  ArrowLeft, Phone, Mail, Calendar, RefreshCw, AlertTriangle,
  MapPin, Building2, Gift, MessageCircle,
} from 'lucide-react'
import { type Lead, STAGE_PIPELINE, effectiveStage } from '@/modules/leads/types'

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
  } catch {
    return iso
  }
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch {
    return iso
  }
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-gray-400 uppercase tracking-wide">{label}</div>
      <div className="text-sm font-medium text-gray-800 mt-0.5">{value || '—'}</div>
    </div>
  )
}

export default function LeadDetailPage({ params }: { params: { id: string } }) {
  const [lead, setLead] = useState<Lead | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/customers/${params.id}`)
      if (!res.ok) throw new Error(res.status === 404 ? 'Lead not found' : 'Failed to load lead')
      const json = await res.json()
      setLead(json.customer)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load lead')
    } finally {
      setLoading(false)
    }
  }, [params.id])

  useEffect(() => { load() }, [load])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500">
        <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Loading lead…
      </div>
    )
  }

  if (error || !lead) {
    return (
      <div className="max-w-2xl mx-auto mt-12 text-center">
        <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto mb-3" />
        <p className="text-gray-700 font-medium">{error ?? 'Lead not found'}</p>
        <Link href="/dashboard/leads" className="text-sm text-blue-600 hover:underline mt-3 inline-block">
          ← Back to Lead Management
        </Link>
      </div>
    )
  }

  const stage = effectiveStage(lead)
  const stageMeta = STAGE_PIPELINE.find((s) => s.stage === stage)

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <Link href="/dashboard/leads" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800">
        <ArrowLeft className="w-4 h-4" /> Back to Lead Management
      </Link>

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-gray-900">{lead.name ?? 'Unnamed lead'}</h1>
            <div className="mt-2 flex flex-wrap gap-4 text-sm text-gray-600">
              {lead.phone && <span className="inline-flex items-center gap-1.5"><Phone className="w-3.5 h-3.5" /> {lead.phone}</span>}
              {lead.email && <span className="inline-flex items-center gap-1.5"><Mail className="w-3.5 h-3.5" /> {lead.email}</span>}
              <span className="inline-flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" /> Since {fmtDate(lead.created_at)}</span>
            </div>
          </div>
          <span
            className="px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap"
            style={{ color: stageMeta?.color, backgroundColor: stageMeta?.bg }}
          >
            {stageMeta?.label ?? stage}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-1.5">
            <Building2 className="w-4 h-4 text-gray-400" /> Contact &amp; Business
          </h2>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Name" value={lead.name} />
            <Field label="Phone" value={lead.phone} />
            <Field label="Email" value={lead.email} />
            <Field label="Company" value={lead.company} />
            <Field label="Source" value={lead.source} />
            <Field label="Preferred Channel" value={lead.preferred_channel} />
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-1.5">
            <MapPin className="w-4 h-4 text-gray-400" /> Location
          </h2>
          <div className="grid grid-cols-2 gap-4">
            <Field label="City" value={lead.city} />
            <Field label="State" value={lead.state} />
            <Field label="Country" value={lead.country} />
            <Field label="Address" value={lead.address} />
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-1.5">
            <Gift className="w-4 h-4 text-gray-400" /> Important Dates
          </h2>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Date of Visit" value={fmtDate(lead.date_of_visit)} />
            <Field label="Birthday" value={fmtDate(lead.birthday)} />
            <Field label="Anniversary" value={fmtDate(lead.anniversary)} />
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-1.5">
            <MessageCircle className="w-4 h-4 text-gray-400" /> Notes &amp; Record
          </h2>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Created At" value={fmtDateTime(lead.created_at)} />
            <Field label="Updated At" value={fmtDateTime(lead.updated_at)} />
          </div>
          <div className="mt-4">
            <div className="text-xs text-gray-400 uppercase tracking-wide">Notes</div>
            <div className="text-sm text-gray-700 mt-1 whitespace-pre-wrap">{lead.notes || '—'}</div>
          </div>
        </div>
      </div>
    </div>
  )
}
