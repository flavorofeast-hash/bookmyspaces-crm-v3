// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/ai/orchestration-executor.test.ts
// Phase 1B, Step 5 (audit/PHASE_1B_IMPLEMENTATION_BACKLOG.md,
// audit/PHASE_1B_STEP5_READINESS_REVIEW.md).
//
// Uses the REAL action-arguments.ts (Step 4, unmocked) so these tests
// exercise the actual integration point between Step 4 and Step 5, not a
// stand-in for it. Only the boundary this file's own logic doesn't own is
// mocked: tool-registry.ts's getTool() (so no real service/DB/googleapis
// call ever happens), orchestrator.ts's checkAndApplyHandoff(),
// unified-conversation-service.ts's recordMessage(), and @/lib/supabase
// (covers both action-arguments.ts's own notification_settings lookup and
// this file's orchestration_decisions insert).
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AIContext } from '@/types/ai-context'
import type { OrchestrationSuccess } from './orchestration-engine'
import type { OrchestrationAction } from './decision-table'
import type { SlotValues, SlotMergeResult } from './slot-memory'
import { EMPTY_SLOTS } from './slot-memory'

const dbState = {
  notificationSetting: null as { value: string } | null,
  insertedRows: [] as Record<string, unknown>[],
  insertError: null as { message: string } | null,
}

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table === 'notification_settings') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: dbState.notificationSetting }) }) }),
        }
      }
      if (table === 'orchestration_decisions') {
        return {
          insert: (row: Record<string, unknown>) => {
            dbState.insertedRows.push(row)
            return Promise.resolve({ error: dbState.insertError })
          },
        }
      }
      throw new Error(`unexpected table: ${table}`)
    },
  }),
}))

const toolFnMock = vi.fn(async (..._args: unknown[]): Promise<unknown> => ({ ok: true }))

vi.mock('@/lib/ai/tool-registry', () => ({
  getTool: (action: string) => ({
    action,
    fn: (...args: unknown[]) => toolFnMock(...args),
    sourceModule: 'mock',
    sourceExport: 'mock',
  }),
}))

const checkAndApplyHandoffMock = vi.fn(async (_input?: unknown) => ({ escalate: false, reason: null }))

vi.mock('@/lib/ai/orchestrator', () => ({
  checkAndApplyHandoff: (input: unknown) => checkAndApplyHandoffMock(input),
}))

const recordMessageMock = vi.fn(async (_input?: unknown) => 'msg-id')

vi.mock('@/lib/conversations/unified-conversation-service', () => ({
  recordMessage: (input: unknown) => recordMessageMock(input),
}))

import { executeOrchestration, type ExecutorContext } from './orchestration-executor'

