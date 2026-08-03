import { describe, it, expect } from 'vitest'
import { deriveBusinessStage } from './pipeline-stage'
import type { ProposalForStage, VisitForStage, ReservationForStage } from './pipeline-stage'

function proposal(overrides: Partial<ProposalForStage> = {}): ProposalForStage {
  return {
    id: 'prop-1',
    proposal_number: 'BMS-2026-001',
    share_token: 'tok-abc123',
    status: 'draft',
    total_price: 50000,
    created_at: '2026-07-01T00:00:00.000Z',
    ...overrides,
  }
}

function visit(overrides: Partial<VisitForStage> = {}): VisitForStage {
  return {
    id: 'visit-1',
    status: 'pending',
    scheduled_at: '2026-07-05T00:00:00.000Z',
    ...overrides,
  }
}

function reservation(overrides: Partial<ReservationForStage> = {}): ReservationForStage {
  return {
    id: 'res-1',
    status: 'confirmed',
    ...overrides,
  }
}

describe('deriveBusinessStage', () => {
  it('Lead with no proposal — falls back to existing lead stage', () => {
    const result = deriveBusinessStage({
      lead: { lead_stage: 'CONTACTED', status: 'followup_pending' },
      proposals: [],
      visits: [],
      reservations: [],
    })
    expect(result.stage).toBe('CONTACTED')
    expect(result.primaryProposal).toBeNull()
  })

  it('Lead with proposal draft — stage is Proposal Draft', () => {
    const result = deriveBusinessStage({
      lead: { lead_stage: 'NEW', status: 'new_inquiry' },
      proposals: [proposal({ status: 'draft' })],
    })
    expect(result.stage).toBe('PROPOSAL_DRAFT')
    expect(result.primaryProposal?.id).toBe('prop-1')
  })

  it('Lead with proposal sent — stage is Proposal Sent (sent/viewed/followed_up all bucket here)', () => {
    const result = deriveBusinessStage({
      lead: { lead_stage: 'NEW', status: 'new_inquiry' },
      proposals: [proposal({ status: 'sent' })],
    })
    expect(result.stage).toBe('PROPOSAL_SENT')

    const viewed = deriveBusinessStage({
      lead: { lead_stage: 'NEW', status: 'new_inquiry' },
      proposals: [proposal({ status: 'viewed' })],
    })
    expect(viewed.stage).toBe('PROPOSAL_SENT')
  })

  it('Lead with scheduled visit (no proposal) — stage is Visit Scheduled', () => {
    const result = deriveBusinessStage({
      lead: { lead_stage: 'CONTACTED', status: 'followup_pending' },
      visits: [visit({ status: 'pending' })],
    })
    expect(result.stage).toBe('VISIT_SCHEDULED')
    expect(result.hasScheduledVisit).toBe(true)
  })

  it('Lead with reservation — stage is Confirmed regardless of proposal/visit state', () => {
    const result = deriveBusinessStage({
      lead: { lead_stage: 'NEGOTIATING', status: 'negotiation' },
      proposals: [proposal({ status: 'sent' })],
      visits: [visit({ status: 'pending' })],
      reservations: [reservation({ status: 'confirmed' })],
    })
    expect(result.stage).toBe('CONFIRMED')
    expect(result.hasActiveReservation).toBe(true)
    // Confirmed still surfaces the most relevant proposal for display
    expect(result.primaryProposal?.status).toBe('sent')
  })

  it('Lead with multiple proposals — accepted wins over sent/draft; most recent wins within a tier', () => {
    const accepted = deriveBusinessStage({
      lead: { lead_stage: 'NEW', status: 'new_inquiry' },
      proposals: [
        proposal({ id: 'p-old', status: 'draft', created_at: '2026-06-01T00:00:00.000Z' }),
        proposal({ id: 'p-sent', status: 'sent', created_at: '2026-06-15T00:00:00.000Z' }),
        proposal({ id: 'p-accepted', status: 'accepted', created_at: '2026-07-01T00:00:00.000Z' }),
      ],
    })
    expect(accepted.stage).toBe('WON')
    expect(accepted.primaryProposal?.id).toBe('p-accepted')
    expect(accepted.proposalCount).toBe(3)

    const twoDrafts = deriveBusinessStage({
      lead: { lead_stage: 'NEW', status: 'new_inquiry' },
      proposals: [
        proposal({ id: 'p-first', status: 'draft', created_at: '2026-06-01T00:00:00.000Z' }),
        proposal({ id: 'p-second', status: 'draft', created_at: '2026-06-20T00:00:00.000Z' }),
      ],
    })
    expect(twoDrafts.stage).toBe('PROPOSAL_DRAFT')
    expect(twoDrafts.primaryProposal?.id).toBe('p-second')
  })

  it('Lead with cancelled proposal — a rejected/expired proposal alone does not produce a pipeline stage', () => {
    const result = deriveBusinessStage({
      lead: { lead_stage: 'NEGOTIATING', status: 'negotiation' },
      proposals: [proposal({ status: 'rejected' })],
    })
    // rejected/expired aren't in the draft or sent buckets, so the ladder
    // falls through to the existing lead stage rather than misreporting
    // a live pipeline stage for a dead proposal.
    expect(result.stage).toBe('NEGOTIATING')
    expect(result.primaryProposal).toBeNull()
  })

  it('Lead with lost opportunity — no proposal/visit/reservation signals, lead_stage LOST passes through', () => {
    const result = deriveBusinessStage({
      lead: { lead_stage: 'LOST', status: 'rejected' },
      proposals: [proposal({ status: 'rejected' })],
    })
    expect(result.stage).toBe('LOST')
  })

  it('Cancelled reservation — stage is Reservation Cancelled, outranking an accepted proposal (rung 2 beats rung 3, per the exact priority ladder)', () => {
    const result = deriveBusinessStage({
      lead: { lead_stage: 'NEW', status: 'new_inquiry' },
      proposals: [proposal({ status: 'accepted' })],
      reservations: [reservation({ status: 'cancelled' })],
    })
    expect(result.stage).toBe('RESERVATION_CANCELLED')
    expect(result.hasActiveReservation).toBe(false)
    expect(result.hasCancelledReservation).toBe(true)
    expect(result.hasAnyReservation).toBe(true)
    expect(result.reservationStatus).toBe('cancelled')
    // Still surfaces the accepted proposal for display even though it
    // didn't win the stage.
    expect(result.primaryProposal?.status).toBe('accepted')
  })

  it('a no_show reservation is treated the same as cancelled', () => {
    const result = deriveBusinessStage({
      lead: { lead_stage: 'NEW', status: 'new_inquiry' },
      reservations: [reservation({ status: 'no_show' })],
    })
    expect(result.stage).toBe('RESERVATION_CANCELLED')
  })

  it('Lead + completed visit (no proposal, no active/cancelled reservation) — stage is Visit Completed', () => {
    const result = deriveBusinessStage({
      lead: { lead_stage: 'CONTACTED', status: 'followup_pending' },
      visits: [visit({ status: 'completed' })],
    })
    expect(result.stage).toBe('VISIT_COMPLETED')
    expect(result.hasCompletedVisit).toBe(true)
    expect(result.hasScheduledVisit).toBe(false)
  })

  it('a pending visit outranks an older completed visit for the same lead', () => {
    const result = deriveBusinessStage({
      lead: { lead_stage: 'NEW', status: 'new_inquiry' },
      visits: [
        visit({ id: 'v-old-completed', status: 'completed', scheduled_at: '2026-05-01T00:00:00.000Z' }),
        visit({ id: 'v-new-pending', status: 'pending', scheduled_at: '2026-07-10T00:00:00.000Z' }),
      ],
    })
    expect(result.stage).toBe('VISIT_SCHEDULED')
    expect(result.scheduledVisit?.id).toBe('v-new-pending')
    expect(result.completedVisit?.id).toBe('v-old-completed')
  })

  it('a tentative/inquiry reservation (not yet active or cancelled) does not override proposal signals', () => {
    const result = deriveBusinessStage({
      lead: { lead_stage: 'NEW', status: 'new_inquiry' },
      proposals: [proposal({ status: 'sent' })],
      reservations: [reservation({ status: 'tentative' })],
    })
    expect(result.stage).toBe('PROPOSAL_SENT')
  })
})
