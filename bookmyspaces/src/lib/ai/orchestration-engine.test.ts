import { describe, it, expect, vi } from 'vitest'
import type { AIContext, BuildAIContextInput } from '@/types/ai-context'
import { ConversationState } from '@/constants/conversation-states'
import type { OrchestrationInput } from './orchestration-engine'

// Same dependency mocks as tool-registry.test.ts (this engine imports the
// registry, which imports every service) plus context-builder itself,
// mocked directly so tests control exactly what "assembled context" looks
// like without needing a real Supabase/OpenAI/Anthropic connection.
vi.mock('@/lib/supabase', () => ({ getSupabaseAdmin: () => ({ from: () => ({ select: () => ({}) }) }) }))
vi.mock('@/lib/sheets', () => ({ syncLeadToSheets: () => Promise.resolve(), initializeSheet: () => Promise.resolve() }))
vi.mock('@/lib/whatsapp/send-message', () => ({ sendWhatsAppText: () => Promise.resolve({ success: true }), sendWhatsAppTemplateSimple: () => Promise.resolve({ success: true }) }))
vi.mock('@/lib/whatsapp/meta-configured', () => ({ isMetaConfigured: () => false }))
vi.mock('@/lib/settings/settings-service', () => ({ getSettingsSection: () => Promise.resolve({}) }))

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

// IMPORTANT: `vi.mock()` factories are hoisted by Vitest above every
// top-level statement in this file, including this `const`. The factory
// below must therefore never reference `buildAIContextMock` directly as a
// *value* at factory-execution time (e.g. `{ buildAIContext: buildAIContextMock }`)
// -- that would evaluate the identifier immediately, while it is still in
// its temporal dead zone, and throw "Cannot access 'buildAIContextMock'
// before initialization". Wrapping it in a nested arrow function defers
// that reference until the mock is actually *called*, which only happens
// later, once this module has finished loading and `buildAIContextMock` is
// initialized. The wrapper takes one concrete, typed parameter (not a
// `...args: unknown[]` spread) so it also satisfies `buildAIContextMock`'s
// inferred single-parameter signature under `strict` -- an untyped spread
// into a non-rest-parameter call is a real `tsc` error (TS2556).
const buildAIContextMock = vi.fn(async (_input?: BuildAIContextInput) => emptyAIContext)
vi.mock('@/lib/ai/context-builder', () => ({
  buildAIContext: (input: BuildAIContextInput) => buildAIContextMock(input),
}))

import { orchestrate } from './orchestration-engine'

const settings = { confidenceThreshold: 0.6, autoHandoff: true }

/** Hardening Sprint, High Issue 4 -- every orchestrate() call must carry these five fields. */
const mandatory = {
  channel: 'whatsapp' as const,
  direction: 'inbound' as const,
  messageId: 'wamid.test-1',
  conversationId: null as string | null,
  source: 'customer' as const,
}

