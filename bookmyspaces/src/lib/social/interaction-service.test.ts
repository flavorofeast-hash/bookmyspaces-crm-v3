import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/social/interaction-service.test.ts
// Sprint 3 (Social CRM) — first test coverage for this file. Exercises
// classifyInteractionIntent() (pure function) and ingestInteraction()'s
// auto-lead-linking behavior (never-duplicate paths).
// ─────────────────────────────────────────────────────────────────────────────

const state = {
  existingInteraction: null as { id: string } | null,
  insertedInteraction: null as Record<string, unknown> | null,
  priorLinkedCustomerId: null as string | null,
  activityLogs: [] as Record<string, unknown>[],
  updatedCustomerId: null as string | null,
}

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table === 'social_interactions') {
        // Both real query chains call .eq().eq() first, then diverge: the
        // dedup check calls .maybeSingle() directly; the prior-link lookup
        // calls .not().order().limit().maybeSingle(). Both must be
        // available on the object returned after the second .eq().
        const afterTwoEq = {
          maybeSingle: () => Promise.resolve({ data: state.existingInteraction, error: null }),
          not: () => ({
            order: () => ({
              limit: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: state.priorLinkedCustomerId ? { customer_id: state.priorLinkedCustomerId } : null,
                    error: null,
                  }),
              }),
            }),
          }),
        }
        return {
          select: () => ({ eq: () => ({ eq: () => afterTwoEq }) }),
          insert: (row: Record<string, unknown>) => {
            state.insertedInteraction = row
            return { select: () => ({ single: () => Promise.resolve({ data: { id: 'interaction-1' }, error: null }) }) }
          },
          update: (patch: Record<string, unknown>) => ({
            eq: () => {
              state.updatedCustomerId = patch.customer_id as string
              return Promise.resolve({ data: null, error: null })
            },
          }),
        }
      }
      if (table === 'activity_logs') {
        return {
          insert: (row: Record<string, unknown>) => {
            state.activityLogs.push(row)
            return Promise.resolve({ data: null, error: null })
          },
        }
      }
      throw new Error(`unexpected table in interaction-service test: ${table}`)
    },
  }),
}))

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))

const captureLeadWithJourneyMock = vi.fn(async (..._args: unknown[]) => ({ leadId: 'lead-new', isNew: true }))
vi.mock('@/lib/leads/create-lead-with-journey', () => ({
  captureLeadWithJourney: (...args: unknown[]) => captureLeadWithJourneyMock(...args),
}))

import { classifySentiment, classifyInteractionIntent, ingestInteraction } from './interaction-service'
import type { NormalizedInteraction } from './types'

function makeInteraction(overrides: Partial<NormalizedInteraction> = {}): NormalizedInteraction {
  return {
    platform: 'facebook',
    interactionType: 'comment',
    externalId: 'ext-1',
    authorName: 'Priya Sharma',
    authorExternalId: 'author-abc',
    content: 'Nice venue!',
    ...overrides,
  }
}

beforeEach(() => {
  state.existingInteraction = null
  state.insertedInteraction = null
  state.priorLinkedCustomerId = null
  state.activityLogs = []
  state.updatedCustomerId = null
  captureLeadWithJourneyMock.mockClear()
  captureLeadWithJourneyMock.mockResolvedValue({ leadId: 'lead-new', isNew: true })
})

describe('classifySentiment', () => {
  it('detects negative/positive/neutral/null the same as before this change', () => {
    expect(classifySentiment('This was the worst experience')).toBe('negative')
    expect(classifySentiment('Amazing place, loved it')).toBe('positive')
    expect(classifySentiment('Just visited yesterday')).toBe('neutral')
    expect(classifySentiment(null)).toBeNull()
  })
})

