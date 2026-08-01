import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/social/dm-responder.test.ts
// Version 2.0 — Omnichannel Communication Platform.
//
// Verifies respondToSocialDirectMessage() reuses the SAME chatWithAI/
// SYSTEM_PROMPT every other channel uses (no channel-specific prompt), the
// ai_active safety gate (never reply into a human-handled conversation,
// same check as the WhatsApp orchestration path), and that it records the
// outbound message + runs the same escalation policy as every other channel.
// ─────────────────────────────────────────────────────────────────────────────

const state = {
  conversationRow: { ai_active: true } as { ai_active: boolean } | null,
  history: [] as Array<{ direction: string; sender_type: string; content: string | null }>,
  chatWithAIResult: 'Sure, our Rooftop package starts at Rs42000 for 60 guests!',
  sendResult: { ok: true, externalMessageId: 'ext-msg-1' } as { ok: boolean; externalMessageId?: string; error?: string },
  recordedMessages: [] as Record<string, unknown>[],
  handoffCalls: [] as Record<string, unknown>[],
}

function resetState() {
  state.conversationRow = { ai_active: true }
  state.history = []
  state.chatWithAIResult = 'Sure, our Rooftop package starts at Rs42000 for 60 guests!'
  state.sendResult = { ok: true, externalMessageId: 'ext-msg-1' }
  state.recordedMessages = []
  state.handoffCalls = []
}

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table === 'unified_conversations') {
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: state.conversationRow, error: null }) }) }) }
      }
      if (table === 'unified_messages') {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => Promise.resolve({ data: state.history, error: null }),
              }),
            }),
          }),
        }
      }
      throw new Error(`unexpected table in dm-responder test: ${table}`)
    },
  }),
}))

const chatWithAIMock = vi.fn((..._args: unknown[]) => Promise.resolve(state.chatWithAIResult))
vi.mock('@/lib/ai', () => ({
  chatWithAI: (...args: unknown[]) => chatWithAIMock(...args),
}))

vi.mock('@/lib/conversations/unified-conversation-service', () => ({
  recordMessage: (input: Record<string, unknown>) => {
    state.recordedMessages.push(input)
    return Promise.resolve('recorded-id')
  },
}))

const checkAndApplyHandoffMock = vi.fn((_input: Record<string, unknown>) => Promise.resolve({ escalate: false }))
vi.mock('@/lib/ai/orchestrator', () => ({
  checkAndApplyHandoff: (input: Record<string, unknown>) => {
    state.handoffCalls.push(input)
    return checkAndApplyHandoffMock(input)
  },
  estimateConfidence: (reply: string) => (reply.length < 20 ? 0.5 : 0.9),
}))

vi.mock('@/lib/social/dm-send', () => ({
  sendMetaDirectMessage: (...args: unknown[]) => Promise.resolve(state.sendResult),
}))

import { respondToSocialDirectMessage } from './dm-responder'
import type { MessagingEvent } from './meta-lead-capture'

function makeEvent(overrides: Partial<MessagingEvent> = {}): MessagingEvent {
  return {
    senderPsid: 'psid-123',
    text: 'Do you have packages for a 60 guest wedding?',
    timestamp: Date.now(),
    externalMessageId: 'wamid-1',
    platform: 'facebook',
    ...overrides,
  }
}

describe('respondToSocialDirectMessage', () => {
  beforeEach(() => {
    resetState()
    chatWithAIMock.mockClear()
    checkAndApplyHandoffMock.mockClear()
  })

  it('calls chatWithAI — the exact same function/SYSTEM_PROMPT website chat uses, no channel-specific prompt', async () => {
    const result = await respondToSocialDirectMessage(makeEvent(), 'conv-1', 'chan-1', 'lead-1')

    expect(result.replied).toBe(true)
    expect(chatWithAIMock).toHaveBeenCalledTimes(1)
    // Second arg is the raw user query; third is campaign context (null for DMs).
    const [, userQuery, campaignContext] = chatWithAIMock.mock.calls[0]
    expect(userQuery).toBe('Do you have packages for a 60 guest wedding?')
    expect(campaignContext).toBeNull()
  })

  it('sends the AI reply via the Meta Send API and records it as an outbound "ai" message in the same unified store every channel uses', async () => {
    await respondToSocialDirectMessage(makeEvent(), 'conv-1', 'chan-1', 'lead-1')

    expect(state.recordedMessages).toHaveLength(1)
    expect(state.recordedMessages[0]).toMatchObject({
      conversationId: 'conv-1',
      channelId: 'chan-1',
      direction: 'outbound',
      senderType: 'ai',
      content: state.chatWithAIResult,
      externalMessageId: 'ext-msg-1',
    })
  })

  it('runs the same escalation policy (checkAndApplyHandoff) as every other channel — not a channel-specific one', async () => {
    await respondToSocialDirectMessage(makeEvent(), 'conv-1', 'chan-1', 'lead-1')

    expect(state.handoffCalls).toHaveLength(1)
    expect(state.handoffCalls[0]).toMatchObject({
      conversationId: 'conv-1',
      leadId: 'lead-1',
      customerText: 'Do you have packages for a 60 guest wedding?',
      aiReply: state.chatWithAIResult,
    })
  })

  it('SAFETY GATE: never replies into a conversation a human has already taken over (ai_active=false)', async () => {
    state.conversationRow = { ai_active: false }

    const result = await respondToSocialDirectMessage(makeEvent(), 'conv-1', 'chan-1', 'lead-1')

    expect(result).toEqual({ replied: false, reason: 'ai_paused' })
    expect(chatWithAIMock).not.toHaveBeenCalled()
    expect(state.recordedMessages).toHaveLength(0)
  })

  it('does nothing (never calls chatWithAI) when the inbound event has no text', async () => {
    const result = await respondToSocialDirectMessage(makeEvent({ text: null }), 'conv-1', 'chan-1', 'lead-1')

    expect(result).toEqual({ replied: false, reason: 'no_text' })
    expect(chatWithAIMock).not.toHaveBeenCalled()
  })

  it('never throws and reports the reason when the Send API call fails', async () => {
    state.sendResult = { ok: false, error: 'meta_not_configured: set META_PAGE_ACCESS_TOKEN' }

    const result = await respondToSocialDirectMessage(makeEvent(), 'conv-1', 'chan-1', 'lead-1')

    expect(result).toEqual({ replied: false, reason: 'meta_not_configured: set META_PAGE_ACCESS_TOKEN' })
    // A failed send must never be recorded as if it went out.
    expect(state.recordedMessages).toHaveLength(0)
  })

  it('builds message history from unified_messages, mapping inbound -> user and outbound -> assistant, without duplicating the live event', async () => {
    state.history = [
      { direction: 'inbound', sender_type: 'customer', content: 'Hi, what venues do you have?' },
      { direction: 'outbound', sender_type: 'ai', content: 'We have Skyline Serenity and Monurama Homestay!' },
      { direction: 'inbound', sender_type: 'customer', content: 'Do you have packages for a 60 guest wedding?' },
    ]

    await respondToSocialDirectMessage(makeEvent(), 'conv-1', 'chan-1', 'lead-1')

    const [messagesForAI] = chatWithAIMock.mock.calls[0]
    expect(messagesForAI).toEqual([
      { role: 'user', content: 'Hi, what venues do you have?' },
      { role: 'assistant', content: 'We have Skyline Serenity and Monurama Homestay!' },
      { role: 'user', content: 'Do you have packages for a 60 guest wedding?' },
    ])
  })
})
