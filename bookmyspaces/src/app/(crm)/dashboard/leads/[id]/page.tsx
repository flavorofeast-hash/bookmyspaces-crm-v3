'use client'

// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/app/(crm)/dashboard/leads/[id]/page.tsx
// Lead Workspace v1 — RC2 Phase 2.
//
// Was a pure viewer (name/phone/email/company/location/dates/notes, no
// actions, no links to any other module). This pass turns it into a usable
// workspace by REUSING what already exists elsewhere in the codebase —
// no new backend, no schema changes, no new API routes:
//
//   - Header's Lead Score / Estimated Revenue: already on the `leads` row
//     returned by the existing GET /api/customers/[id] (select('*')) — the
//     Lead type (@/modules/leads/types) already declares ai_score and
//     estimated_revenue, this page just wasn't rendering them yet.
//   - Quick Actions: plain links into pages that already handle prefill via
//     query params — /proposals/new (?lead_id=&name=&phone=&event=&guests=&date=,
//     see src/app/(crm)/proposals/new/page.tsx), /visits/new
//     (?lead_id=&name=&phone=, see src/app/(crm)/visits/new/page.tsx), and
//     /reservations (?fromLeadId=&name=&phone=&email=, which the Reservations
//     page already reads to auto-open its New Reservation modal — see
//     src/app/(crm)/reservations/page.tsx). WhatsApp reuses the exact
//     wa.me deep-link pattern already used in src/app/(crm)/kanban/page.tsx.
//   - Timeline / Recent Proposals / AI Summary: the exact same extracted
//     components now shared with src/app/(crm)/customers/[id]/page.tsx
//     (src/components/leads/LeadTimeline.tsx, LeadProposals.tsx,
//     AIAssistantPanel.tsx), calling the same existing endpoints
//     (GET /api/customers/[id]/timeline, GET /api/proposals?lead_id=,
//     POST /api/customers/[id]/ai). No new API surface.
//
// The four original detail cards (Contact & Business / Location / Important
// Dates / Notes & Record) are left exactly as they were — this pass adds to
// the page, it doesn't remove working content.
//
// Explicitly NOT in this pass (per "Version 1" scope): Tasks, Documents,
// Owner Assignment, a Reservation History tab, a Site Visit History tab, a
// freeform Email Composer, or any Phase 2/3 item from
// LEAD_WORKSPACE_DESIGN_PLAN.md.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import {
  ArrowLeft, Phone, Mail, Calendar, RefreshCw, AlertTriangle,
  MapPin, Building2, Gift, MessageCircle, PhoneCall, MessageSquareText,
  FileText, MapPinned, BedDouble, Award, Users,
} from 'lucide-react'
import { type Lead, STAGE_PIPELINE, effectiveStage } from '@/modules/leads/types'
import { fmtINR, fmtDate } from '@/lib/format'
import type { CustomerTimeline } from '@/types/timeline'
import { LeadTimeline } from '@/components/leads/LeadTimeline'
import { LeadProposals, type ProposalSummary } from '@/components/leads/LeadProposals'
import { AIAssistantPanel } from '@/components/leads/AIAssistantPanel'

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

// ─── Quick Actions ──────────────────────────────────────────────────────────
// Every link below reuses an existing page/route unchanged — no new backend.

function QuickActions({ lead }: { lead: Lead }) {
  const proposalHref = (() => {
    const p = new URLSearchParams({
      lead_id: lead.id,
      name: lead.name || '',
      phone: lead.phone || '',
      event: lead.event_type || '',
      guests: String(lead.guest_count || ''),
      date: lead.event_date || '',
    })
    return `/proposals/new?${p.toString()}`
  })()

  const visitHref = (() => {
    const p = new URLSearchParams({
      lead_id: lead.id,
      name: lead.name || '',
      phone: lead.phone || '',
    })
    return `/visits/new?${p.toString()}`
  })()

  const reservationHref = (() => {
    const p = new URLSearchParams({
      fromLeadId: lead.id,
      name: lead.name || '',
      phone: lead.phone || '',
      email: lead.email || '',
    })
    return `/reservations?${p.toString()}`
  })()

  const actionClass =
    'flex items-center gap-2 px-3.5 py-2.5 rounded-lg text-sm font-medium border transition-colors'

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <h2 className="text-sm font-semibold text-gray-700 mb-4">Quick Actions</h2>
      <div className="flex flex-wrap gap-2">
        {lead.phone && (
          <a href={`tel:${lead.phone}`} className={`${actionClass} border-gray-200 text-gray-700 hover:bg-gray-50`}>
            <PhoneCall className="w-3.5 h-3.5" /> Call
          </a>
        )}
        {lead.phone && (
          <a
            href={`https://wa.me/91${lead.phone}`}
            target="_blank"
            rel="noopener noreferrer"
            className={`${actionClass} border-transparent text-white`}
            style={{ background: '#25D366' }}
          >
            <MessageSquareText className="w-3.5 h-3.5" /> WhatsApp
          </a>
        )}
        <Link href={proposalHref} className={`${actionClass} border-blue-200 text-blue-700 hover:bg-blue-50`}>
          <FileText className="w-3.5 h-3.5" /> Create Proposal
        </Link>
        <Link href={visitHref} className={`${actionClass} border-amber-200 text-amber-700 hover:bg-amber-50`}>
          <MapPinned className="w-3.5 h-3.5" /> Schedule Visit
        </Link>
        <Link href={reservationHref} className={`${actionClass} border-emerald-200 text-emerald-700 hover:bg-emerald-50`}>
          <BedDouble className="w-3.5 h-3.5" /> Create Reservation
        </Link>
      </div>
    </div>
  )
}

