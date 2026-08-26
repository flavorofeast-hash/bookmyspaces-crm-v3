// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/app/api/social/webhook/[platform]/route.instagram-e2e.test.ts
// Deterministic end-to-end proof of the real Instagram DM pipeline, using
// a realistic captured payload shape (object:"instagram", entry[].messaging[]
// with sender/recipient/message.mid/message.text -- confirmed against
// Meta's current documented shape, not assumed) and REAL production code
// for every stage except the database itself:
//
//   raw payload -> HMAC signature verification (real MetaAdapter,
//   real crypto) -> parseMessagingEvents() (real) -> account/channel
//   resolution (real social-account-routing.ts) -> conversation/message
//   write (real unified-conversation-service.ts) -> asserted DB writes.
//
// Only the Supabase client, and the three side-effect boundaries that do
// their own AI/DB work internally (captureLeadWithJourney,
// qualifyLeadFromMessage, runAutoPackageRecommendation), are mocked.
// route.test.ts (existing) mocks dm-capture-service entirely, so it never
// actually exercises this real pipeline -- this file closes that gap.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest'
import crypto from 'crypto'

const TEST_SECRET = 'test-ig-login-app-secret-not-real'
const IG_ACCOUNT_ID = '17841478674706194' // skyline.monurama, confirmed real IG User ID throughout this investigation

const state = {
  socialAccount: { id: 'acct-skyline-1', display_name: 'skyline.monurama', external_account_id: IG_ACCOUNT_ID },
  socialAccountFindable: true,
  existingChannel: null as { id: string } | null,
  existingConversationId: null as string | null,
  dedupExisting: null as { id: string; conversation_id: string } | null,
  inserts: { channels: [] as unknown[], conversations: [] as unknown[], links: [] as unknown[], messages: [] as unknown[] },
  updates: { conversations: [] as unknown[] },
}

function chain(result: unknown) {
  const obj: Record<string, unknown> = {
    eq: () => chain(result),
    contains: () => chain(result),
    limit: () => chain(result),
    select: () => chain(result),
    maybeSingle: () => Promise.resolve(result),
    single: () => Promise.resolve(result),
    then: (resolve: (v: unknown) => void) => resolve(result),
  }
  return obj
}

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ allowed: true, retryAfterSeconds: 0 }),
  clientIpFrom: () => '127.0.0.1',
}))

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      switch (table) {
        case 'unified_messages':
          return {
            select: () => chain({ data: state.dedupExisting }),
            insert: (v: unknown) => { state.inserts.messages.push(v); return chain({ data: { id: 'msg-e2e-1' }, error: null }) },
          }
        case 'social_accounts':
          return { select: () => chain({ data: state.socialAccountFindable ? state.socialAccount : null, error: null }) }
        case 'channels':
          return {
            select: () => chain({ data: state.existingChannel }),
            insert: (v: unknown) => { state.inserts.channels.push(v); return chain({ data: { id: 'chan-e2e-1' }, error: null }) },
          }
        case 'unified_conversation_channels':
          return {
            select: () => chain({ data: state.existingConversationId ? { conversation_id: state.existingConversationId } : null }),
            insert: (v: unknown) => { state.inserts.links.push(v); return chain({ error: null }) },
            update: () => chain({ error: null }),
          }
        case 'unified_conversations':
          return {
            insert: (v: unknown) => { state.inserts.conversations.push(v); return chain({ data: { id: 'conv-e2e-1' }, error: null }) },
            select: () => chain({ data: { customer_id: null } }),
            update: (v: unknown) => { state.updates.conversations.push(v); return chain({ error: null }) },
          }
        default:
          throw new Error(`unexpected table: ${table}`)
      }
    },
  }),
}))

vi.mock('@/lib/leads/create-lead-with-journey', () => ({
  captureLeadWithJourney: () => Promise.resolve({ leadId: 'lead-e2e-1', isNew: true }),
}))
vi.mock('@/lib/whatsapp/auto-qualify', () => ({ qualifyLeadFromMessage: () => Promise.resolve() }))
vi.mock('@/lib/leads/auto-package-recommendation', () => ({ runAutoPackageRecommendation: () => Promise.resolve() }))
vi.mock('@/lib/social/interaction-service', () => ({ ingestInteraction: () => Promise.resolve({ ok: true, duplicate: false }) }))

import { POST } from './route'

