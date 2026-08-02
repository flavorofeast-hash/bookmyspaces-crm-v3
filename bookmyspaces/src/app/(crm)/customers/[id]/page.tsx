'use client'

// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/app/(crm)/customers/[id]/page.tsx
// V3 Day 6 — Operator Experience sprint: Customer Profile screen.
//
// Fully live today (no migration 012 dependency for the parts that matter
// most): GET /api/customers/[id] reads `leads` directly, GET
// /api/customers/[id]/timeline wraps Day 4's getCustomerTimeline() which
// already reads chat/WhatsApp/email/activity/proposals/payments from tables
// already in production. Only the Reservation/AI-interaction rows on the
// timeline degrade until migration 012 is applied — surfaced here as a
// small banner, not hidden.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import {
  ArrowLeft, Phone, Mail, Calendar, Users, IndianRupee, MapPin,
  RefreshCw, AlertTriangle,
} from 'lucide-react'
import { fmtINR, fmtDate } from '@/lib/format'
import type { CustomerTimeline } from '@/types/timeline'
import { LeadTimeline } from '@/components/leads/LeadTimeline'
import { LeadProposals, type ProposalSummary } from '@/components/leads/LeadProposals'
import { AIAssistantPanel } from '@/components/leads/AIAssistantPanel'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Customer {
  id: string
  name: string | null
  phone: string | null
  email: string | null
  event_type: string | null
  event_date: string | null
  guest_count: number | null
  budget: string | null
  venue: string | null
  source: string
  status: string
  lead_stage: string | null
  lead_temperature: string | null
  ai_score: number | null
  estimated_revenue: number | null
  notes: string | null
  created_at: string
}

// Revenue Platform pivot — Customer Lifetime Value. Mirrors
// src/lib/customers/lifetime-value.ts's LifetimeValue exactly.
interface LifetimeValue {
  totalRevenue: number
  bookingCount: number
  isRepeatCustomer: boolean
  firstBookingAt: string | null
  lastBookingAt: string | null
  degraded: boolean
}

// Mirrors src/lib/ai/opportunity-score.ts's OpportunityScoreResult exactly.
// siteVisitEngagement/proposalEngagement added Sprint 2 (Revenue Conversion
// Engine) — this score is reused unchanged as the pipeline's "Revenue
// Probability" for every opportunity.
interface OpportunityScore {
  score: number
  band: 'HIGH' | 'MEDIUM' | 'LOW'
  components: {
    qualification: number
    proposalStatus: number
    followUpEngagement: number
    customerValue: number
    repeatCustomerBonus: number
    siteVisitEngagement: number
    proposalEngagement: number
  }
  reasoning: string[]
}

