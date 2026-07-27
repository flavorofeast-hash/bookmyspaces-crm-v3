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
  MessageSquare, FileText, Wallet, Bot, Clock, RefreshCw,
  AlertTriangle, ChevronRight, Tag, Sparkles, Copy, Check,
} from 'lucide-react'

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

type TimelineEntryType =
  | 'chat' | 'whatsapp' | 'email' | 'lead_activity' | 'reservation'
  | 'proposal' | 'payment' | 'follow_up' | 'ai_interaction'

interface TimelineEntry {
  type: TimelineEntryType
  timestamp: string
  title: string
  description: string | null
  metadata: Record<string, unknown>
}

interface CustomerTimeline {
  leadId: string
  entries: TimelineEntry[]
  degraded: Partial<Record<TimelineEntryType, boolean>>
}

interface ProposalSummary {
  id: string
  proposal_number: string | null
  package_name: string | null
  total_price: number | null
  status: string
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
interface OpportunityScore {
  score: number
  band: 'HIGH' | 'MEDIUM' | 'LOW'
  components: {
    qualification: number
    proposalStatus: number
    followUpEngagement: number
    customerValue: number
    repeatCustomerBonus: number
  }
  reasoning: string[]
}

const OPPORTUNITY_BAND_STYLE: Record<OpportunityScore['band'], string> = {
  HIGH: 'bg-emerald-100 text-emerald-700',
  MEDIUM: 'bg-amber-100 text-amber-700',
  LOW: 'bg-gray-100 text-gray-600',
}

// V3 Sprint 4 — Priority 4: AI Operator Assistant. Mirrors
// src/lib/ai/operator-assistant.ts's OperatorAssistAction exactly.
type OperatorAssistAction =
  | 'customer_summary' | 'conversation_summary' | 'suggested_whatsapp_reply'
  | 'suggested_email' | 'recommended_room' | 'recommended_package' | 'recommended_follow_up'
  | 'upsell_recommendations'

const ASSIST_ACTIONS: { action: OperatorAssistAction; label: string }[] = [
  { action: 'customer_summary', label: 'Customer Summary' },
  { action: 'conversation_summary', label: 'Conversation Summary' },
  { action: 'suggested_whatsapp_reply', label: 'Suggested WhatsApp Reply' },
  { action: 'suggested_email', label: 'Suggested Email' },
  { action: 'recommended_room', label: 'Recommended Room' },
  { action: 'recommended_package', label: 'Recommended Package' },
  { action: 'recommended_follow_up', label: 'Recommended Follow-up' },
  { action: 'upsell_recommendations', label: 'Upsell Recommendations' },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtINR(n: number | null | undefined): string {
  if (!n) return '₹0'
  return '₹' + Number(n).toLocaleString('en-IN')
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
  } catch {
    return iso
  }
}

function fmtDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
  } catch {
    return iso
  }
}