function buildRealisticInstagramPayload() {
  // Confirmed shape (Meta's Messenger-Platform-style Instagram messaging
  // webhook, cross-checked against current third-party integration guides
  // referencing the live Meta docs): object:"instagram", entry[].id is the
  // recipient's IG-scoped id, messaging[] carries sender/recipient/message.
  return {
    object: 'instagram',
    entry: [{
      time: 1778223725146,
      id: IG_ACCOUNT_ID,
      messaging: [{
        sender: { id: '990011223344' },
        recipient: { id: IG_ACCOUNT_ID },
        timestamp: 1778223723887,
        message: { mid: 'mid.e2e.test.1', text: 'do u offer room' },
      }],
    }],
  }
}

function makeSignedRequest(rawBody: string) {
  const sig = 'sha256=' + crypto.createHmac('sha256', TEST_SECRET).update(rawBody, 'utf8').digest('hex')
  return new Request('https://crm.bookmyspaces.in/api/social/webhook/instagram', {
    method: 'POST',
    headers: { 'x-hub-signature-256': sig },
    body: rawBody,
  })
}

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV, META_IG_LOGIN_APP_SECRET: TEST_SECRET }
  state.socialAccountFindable = true
  state.existingChannel = null
  state.existingConversationId = null
  state.dedupExisting = null
  state.inserts = { channels: [], conversations: [], links: [], messages: [] }
  state.updates = { conversations: [] }
})

describe('Instagram DM end-to-end pipeline (real code, mocked DB only)', () => {
  it('a realistic signed Instagram DM passes verification, parses, resolves the connected account, and writes the full DB chain', async () => {
    const payload = buildRealisticInstagramPayload()
    const rawBody = JSON.stringify(payload)
    const req = makeSignedRequest(rawBody)

    const res = await POST(req, { params: { platform: 'instagram' } })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.leadsFromMessages).toBe(1) // proves signature passed AND parsing AND capture all succeeded

    // Channel resolved/created for the CORRECT connected account (config carries the exact IG id)
    expect(state.inserts.channels).toHaveLength(1)
    expect(state.inserts.channels[0]).toMatchObject({
      channel_type: 'instagram',
      display_name: 'skyline.monurama',
      config: { external_account_id: IG_ACCOUNT_ID, social_account_id: 'acct-skyline-1' },
    })

    // Conversation created and linked
    expect(state.inserts.conversations).toHaveLength(1)
    expect(state.inserts.links).toHaveLength(1)
    expect(state.inserts.links[0]).toMatchObject({ conversation_id: 'conv-e2e-1', channel_id: 'chan-e2e-1', channel_identity: '990011223344' })

    // Message actually recorded with the real content and correct channel/conversation
    expect(state.inserts.messages).toHaveLength(1)
    expect(state.inserts.messages[0]).toMatchObject({
      conversation_id: 'conv-e2e-1', channel_id: 'chan-e2e-1', direction: 'inbound', sender_type: 'customer',
      content: 'do u offer room', external_message_id: 'mid.e2e.test.1',
    })
  })

  it('rejects the same realistic payload when signed with the wrong secret (proves verification is not a no-op)', async () => {
    const payload = buildRealisticInstagramPayload()
    const rawBody = JSON.stringify(payload)
    const wrongSig = 'sha256=' + crypto.createHmac('sha256', 'totally-wrong-secret').update(rawBody, 'utf8').digest('hex')
    const req = new Request('https://crm.bookmyspaces.in/api/social/webhook/instagram', {
      method: 'POST', headers: { 'x-hub-signature-256': wrongSig }, body: rawBody,
    })
    const res = await POST(req, { params: { platform: 'instagram' } })
    expect(res.status).toBe(401)
    expect(state.inserts.messages).toHaveLength(0)
  })

  it('a signed but unrecognized-account payload is rejected before any DB write (multi-account gate)', async () => {
    state.socialAccountFindable = false
    const payload = buildRealisticInstagramPayload()
    payload.entry[0].id = 'some-other-unconnected-account-id'
    payload.entry[0].messaging[0].recipient.id = 'some-other-unconnected-account-id'
    const rawBody = JSON.stringify(payload)
    const req = makeSignedRequest(rawBody)

    const res = await POST(req, { params: { platform: 'instagram' } })
    const json = await res.json()

    expect(res.status).toBe(200) // still 200 to Meta -- rejection is silent/internal, not an HTTP error
    expect(json.leadsFromMessages).toBe(0)
    expect(state.inserts.channels).toHaveLength(0)
    expect(state.inserts.messages).toHaveLength(0)
  })
})
