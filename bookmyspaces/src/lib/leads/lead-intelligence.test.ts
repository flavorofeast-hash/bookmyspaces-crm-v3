import { describe, it, expect } from 'vitest'
import { computeIntelligence, type LeadIntelligenceInput } from './lead-intelligence'

function baseLead(overrides: Partial<LeadIntelligenceInput> = {}): LeadIntelligenceInput {
  return {
    created_at: new Date().toISOString(),
    last_contacted_at: new Date().toISOString(), // "just now" by default
    ai_score: 50,
    lead_temperature: 'WARM',
    lead_stage: 'CONTACTED',
    escalation_required: false,
    next_follow_up_at: null,
    ...overrides,
  }
}

function hoursAgo(h: number): string {
  return new Date(Date.now() - h * 3_600_000).toISOString()
}

describe('computeIntelligence', () => {
  it('CONFIRMED is terminal — Confirmed action, zero urgency, no further rules applied', () => {
    const result = computeIntelligence(baseLead({ lead_stage: 'CONFIRMED', escalation_required: true, ai_score: 100 }))
    expect(result).toMatchObject({
      nextAction: 'close_lead', followUpStatus: 'confirmed', urgencyScore: 0,
      isStale: false, isOverdue: false, actionLabel: 'Confirmed',
    })
  })

  it('LOST is terminal — Lost action, marked stale', () => {
    const result = computeIntelligence(baseLead({ lead_stage: 'LOST' }))
    expect(result).toMatchObject({ nextAction: 'mark_stale', followUpStatus: 'stale', isStale: true, actionLabel: 'Lost' })
  })

  it('a HOT lead with no contact in 25h+ needs an immediate call and is overdue', () => {
    const result = computeIntelligence(baseLead({ lead_temperature: 'HOT', last_contacted_at: hoursAgo(25) }))
    expect(result.nextAction).toBe('call_immediately')
    expect(result.followUpStatus).toBe('overdue')
    expect(result.isOverdue).toBe(true)
  })

  it('a HOT lead untouched past 48h is flagged stale as well as overdue', () => {
    const result = computeIntelligence(baseLead({ lead_temperature: 'HOT', last_contacted_at: hoursAgo(50) }))
    expect(result.isStale).toBe(true)
  })

  it('a HOT lead contacted 4-24h ago just needs a routine follow-up today', () => {
    const result = computeIntelligence(baseLead({ lead_temperature: 'HOT', last_contacted_at: hoursAgo(10) }))
    expect(result.nextAction).toBe('send_followup')
    expect(result.followUpStatus).toBe('due_today')
  })

  it('no response for 72h+ triggers re-engage, and past 120h is also stale', () => {
    const under = computeIntelligence(baseLead({ lead_temperature: 'COLD', last_contacted_at: hoursAgo(80) }))
    expect(under.nextAction).toBe('re_engage')
    expect(under.followUpStatus).toBe('no_response')
    expect(under.isStale).toBe(false)

    const over = computeIntelligence(baseLead({ lead_temperature: 'COLD', last_contacted_at: hoursAgo(130) }))
    expect(over.isStale).toBe(true)
  })

  it('a QUALIFIED lead without a proposal yet should be sent one', () => {
    const result = computeIntelligence(baseLead({ lead_stage: 'QUALIFIED', lead_temperature: 'COLD' }))
    expect(result.nextAction).toBe('send_proposal')
  })

  it('PROPOSAL_SENT under 5 days is just awaiting a response', () => {
    const result = computeIntelligence(baseLead({ lead_stage: 'PROPOSAL_SENT', lead_temperature: 'COLD', last_contacted_at: hoursAgo(48) }))
    expect(result.nextAction).toBe('awaiting_response')
  })

  it('PROPOSAL_SENT past 5 days with no response needs a follow-up and is overdue', () => {
    const result = computeIntelligence(baseLead({ lead_stage: 'PROPOSAL_SENT', lead_temperature: 'COLD', last_contacted_at: hoursAgo(140) }))
    expect(result.nextAction).toBe('send_followup')
    expect(result.followUpStatus).toBe('overdue')
    expect(result.isOverdue).toBe(true)
  })

  it('VISIT_SCHEDULED means the deal is ready to close', () => {
    const result = computeIntelligence(baseLead({ lead_stage: 'VISIT_SCHEDULED', lead_temperature: 'COLD' }))
    expect(result.nextAction).toBe('close_lead')
  })

  it('a fresh NEW/CONTACTED lead scoring 80+ should be called immediately regardless of temperature', () => {
    const result = computeIntelligence(baseLead({ lead_stage: 'NEW', lead_temperature: 'COLD', ai_score: 85 }))
    expect(result.nextAction).toBe('call_immediately')
  })

  it('escalation_required always boosts urgency, even for an otherwise calm lead', () => {
    const calm = computeIntelligence(baseLead({ escalation_required: false }))
    const escalated = computeIntelligence(baseLead({ escalation_required: true }))
    expect(escalated.urgencyScore).toBeGreaterThan(calm.urgencyScore)
  })

  it('an overdue next_follow_up_at (in the past) marks the lead overdue even if otherwise on track', () => {
    const result = computeIntelligence(baseLead({ next_follow_up_at: hoursAgo(1) }))
    expect(result.followUpStatus).toBe('overdue')
    expect(result.isOverdue).toBe(true)
  })

  it('a future next_follow_up_at does not mark the lead overdue', () => {
    const future = new Date(Date.now() + 24 * 3_600_000).toISOString()
    const result = computeIntelligence(baseLead({ next_follow_up_at: future }))
    expect(result.isOverdue).toBe(false)
  })

  it('urgencyScore is always clamped to a maximum of 100', () => {
    const result = computeIntelligence(baseLead({
      lead_temperature: 'HOT', last_contacted_at: hoursAgo(200), escalation_required: true,
      next_follow_up_at: hoursAgo(1), ai_score: 100,
    }))
    expect(result.urgencyScore).toBeLessThanOrEqual(100)
  })

  it('every nextAction value maps to a non-empty actionLabel and actionColor', () => {
    const stages: Array<LeadIntelligenceInput['lead_stage']> = ['NEW', 'CONTACTED', 'QUALIFIED', 'NEGOTIATING', 'PROPOSAL_SENT', 'VISIT_SCHEDULED', 'CONFIRMED', 'LOST']
    for (const stage of stages) {
      const result = computeIntelligence(baseLead({ lead_stage: stage }))
      expect(result.actionLabel.length).toBeGreaterThan(0)
      expect(result.actionColor.length).toBeGreaterThan(0)
    }
  })
})
