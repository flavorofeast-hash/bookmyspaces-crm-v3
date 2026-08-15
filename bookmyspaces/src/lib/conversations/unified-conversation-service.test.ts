import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolveIdentity: vi.fn(),
  buildAIContext: vi.fn(),
}))

vi.mock('@/lib/identity/resolve-identity', () => ({
  resolveIdentity: mocks.resolveIdentity,
}))

vi.mock('@/lib/ai/context-builder', () => ({
  buildAIContext: mocks.buildAIContext,
}))

const state = {
  existingChannelId: null as string | null,
  createdChannelId: 'chan-1',
  channelInsertError: null as { message: string } | null,

  existingConversationId: null as string | null,
  existingCustomerId: null as string | null,
  createdConversationId: 'conv-1',
  conversationInsertError: null as { message: string } | null,
  linkInsertError: null as { message: string } | null,
  customerIdBackfillError: null as { message: string } | null,

  messageId: 'msg-1',
  messageInsertError: null as { message: string } | null,

  touchCalls: [] as Array<{ channelId: string; channelIdentity: string }>,
  lastMessageAtUpdates: [] as string[],
  customerIdUpdates: [] as Array<{ conversationId: string; customerId: string }>,
}

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table === 'channels') {
        return {
          select: () => ({
            eq: () => ({
              limit: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: state.existingChannelId ? { id: state.existingChannelId } : null,
                    error: null,
                  }),
              }),
            }),
          }),
          insert: () => ({
            select: () => ({
              single: () =>
                Promise.resolve({
                  data: state.channelInsertError ? null : { id: state.createdChannelId },
                  error: state.channelInsertError,
                }),
            }),
          }),
        }
      }

      if (table === 'unified_conversation_channels') {
        return {
          select: (cols: string) => {
            if (cols !== 'conversation_id') throw new Error(`unexpected select: ${cols}`)
            return {
              eq: (_c1: string, channelId: string) => ({
                eq: (_c2: string, channelIdentity: string) => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: state.existingConversationId
                        ? { conversation_id: state.existingConversationId }
                        : null,
                      error: null,
                    }),
                }),
              }),
            }
          },
          update: () => ({
            eq: (_c1: string, channelId: string) => ({
              eq: (_c2: string, channelIdentity: string) => {
                state.touchCalls.push({ channelId, channelIdentity })
                return Promise.resolve({ data: null, error: null })
              },
            }),
          }),
          insert: () => Promise.resolve({ data: null, error: state.linkInsertError }),
        }
      }

      if (table === 'unified_conversations') {
        return {
          select: (cols: string) => {
            if (cols !== 'customer_id') throw new Error(`unexpected select: ${cols}`)
            return {
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({ data: { customer_id: state.existingCustomerId }, error: null }),
              }),
            }
          },
          insert: () => ({
            select: () => ({
              single: () =>
                Promise.resolve({
                  data: state.conversationInsertError ? null : { id: state.createdConversationId },
                  error: state.conversationInsertError,
                }),
            }),
          }),
          update: (payload: { last_message_at?: string; customer_id?: string }) => ({
            eq: (_col: string, id: string) => {
              if ('last_message_at' in payload) {
                state.lastMessageAtUpdates.push(payload.last_message_at as string)
                return Promise.resolve({ data: null, error: null })
              }
              state.customerIdUpdates.push({ conversationId: id, customerId: payload.customer_id as string })
              return Promise.resolve({ data: null, error: state.customerIdBackfillError })
            },
          }),
        }
      }

      if (table === 'unified_messages') {
        return {
          insert: () => ({
            select: () => ({
              single: () =>
                Promise.resolve({
                  data: state.messageInsertError ? null : { id: state.messageId },
                  error: state.messageInsertError,
                }),
            }),
          }),
        }
      }

      throw new Error(`unexpected table: ${table}`)
    },
  }),
}))

import {
  ensureChannel,
  getOrCreateConversation,
  recordMessage,
  ingestInboundMessage,
  handleInboundMessage,
} from './unified-conversation-service'

