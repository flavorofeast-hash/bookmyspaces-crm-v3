// src/lib/leads/pipeline-stage.ts
// ─────────────────────────────────────────────────────────────────────────────
// Derives the REAL business-pipeline stage for a lead from its related
// proposals / site visits / reservations, instead of relying solely on
// leads.status / leads.lead_stage (which only change on explicit user action
// and can lag behind reality — e.g. a proposal already exists but the lead
// list still shows "New Inquiry").
//
// Priority ladder (exact, as specified by the RC2 pipeline-hardening brief —
// highest priority first):
//   1. Reservation exists (active)  -> Confirmed
//   2. Reservation cancelled        -> Reservation Cancelled
//   3. Proposal Accepted            -> Won
//   4. Proposal Sent                -> Proposal Sent
//   5. Proposal Draft exists        -> Proposal Draft
//   6. Site Visit scheduled         -> Visit Scheduled
//   7. Site Visit completed         -> Visit Completed
//   8. otherwise                    -> existing Lead Stage (effectiveStage())
//
// This ladder is followed literally, including one counter-intuitive
// consequence worth flagging: a lead whose only reservation was cancelled
// reports "Reservation Cancelled" even if it separately has an accepted
// proposal (rung 2 outranks rung 3). That's what the brief's explicit
// ordering says; if that's not the intended precedence, it's isolated to
// the branch order below. See docs/LEAD_PIPELINE_REPORT.md.
//
// Interpretation notes:
//   - "Reservation exists" (rung 1) reads as an ACTIVE reservation
//     (confirmed / checked_in / checked_out) — a pending "inquiry" or
//     "tentative" reservation is not yet a booking and falls through to the
//     proposal/visit rungs instead.
//   - "Reservation cancelled" (rung 2) covers `cancelled` and `no_show`.
//   - proposals.status is bucketed: accepted -> Won; sent/viewed/followed_up
//     -> Proposal Sent; draft/generated -> Proposal Draft. `rejected`/
//     `expired` proposals don't match any bucket and fall through.
//   - "Site Visit completed" (rung 7) is any follow_ups row with
//     type='site_visit', status='completed'.
// ─────────────────────────────────────────────────────────────────────────────

import { effectiveStage, type LeadStage } from '@/modules/leads/types'

export type DerivedBusinessStage =
  | 'CONFIRMED'
  | 'RESERVATION_CANCELLED'
  | 'WON'
  | 'PROPOSAL_SENT'
  | 'PROPOSAL_DRAFT'
  | 'VISIT_SCHEDULED'
  | 'VISIT_COMPLETED'
  | LeadStage

export interface ProposalForStage {
  id: string
  proposal_number: string | null
  share_token: string | null
  status: string
  total_price: number | null
  created_at: string
}

export interface VisitForStage {
  id: string
  status: string
  scheduled_at: string
}

export interface ReservationForStage {
  id: string
  status: string
}

export interface DeriveStageInput {
  lead: { lead_stage?: string | null; status?: string | null }
  proposals?: ProposalForStage[] | null
  visits?: VisitForStage[] | null
  reservations?: ReservationForStage[] | null
}

export interface DeriveStageResult {
  stage: DerivedBusinessStage
  primaryProposal: ProposalForStage | null
  proposalCount: number
  hasScheduledVisit: boolean
  hasCompletedVisit: boolean
  /** The specific pending visit (if any) — use this id for Reschedule/
   *  Complete actions, NOT `latestVisit`, which may be a completed visit
   *  dated later than a still-pending one. */
  scheduledVisit: VisitForStage | null
  completedVisit: VisitForStage | null
  latestVisit: VisitForStage | null
  hasActiveReservation: boolean
  hasCancelledReservation: boolean
  hasAnyReservation: boolean
  reservationStatus: string | null
  reservationId: string | null
}

const ACTIVE_RESERVATION_STATUSES = new Set(['confirmed', 'checked_in', 'checked_out'])
const CANCELLED_RESERVATION_STATUSES = new Set(['cancelled', 'no_show'])
const SENT_PROPOSAL_STATUSES = new Set(['sent', 'viewed', 'followed_up'])
const DRAFT_PROPOSAL_STATUSES = new Set(['draft', 'generated'])

function mostRecent<T extends { created_at: string }>(rows: T[]): T | null {
  if (rows.length === 0) return null
  return rows.reduce((a, b) => (new Date(b.created_at) > new Date(a.created_at) ? b : a))
}