beforeEach(() => {
  dbState.notificationSetting = null
  dbState.insertedRows = []
  dbState.insertError = null
  toolFnMock.mockClear()
  toolFnMock.mockImplementation(async () => ({ ok: true }))
  checkAndApplyHandoffMock.mockClear()
  recordMessageMock.mockClear()
  sendMock.mockClear()
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

function makeSlots(overrides: Partial<SlotValues> = {}, missingSlots: SlotMergeResult['missingSlots'] = [], hasConflicts = false): SlotMergeResult {
  return {
    slots: { ...EMPTY_SLOTS, ...overrides },
    filledBy: { eventType: null, eventDate: null, guestCount: null, budget: null, venue: null, specialRequirements: null },
    missingSlots,
    isQualified: missingSlots.length === 0,
    conflicts: hasConflicts ? [{
      slot: 'guestCount', crmValue: 50, customerValue: 150, customerValueSource: 'extracted',
      recommendedResolution: 'use_customer_value_pending_confirmation', resolutionRequired: true,
    }] : [],
    hasConflicts,
  }
}

function makeOutcome(overrides: {
  action: OrchestrationAction
  aiContext?: Partial<AIContext>
  slots?: SlotMergeResult
}): OrchestrationSuccess {
  return {
    allowed: true,
    aiContext: { ...emptyAIContext, ...overrides.aiContext },
    slots: overrides.slots ?? makeSlots(),
    intent: { intent: 'unclear', matchedSignals: [] },
    handoffReason: null,
    decision: { action: overrides.action, reason: 'test' },
    tool: {} as OrchestrationSuccess['tool'], // unused by this module -- see action-arguments.ts's own test file for the same convention
  }
}

const sendMock = vi.fn(async (_phone: string, _text: string) => ({ success: true }))

function makeCtx(overrides: Partial<ExecutorContext> = {}): ExecutorContext {
  return {
    mode: 'active',
    channel: 'whatsapp',
    channelId: 'channel-1',
    conversationId: 'conv-1',
    message: 'hello',
    send: sendMock,
    ...overrides,
  }
}

describe('executeOrchestration', () => {
  describe('shadow mode -- nothing executed, decision logged only', () => {
    it('answer_immediately (tool_call kind): no tool call, no send, no record, no handoff -- one decision row', async () => {
      const outcome = makeOutcome({ action: 'answer_immediately' })
      const result = await executeOrchestration(outcome, makeCtx({ mode: 'shadow' }))

      expect(toolFnMock).not.toHaveBeenCalled()
      expect(sendMock).not.toHaveBeenCalled()
      expect(recordMessageMock).not.toHaveBeenCalled()
      expect(checkAndApplyHandoffMock).not.toHaveBeenCalled()
      expect(result.replyText).toBeNull()
      expect(result.sideEffectsApplied).toEqual([])
      expect(dbState.insertedRows).toHaveLength(1)
      expect(dbState.insertedRows[0]).toMatchObject({ mode: 'shadow', action: 'answer_immediately', executed: false })
    })

    it('collect_missing_information (template_reply kind): no send even though a reply exists to send', async () => {
      const outcome = makeOutcome({ action: 'collect_missing_information', slots: makeSlots({}, ['eventType']) })
      const result = await executeOrchestration(outcome, makeCtx({ mode: 'shadow' }))

      expect(sendMock).not.toHaveBeenCalled()
      expect(result.replyText).toBeNull()
      expect(dbState.insertedRows[0]).toMatchObject({ mode: 'shadow', executed: false })
    })
  })

  describe('active mode -- tool_call kind', () => {
    it('answer_immediately: tool.fn return value IS the reply (its registered tool is chatWithAI)', async () => {
      toolFnMock.mockResolvedValueOnce('Sure, here are our packages!')
      const outcome = makeOutcome({
        action: 'answer_immediately',
        aiContext: { customerProfile: { ...emptyAIContext.customerProfile, phone: '919830509991' } },
      })
      const result = await executeOrchestration(outcome, makeCtx())

      expect(toolFnMock).toHaveBeenCalledTimes(1)
      expect(result.replyText).toBe('Sure, here are our packages!')
      expect(sendMock).toHaveBeenCalledWith('919830509991', 'Sure, here are our packages!')
      expect(recordMessageMock).toHaveBeenCalledTimes(1)
      expect(checkAndApplyHandoffMock).toHaveBeenCalledTimes(1)
      expect(dbState.insertedRows[0]).toMatchObject({ mode: 'active', action: 'answer_immediately', executed: true })
    })

    it('notify_staff: tool.fn is called (side effect applied) but its raw return value is NOT turned into a reply', async () => {
      dbState.notificationSetting = { value: '9830509991' }
      const outcome = makeOutcome({ action: 'notify_staff' })
      const result = await executeOrchestration(outcome, makeCtx())

      expect(toolFnMock).toHaveBeenCalledTimes(1)
      expect(result.replyText).toBeNull()
      expect(result.sideEffectsApplied).toEqual(['tool_call:notify_staff'])
      // No reply was produced, so nothing is sent/recorded/handed off, even
      // though the tool call itself succeeded -- this is the "never invent
      // messaging from raw tool data" rule, exercised end to end.
      expect(sendMock).not.toHaveBeenCalled()
      expect(recordMessageMock).not.toHaveBeenCalled()
      expect(checkAndApplyHandoffMock).not.toHaveBeenCalled()
      // "executed" reflects that a real side effect happened (the tool call
      // itself), independent of whether a customer reply was produced --
      // notify_staff genuinely ran, so this is true even with replyText null.
      expect(dbState.insertedRows[0]).toMatchObject({ executed: true })
    })

    it('a thrown/rejected tool.fn degrades to a structured result, never crashes', async () => {
      toolFnMock.mockRejectedValueOnce(new Error('service unavailable'))
      dbState.notificationSetting = { value: '9830509991' }
      const outcome = makeOutcome({ action: 'notify_staff' })
      const result = await executeOrchestration(outcome, makeCtx())

      expect(result.replyText).toBeNull()
      expect(result.sideEffectsApplied).toEqual(['tool_call_failed:notify_staff'])
      expect(dbState.insertedRows).toHaveLength(1) // decision still logged despite the failure
    })
  })

  describe('active mode -- template_reply kind', () => {
    it('sends the exact MESSAGES template, records it, and runs the handoff check', async () => {
      const outcome = makeOutcome({
        action: 'collect_missing_information',
        slots: makeSlots({}, ['guestCount']),
        aiContext: { customerProfile: { ...emptyAIContext.customerProfile, phone: '919830509991' } },
      })
      const result = await executeOrchestration(outcome, makeCtx())

      expect(toolFnMock).not.toHaveBeenCalled() // no tool call for a template reply
      expect(result.replyText).toContain('guests')
      expect(sendMock).toHaveBeenCalledWith('919830509991', result.replyText)
      expect(recordMessageMock).toHaveBeenCalledTimes(1)
      expect(checkAndApplyHandoffMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('active mode -- downgraded kind', () => {
    it('generate_proposal recurses into notify_staff\'s own result and records the downgrade', async () => {
      dbState.notificationSetting = { value: '9830509991' }
      const outcome = makeOutcome({ action: 'generate_proposal' })
      const result = await executeOrchestration(outcome, makeCtx())

      expect(result.sideEffectsApplied).toEqual(['downgraded:generate_proposal->notify_staff', 'tool_call:notify_staff'])
      expect(result.replyText).toBeNull() // notify_staff itself never produces a reply
      expect(result.reason).toContain('downgraded to notify_staff')
      expect(dbState.insertedRows[0]).toMatchObject({ action: 'generate_proposal' })
    })

    it('the downgrade itself safe-fails when the sub-result is also unavailable (no operator configured) -- the downgrade note is still recorded, even though nothing executed', async () => {
      dbState.notificationSetting = null
      const outcome = makeOutcome({ action: 'generate_proposal' })
      const result = await executeOrchestration(outcome, makeCtx())

      // The downgrade itself is always noted -- it's an honest record that a
      // redirect decision was made, independent of whether the redirected-to
      // action then succeeded. Never collapsed away, per this step's own rule.
      expect(result.sideEffectsApplied).toEqual(['downgraded:generate_proposal->notify_staff'])
      expect(result.replyText).toBeNull()
      expect(sendMock).not.toHaveBeenCalled()
    })
  })

  describe('active mode -- unavailable kind (EXPLICITLY not resolved by this step)', () => {
    it('check_room_availability with no inventoryItemId: no reply, no invented messaging, no side effect', async () => {
      const outcome = makeOutcome({ action: 'check_room_availability', slots: makeSlots({ eventDate: '2026-09-10' }) })
      const result = await executeOrchestration(outcome, makeCtx())

      expect(toolFnMock).not.toHaveBeenCalled()
      expect(sendMock).not.toHaveBeenCalled()
      expect(recordMessageMock).not.toHaveBeenCalled()
      expect(checkAndApplyHandoffMock).not.toHaveBeenCalled()
      expect(result.replyText).toBeNull()
      expect(result.sideEffectsApplied).toEqual([])
      expect(result.kind).toBe('unavailable')
      expect(dbState.insertedRows[0]).toMatchObject({ executed: false })
    })
  })

  describe('SlotConflict pass-through (Critical Issue 1 output reaching a durable log for the first time)', () => {
    it('forwards conflicts unchanged into the ExecutorResult and the orchestration_decisions row', async () => {
      const outcome = makeOutcome({ action: 'answer_immediately', slots: makeSlots({}, [], true) })
      const result = await executeOrchestration(outcome, makeCtx({ mode: 'shadow' }))

      expect(result.hadConflicts).toBe(true)
      expect(result.conflicts).toHaveLength(1)
      expect(result.conflicts[0]).toMatchObject({ slot: 'guestCount', crmValue: 50, customerValue: 150 })
      expect(dbState.insertedRows[0]).toMatchObject({ had_conflicts: true })
      expect(dbState.insertedRows[0].conflicts).toHaveLength(1)
    })
  })

  describe('decision logging failure is non-fatal', () => {
    it('still returns a valid result when the orchestration_decisions insert fails', async () => {
      dbState.insertError = { message: 'boom' }
      const outcome = makeOutcome({ action: 'answer_immediately' })
      const result = await executeOrchestration(outcome, makeCtx({ mode: 'shadow' }))

      expect(result.decisionRecorded).toBe(false)
      expect(result.action).toBe('answer_immediately') // the rest of the result is still valid
    })
  })
})