function resetState() {
  state.existingChannelId = null
  state.createdChannelId = 'chan-1'
  state.channelInsertError = null
  state.existingConversationId = null
  state.existingCustomerId = null
  state.createdConversationId = 'conv-1'
  state.conversationInsertError = null
  state.linkInsertError = null
  state.customerIdBackfillError = null
  state.messageId = 'msg-1'
  state.messageInsertError = null
  state.touchCalls = []
  state.lastMessageAtUpdates = []
  state.customerIdUpdates = []
}

describe('ensureChannel', () => {
  beforeEach(resetState)

  it('returns the existing channel id without creating a new one', async () => {
    state.existingChannelId = 'chan-existing'
    const id = await ensureChannel('whatsapp')
    expect(id).toBe('chan-existing')
  })

  it('creates a new channel row when none exists for that channel_type', async () => {
    state.existingChannelId = null
    const id = await ensureChannel('website_chat')
    expect(id).toBe('chan-1')
  })

  it('throws when channel creation fails', async () => {
    state.existingChannelId = null
    state.channelInsertError = { message: 'insert failed' }
    await expect(ensureChannel('email')).rejects.toThrow(/failed to create channel row/)
  })
})

describe('getOrCreateConversation', () => {
  beforeEach(resetState)

  it('returns the existing conversation and touches last_seen_at on repeat contact', async () => {
    state.existingChannelId = 'chan-existing'
    state.existingConversationId = 'conv-existing'

    const result = await getOrCreateConversation({ channelType: 'whatsapp', channelIdentity: '919051459463' })

    expect(result).toEqual({ conversationId: 'conv-existing', channelId: 'chan-existing', isNewConversation: false })
    expect(state.touchCalls).toEqual([{ channelId: 'chan-existing', channelIdentity: '919051459463' }])
  })

  it('creates a new conversation and links the channel identity when no match exists', async () => {
    state.existingChannelId = 'chan-existing'
    state.existingConversationId = null

    const result = await getOrCreateConversation({
      channelType: 'whatsapp',
      channelIdentity: '919051459463',
      customerId: 'lead-42',
    })

    expect(result).toEqual({ conversationId: 'conv-1', channelId: 'chan-existing', isNewConversation: true })
    expect(state.touchCalls).toEqual([])
  })

  it('propagates a conversation-creation error', async () => {
    state.existingConversationId = null
    state.conversationInsertError = { message: 'db down' }
    await expect(
      getOrCreateConversation({ channelType: 'whatsapp', channelIdentity: '919051459463' })
    ).rejects.toThrow(/failed to create unified_conversations row/)
  })

  // BUGFIX regression coverage: a conversation created with customer_id=NULL
  // (e.g. via mirrorWhatsAppOutbound, which never knows the lead) must get
  // backfilled the next time a caller resolves a real customerId for it,
  // without creating a duplicate conversation or losing its id.
  it('backfills customer_id on an existing conversation whose customer_id is currently NULL', async () => {
    state.existingChannelId = 'chan-existing'
    state.existingConversationId = 'conv-existing'
    state.existingCustomerId = null

    const result = await getOrCreateConversation({
      channelType: 'whatsapp',
      channelIdentity: '919051459463',
      customerId: 'lead-42',
    })

    expect(result).toEqual({ conversationId: 'conv-existing', channelId: 'chan-existing', isNewConversation: false })
    expect(state.customerIdUpdates).toEqual([{ conversationId: 'conv-existing', customerId: 'lead-42' }])
  })

  it('does not overwrite an already-set customer_id with a different lead', async () => {
    state.existingChannelId = 'chan-existing'
    state.existingConversationId = 'conv-existing'
    state.existingCustomerId = 'lead-original'

    await getOrCreateConversation({
      channelType: 'whatsapp',
      channelIdentity: '919051459463',
      customerId: 'lead-different',
    })

    expect(state.customerIdUpdates).toEqual([])
  })

  it('does not query or update customer_id when the caller has no customerId to offer', async () => {
    state.existingChannelId = 'chan-existing'
    state.existingConversationId = 'conv-existing'
    state.existingCustomerId = null

    await getOrCreateConversation({ channelType: 'whatsapp', channelIdentity: '919051459463' })

    expect(state.customerIdUpdates).toEqual([])
  })
})