describe('classifyInteractionIntent', () => {
  it('returns null for text with no discernible intent', () => {
    expect(classifyInteractionIntent('Beautiful sunset shot!')).toBeNull()
    expect(classifyInteractionIntent(null)).toBeNull()
    expect(classifyInteractionIntent('')).toBeNull()
  })

  it('classifies spam before anything else', () => {
    expect(classifyInteractionIntent('Follow for follow, check my bio!')).toBe('spam')
    expect(classifyInteractionIntent('DM me for collab, visit https://example.com')).toBe('spam')
  })

  it('classifies complaint text', () => {
    expect(classifyInteractionIntent('Terrible service, I want a refund')).toBe('complaint')
    expect(classifyInteractionIntent('This was a scam, never coming back')).toBe('complaint')
  })

  it('classifies explicit booking-intent phrases as booking_intent', () => {
    expect(classifyInteractionIntent('How do I book this venue for December?')).toBe('booking_intent')
  })

  it('classifies price/availability questions as enquiry', () => {
    expect(classifyInteractionIntent('What is the price for a wedding package?')).toBe('enquiry')
    expect(classifyInteractionIntent('Is this available next month?')).toBe('enquiry')
    expect(classifyInteractionIntent('Do you host corporate events?')).toBe('enquiry')
  })

  it('prioritizes complaint over booking_intent when both patterns could match', () => {
    // Contains a refund/complaint word AND a question mark — complaint wins.
    expect(classifyInteractionIntent('I want a refund, how do I book a refund exactly?')).toBe('complaint')
  })
})

describe('ingestInteraction', () => {
  it('returns duplicate:true without inserting when (platform, external_id) already exists', async () => {
    state.existingInteraction = { id: 'existing-1' }
    const result = await ingestInteraction(makeInteraction())
    expect(result).toEqual({ ok: true, id: 'existing-1', duplicate: true })
    expect(state.insertedInteraction).toBeNull()
    expect(captureLeadWithJourneyMock).not.toHaveBeenCalled()
  })

  it('stores the classified intent on the new row', async () => {
    await ingestInteraction(makeInteraction({ content: 'How much for a 50 guest wedding?' }))
    expect(state.insertedInteraction?.intent).toBe('enquiry')
  })

  it('never creates a lead for a comment with no discernible intent', async () => {
    await ingestInteraction(makeInteraction({ content: 'Beautiful sunset shot!' }))
    expect(captureLeadWithJourneyMock).not.toHaveBeenCalled()
    expect(state.updatedCustomerId).toBeNull()
  })

  it('never creates a lead for spam', async () => {
    await ingestInteraction(makeInteraction({ content: 'Follow for follow, check my bio!' }))
    expect(captureLeadWithJourneyMock).not.toHaveBeenCalled()
  })

  it('creates a lead via phone extraction when a phone number is present, without sending a welcome message', async () => {
    await ingestInteraction(makeInteraction({ content: 'Please call me on 9876543210, how much for a wedding?' }))
    expect(captureLeadWithJourneyMock).toHaveBeenCalledTimes(1)
    const arg = captureLeadWithJourneyMock.mock.calls[0][0] as Record<string, unknown>
    expect(arg.phone).toBe('9876543210')
    expect(arg.sendWelcome).toBe(false)
    expect(state.updatedCustomerId).toBe('lead-new')
  })

  it('reuses an existing lead for a repeat commenter (same platform + author_external_id) instead of creating a duplicate', async () => {
    state.priorLinkedCustomerId = 'lead-existing'
    await ingestInteraction(makeInteraction({ content: 'What is the price for a rooftop event?' }))
    expect(captureLeadWithJourneyMock).not.toHaveBeenCalled()
    expect(state.updatedCustomerId).toBe('lead-existing')
    expect(state.activityLogs).toHaveLength(1)
    expect(state.activityLogs[0]).toMatchObject({ lead_id: 'lead-existing', action: 'lead_re_engaged' })
  })

  it('creates a contact-less lead for a first-time enquiry with no phone/email/prior link', async () => {
    await ingestInteraction(makeInteraction({ content: 'Do you have packages for a birthday party?' }))
    expect(captureLeadWithJourneyMock).toHaveBeenCalledTimes(1)
    const arg = captureLeadWithJourneyMock.mock.calls[0][0] as Record<string, unknown>
    expect(arg.phone).toBeUndefined()
    expect(arg.email).toBeUndefined()
    expect(state.updatedCustomerId).toBe('lead-new')
  })

  it('does not create any lead for a positive comment with no enquiry signal and no prior link', async () => {
    await ingestInteraction(makeInteraction({ content: 'Loved the ambience here!' }))
    expect(captureLeadWithJourneyMock).not.toHaveBeenCalled()
    expect(state.updatedCustomerId).toBeNull()
  })
})