interface LoyaltyCardData {
  account: { points_balance: number; tier: string } | null
  nextTierTarget: { tierName: string; pointsNeeded: number } | null
}

interface ReferralCardData {
  code: string
  link: string
  referredCount: number
  rewardsAsReferrer: Array<{ id: string; status: string; reward_type: string | null; reward_value: number | null }>
}

export default function LeadDetailPage({ params }: { params: { id: string } }) {
  const [lead, setLead] = useState<Lead | null>(null)
  const [timeline, setTimeline] = useState<CustomerTimeline | null>(null)
  const [proposals, setProposals] = useState<ProposalSummary[]>([])
  const [loyalty, setLoyalty] = useState<LoyaltyCardData | null>(null)
  const [referral, setReferral] = useState<ReferralCardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // Same pattern as src/app/(crm)/customers/[id]/page.tsx's load(): fetch
      // the lead plus its timeline and proposals in parallel, from the exact
      // same existing endpoints. Loyalty/referral reuse the existing
      // GET ?leadId= variants of /api/loyalty and /api/referrals unchanged.
      const [leadRes, timelineRes, proposalsRes, loyaltyRes, referralRes] = await Promise.all([
        fetch(`/api/customers/${params.id}`),
        fetch(`/api/customers/${params.id}/timeline`),
        fetch(`/api/proposals?lead_id=${params.id}`),
        fetch(`/api/loyalty?leadId=${params.id}`),
        fetch(`/api/referrals?leadId=${params.id}`),
      ])

      if (!leadRes.ok) throw new Error(leadRes.status === 404 ? 'Lead not found' : 'Failed to load lead')
      const json = await leadRes.json()
      setLead(json.customer)

      if (timelineRes.ok) {
        const timelineJson = await timelineRes.json()
        setTimeline(timelineJson.timeline)
      }

      if (proposalsRes.ok) {
        const proposalsJson = await proposalsRes.json()
        setProposals(proposalsJson.proposals ?? proposalsJson ?? [])
      }

      if (loyaltyRes.ok) setLoyalty(await loyaltyRes.json())
      if (referralRes.ok) setReferral(await referralRes.json())
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
    <div className="max-w-5xl mx-auto space-y-6">
      <Link href="/dashboard/leads" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800">
        <ArrowLeft className="w-4 h-4" /> Back to Lead Management
      </Link>

      {/* ── Header ──────────────────────────────────────────────────────── */}
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
          <div className="flex flex-wrap gap-2 items-center">
            {lead.ai_score != null && (
              <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-indigo-100 text-indigo-700">
                Score: {lead.ai_score}
              </span>
            )}
            <span
              className="px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap"
              style={{ color: stageMeta?.color, backgroundColor: stageMeta?.bg }}
            >
              {stageMeta?.label ?? stage}
            </span>
          </div>
        </div>

        {lead.estimated_revenue != null && (
          <div className="mt-5 pt-5 border-t border-gray-100">
            <div className="text-xs text-gray-400 uppercase tracking-wide">Estimated Revenue</div>
            <div className="text-sm font-semibold text-emerald-700 mt-0.5">{fmtINR(lead.estimated_revenue)}</div>
          </div>
        )}
      </div>

      {/* ── Quick Actions ───────────────────────────────────────────────── */}
      <QuickActions lead={lead} />

      {/* ── Existing detail cards (unchanged) ──────────────────────────── */}
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

        {/* ── Loyalty & Referral (Customer Loyalty & Referral Experience) ── */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-1.5">
            <Award className="w-4 h-4 text-gray-400" /> Loyalty &amp; Referral
          </h2>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Loyalty Tier" value={loyalty?.account?.tier ?? '—'} />
            <Field label="Points Balance" value={loyalty?.account ? loyalty.account.points_balance.toLocaleString('en-IN') : '—'} />
            <Field
              label="Next Tier"
              value={loyalty?.nextTierTarget ? `${loyalty.nextTierTarget.tierName} (${loyalty.nextTierTarget.pointsNeeded.toLocaleString('en-IN')} pts to go)` : 'Top tier reached'}
            />
            <Field label="Referral Code" value={referral?.code} />
          </div>
          {referral && (
            <div className="mt-4 pt-4 border-t border-gray-100 flex items-center gap-2 text-sm text-gray-600">
              <Users className="w-3.5 h-3.5 text-gray-400" />
              Referred {referral.referredCount} {referral.referredCount === 1 ? 'customer' : 'customers'}
              {referral.rewardsAsReferrer.some((r) => r.status === 'earned') && (
                <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700">Reward earned</span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Timeline + Recent Proposals (shared components, same as Customer Profile) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <LeadTimeline timeline={timeline} />
        </div>
        <LeadProposals proposals={proposals} />
      </div>

      {/* ── AI Summary (shared AI Operator Assistant panel) ────────────── */}
      <AIAssistantPanel customerId={params.id} />
    </div>
  )
}
