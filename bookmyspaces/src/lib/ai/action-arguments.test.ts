// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/ai/action-arguments.test.ts
// Phase 1B, Step 4 (audit/PHASE_1B_IMPLEMENTATION_BACKLOG.md,
// audit/PHASE_1B_STEP4_READINESS_REVIEW.md).
//
// Pure unit tests -- no integration tests required (readiness review
// Section 9): action-arguments.ts is a library with zero live callers,
// its only real I/O (notify_staff's notification_settings lookup) is
// covered here with a mocked Supabase client, same convention as
// settings-service.test.ts / auto-responder.test.ts.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AIContext } from '@/types/ai-context'
import type { OrchestrationSuccess } from './orchestration-engine'
import type { OrchestrationAction } from './decision-table'
import type { SlotValues, SlotMergeResult } from './slot-memory'
import { EMPTY_SLOTS } from './slot-memory'

const mockDb = {
  notificationSetting: null as { value: string } | null,
}

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table !== 'notification_settings') throw new Error(`unexpected table: ${table}`)
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: mockDb.notificationSetting }),
          }),
        }),
      }
    },
  }),
}))

import { buildActionArguments, type ActionArgumentsContext } from './action-arguments'

beforeEach(() => {
  mockDb.notificationSetting = null
})

const emptyAIContext: AIContext = {
  customerProfile: { leadId: null, name: null, phone: null, email: null, status: null, hasConflictingIdentifier: false },
  conversationHistory: [],
  reservationHistory: [],
  proposalHistory: [],
  customerPreferences: { preferredEventType: null, preferredGuestCount: null, preferredVenue: null, notes: null },
  activePackages: [],
  upsellInventory: { mealPlans: [], addonServices: [] },
  eventPackages: [],
  knowledgeBaseResults: [],
  pricing: { activePackages: [], pricingDrift: [] },
  businessRules: { cancellationWindowHours: 48, advancePaymentPercent: 30, checkInTime: '14:00', checkOutTime: '11:00', isLiveConfig: false },
  degraded: { reservationHistory: false, conversationHistory: false, upsellInventory: false, eventPackages: false },
}

function makeSlots(overrides: Partial<SlotValues> = {}, missingSlots: SlotMergeResult['missingSlots'] = []): SlotMergeResult {
  return {
    slots: { ...EMPTY_SLOTS, ...overrides },
    filledBy: { eventType: null, eventDate: null, guestCount: null, budget: null, venue: null, specialRequirements: null },
    missingSlots,
    isQualified: missingSlots.length === 0,
    conflicts: [],
    hasConflicts: false,
  }
}

function makeOutcome(overrides: {
  action: OrchestrationAction
  aiContext?: Partial<AIContext>
  slots?: SlotMergeResult
  handoffReason?: OrchestrationSuccess['handoffReason']
  decisionReason?: string
}): OrchestrationSuccess {
  return {
    allowed: true,
    aiContext: { ...emptyAIContext, ...overrides.aiContext },
    slots: overrides.slots ?? makeSlots(),
    intent: { intent: 'unclear', matchedSignals: [] },
    handoffReason: overrides.handoffReason ?? null,
    decision: { action: overrides.action, reason: overrides.decisionReason ?? 'test' },
    // action-arguments.ts never reads `.tool` -- it derives everything it
    // needs from `.decision.action` instead (see its own file header: the
    // registered tool.fn is looked up by tool-registry.ts elsewhere, not by
    // this module). A minimal stand-in avoids pulling this test file into
    // tool-registry.ts's own import graph (which reaches captureLeadWithJourney
    // -> googleapis, a dependency chain already documented elsewhere in this
    // project as slow to resolve in this sandbox) for something never used.
    tool: {} as OrchestrationSuccess['tool'],
  }
}

function makeCtx(overrides: Partial<ActionArgumentsContext> & { outcome: OrchestrationSuccess }): ActionArgumentsContext {
  return {
    channel: 'whatsapp',
    conversationId: 'conv-1',
    message: 'test message',
    ...overrides,
  }
}