const TIMELINE_ICON: Record<TimelineEntryType, React.ComponentType<{ className?: string }>> = {
  chat: MessageSquare,
  whatsapp: MessageSquare,
  email: Mail,
  lead_activity: Tag,
  reservation: Calendar,
  proposal: FileText,
  payment: Wallet,
  follow_up: Clock,
  ai_interaction: Bot,
}

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
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-3 text-xs">
              <div><span className="text-gray-400">Qualification</span><div className="font-semibold text-gray-800">{opportunityScore.components.qualification}/40</div></div>
              <div><span className="text-gray-400">Proposal status</span><div className="font-semibold text-gray-800">{opportunityScore.components.proposalStatus}/20</div></div>
              <div><span className="text-gray-400">Follow-up</span><div className="font-semibold text-gray-800">{opportunityScore.components.followUpEngagement}/15</div></div>
              <div><span className="text-gray-400">Customer value</span><div className="font-semibold text-gray-800">{opportunityScore.components.customerValue}/15</div></div>
              <div><span className="text-gray-400">Repeat bonus</span><div className="font-semibold text-gray-800">{opportunityScore.components.repeatCustomerBonus}/10</div></div>
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
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Timeline</h2>
          {!timeline || timeline.entries.length === 0 ? (
            <p className="text-sm text-gray-400">No activity recorded yet.</p>
          ) : (
            <ol className="space-y-4">
              {timeline.entries.map((entry, i) => {
                const Icon = TIMELINE_ICON[entry.type] ?? Tag
                return (
                  <li key={i} className="flex gap-3">
                    <div className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center shrink-0 mt-0.5">
                      <Icon className="w-3.5 h-3.5 text-gray-600" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-baseline gap-2">
                        <span className="text-sm font-medium text-gray-800">{entry.title}</span>
                        <span className="text-xs text-gray-400 shrink-0">{fmtDateTime(entry.timestamp)}</span>
                      </div>
                      {entry.description && (
                        <p className="text-sm text-gray-500 mt-0.5 break-words">{entry.description}</p>
                      )}
                    </div>
                  </li>
                )
              })}
            </ol>
          )}
        </div>

        {/* ── Proposals ───────────────────────────────────────────────────── */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Proposals</h2>
          {proposals.length === 0 ? (
            <p className="text-sm text-gray-400">No proposals yet.</p>
          ) : (
            <ul className="space-y-3">
              {proposals.map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/proposals`}
                    className="flex items-center justify-between gap-2 group"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-gray-800 truncate">
                        {p.proposal_number ?? p.id.slice(0, 8)} — {p.package_name ?? 'Custom'}
                      </div>
                      <div className="text-xs text-gray-400">{fmtDate(p.created_at)} · {p.status}</div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0 text-sm font-semibold text-gray-700">
                      {fmtINR(p.total_price)}
                      <ChevronRight className="w-3.5 h-3.5 text-gray-300 group-hover:text-gray-500" />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* ── AI Operator Assistant ───────────────────────────────────────── */}
      <AIAssistantPanel customerId={params.id} />
    </div>
  )
}

// Direct Event Sales Engine, Section 2/7 — mirrors src/lib/ai/
// operator-assistant.ts's EventSalesAdvisorResult exactly.
interface EventSalesAdvisorResult {
  identified: {
    eventType: string | null
    guestCount: number | null
    budget: string | null
    preferredDate: string | null
    foodRequirements: string | null
    hallRequirements: string | null
    roomRequirements: string | null
  }
  recommendation: {
    venue: string | null
    packageId: string | null
    packageName: string | null
    catering: string | null
    decoration: string | null
    addons: string[]
    estimatedPrice: number | null
    upsells: string[]
  }
  salesCopilot: {
    expectedBudgetRange: string | null
    bookingProbability: 'HIGH' | 'MEDIUM' | 'LOW'
    bookingProbabilityReason: string
    nextFollowUpAction: string
    nextFollowUpTiming: string
    nextFollowUpChannel: string
    bestResponse: string
  }
}

function AIAssistantPanel({ customerId }: { customerId: string }) {
  const [pendingAction, setPendingAction] = useState<OperatorAssistAction | null>(null)
  const [result, setResult] = useState<{ action: OperatorAssistAction; text: string } | null>(null)
  const [assistError, setAssistError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const [advisorPending, setAdvisorPending] = useState(false)
  const [advisorResult, setAdvisorResult] = useState<EventSalesAdvisorResult | null>(null)
  const [advisorError, setAdvisorError] = useState<string | null>(null)

  async function runAssist(action: OperatorAssistAction) {
    setPendingAction(action)
    setAssistError(null)
    setCopied(false)
    try {
      const res = await fetch(`/api/customers/${customerId}/ai`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'AI assistant request failed')
      setResult({ action, text: json.text })
    } catch (err) {
      setAssistError(err instanceof Error ? err.message : 'AI assistant request failed')
    } finally {
      setPendingAction(null)
    }
  }

  async function runEventAdvisor() {
    setAdvisorPending(true)
    setAdvisorError(null)
    try {
      const res = await fetch(`/api/customers/${customerId}/ai`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'event_sales_advisor' }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Event Sales Advisor request failed')
      setAdvisorResult(json)
    } catch (err) {
      setAdvisorError(err instanceof Error ? err.message : 'Event Sales Advisor request failed')
    } finally {
      setAdvisorPending(false)
    }
  }

  function handleCopy() {
    if (!result) return
    navigator.clipboard?.writeText(result.text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <h2 className="text-sm font-semibold text-gray-700 mb-1 flex items-center gap-1.5">
        <Sparkles className="w-4 h-4 text-indigo-500" /> AI Operator Assistant
      </h2>
      <p className="text-xs text-gray-400 mb-4">
        Built from this customer&apos;s real profile, preferences, reservation/proposal history, and recent conversation — the same AI Context Builder every other AI feature in BookMySpaces reads from.
      </p>

      <div className="flex flex-wrap gap-2">
        {ASSIST_ACTIONS.map(({ action, label }) => (
          <button
            key={action}
            onClick={() => runAssist(action)}
            disabled={pendingAction !== null}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-50 text-gray-700 border border-gray-200 hover:bg-gray-100 disabled:opacity-50"
          >
            {pendingAction === action ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3 text-indigo-400" />}
            {label}
          </button>
        ))}
        {/* Direct Event Sales Engine, Section 2/7 — structured (not free-text) result, own button + panel. */}
        <button
          onClick={runEventAdvisor}
          disabled={advisorPending}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-violet-50 text-violet-700 border border-violet-200 hover:bg-violet-100 disabled:opacity-50"
        >
          {advisorPending ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3 text-violet-500" />}
          Event Sales Advisor
        </button>
      </div>

      {advisorError && (
        <div className="mt-4 flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
          <AlertTriangle className="w-4 h-4" /> {advisorError}
        </div>
      )}

      {advisorResult && (
        <div className="mt-4 bg-violet-50/50 border border-violet-100 rounded-lg p-4 space-y-3">
          <div>
            <p className="text-xs font-semibold text-violet-700 mb-1.5">Identified requirements</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-gray-700">
              <div><span className="text-gray-400">Event type:</span> {advisorResult.identified.eventType ?? '—'}</div>
              <div><span className="text-gray-400">Guests:</span> {advisorResult.identified.guestCount ?? '—'}</div>
              <div><span className="text-gray-400">Budget:</span> {advisorResult.identified.budget ?? '—'}</div>
              <div><span className="text-gray-400">Date:</span> {advisorResult.identified.preferredDate ?? '—'}</div>
              <div className="col-span-2"><span className="text-gray-400">Food:</span> {advisorResult.identified.foodRequirements ?? '—'}</div>
              <div className="col-span-2"><span className="text-gray-400">Hall/Room:</span> {[advisorResult.identified.hallRequirements, advisorResult.identified.roomRequirements].filter(Boolean).join(' / ') || '—'}</div>
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold text-violet-700 mb-1.5">Recommendation</p>
            <p className="text-sm text-gray-800">
              {advisorResult.recommendation.packageName ? (
                <>Package: <span className="font-medium">{advisorResult.recommendation.packageName}</span>{advisorResult.recommendation.estimatedPrice ? ` — ${fmtINR(advisorResult.recommendation.estimatedPrice)}` : ''}</>
              ) : 'No package in the current catalog matches confidently.'}
            </p>
            {advisorResult.recommendation.catering && <p className="text-xs text-gray-600 mt-1">Catering: {advisorResult.recommendation.catering}</p>}
            {advisorResult.recommendation.decoration && <p className="text-xs text-gray-600">Decoration: {advisorResult.recommendation.decoration}</p>}
            {advisorResult.recommendation.addons.length > 0 && <p className="text-xs text-gray-600">Add-ons: {advisorResult.recommendation.addons.join(', ')}</p>}
            {advisorResult.recommendation.upsells.length > 0 && <p className="text-xs text-gray-600">Upsells: {advisorResult.recommendation.upsells.join(', ')}</p>}
          </div>
          <div>
            <p className="text-xs font-semibold text-violet-700 mb-1.5">Sales copilot</p>
            <div className="flex items-center gap-2 mb-1">
              <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${advisorResult.salesCopilot.bookingProbability === 'HIGH' ? 'bg-emerald-100 text-emerald-700' : advisorResult.salesCopilot.bookingProbability === 'MEDIUM' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'}`}>
                {advisorResult.salesCopilot.bookingProbability} probability
              </span>
              <span className="text-xs text-gray-500">{advisorResult.salesCopilot.bookingProbabilityReason}</span>
            </div>
            {advisorResult.salesCopilot.expectedBudgetRange && <p className="text-xs text-gray-600">Expected budget: {advisorResult.salesCopilot.expectedBudgetRange}</p>}
            <p className="text-xs text-gray-600">Next: {advisorResult.salesCopilot.nextFollowUpAction} ({advisorResult.salesCopilot.nextFollowUpTiming}, {advisorResult.salesCopilot.nextFollowUpChannel})</p>
            <p className="text-sm text-gray-800 mt-2 bg-white border border-violet-100 rounded-lg p-2">{advisorResult.salesCopilot.bestResponse}</p>
          </div>
        </div>
      )}

      {assistError && (
        <div className="mt-4 flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
          <AlertTriangle className="w-4 h-4" /> {assistError}
        </div>
      )}

      {result && (
        <div className="mt-4 bg-indigo-50/50 border border-indigo-100 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-indigo-700">
              {ASSIST_ACTIONS.find((a) => a.action === result.action)?.label}
            </span>
            <button
              onClick={handleCopy}
              className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-800"
            >
              {copied ? <Check className="w-3 h-3 text-green-600" /> : <Copy className="w-3 h-3" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p className="text-sm text-gray-800 whitespace-pre-wrap">{result.text}</p>
        </div>
      )}
    </div>
  )
}