const OPPORTUNITY_BAND_STYLE: Record<OpportunityScore['band'], string> = {
  HIGH: 'bg-emerald-100 text-emerald-700',
  MEDIUM: 'bg-amber-100 text-amber-700',
  LOW: 'bg-gray-100 text-gray-600',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TEMPERATURE_STYLE: Record<string, string> = {
  HOT: 'bg-red-100 text-red-700',
  WARM: 'bg-amber-100 text-amber-700',
  COLD: 'bg-blue-100 text-blue-700',
}

export default function CustomerProfilePage({ params }: { params: { id: string } }) {
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [lifetimeValue, setLifetimeValue] = useState<LifetimeValue | null>(null)
  const [opportunityScore, setOpportunityScore] = useState<OpportunityScore | null>(null)
  const [showScoreDetail, setShowScoreDetail] = useState(false)
  const [timeline, setTimeline] = useState<CustomerTimeline | null>(null)
  const [proposals, setProposals] = useState<ProposalSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [customerRes, timelineRes, proposalsRes] = await Promise.all([
        fetch(`/api/customers/${params.id}`),
        fetch(`/api/customers/${params.id}/timeline`),
        fetch(`/api/proposals?lead_id=${params.id}`),
      ])

      if (!customerRes.ok) {
        throw new Error(customerRes.status === 404 ? 'Customer not found' : 'Failed to load customer')
      }
      const customerJson = await customerRes.json()
      setCustomer(customerJson.customer)
      setLifetimeValue(customerJson.lifetimeValue ?? null)
      setOpportunityScore(customerJson.opportunityScore ?? null)

      if (timelineRes.ok) {
        const timelineJson = await timelineRes.json()
        setTimeline(timelineJson.timeline)
      }

      if (proposalsRes.ok) {
        const proposalsJson = await proposalsRes.json()
        setProposals(proposalsJson.proposals ?? proposalsJson ?? [])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load customer')
    } finally {
      setLoading(false)
    }
  }, [params.id])

  useEffect(() => { load() }, [load])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500">
        <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Loading customer…
      </div>
    )
  }

  if (error || !customer) {
    return (
      <div className="max-w-2xl mx-auto mt-12 text-center">
        <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto mb-3" />
        <p className="text-gray-700 font-medium">{error ?? 'Customer not found'}</p>
        <Link href="/dashboard" className="text-sm text-blue-600 hover:underline mt-3 inline-block">
          ← Back to Dashboard
        </Link>
      </div>
    )
  }

  const degradedTypes = Object.entries(timeline?.degraded ?? {}).filter(([, v]) => v).map(([k]) => k)

  return (
    <div className="max-w-5xl mx-auto space-y-6">

      <Link href="/dashboard" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800">
        <ArrowLeft className="w-4 h-4" /> Back to Dashboard
      </Link>

      {/* ── Header card ─────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-gray-900">{customer.name ?? 'Unnamed customer'}</h1>
            <div className="mt-2 flex flex-wrap gap-4 text-sm text-gray-600">
              {customer.phone && (
                <span className="inline-flex items-center gap-1.5"><Phone className="w-3.5 h-3.5" /> {customer.phone}</span>
              )}
              {customer.email && (
                <span className="inline-flex items-center gap-1.5"><Mail className="w-3.5 h-3.5" /> {customer.email}</span>
              )}
              <span className="inline-flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" /> Customer since {fmtDate(customer.created_at)}</span>
            </div>
          </div>
          <div className="flex gap-2">
            {opportunityScore && (
              <button
                onClick={() => setShowScoreDetail((v) => !v)}
                title="Click for score breakdown"
                className={`px-2.5 py-1 rounded-full text-xs font-semibold ${OPPORTUNITY_BAND_STYLE[opportunityScore.band]}`}
              >
                Opportunity: {opportunityScore.score}/100
              </button>
            )}
            {lifetimeValue?.isRepeatCustomer && (
              <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-violet-100 text-violet-700">
                Repeat Customer
              </span>
            )}
            {customer.lead_temperature && (
              <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${TEMPERATURE_STYLE[customer.lead_temperature] ?? 'bg-gray-100 text-gray-700'}`}>
                {customer.lead_temperature}
              </span>
            )}
            <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-700">
              {(customer.lead_stage ?? customer.status)?.replace(/_/g, ' ')}
            </span>
          </div>
        </div>

        {/* Lifetime Value strip — Revenue Platform pivot */}
        {lifetimeValue && (
          <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-4 pt-5 border-t border-gray-100">
            <div>
              <div className="text-xs text-gray-400 uppercase tracking-wide">Lifetime value</div>
              <div className="text-sm font-semibold text-emerald-700 mt-0.5">{fmtINR(lifetimeValue.totalRevenue)}</div>
            </div>
            <div>
              <div className="text-xs text-gray-400 uppercase tracking-wide">Bookings</div>
              <div className="text-sm font-medium text-gray-800 mt-0.5">{lifetimeValue.bookingCount}</div>
            </div>
            <div>
              <div className="text-xs text-gray-400 uppercase tracking-wide">First booking</div>
              <div className="text-sm font-medium text-gray-800 mt-0.5">{fmtDate(lifetimeValue.firstBookingAt)}</div>
            </div>
            <div>
              <div className="text-xs text-gray-400 uppercase tracking-wide">Last booking</div>
              <div className="text-sm font-medium text-gray-800 mt-0.5">{fmtDate(lifetimeValue.lastBookingAt)}</div>
            </div>
            {lifetimeValue.degraded && (
              <p className="col-span-full text-xs text-amber-600">
                Reservation-sourced revenue isn&apos;t included yet — showing proposal revenue only.
              </p>
            )}
          </div>
        )}

        {showScoreDetail && opportunityScore && (
          <div className="mt-4 pt-4 border-t border-gray-100">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">
              Opportunity Score Breakdown
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3 text-xs">
              <div><span className="text-gray-400">Qualification</span><div className="font-semibold text-gray-800">{opportunityScore.components.qualification}/30</div></div>
              <div><span className="text-gray-400">Proposal status</span><div className="font-semibold text-gray-800">{opportunityScore.components.proposalStatus}/15</div></div>
              <div><span className="text-gray-400">Follow-up</span><div className="font-semibold text-gray-800">{opportunityScore.components.followUpEngagement}/10</div></div>
              <div><span className="text-gray-400">Customer value</span><div className="font-semibold text-gray-800">{opportunityScore.components.customerValue}/10</div></div>
              <div><span className="text-gray-400">Repeat bonus</span><div className="font-semibold text-gray-800">{opportunityScore.components.repeatCustomerBonus}/5</div></div>
              <div><span className="text-gray-400">Site visit</span><div className="font-semibold text-gray-800">{opportunityScore.components.siteVisitEngagement}/15</div></div>
              <div><span className="text-gray-400">Proposal viewed</span><div className="font-semibold text-gray-800">{opportunityScore.components.proposalEngagement}/15</div></div>
            </div>
            <ul className="text-xs text-gray-500 space-y-0.5">
              {opportunityScore.reasoning.map((r, i) => <li key={i}>{r}</li>)}
            </ul>
          </div>
        )}

        {/* Preferences row */}
        <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-4 pt-5 border-t border-gray-100">
          <div>
            <div className="text-xs text-gray-400 uppercase tracking-wide">Event type</div>
            <div className="text-sm font-medium text-gray-800 mt-0.5">{customer.event_type ?? '—'}</div>
          </div>
          <div>
            <div className="text-xs text-gray-400 uppercase tracking-wide">Event date</div>
            <div className="text-sm font-medium text-gray-800 mt-0.5">{fmtDate(customer.event_date)}</div>
          </div>
          <div>
            <div className="text-xs text-gray-400 uppercase tracking-wide flex items-center gap-1"><Users className="w-3 h-3" /> Guests</div>
            <div className="text-sm font-medium text-gray-800 mt-0.5">{customer.guest_count ?? '—'}</div>
          </div>
          <div>
            <div className="text-xs text-gray-400 uppercase tracking-wide flex items-center gap-1"><IndianRupee className="w-3 h-3" /> Budget</div>
            <div className="text-sm font-medium text-gray-800 mt-0.5">{customer.budget ?? '—'}</div>
          </div>
          {customer.venue && (
            <div>
              <div className="text-xs text-gray-400 uppercase tracking-wide flex items-center gap-1"><MapPin className="w-3 h-3" /> Venue preference</div>
              <div className="text-sm font-medium text-gray-800 mt-0.5">{customer.venue}</div>
            </div>
          )}
          {customer.estimated_revenue != null && (
            <div>
              <div className="text-xs text-gray-400 uppercase tracking-wide">Estimated revenue</div>
              <div className="text-sm font-medium text-gray-800 mt-0.5">{fmtINR(customer.estimated_revenue)}</div>
            </div>
          )}
        </div>
      </div>

      {degradedTypes.length > 0 && (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            Reservation history isn&apos;t showing here yet — the Reservation module&apos;s database migration hasn&apos;t been
            applied in this environment. Everything else on this profile (chat, WhatsApp, email, proposals, payments) is live.
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* ── Timeline ────────────────────────────────────────────────────── */}
        <div className="lg:col-span-2">
          <LeadTimeline timeline={timeline} />
        </div>

        {/* ── Proposals ───────────────────────────────────────────────────── */}
        <LeadProposals proposals={proposals} />
      </div>

      {/* ── AI Operator Assistant ───────────────────────────────────────── */}
      <AIAssistantPanel customerId={params.id} />
    </div>
  )
}
