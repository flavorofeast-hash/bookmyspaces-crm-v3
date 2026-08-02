'use client'

// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/components/leads/AIAssistantPanel.tsx
// Lead Workspace v1 — extraction, not a rewrite. This is the exact AI
// Operator Assistant panel (8 actions + Event Sales Advisor) that previously
// lived inline in src/app/(crm)/customers/[id]/page.tsx, moved here
// unchanged so both the Customer Profile page and the new Lead Workspace can
// mount it against the same POST /api/customers/[id]/ai endpoint without
// duplicating the component. Takes only a `customerId` prop, exactly as
// before — no behavior change, no new API.
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from 'react'
import {
  RefreshCw, AlertTriangle, Sparkles, Copy, Check,
} from 'lucide-react'
import { fmtINR } from '@/lib/format'

// Mirrors src/lib/ai/operator-assistant.ts's OperatorAssistAction exactly.
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

export function AIAssistantPanel({ customerId }: { customerId: string }) {
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
