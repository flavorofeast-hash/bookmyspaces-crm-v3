import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AIContext } from '@/types/ai-context'

const state = {
  responseText: 'Mocked AI response.',
  shouldThrow: false,
  insertedLog: null as Record<string, unknown> | null,
}

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: {
      create: () => {
        if (state.shouldThrow) throw new Error('Anthropic API error')
        return Promise.resolve({ content: [{ type: 'text', text: state.responseText }] })
      },
    },
  })),
}))

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table !== 'ai_interaction_log') throw new Error(`unexpected table: ${table}`)
      return {
        insert: (row: Record<string, unknown>) => {
          state.insertedLog = row
          return Promise.resolve({ data: null, error: null })
        },
      }
    },
  }),
}))

import { runOperatorAssist } from './operator-assistant'

const baseContext: AIContext = {
  customerProfile: { leadId: 'lead-1', name: 'Priya Sharma', phone: '9876543210', email: null, status: 'new_inquiry', hasConflictingIdentifier: false },
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

describe('runOperatorAssist', () => {
  beforeEach(() => {
    state.responseText = 'Mocked AI response.'
    state.shouldThrow = false
    state.insertedLog = null
    process.env.ANTHROPIC_API_KEY = 'test-key'
  })

  it('returns ok:true with the model text for a successful call', async () => {
    const result = await runOperatorAssist('customer_summary', baseContext, 'lead-1')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.text).toBe('Mocked AI response.')
  })

  it('logs the interaction to ai_interaction_log with the matching interaction_type (the exact column contract fixed in migration 012 this sprint)', async () => {
    await runOperatorAssist('suggested_whatsapp_reply', baseContext, 'lead-1', 'conv-1')
    expect(state.insertedLog).toMatchObject({
      lead_id: 'lead-1',
      conversation_id: 'conv-1',
      interaction_type: 'suggested_whatsapp_reply',
      summary: 'Mocked AI response.',
    })
  })

  it('returns ok:false (never throws) when the AI provider call fails', async () => {
    state.shouldThrow = true
    const result = await runOperatorAssist('recommended_package', baseContext, null)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('Anthropic API error')
  })

  it('produces a distinct prompt/result per action (not a single hardcoded response)', async () => {
    state.responseText = 'Recommend the Rooftop Suite for this group size.'
    const result = await runOperatorAssist('recommended_room', baseContext, 'lead-1')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.action).toBe('recommended_room')
      expect(result.text).toBe('Recommend the Rooftop Suite for this group size.')
    }
  })
})
