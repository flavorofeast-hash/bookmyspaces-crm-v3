import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = {
  lead: null as Record<string, unknown> | null,
  proposals: [] as Record<string, unknown>[],
  reservations: [] as Record<string, unknown>[],
  reservationsError: null as { message: string } | null,
  unifiedMessages: [] as Record<string, unknown>[],
  unifiedMessagesError: null as { message: string } | null,
  settingsRows: [] as Record<string, unknown>[],
  settingsError: null as { message: string } | null,
  mealPlans: [] as Record<string, unknown>[],
  addonServices: [] as Record<string, unknown>[],
  packages: [] as Record<string, unknown>[],
}

const mocks = vi.hoisted(() => ({
  getActivePackagePrices: vi.fn(),
  checkSystemPromptPricingDrift: vi.fn(),
  retrieveKnowledgeByVector: vi.fn(),
}))

vi.mock('@/lib/pricing/pricing-service', () => ({
  getActivePackagePrices: mocks.getActivePackagePrices,
  checkSystemPromptPricingDrift: mocks.checkSystemPromptPricingDrift,
}))

vi.mock('@/lib/knowledge/knowledge-retrieval', () => ({
  retrieveKnowledgeByVector: mocks.retrieveKnowledgeByVector,
}))

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table === 'leads') {
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: state.lead }) }) }) }
      }
      if (table === 'proposals') {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => Promise.resolve({ data: state.proposals, error: null }),
              }),
            }),
          }),
        }
      }
      if (table === 'reservations') {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => Promise.resolve({ data: state.reservations, error: state.reservationsError }),
              }),
            }),
          }),
        }
      }
      if (table === 'unified_messages') {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => Promise.resolve({ data: state.unifiedMessages, error: state.unifiedMessagesError }),
              }),
            }),
          }),
        }
      }
      if (table === 'settings') {
        return {
          select: () => ({
            eq: () => Promise.resolve({ data: state.settingsRows, error: state.settingsError }),
          }),
        }
      }
      // Priority 1 (AI Sales Executive) — upsell inventory. Mirrors
      // property-service.ts's listActiveMealPlans/listActiveAddonServices
      // query shape (no propertyId arg from context-builder.ts, so no
      // second .eq()); the query object itself is the awaited thenable.
      if (table === 'meal_plans') {
        return {
          select: () => ({
            eq: () => ({
              order: () => Promise.resolve({ data: state.mealPlans, error: null }),
            }),
          }),
        }
      }
      if (table === 'addon_services') {
        return {
          select: () => ({
            eq: () => ({
              order: () => Promise.resolve({ data: state.addonServices, error: null }),
            }),
          }),
        }
      }
      // Direct Event Sales Engine, Section 2 — event-type-aware package
      // catalog (src/lib/packages/package-service.ts's listPackages(),
      // default activeOnly:true call shape: select -> order -> eq).
      if (table === 'packages') {
        return {
          select: () => ({
            order: () => ({
              eq: () => Promise.resolve({ data: state.packages, error: null }),
            }),
          }),
        }
      }
      throw new Error(`unexpected table: ${table}`)
    },
  }),
}))

import { buildAIContext } from './context-builder'

function resetState() {
  state.lead = null
  state.proposals = []
  state.reservations = []
  state.reservationsError = null
  state.unifiedMessages = []
  state.unifiedMessagesError = null
  state.settingsRows = []
  state.settingsError = null
  state.mealPlans = []
  state.addonServices = []
  state.packages = []
}

