// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/leads/lead-intelligence.ts
// Sprint 3A (Founder Dashboard) — extraction, not new logic.
//
// computeIntelligence() previously lived only inside src/app/(crm)/dashboard/
// HotLeadDashboard.tsx ("Intelligence engine (pure, no API)" — always was a
// standalone pure function with zero React/DOM dependency, just defined
// inline in a 'use client' page). Moved here unchanged so the Founder
// Dashboard's server-side API route can reuse the SAME "what should the
// salesperson/owner do next" logic instead of re-deriving a second, competing
// next-action heuristic — the "no duplicate logic" rule leaves no other
// option once the same decision needs to be made from both a client
// component and a server route. HotLeadDashboard.tsx now imports this
// instead of defining its own copy; behavior is byte-identical.
//
// Input type is deliberately narrower than HotLeadDashboard.tsx's own `Lead`
// interface — only the columns computeIntelligence() actually reads. Both
// that page's `Lead` and any `leads` row shape a new caller selects are
// structurally compatible with `LeadIntelligenceInput` as long as they carry
// these columns, so neither caller needs to change its own row type.
// ─────────────────────────────────────────────────────────────────────────────

import type { LeadStage, LeadTemperature } from '@/modules/leads/types'

export type NextAction =
  | 'call_immediately'
  | 'send_proposal'
  | 'schedule_visit'
  | 're_engage'
  | 'close_lead'
  | 'mark_stale'
  | 'send_followup'
  | 'awaiting_response'

export type FollowUpStatus =
  | 'overdue'
  | 'due_today'
  | 'stale'
  | 'no_response'
  | 'on_track'
  | 'confirmed'

export interface LeadIntelligence {
  nextAction      : NextAction
  followUpStatus  : FollowUpStatus
  urgencyScore    : number   // 0–100 for priority sort
  staleReason     : string | null
  hoursWithoutContact: number | null
  isStale         : boolean
  isOverdue       : boolean
  actionLabel     : string
  actionColor     : string
}

export interface LeadIntelligenceInput {
  created_at          : string
  last_contacted_at   : string | null
  ai_score            : number | null
  lead_temperature    : LeadTemperature | null
  lead_stage          : LeadStage | null
  escalation_required : boolean
  next_follow_up_at   : string | null
}

const ACTION_LABELS: Record<NextAction, { label: string; color: string }> = {
  call_immediately  : { label: 'Call Now',        color: 'text-red-600'     },
  send_proposal     : { label: 'Send Proposal',   color: 'text-purple-600'  },
  schedule_visit    : { label: 'Schedule Visit',  color: 'text-orange-600'  },
  re_engage         : { label: 'Re-engage',       color: 'text-amber-600'   },
  close_lead        : { label: 'Close Deal',      color: 'text-emerald-600' },
  mark_stale        : { label: 'Mark Stale',      color: 'text-gray-400'    },
  send_followup     : { label: 'Follow Up',       color: 'text-blue-600'    },
  awaiting_response : { label: 'Awaiting Reply',  color: 'text-gray-500'    },
}

export function computeIntelligence(lead: LeadIntelligenceInput): LeadIntelligence {
  const now        = Date.now()
  const refTime    = lead.last_contacted_at ?? lead.created_at
  const hoursGone  = Math.floor((now - new Date(refTime).getTime()) / 3_600_000)
  const score      = lead.ai_score ?? 0
  const temp       = lead.lead_temperature
  const stage      = lead.lead_stage
  const hasProposal= stage === 'PROPOSAL_SENT' || stage === 'NEGOTIATING' || stage === 'VISIT_SCHEDULED' || stage === 'CONFIRMED'

  let nextAction    : NextAction     = 'send_followup'
  let followUpStatus: FollowUpStatus = 'on_track'
  let staleReason   : string | null  = null
  let isStale       = false
  let isOverdue     = false
  let urgencyScore  = score

  // ── Confirmed / Lost — terminal ───────────────────────────────────────────
  if (stage === 'CONFIRMED') {
    return {
      nextAction: 'close_lead', followUpStatus: 'confirmed',
      urgencyScore: 0, staleReason: null,
      hoursWithoutContact: hoursGone, isStale: false, isOverdue: false,
      actionLabel: 'Confirmed', actionColor: 'text-emerald-600',
    }
  }
  if (stage === 'LOST') {
    return {
      nextAction: 'mark_stale', followUpStatus: 'stale',
      urgencyScore: 0, staleReason: 'Lead marked lost',
      hoursWithoutContact: hoursGone, isStale: true, isOverdue: false,
      actionLabel: 'Lost', actionColor: 'text-gray-400',
    }
  }

  // ── HOT lead rules ────────────────────────────────────────────────────────
  if (temp === 'HOT') {
    if (hoursGone > 24) {
      nextAction    = 'call_immediately'
      followUpStatus= 'overdue'
      staleReason   = `No contact for ${hoursGone}h`
      isStale       = hoursGone > 48
      isOverdue     = true
      urgencyScore  += 40
    } else if (hoursGone > 4) {
      nextAction    = 'send_followup'
      followUpStatus= 'due_today'
      urgencyScore  += 20
    }
  }

  // ── No response > 72 hours ────────────────────────────────────────────────
  if (hoursGone > 72 && !isStale) {
    nextAction    = 're_engage'
    followUpStatus= 'no_response'
    staleReason   = `No response in ${Math.floor(hoursGone / 24)} days`
    isStale       = hoursGone > 120
    urgencyScore  += 15
  }

  // ── Stage-based rules ─────────────────────────────────────────────────────
  if (stage === 'QUALIFIED' && !hasProposal) {
    nextAction    = 'send_proposal'
    urgencyScore  += 30
  }
  if (stage === 'PROPOSAL_SENT') {
    const proposalHours = hoursGone
    if (proposalHours > 120) {  // > 5 days
      nextAction    = 'send_followup'
      followUpStatus= 'overdue'
      staleReason   = 'Proposal sent 5+ days ago, no response'
      isOverdue     = true
      urgencyScore  += 25
    } else {
      nextAction    = 'awaiting_response'
    }
  }
  if (stage === 'VISIT_SCHEDULED') {
    nextAction  = 'close_lead'
    urgencyScore += 35
  }
  if (score >= 80 && (stage === 'NEW' || stage === 'CONTACTED')) {
    nextAction    = 'call_immediately'
    urgencyScore  += 20
  }

  // ── Escalation boost ──────────────────────────────────────────────────────
  if (lead.escalation_required) urgencyScore += 50

  // ── Overdue follow-up from scheduler ─────────────────────────────────────
  if (lead.next_follow_up_at && new Date(lead.next_follow_up_at) <= new Date()) {
    followUpStatus = 'overdue'
    isOverdue      = true
    urgencyScore   += 20
  }

  return {
    nextAction, followUpStatus, staleReason,
    isStale, isOverdue,
    hoursWithoutContact: hoursGone,
    urgencyScore       : Math.min(urgencyScore, 100),
    actionLabel        : ACTION_LABELS[nextAction].label,
    actionColor        : ACTION_LABELS[nextAction].color,
  }
}
