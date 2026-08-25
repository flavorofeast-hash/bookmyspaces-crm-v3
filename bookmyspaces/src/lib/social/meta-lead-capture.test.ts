import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const dbState = {
  insertError: null as { code: string; message: string } | null,
  updateCalls: [] as Array<{ values: unknown; leadgenId: string }>,
}

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table !== 'social_leadgen_events') throw new Error(`unexpected table: ${table}`)
      return {
        insert: () => ({
          select: () => ({
            single: () => dbState.insertError
              ? Promise.resolve({ data: null, error: dbState.insertError })
              : Promise.resolve({ data: { id: 'event-1' }, error: null }),
          }),
        }),
        update: (values: unknown) => ({
          eq: (_col: string, leadgenId: string) => {
            dbState.updateCalls.push({ values, leadgenId })
            return Promise.resolve({ error: null })
          },
        }),
      }
    },
  }),
}))

import { parseLeadgenEvents, parseMessagingEvents, fetchLeadgenDetails, claimLeadgenEvent, linkLeadgenEventToLead } from './meta-lead-capture'

describe('parseLeadgenEvents', () => {
  it('parses a Facebook Lead Ads leadgen event', () => {
    const payload = {
      entry: [{
        changes: [{
          field: 'leadgen',
          value: { leadgen_id: 'lg_1', form_id: 'form_1', page_id: 'page_1', ad_id: 'ad_1' },
        }],
      }],
    }
    const out = parseLeadgenEvents(payload, 'facebook')
    expect(out).toEqual([{ leadgenId: 'lg_1', formId: 'form_1', pageId: 'page_1', adId: 'ad_1', platform: 'facebook' }])
  })

  it('ignores non-leadgen fields, missing leadgen_id, and malformed payloads', () => {
    expect(parseLeadgenEvents({ entry: [{ changes: [{ field: 'feed', value: {} }] }] }, 'facebook')).toHaveLength(0)
    expect(parseLeadgenEvents({ entry: [{ changes: [{ field: 'leadgen', value: {} }] }] }, 'facebook')).toHaveLength(0)
    expect(parseLeadgenEvents({}, 'instagram')).toHaveLength(0)
    expect(parseLeadgenEvents({ entry: 'nonsense' as unknown as [] }, 'facebook')).toHaveLength(0)
  })

  it('defaults optional ids to null when absent', () => {
    const payload = { entry: [{ changes: [{ field: 'leadgen', value: { leadgen_id: 'lg_2' } }] }] }
    const out = parseLeadgenEvents(payload, 'instagram')
    expect(out).toEqual([{ leadgenId: 'lg_2', formId: null, pageId: null, adId: null, platform: 'instagram' }])
  })
})

describe('parseMessagingEvents', () => {
  it('parses an inbound Messenger text message', () => {
    const payload = {
      entry: [{
        messaging: [{
          sender: { id: 'psid_1' },
          timestamp: 1700000000,
          message: { mid: 'mid_1', text: 'Hi, do you have availability?' },
        }],
      }],
    }
    const out = parseMessagingEvents(payload, 'facebook')
    expect(out).toEqual([{
      senderPsid: 'psid_1', text: 'Hi, do you have availability?',
      timestamp: 1700000000, externalMessageId: 'mid_1', platform: 'facebook', recipientId: null,
    }])
  })

  it('extracts recipient.id (which connected account this message was sent to) when present', () => {
    const payload = {
      entry: [{
        messaging: [{
          sender: { id: 'psid_1' },
          recipient: { id: '17841478674706194' },
          message: { mid: 'mid_1', text: 'hi' },
        }],
      }],
    }
    const out = parseMessagingEvents(payload, 'instagram')
    expect(out[0].recipientId).toBe('17841478674706194')
  })

  it('ignores echoes (our own outbound sends)', () => {
    const payload = {
      entry: [{ messaging: [{ sender: { id: 'psid_1' }, message: { is_echo: true, text: 'our reply' } }] }],
    }
    expect(parseMessagingEvents(payload, 'facebook')).toHaveLength(0)
  })

  it('ignores non-message events (delivery/read/postback have no message key)', () => {
    const payload = {
      entry: [{ messaging: [{ sender: { id: 'psid_1' }, delivery: { mids: ['mid_1'] } }] }],
    }
    expect(parseMessagingEvents(payload, 'instagram')).toHaveLength(0)
  })

  it('skips events with no sender id', () => {
    const payload = { entry: [{ messaging: [{ message: { text: 'no sender' } }] }] }
    expect(parseMessagingEvents(payload, 'facebook')).toHaveLength(0)
  })

  it('captures attachment-only messages (no text) with text:null', () => {
    const payload = {
      entry: [{ messaging: [{ sender: { id: 'psid_2' }, message: { mid: 'mid_2', attachments: [{ type: 'image' }] } }] }],
    }
    const out = parseMessagingEvents(payload, 'instagram')
    expect(out).toEqual([{ senderPsid: 'psid_2', text: null, timestamp: null, externalMessageId: 'mid_2', platform: 'instagram', recipientId: null }])
  })
})

