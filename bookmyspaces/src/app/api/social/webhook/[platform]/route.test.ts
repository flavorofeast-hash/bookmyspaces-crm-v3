// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/app/api/social/webhook/[platform]/route.test.ts
// Route-level tests for the Meta (Facebook/Instagram) webhook -- the piece
// genuinely uncovered before this file: verification handshake, signature
// rejection, malformed/unknown payloads, and the route's own aggregation of
// ingested/leadsFromForms/leadsFromMessages counts. Contact-matching,
// dedup, new-vs-existing-conversation behavior are unit-tested in depth
// already at src/lib/social/dm-capture-service.test.ts and
// meta-lead-capture.test.ts -- not duplicated here, only exercised through
// the route to confirm the wiring itself works end-to-end.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'

const state = {
  verified: true,
  interactions: [] as unknown[],
  leadgenEvents: [] as unknown[],
  messagingEvents: [] as unknown[],
  captureDMResult: { leadId: 'lead-1', conversationId: 'conv-1', isNewLead: false } as unknown,
}

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ allowed: true, retryAfterSeconds: 0 }),
  clientIpFrom: () => '127.0.0.1',
}))

vi.mock('@/lib/social/adapter-registry', () => ({
  getSocialAdapter: (platform: string) => {
    if (platform === 'unknown') return null
    return {
      verifyWebhook: () => Promise.resolve(state.verified),
      parseWebhook: () => state.interactions,
    }
  },
}))

vi.mock('@/lib/social/interaction-service', () => ({
  ingestInteraction: () => Promise.resolve({ ok: true, duplicate: false }),
}))

vi.mock('@/lib/social/meta-lead-capture', () => ({
  parseLeadgenEvents: () => state.leadgenEvents,
  parseMessagingEvents: () => state.messagingEvents,
  fetchLeadgenDetails: () => Promise.resolve(null),
  claimLeadgenEvent: () => Promise.resolve(true),
  linkLeadgenEventToLead: () => Promise.resolve(),
}))

vi.mock('@/lib/leads/create-lead-with-journey', () => ({
  captureLeadWithJourney: () => Promise.resolve(null),
}))

vi.mock('@/lib/social/dm-capture-service', () => ({
  captureSocialDirectMessage: () => Promise.resolve(state.captureDMResult),
}))

import { GET, POST } from './route'

function makeGetRequest(params: Record<string, string>) {
  const url = new URL('https://crm.bookmyspaces.in/api/social/webhook/instagram')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return new Request(url.toString())
}

function makePostRequest(body: string) {
  return new Request('https://crm.bookmyspaces.in/api/social/webhook/instagram', { method: 'POST', body })
}

describe('social webhook route', () => {
  const originalVerifyToken = process.env.META_VERIFY_TOKEN

  beforeEach(() => {
    state.verified = true
    state.interactions = []
    state.leadgenEvents = []
    state.messagingEvents = []
    state.captureDMResult = { leadId: 'lead-1', conversationId: 'conv-1', isNewLead: false }
    process.env.META_VERIFY_TOKEN = 'test-verify-token-123'
  })

  afterAll(() => {
    process.env.META_VERIFY_TOKEN = originalVerifyToken
  })

  describe('GET (verification handshake)', () => {
    it('1. valid verification returns the challenge with 200', async () => {
      const req = makeGetRequest({ 'hub.mode': 'subscribe', 'hub.verify_token': 'test-verify-token-123', 'hub.challenge': 'echo-me-123' })
      const res = await GET(req, { params: { platform: 'instagram' } })
      expect(res.status).toBe(200)
      expect(await res.text()).toBe('echo-me-123')
    })

    it('2. invalid verify token returns 403', async () => {
      const req = makeGetRequest({ 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong-token', 'hub.challenge': 'echo-me-123' })
      const res = await GET(req, { params: { platform: 'instagram' } })
      expect(res.status).toBe(403)
    })

    it('3. missing verification parameters returns 403', async () => {
      const req = makeGetRequest({ 'hub.mode': 'subscribe' }) // no token, no challenge
      const res = await GET(req, { params: { platform: 'instagram' } })
      expect(res.status).toBe(403)
    })

    it('returns 500 with a clear message when META_VERIFY_TOKEN is unset', async () => {
      delete process.env.META_VERIFY_TOKEN
      const req = makeGetRequest({ 'hub.mode': 'subscribe', 'hub.verify_token': 'anything', 'hub.challenge': 'x' })
      const res = await GET(req, { params: { platform: 'instagram' } })
      expect(res.status).toBe(500)
    })
  })

  describe('POST (event ingestion)', () => {
    it('rejects an unverified (bad signature) request with 401', async () => {
      state.verified = false
      const res = await POST(makePostRequest('{}'), { params: { platform: 'instagram' } })
      expect(res.status).toBe(401)
    })

    it('6. malformed JSON payload does not crash, returns 200 to Meta', async () => {
      const res = await POST(makePostRequest('{not valid json'), { params: { platform: 'instagram' } })
      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.received).toBe(0)
    })

    it('7. unknown/empty event payload returns 200 with zero counts', async () => {
      const res = await POST(makePostRequest(JSON.stringify({ entry: [] })), { params: { platform: 'instagram' } })
      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json).toEqual({ received: 0, ingested: 0, leadsFromForms: 0, leadsFromMessages: 0 })
    })

    it('4. a valid Instagram DM event is routed to captureSocialDirectMessage and counted', async () => {
      state.messagingEvents = [{ senderPsid: 'psid-1', text: 'Hi', timestamp: 1700000000, externalMessageId: 'mid-1', platform: 'instagram' }]
      state.captureDMResult = { leadId: 'lead-new', conversationId: 'conv-new', isNewLead: true } // 9. new contact
      const res = await POST(makePostRequest(JSON.stringify({ entry: [{ messaging: [] }] })), { params: { platform: 'instagram' } })
      const json = await res.json()
      expect(res.status).toBe(200)
      expect(json.leadsFromMessages).toBe(1)
    })

    it('5. / 10. a duplicate/existing-conversation DM is not counted as a new lead', async () => {
      state.messagingEvents = [{ senderPsid: 'psid-1', text: 'Hi again', timestamp: 1700000001, externalMessageId: 'mid-1', platform: 'instagram' }]
      state.captureDMResult = { leadId: 'lead-1', conversationId: 'conv-1', isNewLead: false, duplicate: true }
      const res = await POST(makePostRequest(JSON.stringify({ entry: [{ messaging: [] }] })), { params: { platform: 'instagram' } })
      const json = await res.json()
      expect(res.status).toBe(200)
      expect(json.leadsFromMessages).toBe(0)
    })

    it('returns 404 for a platform with no registered adapter', async () => {
      const res = await POST(makePostRequest('{}'), { params: { platform: 'unknown' } })
      expect(res.status).toBe(404)
    })
  })
})
