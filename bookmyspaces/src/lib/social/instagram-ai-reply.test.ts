import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = {
  history: [] as Array<{ direction: string; content: string | null }>,
  aiSettings: { model: 'test-model', maxTokens: 500 } as Record<string, unknown>,
  handoffDecision: { escalate: false } as { escalate: boolean },
  chatWithAIShouldThrow: false,
}

const chatWithAICalls: unknown[] = []
const evaluateHandoffCalls: unknown[] = []
const formatMessageCalls: unknown[] = []
const dispatchCalls: unknown[] = []
let dispatchResult: { ok: boolean; messageId: string | null; delivered: boolean; channelType: string | null; detail?: string } =
  { ok: true, messageId: 'msg-1', delivered: true, channelType: 'instagram' }

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table !== 'unified_messages') throw new Error(`unexpected table: ${table}`)
      return {
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: () => Promise.resolve({ data: state.history }),
            }),
          }),
        }),
      }
    },
  }),
}))

vi.mock('@/lib/ai', () => ({
  chatWithAI: (messages: unknown, userQuery: unknown) => {
    chatWithAICalls.push({ messages, userQuery })
    if (state.chatWithAIShouldThrow) return Promise.reject(new Error('AI down'))
    return Promise.resolve('raw AI response')
  },
  cleanAIResponse: (raw: string) => `clean:${raw}`,
}))

vi.mock('@/lib/ai/orchestrator', () => ({
  evaluateHandoff: (input: unknown) => {
    evaluateHandoffCalls.push(input)
    return state.handoffDecision
  },
  estimateConfidence: () => 0.9,
}))

vi.mock('@/lib/messaging/format-message', () => ({
  formatMessage: (input: unknown) => {
    formatMessageCalls.push(input)
    return `formatted:${(input as { body: string }).body}`
  },
}))

vi.mock('@/lib/settings/settings-service', () => ({
  getSettingsSection: () => Promise.resolve(state.aiSettings),
}))

vi.mock('@/lib/conversations/outbound-dispatcher', () => ({
  dispatchOutbound: (input: unknown) => {
    dispatchCalls.push(input)
    return Promise.resolve(dispatchResult)
  },
}))

import { triggerInstagramAIReply } from './instagram-ai-reply'

beforeEach(() => {
  state.history = [
    { direction: 'inbound', content: 'hi' },
    { direction: 'outbound', content: 'hello, how can I help?' },
    { direction: 'inbound', content: 'do you have rooms available?' },
  ]
  state.aiSettings = { model: 'test-model', maxTokens: 500 }
  state.handoffDecision = { escalate: false }
  state.chatWithAIShouldThrow = false
  dispatchResult = { ok: true, messageId: 'msg-1', delivered: true, channelType: 'instagram' }
  chatWithAICalls.length = 0
  evaluateHandoffCalls.length = 0
  formatMessageCalls.length = 0
  dispatchCalls.length = 0
})

describe('triggerInstagramAIReply', () => {
  it('builds AI context from unified_messages history and dispatches the reply, respecting handoff evaluation', async () => {
    await triggerInstagramAIReply({ conversationId: 'conv-1', customerText: 'do you have rooms available?' })

    expect(chatWithAICalls).toEqual([{
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello, how can I help?' },
        { role: 'user', content: 'do you have rooms available?' },
      ],
      userQuery: 'do you have rooms available?',
    }])

    // Same functions, same call shape as the WhatsApp path -- proves the
    // handoff/confidence rules are not bypassed.
    expect(evaluateHandoffCalls).toEqual([{
      customerText: 'do you have rooms available?', aiConfidence: 0.9, settings: state.aiSettings,
    }])

    expect(formatMessageCalls).toEqual([{ body: 'clean:raw AI response', includeHandover: false }])
    expect(dispatchCalls).toEqual([{ conversationId: 'conv-1', content: 'formatted:clean:raw AI response', senderType: 'ai' }])
  })

  it('includes the handover block when evaluateHandoff escalates', async () => {
    state.handoffDecision = { escalate: true }
    await triggerInstagramAIReply({ conversationId: 'conv-1', customerText: 'I want a refund' })
    expect(formatMessageCalls[0]).toMatchObject({ includeHandover: true })
  })

  it('does nothing when there is no customer text (attachment-only message)', async () => {
    await triggerInstagramAIReply({ conversationId: 'conv-1', customerText: null })
    expect(chatWithAICalls).toHaveLength(0)
    expect(dispatchCalls).toHaveLength(0)
  })

  it('never throws when the AI call fails, and sends no reply', async () => {
    state.chatWithAIShouldThrow = true
    await expect(
      triggerInstagramAIReply({ conversationId: 'conv-1', customerText: 'hi' })
    ).resolves.toBeUndefined()
    expect(dispatchCalls).toHaveLength(0)
  })

  it('never throws when dispatchOutbound fails to deliver', async () => {
    dispatchResult = { ok: true, messageId: 'msg-1', delivered: false, channelType: 'instagram', detail: 'graph_error' }
    await expect(
      triggerInstagramAIReply({ conversationId: 'conv-1', customerText: 'hi' })
    ).resolves.toBeUndefined()
    expect(dispatchCalls).toHaveLength(1)
  })
})