describe('buildAIContext', () => {
  beforeEach(() => {
    resetState()
    mocks.getActivePackagePrices.mockReset().mockResolvedValue([
      { name: 'Gold', basePrice: 50000, maxGuests: 100, durationHours: 6, isPopular: true },
    ])
    mocks.checkSystemPromptPricingDrift.mockReset().mockResolvedValue([])
    mocks.retrieveKnowledgeByVector.mockReset().mockResolvedValue([
      { id: 'k1', content: 'Skyline Serenity has 12 rooms', sourceFile: 'faq.md', category: 'property', similarity: 0.8 },
    ])
  })

  it('returns an unidentified-visitor context when leadId is null', async () => {
    const ctx = await buildAIContext({ leadId: null, query: 'do you have rooftop venues' })

    expect(ctx.customerProfile).toEqual({ leadId: null, name: null, phone: null, email: null, status: null, hasConflictingIdentifier: false })
    expect(ctx.proposalHistory).toEqual([])
    expect(ctx.reservationHistory).toEqual([])
    expect(ctx.activePackages).toHaveLength(1)
    expect(ctx.knowledgeBaseResults).toHaveLength(1)
    expect(ctx.businessRules.isLiveConfig).toBe(false)
    expect(ctx.businessRules.cancellationWindowHours).toBe(48)
  })

  it('assembles full context for a known lead with live proposal history', async () => {
    state.lead = {
      id: 'lead-1', name: 'Arijit Banerjee', phone: '919051459463', email: 'arijit@example.com',
      status: 'proposal_sent', event_type: 'wedding', guest_count: 150, venue: 'monurama', special_requirements: 'vegetarian catering',
    }
    state.proposals = [
      { id: 'prop-1', proposal_number: 'BMS-2026-001', package_name: 'Gold', total_price: '50000.00', status: 'sent', created_at: '2026-07-01T10:00:00Z' },
    ]

    const ctx = await buildAIContext({ leadId: 'lead-1', query: 'what is the status of my proposal' })

    expect(ctx.customerProfile.name).toBe('Arijit Banerjee')
    expect(ctx.customerPreferences).toEqual({
      preferredEventType: 'wedding', preferredGuestCount: 150, preferredVenue: 'monurama', notes: 'vegetarian catering',
    })
    expect(ctx.proposalHistory).toEqual([
      { id: 'prop-1', proposalNumber: 'BMS-2026-001', packageName: 'Gold', totalPrice: 50000, status: 'sent', createdAt: '2026-07-01T10:00:00Z' },
    ])
    expect(ctx.degraded.reservationHistory).toBe(false)
    expect(ctx.degraded.conversationHistory).toBe(false)
  })

  it('marks reservationHistory degraded (not thrown) when the reservations table errors', async () => {
    state.lead = { id: 'lead-1', name: 'X', phone: null, email: null, status: null, event_type: null, guest_count: null, venue: null, special_requirements: null }
    state.reservationsError = { message: 'relation "reservations" does not exist' }

    const ctx = await buildAIContext({ leadId: 'lead-1', query: 'availability' })

    expect(ctx.reservationHistory).toEqual([])
    expect(ctx.degraded.reservationHistory).toBe(true)
    // Other sections still populate despite the reservations failure
    expect(ctx.activePackages).toHaveLength(1)
  })

  it('pulls conversation history when a conversationId is supplied', async () => {
    state.unifiedMessages = [
      { direction: 'inbound', sender_type: 'customer', content: 'Hi, is Skyline available?', created_at: '2026-07-13T10:00:00Z' },
      { direction: 'outbound', sender_type: 'ai', content: 'Yes! What dates work for you?', created_at: '2026-07-13T10:01:00Z' },
    ]

    const ctx = await buildAIContext({ leadId: null, query: 'availability', conversationId: 'conv-1' })

    expect(ctx.conversationHistory).toEqual([
      { role: 'user', content: 'Hi, is Skyline available?', timestamp: '2026-07-13T10:00:00Z' },
      { role: 'assistant', content: 'Yes! What dates work for you?', timestamp: '2026-07-13T10:01:00Z' },
    ])
  })

  it('uses live settings for business rules when present', async () => {
    state.settingsRows = [
      { key: 'cancellationWindowHours', value: 72 },
      { key: 'advancePaymentPercent', value: 25 },
    ]

    const ctx = await buildAIContext({ leadId: null, query: 'cancellation policy' })

    expect(ctx.businessRules).toEqual({
      cancellationWindowHours: 72,
      advancePaymentPercent: 25,
      checkInTime: '14:00',
      checkOutTime: '11:00',
      isLiveConfig: true,
    })
  })

  it('includes pricing drift findings from the Pricing Engine', async () => {
    mocks.checkSystemPromptPricingDrift.mockResolvedValue([{ packageName: 'Gold', hardcodedPrice: 50000, livePrice: 55000 }])

    const ctx = await buildAIContext({ leadId: null, query: 'pricing' })

    expect(ctx.pricing.pricingDrift).toEqual([{ packageName: 'Gold', hardcodedPrice: 50000, livePrice: 55000 }])
  })
})
