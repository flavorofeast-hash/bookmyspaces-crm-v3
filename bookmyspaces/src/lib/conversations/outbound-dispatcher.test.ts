import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockDb = {
  links: [] as unknown[],
  linksError: null as { message: string } | null,
  messageUpdates: [] as unknown[],
}
const recorded: unknown[] = []
const waSends: unknown[] = []
const igSends: unknown[] = []
const fbSends: unknown[] = []
let waResult: { success: boolean; error?: string } = { success: true }
let igResult: { success: boolean; externalMessageId?: string; error?: string } = { success: true, externalMessageId: 'ig-mid-1' }
let fbResult: { success: boolean; externalMessageId?: string; error?: string } = { success: true, externalMessageId: 'fb-mid-1' }

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table === 'unified_conversation_channels') {
        return {
          select: () => ({
            eq: () => ({
              order: () => Promise.resolve({ data: mockDb.linksError ? null : mockDb.links, error: mockDb.linksError }),
            }),
          }),
        }
      }
      if (table === 'unified_messages') {
        return {
          update: (v: unknown) => ({
            eq: (col: string, id: string) => {
              mockDb.messageUpdates.push({ v, col, id })
              return Promise.resolve({ error: null })
            },
          }),
        }
      }
      throw new Error(`unexpected table: ${table}`)
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

vi.mock('@/lib/social/instagram-send', () => ({
  sendInstagramMessage: (igUserId: string, recipientId: string, text: string) => {
    igSends.push({ igUserId, recipientId, text })
    return Promise.resolve(igResult)
  },
}))

vi.mock('@/lib/social/facebook-send', () => ({
  sendFacebookMessage: (recipientId: string, text: string) => {
    fbSends.push({ recipientId, text })
    return Promise.resolve(fbResult)
  },
}))

import { dispatchOutbound } from './outbound-dispatcher'

beforeEach(() => {
  mockDb.links = []
  mockDb.linksError = null
  mockDb.messageUpdates.length = 0
  recorded.length = 0
  waSends.length = 0
  igSends.length = 0
  fbSends.length = 0
  waResult = { success: true }
  igResult = { success: true, externalMessageId: 'ig-mid-1' }
  fbResult = { success: true, externalMessageId: 'fb-mid-1' }
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

  // Instagram AI-reply connection — reuses the same recordMessage() call as
  // every other channel; only the transport (sendInstagramMessage) and the
  // external-id backfill are new.
  it('sends via Instagram using the IGSID from channel_identity and the IG account id from channel config', async () => {
    mockDb.links = [
      { channel_id: 'ch3', channel_identity: 'igsid-customer-1', channels: { channel_type: 'instagram', config: { external_account_id: '17841478674706194' } } },
    ]
    const res = await dispatchOutbound({ conversationId: 'c3', content: 'AI reply text', senderType: 'ai' })
    expect(res.ok).toBe(true)
    expect(res.delivered).toBe(true)
    expect(res.channelType).toBe('instagram')
    expect(igSends).toEqual([{ igUserId: '17841478674706194', recipientId: 'igsid-customer-1', text: 'AI reply text' }])
  })

  it('backfills external_message_id onto the recorded row after a successful Instagram send', async () => {
    mockDb.links = [
      { channel_id: 'ch3', channel_identity: 'igsid-customer-1', channels: { channel_type: 'instagram', config: { external_account_id: '17841478674706194' } } },
    ]
    await dispatchOutbound({ conversationId: 'c3', content: 'AI reply text', senderType: 'ai' })
    expect(mockDb.messageUpdates).toEqual([{ v: { external_message_id: 'ig-mid-1' }, col: 'id', id: 'msg-1' }])
  })

  it('reports a failed Instagram send without falsely marking it delivered, and does not backfill an id', async () => {
    igResult = { success: false, error: 'graph_error' }
    mockDb.links = [
      { channel_id: 'ch3', channel_identity: 'igsid-customer-1', channels: { channel_type: 'instagram', config: { external_account_id: '17841478674706194' } } },
    ]
    const res = await dispatchOutbound({ conversationId: 'c3', content: 'AI reply text', senderType: 'ai' })
    expect(res.ok).toBe(true)
    expect(res.delivered).toBe(false)
    expect(res.detail).toBe('graph_error')
    expect(mockDb.messageUpdates).toHaveLength(0)
  })

  it('reports delivered=false when the Instagram channel row has no external_account_id in config', async () => {
    mockDb.links = [
      { channel_id: 'ch3', channel_identity: 'igsid-customer-1', channels: { channel_type: 'instagram', config: {} } },
    ]
    const res = await dispatchOutbound({ conversationId: 'c3', content: 'AI reply text', senderType: 'ai' })
    expect(res.ok).toBe(true)
    expect(res.delivered).toBe(false)
    expect(igSends).toHaveLength(0)
  })

  // Facebook Messenger pass — single-Page global-credential model, no
  // per-account lookup needed (unlike Instagram's config.external_account_id).
  it('sends via Facebook Messenger using the PSID from channel_identity', async () => {
    mockDb.links = [
      { channel_id: 'ch4', channel_identity: 'psid-customer-1', channels: { channel_type: 'facebook' } },
    ]
    const res = await dispatchOutbound({ conversationId: 'c4', content: 'AI reply text', senderType: 'ai' })
    expect(res.ok).toBe(true)
    expect(res.delivered).toBe(true)
    expect(res.channelType).toBe('facebook')
    expect(fbSends).toEqual([{ recipientId: 'psid-customer-1', text: 'AI reply text' }])
  })

  it('backfills external_message_id onto the recorded row after a successful Facebook send', async () => {
    mockDb.links = [
      { channel_id: 'ch4', channel_identity: 'psid-customer-1', channels: { channel_type: 'facebook' } },
    ]
    await dispatchOutbound({ conversationId: 'c4', content: 'AI reply text', senderType: 'ai' })
    expect(mockDb.messageUpdates).toEqual([{ v: { external_message_id: 'fb-mid-1' }, col: 'id', id: 'msg-1' }])
  })

  it('reports a failed Facebook send without falsely marking it delivered, and does not backfill an id', async () => {
    fbResult = { success: false, error: 'graph_error' }
    mockDb.links = [
      { channel_id: 'ch4', channel_identity: 'psid-customer-1', channels: { channel_type: 'facebook' } },
    ]
    const res = await dispatchOutbound({ conversationId: 'c4', content: 'AI reply text', senderType: 'ai' })
    expect(res.ok).toBe(true)
    expect(res.delivered).toBe(false)
    expect(res.detail).toBe('graph_error')
    expect(mockDb.messageUpdates).toHaveLength(0)
  })
})