describe('fetchLeadgenDetails', () => {
  const ORIGINAL_ENV = { ...process.env }

  beforeEach(() => {
    process.env.META_PAGE_ACCESS_TOKEN = 'token'
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
    vi.unstubAllGlobals()
  })

  it('returns null when META_PAGE_ACCESS_TOKEN is not set', async () => {
    delete process.env.META_PAGE_ACCESS_TOKEN
    const result = await fetchLeadgenDetails('lg_1')
    expect(result).toBeNull()
  })

  it('maps field_data into name/phone/email using full_name when present', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      field_data: [
        { name: 'full_name', values: ['Priya Sharma'] },
        { name: 'email', values: ['priya@example.com'] },
        { name: 'phone_number', values: ['9051459463'] },
      ],
    }), { status: 200 })))
    const result = await fetchLeadgenDetails('lg_1')
    expect(result).toMatchObject({ name: 'Priya Sharma', email: 'priya@example.com', phone: '9051459463' })
  })

  it('falls back to first_name + last_name when full_name/name are absent', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      field_data: [
        { name: 'first_name', values: ['Priya'] },
        { name: 'last_name', values: ['Sharma'] },
      ],
    }), { status: 200 })))
    const result = await fetchLeadgenDetails('lg_1')
    expect(result?.name).toBe('Priya Sharma')
  })

  it('returns null on a Graph API error response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message: 'Invalid token' } }), { status: 400 })))
    const result = await fetchLeadgenDetails('lg_1')
    expect(result).toBeNull()
  })

  it('returns null when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
    const result = await fetchLeadgenDetails('lg_1')
    expect(result).toBeNull()
  })
})

// Meta integration hardening pass — leadgen webhook idempotency
// (migration 029, social_leadgen_events).
describe('claimLeadgenEvent / linkLeadgenEventToLead', () => {
  beforeEach(() => {
    dbState.insertError = null
    dbState.updateCalls.length = 0
  })

  it('claims a new leadgen_id (first delivery)', async () => {
    const claimed = await claimLeadgenEvent('lg_1', 'facebook')
    expect(claimed).toBe(true)
  })

  it('does not re-claim a leadgen_id already recorded (replay/redelivery)', async () => {
    dbState.insertError = { code: '23505', message: 'duplicate key value violates unique constraint' }
    const claimed = await claimLeadgenEvent('lg_1', 'facebook')
    expect(claimed).toBe(false)
  })

  it('fails open (claims anyway) on an unexpected DB error, never silently drops the event', async () => {
    dbState.insertError = { code: '42P01', message: 'relation does not exist' }
    const claimed = await claimLeadgenEvent('lg_1', 'facebook')
    expect(claimed).toBe(true)
  })

  it('links a claimed event to the lead it produced', async () => {
    await linkLeadgenEventToLead('lg_1', 'lead-1')
    expect(dbState.updateCalls).toEqual([{ values: { lead_id: 'lead-1' }, leadgenId: 'lg_1' }])
  })
})
