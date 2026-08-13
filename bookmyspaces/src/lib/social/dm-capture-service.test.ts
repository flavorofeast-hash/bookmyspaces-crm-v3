import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = {
  isNewConversation: true,
  existingCustomerId: null as string | null,
  updateCalls: [] as unknown[],
  throwOnGetOrCreateConversation: false,
}
const recorded: unknown[] = []
const captureCalls: unknown[] = []
const qualifyCalls: unknown[] = []
const packageRecCalls: unknown[] = []

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table !== 'unified_conversations') throw new Error(`unexpected table: ${table}`)
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: { customer_id: state.existingCustomerId } }),
          }),
        }),
        update: (values: unknown) => ({
          eq: (col: string, id: string) => {
            state.updateCalls.push({ values, col, id })
            return Promise.resolve({ error: null })
          },
        }),
      }
    },
  }),
}))

vi.mock('@/lib/conversations/unified-conversation-service', () => ({
  getOrCreateConversation: () => {
    if (state.throwOnGetOrCreateConversation) return Promise.reject(new Error('db unreachable'))
    return Promise.resolve({
      conversationId: 'conv-1', channelId: 'chan-1', isNewConversation: state.isNewConversation,
    })
  },
  recordMessage: (input: unknown) => {
    recorded.push(input)
    return Promise.resolve('msg-1')
  },
}))

vi.mock('@/lib/leads/create-lead-with-journey', () => ({
  captureLeadWithJourney: (input: unknown) => {
    captureCalls.push(input)
    return Promise.resolve({ leadId: 'lead-new-1', isNew: true })
  },
}))

vi.mock('@/lib/whatsapp/auto-qualify', () => ({
  qualifyLeadFromMessage: (leadId: string, text: string) => {
    qualifyCalls.push({ leadId, text })
    return Promise.resolve()
  },
}))

vi.mock('@/lib/leads/auto-package-recommendation', () => ({
  runAutoPackageRecommendation: (leadId: string) => {
    packageRecCalls.push(leadId)
    return Promise.resolve()
  },
}))

import { captureSocialDirectMessage } from './dm-capture-service'

beforeEach(() => {
  state.isNewConversation = true
  state.existingCustomerId = null
  state.updateCalls.length = 0
  recorded.length = 0
  captureCalls.length = 0
  qualifyCalls.length = 0
  packageRecCalls.length = 0
})

describe('captureSocialDirectMessage', () => {
  it('creates a new lead on first contact and links it to the conversation', async () => {
    const result = await captureSocialDirectMessage({
      senderPsid: 'psid_1', text: 'Do you have availability this weekend?',
      timestamp: 1700000000, externalMessageId: 'mid_1', platform: 'facebook',
    })

    expect(result).toEqual({ leadId: 'lead-new-1', conversationId: 'conv-1', isNewLead: true })
    expect(captureCalls).toEqual([{
      source: 'facebook_messenger',
      notes: 'Facebook Messenger PSID: psid_1',
      qualifyText: 'Do you have availability this weekend?',
      sendWelcome: false,
    }])
    // conversation gets linked to the new lead
    expect(state.updateCalls).toEqual([{ values: { customer_id: 'lead-new-1' }, col: 'id', id: 'conv-1' }])
    expect(recorded).toEqual([{
      conversationId: 'conv-1', channelId: 'chan-1', direction: 'inbound', senderType: 'customer',
      content: 'Do you have availability this weekend?', externalMessageId: 'mid_1',
      rawPayload: { psid: 'psid_1', platform: 'facebook' },
    }])
  })

  it('uses instagram_dm as the source for Instagram DMs', async () => {
    await captureSocialDirectMessage({
      senderPsid: 'psid_2', text: 'hi', timestamp: null, externalMessageId: null, platform: 'instagram',
    })
    expect(captureCalls[0]).toMatchObject({ source: 'instagram_dm', notes: 'Instagram DM PSID: psid_2' })
  })

  it('re-qualifies an existing lead on repeat contact instead of creating a duplicate', async () => {
    state.isNewConversation = false
    state.existingCustomerId = 'lead-existing-1'

    const result = await captureSocialDirectMessage({
      senderPsid: 'psid_1', text: 'following up on my booking', timestamp: null, externalMessageId: null, platform: 'facebook',
    })

    expect(result).toEqual({ leadId: 'lead-existing-1', conversationId: 'conv-1', isNewLead: false })
    expect(captureCalls).toHaveLength(0) // no duplicate lead created
    expect(qualifyCalls).toEqual([{ leadId: 'lead-existing-1', text: 'following up on my booking' }])
    expect(packageRecCalls).toEqual(['lead-existing-1'])
    expect(state.updateCalls).toHaveLength(0) // conversation already linked, nothing to update
  })

  it('never throws — returns null when a dependency fails', async () => {
    state.throwOnGetOrCreateConversation = true
    const result = await captureSocialDirectMessage({
      senderPsid: 'psid_3', text: null, timestamp: null, externalMessageId: null, platform: 'facebook',
    })
    expect(result).toBeNull()
    state.throwOnGetOrCreateConversation = false
  })
})