describe('buildActionArguments', () => {
  describe('handoff_to_human', () => {
    it('builds applyHandoff args when a real HandoffReason is present', async () => {
      const outcome = makeOutcome({
        action: 'handoff_to_human',
        aiContext: { customerProfile: { ...emptyAIContext.customerProfile, leadId: 'lead-1' } },
        handoffReason: 'complaint',
      })
      const result = await buildActionArguments(makeCtx({ outcome }))
      expect(result.kind).toBe('tool_call')
      if (result.kind === 'tool_call') {
        expect(result.args[0]).toMatchObject({ conversationId: 'conv-1', leadId: 'lead-1', reason: 'complaint' })
      }
    })

    it('safe-fails (does not invent a HandoffReason) when decision-table fired without one', async () => {
      const outcome = makeOutcome({
        action: 'handoff_to_human',
        handoffReason: null,
        decisionReason: 'conversation already escalated',
      })
      const result = await buildActionArguments(makeCtx({ outcome }))
      expect(result.kind).toBe('unavailable')
      if (result.kind === 'unavailable') {
        expect(result.reason).toContain('HandoffReason')
      }
    })
  })

  describe('collect_missing_information / ask_question', () => {
    it('resolves eventType to ASK_EVENT_TYPE', async () => {
      const outcome = makeOutcome({ action: 'collect_missing_information', slots: makeSlots({}, ['eventType']) })
      const result = await buildActionArguments(makeCtx({ outcome }))
      expect(result.kind).toBe('template_reply')
      if (result.kind === 'template_reply') expect(result.replyText).toContain('type of event')
    })

    it('resolves eventDate to ASK_EVENT_DATE', async () => {
      const outcome = makeOutcome({ action: 'collect_missing_information', slots: makeSlots({}, ['eventDate']) })
      const result = await buildActionArguments(makeCtx({ outcome }))
      expect(result.kind).toBe('template_reply')
      if (result.kind === 'template_reply') expect(result.replyText).toContain('date')
    })

    it('resolves guestCount to ASK_GUEST_COUNT', async () => {
      const outcome = makeOutcome({ action: 'collect_missing_information', slots: makeSlots({}, ['guestCount']) })
      const result = await buildActionArguments(makeCtx({ outcome }))
      expect(result.kind).toBe('template_reply')
      if (result.kind === 'template_reply') expect(result.replyText).toContain('guests')
    })

    it('collect_missing_information safe-fails when no slot is actually missing', async () => {
      const outcome = makeOutcome({ action: 'collect_missing_information', slots: makeSlots({}, []) })
      const result = await buildActionArguments(makeCtx({ outcome }))
      expect(result.kind).toBe('unavailable')
    })

    it('ask_question safe-fails on its only realistic path (no missing slot -- unreachable via decision-table.ts today)', async () => {
      const outcome = makeOutcome({ action: 'ask_question', slots: makeSlots({}, []) })
      const result = await buildActionArguments(makeCtx({ outcome }))
      expect(result.kind).toBe('unavailable')
      if (result.kind === 'unavailable') expect(result.reason).toContain('ask_question')
    })
  })

  describe('check_room_availability / check_banquet_availability', () => {
    it('safe-fails when no inventoryItemId is supplied -- never guesses one', async () => {
      const outcome = makeOutcome({ action: 'check_room_availability', slots: makeSlots({ eventDate: '2026-09-10' }) })
      const result = await buildActionArguments(makeCtx({ outcome }))
      expect(result.kind).toBe('unavailable')
      if (result.kind === 'unavailable') expect(result.reason).toContain('inventoryItemId')
    })

    it('builds checkAvailability args when inventoryItemId and eventDate are both known', async () => {
      const outcome = makeOutcome({ action: 'check_room_availability', slots: makeSlots({ eventDate: '2026-09-10' }) })
      const result = await buildActionArguments(makeCtx({ outcome, inventoryItemId: 'item-1' }))
      expect(result.kind).toBe('tool_call')
      if (result.kind === 'tool_call') expect(result.args).toEqual(['item-1', '2026-09-10', '2026-09-10'])
    })

    it('check_banquet_availability follows the same rule (safe-fail without an id)', async () => {
      const outcome = makeOutcome({ action: 'check_banquet_availability', slots: makeSlots({ eventDate: '2026-09-10' }) })
      const result = await buildActionArguments(makeCtx({ outcome }))
      expect(result.kind).toBe('unavailable')
    })

    it('safe-fails when eventDate is unknown, even with a resolved inventoryItemId', async () => {
      const outcome = makeOutcome({ action: 'check_room_availability', slots: makeSlots({}) })
      const result = await buildActionArguments(makeCtx({ outcome, inventoryItemId: 'item-1' }))
      expect(result.kind).toBe('unavailable')
    })
  })

  describe('generate_quotation', () => {
    it('calls getActivePackagePrices() with no arguments (corrected from the original design doc assumption)', async () => {
      const outcome = makeOutcome({ action: 'generate_quotation' })
      const result = await buildActionArguments(makeCtx({ outcome }))
      expect(result.kind).toBe('tool_call')
      if (result.kind === 'tool_call') expect(result.args).toEqual([])
    })
  })

  describe('recommend_package', () => {
    it('builds args with leadId + conversationId', async () => {
      const outcome = makeOutcome({ action: 'recommend_package', aiContext: { customerProfile: { ...emptyAIContext.customerProfile, leadId: 'lead-1' } } })
      const result = await buildActionArguments(makeCtx({ outcome, conversationId: 'conv-9' }))
      expect(result.kind).toBe('tool_call')
      if (result.kind === 'tool_call') expect(result.args).toEqual(['lead-1', 'conv-9'])
    })

    it('safe-fails without a leadId', async () => {
      const outcome = makeOutcome({ action: 'recommend_package' })
      const result = await buildActionArguments(makeCtx({ outcome }))
      expect(result.kind).toBe('unavailable')
    })
  })

  describe('generate_proposal', () => {
    it('always downgrades to notify_staff -- never attempts createProposalFromReservation()', async () => {
      mockDb.notificationSetting = { value: '9830509991' }
      const outcome = makeOutcome({
        action: 'generate_proposal',
        aiContext: { customerProfile: { ...emptyAIContext.customerProfile, name: 'Priya', phone: '919830509991' } },
        slots: makeSlots({ eventType: 'Wedding', guestCount: 150 }),
      })
      const result = await buildActionArguments(makeCtx({ outcome }))
      expect(result.kind).toBe('downgraded')
      if (result.kind === 'downgraded') {
        expect(result.downgradedTo).toBe('notify_staff')
        expect(result.result.kind).toBe('tool_call')
      }
    })

    it('the downgraded result itself safe-fails if no operator number is configured', async () => {
      mockDb.notificationSetting = null
      const outcome = makeOutcome({ action: 'generate_proposal' })
      const result = await buildActionArguments(makeCtx({ outcome }))
      expect(result.kind).toBe('downgraded')
      if (result.kind === 'downgraded') expect(result.result.kind).toBe('unavailable')
    })
  })

  describe('create_lead / update_lead', () => {
    it('builds captureLeadWithJourney args with a traceable, channel-derived source and sendWelcome:false', async () => {
      const outcome = makeOutcome({
        action: 'create_lead',
        aiContext: { customerProfile: { ...emptyAIContext.customerProfile, name: 'Priya', phone: '919830509991', email: null } },
        slots: makeSlots({ eventType: 'Wedding' }),
      })
      const result = await buildActionArguments(makeCtx({ outcome, channel: 'whatsapp' }))
      expect(result.kind).toBe('tool_call')
      if (result.kind === 'tool_call') {
        expect(result.args[0]).toMatchObject({
          name: 'Priya',
          phone: '919830509991',
          source: 'orchestration_whatsapp',
          eventType: 'Wedding',
          sendWelcome: false,
        })
      }
    })

    it('update_lead uses the same builder, action set correctly', async () => {
      const outcome = makeOutcome({ action: 'update_lead' })
      const result = await buildActionArguments(makeCtx({ outcome }))
      expect(result.kind).toBe('tool_call')
      expect(result.action).toBe('update_lead')
    })
  })

  describe('notify_staff', () => {
    it('builds enqueueMessage args with the 91-prefixed operator number when configured', async () => {
      mockDb.notificationSetting = { value: '9830509991' }
      const outcome = makeOutcome({
        action: 'notify_staff',
        aiContext: { customerProfile: { ...emptyAIContext.customerProfile, name: 'Priya', phone: '919999999999' } },
        slots: makeSlots({ eventType: 'Wedding', guestCount: 150 }),
      })
      const result = await buildActionArguments(makeCtx({ outcome }))
      expect(result.kind).toBe('tool_call')
      if (result.kind === 'tool_call') {
        const args = result.args[0] as { phone: string; message: string }
        expect(args.phone).toBe('919830509991')
        expect(args.message).toContain('Priya')
        expect(args.message).toContain('Wedding')
      }
    })

    it('safe-fails when no operator number is configured', async () => {
      mockDb.notificationSetting = null
      const outcome = makeOutcome({ action: 'notify_staff' })
      const result = await buildActionArguments(makeCtx({ outcome }))
      expect(result.kind).toBe('unavailable')
    })
  })

  describe('schedule_follow_up', () => {
    it('safe-fails without a followUpMessage -- never invents new customer-facing copy', async () => {
      const outcome = makeOutcome({
        action: 'schedule_follow_up',
        aiContext: { customerProfile: { ...emptyAIContext.customerProfile, phone: '919830509991' } },
      })
      const result = await buildActionArguments(makeCtx({ outcome }))
      expect(result.kind).toBe('unavailable')
    })

    it('safe-fails without a customer phone', async () => {
      const outcome = makeOutcome({ action: 'schedule_follow_up' })
      const result = await buildActionArguments(makeCtx({ outcome, followUpMessage: 'Just checking in!' }))
      expect(result.kind).toBe('unavailable')
    })

    it('builds enqueueMessage args when both are present', async () => {
      const outcome = makeOutcome({
        action: 'schedule_follow_up',
        aiContext: { customerProfile: { ...emptyAIContext.customerProfile, phone: '919830509991' } },
      })
      const result = await buildActionArguments(makeCtx({ outcome, followUpMessage: 'Just checking in!' }))
      expect(result.kind).toBe('tool_call')
      if (result.kind === 'tool_call') expect(result.args[0]).toMatchObject({ phone: '919830509991', message: 'Just checking in!' })
    })
  })

  describe('answer_immediately', () => {
    it('builds chatWithAI args: prior history + the current message', async () => {
      const outcome = makeOutcome({
        action: 'answer_immediately',
        aiContext: {
          conversationHistory: [
            { role: 'user', content: 'hi', timestamp: null },
            { role: 'assistant', content: 'hello!', timestamp: null },
          ],
        },
      })
      const result = await buildActionArguments(makeCtx({ outcome, message: 'what are your prices?' }))
      expect(result.kind).toBe('tool_call')
      if (result.kind === 'tool_call') {
        expect(result.args[0]).toEqual([{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello!' }])
        expect(result.args[1]).toBe('what are your prices?')
      }
    })
  })

  describe('dispatch exhaustiveness', () => {
    const allActions: OrchestrationAction[] = [
      'handoff_to_human', 'ask_question', 'collect_missing_information',
      'check_room_availability', 'check_banquet_availability', 'generate_quotation',
      'recommend_package', 'generate_proposal', 'create_lead', 'update_lead',
      'notify_staff', 'schedule_follow_up', 'answer_immediately',
    ]

    it('produces a result (never throws) for every registered OrchestrationAction', async () => {
      for (const action of allActions) {
        const outcome = makeOutcome({ action })
        const result = await buildActionArguments(makeCtx({ outcome }))
        expect(result.action).toBe(action)
      }
    })
  })
})
