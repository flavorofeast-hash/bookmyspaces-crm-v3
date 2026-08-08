import { describe, it, expect, vi, beforeEach } from 'vitest'

// Production Stabilization (Priority 5) — Inbox Conversation Assignment.
// Covers the new PATCH /api/inbox/[id] handler: reassigns leads.assigned_to
// via the conversation's linked customer_id, logs a best-effort journey
// event (so it appears on the Customer Timeline for free), and rejects a
// conversation with no linked lead.

const VALID_ID = '11111111-1111-1111-1111-111111111111'

const state = {
  conversation: null as { id: string; customer_id: string | null } | null,
  updatedLead: null as { id: string; assigned_to: string | null } | null,
  updateError: null as { message: string } | null,
}

vi.mock('@/lib/auth-guard', () => ({
  requireAuth: vi.fn(() => Promise.resolve({ ok: true, user: { id: 'user-1', email: 'ops@bookmyspaces.in' } })),
}))

vi.mock('@/lib/customers/journey', () => ({
  logJourneyEvent: vi.fn(() => Promise.resolve(undefined)),
}))

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table === 'unified_conversations') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: state.conversation, error: null }),
            }),
          }),
        }
      }
      if (table === 'leads') {
        return {
          update: (patch: { assigned_to: string | null }) => ({
            eq: () => ({
              select: () => ({
                single: () => {
                  if (state.updateError) return Promise.resolve({ data: null, error: state.updateError })
                  state.updatedLead = { id: state.conversation?.customer_id ?? '', assigned_to: patch.assigned_to }
                  return Promise.resolve({ data: state.updatedLead, error: null })
                },
              }),
            }),
          }),
        }
      }
      throw new Error(`unexpected table: ${table}`)
    },
  }),
}))

import { PATCH } from './route'
import { logJourneyEvent } from '@/lib/customers/journey'

function patchRequest(body: unknown) {
  return new Request(`http://localhost/api/inbox/${VALID_ID}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  state.conversation = { id: VALID_ID, customer_id: 'lead-1' }
  state.updatedLead = null
  state.updateError = null
  vi.clearAllMocks()
})

describe('PATCH /api/inbox/[id] — conversation assignment', () => {
  it('assigns the linked lead and logs a journey event', async () => {
    const res = await PATCH(patchRequest({ assigned_to: 'Priya' }), { params: { id: VALID_ID } })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.lead).toEqual({ id: 'lead-1', assigned_to: 'Priya' })
    expect(logJourneyEvent).toHaveBeenCalledWith(
      'lead-1',
      'conversation_assigned',
      'Assigned to Priya',
      expect.objectContaining({ conversationId: VALID_ID, assignedTo: 'Priya' })
    )
  })

  it('unassigns when assigned_to is null', async () => {
    const res = await PATCH(patchRequest({ assigned_to: null }), { params: { id: VALID_ID } })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.lead.assigned_to).toBeNull()
    expect(logJourneyEvent).toHaveBeenCalledWith('lead-1', 'conversation_assigned', 'Unassigned', expect.anything())
  })

  it('rejects a conversation with no linked lead', async () => {
    state.conversation = { id: VALID_ID, customer_id: null }
    const res = await PATCH(patchRequest({ assigned_to: 'Priya' }), { params: { id: VALID_ID } })

    expect(res.status).toBe(400)
    expect(logJourneyEvent).not.toHaveBeenCalled()
  })

  it('returns 404 for a conversation that does not exist', async () => {
    state.conversation = null
    const res = await PATCH(patchRequest({ assigned_to: 'Priya' }), { params: { id: VALID_ID } })

    expect(res.status).toBe(404)
  })

  it('rejects an invalid conversation id', async () => {
    const res = await PATCH(patchRequest({ assigned_to: 'Priya' }), { params: { id: 'not-a-uuid' } })
    expect(res.status).toBe(404)
  })

  it('rejects an empty-string assignee (must be null to unassign, not "")', async () => {
    const res = await PATCH(patchRequest({ assigned_to: '' }), { params: { id: VALID_ID } })
    expect(res.status).toBe(400)
  })

  it('returns 500 when the lead update fails', async () => {
    state.updateError = { message: 'db down' }
    const res = await PATCH(patchRequest({ assigned_to: 'Priya' }), { params: { id: VALID_ID } })
    expect(res.status).toBe(500)
  })
})