describe('orchestrate', () => {
  describe('inbound guard (Critical Issue 2 + High Issue 4 + Security) -- runs before any I/O', () => {
    it('rejects an outbound message without ever calling buildAIContext (outbound loop protection)', async () => {
      buildAIContextMock.mockClear()
      const result = await orchestrate({
        ...mandatory,
        direction: 'outbound',
        leadId: null,
        message: 'hi',
        conversationState: ConversationState.NEW_INQUIRY,
        aiSettings: settings,
      })
      expect(result.allowed).toBe(false)
      if (!result.allowed) expect(result.rejectionReason).toBe('not_inbound_direction')
      expect(buildAIContextMock).not.toHaveBeenCalled()
    })

    it('rejects an AI-generated reply echoed back in as new input, without calling buildAIContext', async () => {
      buildAIContextMock.mockClear()
      const result = await orchestrate({
        ...mandatory,
        source: 'ai',
        leadId: null,
        message: 'Thanks for reaching out!',
        conversationState: ConversationState.NEW_INQUIRY,
        aiSettings: settings,
      })
      expect(result.allowed).toBe(false)
      if (!result.allowed) expect(result.rejectionReason).toBe('non_customer_source')
      expect(buildAIContextMock).not.toHaveBeenCalled()
    })

    it('rejects a duplicated webhook delivery (idempotency)', async () => {
      const result = await orchestrate({
        ...mandatory,
        isDuplicateDelivery: true,
        leadId: null,
        message: 'hi again',
        conversationState: ConversationState.NEW_INQUIRY,
        aiSettings: settings,
      })
      expect(result.allowed).toBe(false)
      if (!result.allowed) expect(result.rejectionReason).toBe('duplicate_delivery')
    })

    it('rejects a replay event', async () => {
      const result = await orchestrate({
        ...mandatory,
        isReplayEvent: true,
        leadId: null,
        message: 'hi again',
        conversationState: ConversationState.NEW_INQUIRY,
        aiSettings: settings,
      })
      expect(result.allowed).toBe(false)
      if (!result.allowed) expect(result.rejectionReason).toBe('replay_event')
    })

    it('rejects input missing the mandatory channel field', async () => {
      const malformed = { ...mandatory, channel: undefined, leadId: null, message: 'hi', conversationState: ConversationState.NEW_INQUIRY, aiSettings: settings } as unknown as OrchestrationInput
      const result = await orchestrate(malformed)
      expect(result.allowed).toBe(false)
      if (!result.allowed) expect(result.rejectionReason).toBe('missing_required_field')
    })

    it('rejects input missing the mandatory direction field', async () => {
      const malformed = { ...mandatory, direction: undefined, leadId: null, message: 'hi', conversationState: ConversationState.NEW_INQUIRY, aiSettings: settings } as unknown as OrchestrationInput
      const result = await orchestrate(malformed)
      expect(result.allowed).toBe(false)
      if (!result.allowed) expect(result.rejectionReason).toBe('missing_required_field')
    })

    it('rejects an empty/invalid message body', async () => {
      const result = await orchestrate({
        ...mandatory, leadId: null, message: '   ', conversationState: ConversationState.NEW_INQUIRY, aiSettings: settings,
      })
      expect(result.allowed).toBe(false)
      if (!result.allowed) expect(result.rejectionReason).toBe('empty_message')
    })
  })

  it('calls buildAIContext with the resolved leadId, message, conversationId, and the computed skip flag (delegates, does not re-implement)', async () => {
    buildAIContextMock.mockClear()
    await orchestrate({
      ...mandatory,
      leadId: 'lead-123',
      conversationId: 'conv-456',
      message: 'Need a hall for 100 guests',
      conversationState: ConversationState.NEW_INQUIRY,
      aiSettings: settings,
    })
    expect(buildAIContextMock).toHaveBeenCalledWith({
      leadId: 'lead-123',
      query: 'Need a hall for 100 guests',
      conversationId: 'conv-456',
      skipExpensiveRetrieval: true, // required slots still missing this turn
    })
  })

  it('an existing handoff trigger in the message overrides everything else', async () => {
    const result = await orchestrate({
      ...mandatory,
      leadId: null,
      message: 'This is unacceptable, I want a refund now',
      conversationState: ConversationState.QUALIFIED,
      aiSettings: settings,
    })
    expect(result.allowed).toBe(true)
    if (result.allowed) {
      expect(result.handoffReason).not.toBeNull()
      expect(result.decision.action).toBe('handoff_to_human')
      expect(result.tool.sourceExport).toBe('applyHandoff')
    }
  })

  it('never asks for a slot the CRM tier already has -- missingSlots excludes it and the action is not collect_missing_information for that field', async () => {
    const result = await orchestrate({
      ...mandatory,
      leadId: 'lead-1',
      message: 'What about pricing?',
      conversationState: ConversationState.WAITING_FOR_EVENT_DATE,
      aiSettings: settings,
      crmSlots: { eventType: 'WEDDING', eventDate: '2026-12-14', guestCount: 150 },
    })
    expect(result.allowed).toBe(true)
    if (result.allowed) {
      expect(result.slots.missingSlots).toEqual([])
      expect(result.slots.filledBy.eventType).toBe('crm')
    }
  })

  it('a fresh message with a missing required slot resolves to collect_missing_information (now regardless of conversation state -- High Issue 2)', async () => {
    const result = await orchestrate({
      ...mandatory,
      leadId: null,
      message: 'Need a banquet hall for 120 people next Saturday',
      conversationState: ConversationState.WAITING_FOR_GUEST_COUNT,
      aiSettings: settings,
    })
    expect(result.allowed).toBe(true)
    if (result.allowed) {
      // extractLeadDetails will find guest_count=120 from the message itself,
      // so only eventDate remains missing ("next Saturday" is not parsed into
      // a real date by the regex extractor) -- still a real missing slot.
      expect(result.slots.missingSlots).toContain('eventDate')
      expect(result.decision.action).toBe('collect_missing_information')
      expect(result.tool.sourceExport).toBe('chatWithAI')
    }
  })

  it('resolves a real tool reference for whatever action is decided -- never returns an unregistered action', async () => {
    const result = await orchestrate({
      ...mandatory,
      leadId: 'lead-1',
      message: 'What is the price for a wedding package?',
      conversationState: ConversationState.QUALIFIED,
      aiSettings: settings,
      crmSlots: { eventType: 'WEDDING', eventDate: '2026-12-14', guestCount: 150 },
    })
    expect(result.allowed).toBe(true)
    if (result.allowed) {
      expect(result.decision.action).toBe('generate_quotation')
      expect(result.tool.sourceExport).toBe('getActivePackagePrices')
      expect(typeof result.tool.fn).toBe('function')
    }
  })

  it('does not invoke the resolved tool itself -- coordination only, per the Phase 1A rule', async () => {
    // generate_proposal's real tool (createProposalFromReservation) would
    // reject/throw against the minimal Supabase mock above if it were ever
    // actually called (it expects a real reservation row). orchestrate()
    // completing successfully and returning a plain reference -- not a
    // result of calling it -- is the proof this engine only decides and
    // never executes.
    const result = await orchestrate({
      ...mandatory,
      leadId: 'lead-1',
      message: 'I want to book now, please confirm the booking',
      conversationState: ConversationState.QUALIFIED,
      aiSettings: settings,
      crmSlots: { eventType: 'WEDDING', eventDate: '2026-12-14', guestCount: 150 },
      hasPackageRecommendation: true,
    })
    expect(result.allowed).toBe(true)
    if (result.allowed) {
      expect(result.decision.action).toBe('generate_proposal')
      expect(result.tool.sourceExport).toBe('createProposalFromReservation')
      // The result carries a reference to the tool, not the tool's own output --
      // there is no "executionResult"/"toolResult" field on OrchestrationSuccess.
      expect(result).not.toHaveProperty('executionResult')
      expect(result).not.toHaveProperty('toolResult')
    }
  })

  describe('deriving leadExists/hasProposal/hasPackageRecommendation from AIContext (High Issue 3)', () => {
    it('derives all three from the built AIContext when the caller supplies no overrides', async () => {
      buildAIContextMock.mockImplementationOnce(async () => ({
        ...emptyAIContext,
        customerProfile: { ...emptyAIContext.customerProfile, leadId: 'lead-9' },
        proposalHistory: [
          { id: 'p1', proposalNumber: 'BMS-1', packageName: 'Gold', totalPrice: 50000, status: 'draft', createdAt: '2026-01-01' },
        ],
      }))
      const result = await orchestrate({
        ...mandatory,
        leadId: 'lead-9',
        message: 'I want to book now, please confirm the booking',
        conversationState: ConversationState.QUALIFIED,
        aiSettings: settings,
        crmSlots: { eventType: 'WEDDING', eventDate: '2026-12-14', guestCount: 150 },
        // no hasPackageRecommendation / hasProposal / leadExists passed
      })
      expect(result.allowed).toBe(true)
      if (result.allowed) {
        // leadExists derived true, hasPackageRecommendation derived true (a
        // proposal with a packageName exists), hasProposal derived true --
        // ready_to_book with both already present routes to schedule_follow_up.
        expect(result.decision.action).toBe('schedule_follow_up')
      }
    })

    it('an explicit override still wins over the derived AIContext value', async () => {
      buildAIContextMock.mockImplementationOnce(async () => emptyAIContext) // no lead, no proposals
      const result = await orchestrate({
        ...mandatory,
        leadId: null,
        message: 'I want to book now, please confirm the booking',
        conversationState: ConversationState.QUALIFIED,
        aiSettings: settings,
        crmSlots: { eventType: 'WEDDING', eventDate: '2026-12-14', guestCount: 150 },
        hasPackageRecommendation: true,
      })
      expect(result.allowed).toBe(true)
      if (result.allowed) expect(result.decision.action).toBe('generate_proposal')
    })
  })

  describe('performance: skip expensive AIContext retrieval when the decision is already determined (Performance)', () => {
    it('skips when a handoff trigger already fires', async () => {
      buildAIContextMock.mockClear()
      await orchestrate({
        ...mandatory,
        leadId: null,
        message: 'This is unacceptable, I want a refund now',
        conversationState: ConversationState.QUALIFIED,
        aiSettings: settings,
      })
      expect(buildAIContextMock).toHaveBeenCalledWith(expect.objectContaining({ skipExpensiveRetrieval: true }))
    })

    it('does not skip when the decision genuinely depends on business data', async () => {
      buildAIContextMock.mockClear()
      await orchestrate({
        ...mandatory,
        leadId: 'lead-1',
        message: 'What is the price for a wedding package?',
        conversationState: ConversationState.QUALIFIED,
        aiSettings: settings,
        crmSlots: { eventType: 'WEDDING', eventDate: '2026-12-14', guestCount: 150 },
      })
      expect(buildAIContextMock).toHaveBeenCalledWith(expect.objectContaining({ skipExpensiveRetrieval: false }))
    })
  })

  it('surfaces slot conflicts from slot-memory.ts for downstream confirmation (Critical Issue 1)', async () => {
    const result = await orchestrate({
      ...mandatory,
      leadId: 'lead-1',
      message: 'Actually we now need 150 guests',
      conversationState: ConversationState.QUALIFIED,
      aiSettings: settings,
      crmSlots: { eventType: 'WEDDING', eventDate: '2026-12-14', guestCount: 50 },
    })
    expect(result.allowed).toBe(true)
    if (result.allowed) {
      expect(result.slots.hasConflicts).toBe(true)
      expect(result.slots.conflicts[0]).toMatchObject({ slot: 'guestCount', crmValue: 50, customerValue: 150 })
    }
  })
})
