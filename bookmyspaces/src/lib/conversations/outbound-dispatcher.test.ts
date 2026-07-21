import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockDb = {
  links: [] as unknown[],
  linksError: null as { message: string } | null,
}
const recorded: unknown[] = []
const waSends: unknown[] = []
let waResult: { success: boolean; error?: string } = { success: true }

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table !== 'unified_conversation_channels') throw new Error(`unexpected table: ${table}`)
      return {
        select: () => ({
          eq: () => ({
            order: () => Promise.resolve({ data: mockDb.linksError ? null : mockDb.links, error: mockDb.linksError }),
          }),
        }),
      }
    },
  }),
}))

vi.mock('@/lib/conversations/unified-conversation-service', () => ({
  recordMessage: (input: unknown) => {
    recorded.push(input)
    return Promise.resolve('msg-1')
  },
}))

vi.mock('@/lib/whatsapp/send-message', () => ({
  sendWhatsAppText: (to: string, body: string, opts: unknown) => {
    waSends.push({ to, body, opts })
    return Promise.resolve(waResult)
  },
}))

import { dispatchOutbound } from './outbound-dispatcher'

beforeEach(() => {
  mockDb.links = []
  mockDb.linksError = null
  recorded.length = 0
  waSends.length = 0
  waResult = { success: true }
})

describe('dispatchOutbound', () => {
  it('fails cleanly when the conversation has no channel links', async () => {
    const res = await dispatchOutbound({ conversationId: 'c1', content: 'hi', senderType: 'human' })
    expect(res.ok).toBe(false)
    expect(recorded).toHaveLength(0)
  })

  it('records then sends via WhatsApp with the mirror disabled (no double-record)', async () => {
    mockDb.links = [
      { channel_id: 'ch1', channel_identity: '919830509991', channels: { channel_type: 'whatsapp' } },
    ]
    const res = await dispatchOutbound({ conversationId: 'c1', content: 'hello', senderType: 'human' })
    expect(res.ok).toBe(true)
    expect(res.delivered).toBe(true)
    expect(res.channelType).toBe('whatsapp')
    expect(recorded).toHaveLength(1)
    expect(recorded[0]).toMatchObject({ direction: 'outbound', senderType: 'human' })
    expect(waSends).toHaveLength(1)
    expect((waSends[0] as { opts: { unifiedMirror: null } }).opts.unifiedMirror).toBeNull()
  })

  it('records website_chat replies but reports delivered=false (no push transport)', async () => {
    mockDb.links = [
      { channel_id: 'ch2', channel_identity: 'session-uuid', channels: { channel_type: 'website_chat' } },
    ]
    const res = await dispatchOutbound({ conversationId: 'c2', content: 'hello', senderType: 'human' })
    expect(res.ok).toBe(true)
    expect(res.delivered).toBe(false)
    expect(recorded).toHaveLength(1)
    expect(waSends).toHaveLength(0)
  })

  it('reports a failed WhatsApp transport without losing the recorded message', async () => {
    waResult = { success: false, error: 'network down' }
    mockDb.links = [
      { channel_id: 'ch1', channel_identity: '919830509991', channels: { channel_type: 'whatsapp' } },
    ]
    const res = await dispatchOutbound({ conversationId: 'c1', content: 'hello', senderType: 'ai' })
    expect(res.ok).toBe(true)
    expect(res.delivered).toBe(false)
    expect(res.messageId).toBe('msg-1')
  })
})