export function deriveBusinessStage(input: DeriveStageInput): DeriveStageResult {
  const proposals = input.proposals ?? []
  const visits = input.visits ?? []
  const reservations = input.reservations ?? []

  const activeReservation = reservations.find((r) => ACTIVE_RESERVATION_STATUSES.has(r.status)) ?? null
  const cancelledReservation = reservations.find((r) => CANCELLED_RESERVATION_STATUSES.has(r.status)) ?? null
  const anyReservation = reservations[0] ?? null

  const acceptedProposal = mostRecent(proposals.filter((p) => p.status === 'accepted'))
  const sentProposal = mostRecent(proposals.filter((p) => SENT_PROPOSAL_STATUSES.has(p.status)))
  const draftProposal = mostRecent(proposals.filter((p) => DRAFT_PROPOSAL_STATUSES.has(p.status)))
  const scheduledVisit = mostRecent(
    visits
      .filter((v) => v.status === 'pending')
      .map((v) => ({ ...v, created_at: v.scheduled_at }))
  )
  const completedVisit = mostRecent(
    visits
      .filter((v) => v.status === 'completed')
      .map((v) => ({ ...v, created_at: v.scheduled_at }))
  )

  let stage: DerivedBusinessStage
  let primaryProposal: ProposalForStage | null = null

  if (activeReservation) {
    stage = 'CONFIRMED'
    primaryProposal = acceptedProposal ?? sentProposal ?? draftProposal ?? null
  } else if (cancelledReservation) {
    stage = 'RESERVATION_CANCELLED'
    primaryProposal = acceptedProposal ?? sentProposal ?? draftProposal ?? null
  } else if (acceptedProposal) {
    stage = 'WON'
    primaryProposal = acceptedProposal
  } else if (sentProposal) {
    stage = 'PROPOSAL_SENT'
    primaryProposal = sentProposal
  } else if (draftProposal) {
    stage = 'PROPOSAL_DRAFT'
    primaryProposal = draftProposal
  } else if (scheduledVisit) {
    stage = 'VISIT_SCHEDULED'
  } else if (completedVisit) {
    stage = 'VISIT_COMPLETED'
  } else {
    stage = effectiveStage(input.lead)
  }

  return {
    stage,
    primaryProposal,
    proposalCount: proposals.length,
    hasScheduledVisit: !!scheduledVisit,
    hasCompletedVisit: !!completedVisit,
    scheduledVisit,
    completedVisit,
    latestVisit: mostRecent(visits.map((v) => ({ ...v, created_at: v.scheduled_at }))),
    hasActiveReservation: !!activeReservation,
    hasCancelledReservation: !!cancelledReservation,
    hasAnyReservation: reservations.length > 0,
    reservationStatus: (activeReservation ?? cancelledReservation ?? anyReservation)?.status ?? null,
    reservationId: (activeReservation ?? cancelledReservation ?? anyReservation)?.id ?? null,
  }
}

// ─── Badge metadata — consistent colours across the Lead Management table ────
// Palette matches STAGE_PIPELINE (modules/leads/types.ts) for the stages that
// already have an established colour there; new derived-only stages (WON,
// PROPOSAL_DRAFT) use adjacent colours from the same palette family.

export const BUSINESS_STAGE_META: Record<DerivedBusinessStage, { label: string; color: string; bg: string }> = {
  CONFIRMED: { label: 'Confirmed ✓', color: '#16a34a', bg: '#f0fdf4' },
  RESERVATION_CANCELLED: { label: 'Cancelled', color: '#dc2626', bg: '#fef2f2' },
  WON: { label: 'Won', color: '#15803d', bg: '#f0fdf4' },
  PROPOSAL_SENT: { label: 'Proposal Sent', color: '#7c3aed', bg: '#f5f3ff' },
  PROPOSAL_DRAFT: { label: 'Proposal Draft', color: '#b45309', bg: '#fffbeb' },
  VISIT_SCHEDULED: { label: 'Visit Scheduled', color: '#d97706', bg: '#fffbeb' },
  VISIT_COMPLETED: { label: 'Visit Completed', color: '#0d9488', bg: '#f0fdfa' },
  NEW: { label: 'New Inquiry', color: '#2563eb', bg: '#eff6ff' },
  CONTACTED: { label: 'Contacted', color: '#0891b2', bg: '#ecfeff' },
  QUALIFIED: { label: 'Qualified', color: '#4f46e5', bg: '#eef2ff' },
  NEGOTIATING: { label: 'Negotiation', color: '#ea580c', bg: '#fff7ed' },
  LOST: { label: 'Lost', color: '#4b5563', bg: '#f9fafb' },
}

// Small, deliberately-scoped duplicate of proposals/page.tsx's local
// STATUS_CONFIG labels (not exported there). Not extracted into a shared
// module for this pass — doing so would require touching the working
// Proposals page, which is out of scope / higher risk for this mission
// ("Do NOT break ... Proposal Creation"). See docs/LEAD_PIPELINE_REPORT.md.
export const PROPOSAL_STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  generated: 'Generated',
  sent: 'Sent',
  viewed: 'Viewed',
  followed_up: 'Followed Up',
  accepted: 'Accepted',
  rejected: 'Rejected',
  expired: 'Expired',
}

const RESERVATION_STATUS_LABEL: Record<string, string> = {
  inquiry: 'Inquiry',
  tentative: 'Tentative',
  confirmed: 'Confirmed',
  checked_in: 'Checked In',
  checked_out: 'Checked Out',
  cancelled: 'Cancelled',
  no_show: 'No-show',
}

export function reservationStatusLabel(status: string | null): string | null {
  if (!status) return null
  return RESERVATION_STATUS_LABEL[status] ?? status
}

// Mirrors site-visit-service.ts's STATUS_LABEL exactly (same values, same
// labels) but declared here — that file imports getSupabaseAdmin() and is
// server-only, so it cannot be imported from a 'use client' page. This is a
// deliberately tiny duplicate (4 entries), not a rewrite of that module.
const VISIT_STATUS_LABEL: Record<string, string> = {
  pending: 'Scheduled',
  completed: 'Completed',
  skipped: 'No-show',
  rescheduled: 'Rescheduled',
}

export function visitStatusLabel(status: string | null): string | null {
  if (!status) return null
  return VISIT_STATUS_LABEL[status] ?? status
}
