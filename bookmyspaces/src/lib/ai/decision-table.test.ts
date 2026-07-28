import { describe, it, expect } from 'vitest'
import { decideNextAction, type DecisionInput } from './decision-table'
import { ConversationState } from '@/constants/conversation-states'

const base: DecisionInput = {
  conversationState: ConversationState.QUALIFIED,
  missingSlots: [],
  intent: 'unclear',
  confidence: 0.9,
  confidenceThreshold: 0.6,
}

describe('decideNextAction', () => {
  it('rule 1: an existing handoff reason always wins, regardless of anything else', () => {
    const result = decideNextAction({
      ...base,
      handoffReason: 'complaint',
      intent: 'ready_to_book',
      confidence: 0.99,
    })
    expect(result.action).toBe('handoff_to_human')
    expect(result.reason).toContain('complaint')
  })

  it('rule 2: low confidence escalates even with no other trigger', () => {
    const result = decideNextAction({ ...base, confidence: 0.2 })
    expect(result.action).toBe('handoff_to_human')
  })

  it('rule 3: an already-escalated conversation stays escalated', () => {
    const result = decideNextAction({ ...base, conversationState: ConversationState.HANDOFF_TO_OPERATOR })
    expect(result.action).toBe('handoff_to_human')
  })

  it('rule 4: missing slots in a collecting state -> collect_missing_information (never ask twice for known data)', () => {
    const result = decideNextAction({
      ...base,
      conversationState: ConversationState.WAITING_FOR_EVENT_DATE,
      missingSlots: ['eventDate', 'guestCount'],
    })
    expect(result.action).toBe('collect_missing_information')
    expect(result.reason).toContain('eventDate')
  })

  it('rule 4 does not fire once slots are empty, even in a collecting state', () => {
    const result = decideNextAction({
      ...base,
      conversationState: ConversationState.WAITING_FOR_EVENT_DATE,
      missingSlots: [],
    })
    expect(result.action).not.toBe('collect_missing_information')
  })

  it('Hardening Sprint fix (High Issue 2): missing slots ask for info even OUTSIDE a collecting state -- ' +
     'a rule requiring complete information (e.g. price_request/generate_quotation) must never run while a mandatory slot is missing', () => {
    const result = decideNextAction({
      ...base,
      conversationState: ConversationState.QUALIFIED, // NOT a collecting state
      missingSlots: ['guestCount'],
      intent: 'price_request', // would otherwise route straight to generate_quotation
    })
    expect(result.action).toBe('collect_missing_information')
    expect(result.reason).toContain('guestCount')
  })

  it('Hardening Sprint fix: the old "ask_question" rule is unreachable dead code and has been removed -- ' +
     'unclear intent with missing slots now always resolves via the (broadened) missing-slots rule, never ask_question', () => {
    const result = decideNextAction({ ...base, intent: 'unclear', missingSlots: ['eventDate'] })
    expect(result.action).toBe('collect_missing_information')
    expect(result.action).not.toBe('ask_question')
  })

  it('rule 5: availability_check routes to room by default, banquet when specified', () => {
    expect(decideNextAction({ ...base, intent: 'availability_check' }).action).toBe('check_room_availability')
    expect(decideNextAction({ ...base, intent: 'availability_check', inventoryCategory: 'banquet' }).action)
      .toBe('check_banquet_availability')
  })

  it('rule 6: price_request -> generate_quotation', () => {
    expect(decideNextAction({ ...base, intent: 'price_request' }).action).toBe('generate_quotation')
  })

  it('rule 7: ready_to_book progresses recommend_package -> generate_proposal -> schedule_follow_up', () => {
    expect(decideNextAction({ ...base, intent: 'ready_to_book' }).action).toBe('recommend_package')
    expect(decideNextAction({ ...base, intent: 'ready_to_book', hasPackageRecommendation: true }).action)
      .toBe('generate_proposal')
    expect(decideNextAction({
      ...base, intent: 'ready_to_book', hasPackageRecommendation: true, hasProposal: true,
    }).action).toBe('schedule_follow_up')
  })

  it('rule 8: site_visit_request -> notify_staff', () => {
    expect(decideNextAction({ ...base, intent: 'site_visit_request' }).action).toBe('notify_staff')
  })

  it('rule 9: comparison_shopping and hesitation -> schedule_follow_up', () => {
    expect(decideNextAction({ ...base, intent: 'comparison_shopping' }).action).toBe('schedule_follow_up')
    expect(decideNextAction({ ...base, intent: 'hesitation' }).action).toBe('schedule_follow_up')
  })

  it('rule 10: complete slots, unclear intent, no CRM record yet -> create_lead', () => {
    expect(decideNextAction({ ...base, intent: 'unclear', leadExists: false }).action).toBe('create_lead')
  })

  it('Hardening Sprint fix (High Issue 2): rule 11 (answer_immediately) is reachable again -- ' +
     'previously permanently shadowed by a blanket update_lead fallback, so a fully-qualified customer ' +
     'saying something conversational got a silent CRM re-write and no reply, every time', () => {
    const result = decideNextAction({ ...base, intent: 'unclear', leadExists: true })
    expect(result.action).toBe('answer_immediately')
    expect(result.action).not.toBe('update_lead')
  })

  it('rule ordering: an earlier rule always wins over a later one that would also match', () => {
    // handoffReason (rule 1) beats missing slots (rule 4) beats a specific intent rule (rule 6/7/etc).
    const handoffWins = decideNextAction({
      ...base, handoffReason: 'complaint', missingSlots: ['eventDate'], intent: 'price_request',
    })
    expect(handoffWins.action).toBe('handoff_to_human')

    const missingSlotsWins = decideNextAction({
      ...base, missingSlots: ['eventDate'], intent: 'price_request',
    })
    expect(missingSlotsWins.action).toBe('collect_missing_information')
  })

  it('is a pure function -- same input always produces the same output', () => {
    const input: DecisionInput = { ...base, intent: 'price_request' }
    const first = decideNextAction(input)
    const second = decideNextAction(input)
    expect(first).toEqual(second)
  })
})