describe('recordMessage', () => {
  beforeEach(resetState)

  it('inserts the message and bumps last_message_at on the conversation', async () => {
    const messageId = await recordMessage({
      conversationId: 'conv-1',
      channelId: 'chan-1',
      direction: 'inbound',
      senderType: 'customer',
      content: 'Hi, is Skyline Serenity available this weekend?',
    })

    expect(messageId).toBe('msg-1')
    expect(state.lastMessageAtUpdates).toHaveLength(1)
  })

  it('throws when the message insert fails', async () => {
    state.messageInsertError = { message: 'constraint violation' }
    await expect(
      recordMessage({ conversationId: 'conv-1', channelId: 'chan-1', direction: 'outbound', senderType: 'ai', content: 'Hi!' })
    ).rejects.toThrow(/failed to insert unified_messages row/)
  })
})

describe('ingestInboundMessage (Channel Adapter entry point)', () => {
  beforeEach(resetState)

  it('creates a new conversation, links the identity, and records the inbound message', async () => {
    state.existingChannelId = 'chan-existing'
    state.existingConversationId = null

    const result = await ingestInboundMessage({
      channelType: 'whatsapp',
      channelIdentity: '919051459463',
      content: 'Hi, is Skyline Serenity available this weekend?',
      customerId: 'lead-42',
    })

    expect(result).toEqual({
      conversationId: 'conv-1',
      channelId: 'chan-existing',
      messageId: 'msg-1',
      isNewConversation: true,
    })
  })

  it('appends to an existing conversation without re-creating it', async () => {
    state.existingChannelId = 'chan-existing'
    state.existingConversationId = 'conv-existing'

    const result = await ingestInboundMessage({
      channelType: 'whatsapp',
      channelIdentity: '919051459463',
      content: 'Following up on my earlier question',
    })

    expect(result.isNewConversation).toBe(false)
    expect(result.conversationId).toBe('conv-existing')
    expect(state.touchCalls).toHaveLength(1)
  })
})

describe('handleInboundMessage (single channel-agnostic pipeline)', () => {
  beforeEach(() => {
    resetState()
    mocks.resolveIdentity.mockReset()
    mocks.buildAIContext.mockReset().mockResolvedValue({ customerProfile: { leadId: null } })
  })

  it('resolves identity by phone for whatsapp/sms, stores the message, and builds AI context', async () => {
    state.existingChannelId = 'chan-existing'
    state.existingConversationId = null
    mocks.resolveIdentity.mockResolvedValue({ leadId: 'lead-42', name: 'Priya', phone: '919051459463', email: null, matchedOn: 'phone', hasConflictingIdentifier: false })

    const result = await handleInboundMessage({
      channelType: 'whatsapp',
      channelIdentity: '919051459463',
      content: 'Is Skyline Serenity available this weekend?',
    })

    expect(mocks.resolveIdentity).toHaveBeenCalledWith({ phone: '919051459463' })
    expect(mocks.buildAIContext).toHaveBeenCalledWith({ leadId: 'lead-42', query: 'Is Skyline Serenity available this weekend?', conversationId: 'conv-1' })
    expect(result.conversationId).toBe('conv-1')
    expect(result.identity?.leadId).toBe('lead-42')
    expect(result.aiContext).toEqual({ customerProfile: { leadId: null } })
  })

  it('resolves identity by email for the email channel', async () => {
    state.existingChannelId = 'chan-existing'
    mocks.resolveIdentity.mockResolvedValue(null)

    await handleInboundMessage({
      channelType: 'email',
      channelIdentity: 'priya@example.com',
      content: 'Following up on my quote',
    })

    expect(mocks.resolveIdentity).toHaveBeenCalledWith({ email: 'priya@example.com' })
  })

  it('passes leadId: null to buildAIContext when identity does not resolve', async () => {
    state.existingChannelId = 'chan-existing'
    mocks.resolveIdentity.mockResolvedValue(null)

    const result = await handleInboundMessage({
      channelType: 'website_chat',
      channelIdentity: 'session-abc',
      content: 'Do you have rooftop venues?',
    })

    expect(result.identity).toBeNull()
    expect(mocks.buildAIContext).toHaveBeenCalledWith(expect.objectContaining({ leadId: null }))
  })
})
