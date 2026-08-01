import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/leads/rc2-journey-validation.integration.test.ts
// RC2 Production Readiness — Real Business Validation.
//
// Chains the REAL functions each of the 8 required customer journeys pass
// through — runAutoPackageRecommendation (Package Recommendation + Pricing +
// Proposal Draft + Property Intelligence guard) and runVisitToProposalConversion
// (the Site-Visit-Completed trigger) — against ONE shared mock, same "one
// shared mock, real call chain" style as reservation-to-proposal.integration.test.ts
// and auto-package-recommendation.test.ts (whose exact mocking approach this
// file reuses). Nothing here reimplements business logic; it only chains
// already-tested pieces the way a real customer journey actually calls them,
// which is the one thing the per-file unit tests don't individually prove.
//
// What this file intentionally does NOT attempt: driving the actual AI
// conversation (chatWithAI/Anthropic) or the Next.js route handlers
// (POST /api/chat, PATCH /api/site-visits/[id]) end-to-end. Those require a
// live LLM call and a live NextRequest — outside what this sandbox can
// exercise deterministically. The conversational/prompt-level guarantees for
// Journeys 5, 7, 8 (pricing-only answers, visit-request phrasing, "never
// bring it up again") are verified instead by direct inspection of
// src/lib/ai.ts's SYSTEM_PROMPT (see RC2_READINESS_REPORT.md) — this file
// verifies everything downstream of that conversation: lead → visit → guard
// → proposal → no duplicates.
// ─────────────────────────────────────────────────────────────────────────────

const state = {
  lead: null as Record<string, unknown> | null,
  existingProposalCount: 0,
  advisorResult: null as any,
  pkg: null as any,
  insertedProposals: [] as Record<string, unknown>[],
  visit: null as Record<string, unknown> | null,
  leadUpdatePayload: null as Record<string, unknown> | null,
}

function resetState() {
  state.lead = null
  state.existingProposalCount = 0
  state.advisorResult = null
  state.pkg = null
  state.insertedProposals = []
  state.visit = null
  state.leadUpdatePayload = null
}

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table === 'leads') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: state.lead, error: null }),
            }),
          }),
          update: (payload: Record<string, unknown>) => {
            state.leadUpdatePayload = payload
            Object.assign(state.lead as Record<string, unknown>, payload)
            return { eq: () => Promise.resolve({ error: null }) }
          },
        }
      }
      if (table === 'proposals') {
        return {
          select: () => ({
            // matches auto-package-recommendation.ts's count-existing-proposals check
            eq: () => Promise.resolve({ count: state.existingProposalCount, error: null }),
          }),
          insert: (payload: Record<string, unknown>) => {
            const row = { id: `draft-${state.insertedProposals.length + 1}`, ...payload }
            state.insertedProposals.push(row)
            state.existingProposalCount = state.insertedProposals.length
            return { select: () => ({ single: () => Promise.resolve({ data: row, error: null }) }) }
          },
        }
      }
      if (table === 'follow_ups') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({ maybeSingle: () => Promise.resolve({ data: state.visit, error: null }) }),
            }),
          }),
        }
      }
      if (table === 'activity_logs') {
        return { insert: () => Promise.resolve({ data: null, error: null }) }
      }
      throw new Error(`unexpected table in RC2 journey validation: ${table}`)
    },
  }),
}))

vi.mock('@/lib/ai/context-builder', () => ({
  buildAIContext: vi.fn(() => Promise.resolve({})),
}))

vi.mock('@/lib/ai/operator-assistant', () => ({
  runEventSalesAdvisor: vi.fn(() => Promise.resolve(state.advisorResult)),
}))

vi.mock('@/lib/packages/package-service', () => ({
  getPackageById: vi.fn(() => Promise.resolve(state.pkg)),
  resolvePackagePrice: vi.fn((pkg: any) => ({ price: pkg.basePrice, appliedRule: null })),
}))

vi.mock('@/lib/scoring', () => ({
  generateProposalCoverNote: vi.fn(() => Promise.resolve('AI-generated cover note')),
}))

import { runAutoPackageRecommendation } from './auto-package-recommendation'
import { runVisitToProposalConversion } from './visit-to-proposal'

function makePackage(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pkg-1', name: 'Wedding Gold', venue: 'Monurama Homestay', hall: 'Rooftop',
    maxGuests: 100, basePrice: 50000, addons: [], addonServiceIds: [],
    ...overrides,
  }
}

function makeAdvisor(packageId: string | null, overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    result: {
      recommendation: { packageId, packageName: packageId ? 'Wedding Gold' : null, catering: null, decoration: null, upsells: [] },
      salesCopilot: { bookingProbability: 'HIGH' },
      ...overrides,
    },
  }
}

describe('RC2 Journey 1 — Wedding enquiry: Lead -> Site Visit -> Completed -> Proposal Draft', () => {
  beforeEach(() => {
    resetState()
    state.lead = { id: 'lead-1', name: 'Priya', phone: '9830509991', email: null, event_type: 'wedding', event_date: null, guest_count: 45, budget: '3L', venue: 'Monurama Homestay' }
    state.visit = { lead_id: 'lead-1', property: 'Monurama Homestay', purpose: 'wedding site visit', guest_count: 45, budget: '3L' }
    state.advisorResult = makeAdvisor('pkg-1')
    state.pkg = makePackage({ venue: 'Monurama Homestay', maxGuests: 60 })
  })

  it('PASS: completing the visit drafts exactly one Monurama proposal, safe-filling nothing already set', async () => {
    const result = await runVisitToProposalConversion('visit-1')
    expect(result.draftProposalId).toBe('draft-1')
    expect(state.insertedProposals).toHaveLength(1)
    expect(state.insertedProposals[0]).toMatchObject({ venue: 'Monurama Homestay', status: 'draft' })
    expect(state.leadUpdatePayload).toBeNull() // lead already had guest_count/budget/venue — no overwrite
  })

  it('PASS: marking the same visit completed twice never creates a second proposal (idempotent, no duplicate proposals)', async () => {
    await runVisitToProposalConversion('visit-1')
    await runVisitToProposalConversion('visit-1') // simulates a re-fired trigger / retried PATCH
    expect(state.insertedProposals).toHaveLength(1)
  })
})

describe('RC2 Journey 2 — Birthday enquiry: same chain, guarded the same way', () => {
  beforeEach(() => {
    resetState()
    state.lead = { id: 'lead-2', name: 'Rohan', phone: '9830509992', email: null, event_type: 'birthday', event_date: null, guest_count: 12, budget: null, venue: null }
    state.visit = { lead_id: 'lead-2', property: 'Monurama Homestay', purpose: 'birthday site visit', guest_count: 12, budget: '80k' }
    state.advisorResult = makeAdvisor('pkg-hall')
    state.pkg = makePackage({ id: 'pkg-hall', name: 'Hall 1 Birthday', venue: 'Monurama Homestay', hall: 'Hall 1', maxGuests: 15 })
  })

  it('PASS: never recommends Skyline for a birthday — guard applies via the visit-completion trigger too, not just lead-qualification', async () => {
    // Advisor misbehaving (prompt-only guidance failed) and naming a Skyline package for an event lead.
    state.advisorResult = makeAdvisor('pkg-skyline')
    state.pkg = makePackage({ id: 'pkg-skyline', venue: 'Skyline Serenity', maxGuests: 20 })

    const result = await runVisitToProposalConversion('visit-2')
    expect(result.draftProposalId).toBeNull()
    expect(state.insertedProposals).toHaveLength(0)
  })

  it('PASS: within-capacity Hall package drafts normally and safe-fills the visit-captured budget onto the lead', async () => {
    const result = await runVisitToProposalConversion('visit-2')
    expect(result.draftProposalId).toBe('draft-1')
    expect(state.leadUpdatePayload).toEqual({ budget: '80k', venue: 'Monurama Homestay' }) // budget and venue were both null on the lead
  })
})

describe('RC2 Journey 3 — Airport Stay (Skyline, accommodation-only, not an event)', () => {
  beforeEach(() => {
    resetState()
    state.lead = { id: 'lead-3', name: 'Amit', phone: '9830509993', email: null, event_type: null, event_date: null, guest_count: null, budget: null, venue: 'Skyline Serenity' }
  })

  it('WARNING (documented, not a bug): no event_type means runAutoPackageRecommendation safely no-ops — a room-stay lead never gets a fabricated event proposal', async () => {
    const result = await runAutoPackageRecommendation('lead-3')
    expect(result).toEqual({ ran: false, packageId: null, draftProposalId: null })
    expect(state.insertedProposals).toHaveLength(0)
  })
})

describe('RC2 Journey 4 — Corporate Event: Monurama 100-guest cap enforced via the visit-completion trigger', () => {
  beforeEach(() => {
    resetState()
    state.lead = { id: 'lead-4', name: 'Corp Co', phone: '9830509994', email: null, event_type: 'corporate', event_date: null, guest_count: 120, budget: '5L', venue: null }
    state.visit = { lead_id: 'lead-4', property: 'Monurama Homestay', purpose: 'corporate site visit', guest_count: 120, budget: '5L' }
    state.advisorResult = makeAdvisor('pkg-corp')
    state.pkg = makePackage({ id: 'pkg-corp', venue: 'Monurama Homestay', maxGuests: 120 })
  })

  it('FAIL if violated / PASS as implemented: refuses to draft a proposal above the 100-guest property-wide cap', async () => {
    const result = await runVisitToProposalConversion('visit-4')
    expect(result.draftProposalId).toBeNull()
    expect(state.insertedProposals).toHaveLength(0)
  })

  it('PASS: the same corporate lead at exactly 100 guests (not over) is allowed', async () => {
    state.lead = { ...state.lead, guest_count: 100 }
    state.visit = { ...state.visit, guest_count: 100 }
    state.pkg = makePackage({ id: 'pkg-corp', venue: 'Monurama Homestay', maxGuests: 100 })
    const result = await runVisitToProposalConversion('visit-4')
    expect(result.draftProposalId).toBe('draft-1')
  })
})

describe('RC2 Journey 6 — Customer wants a proposal immediately (no site visit involved)', () => {
  beforeEach(() => {
    resetState()
    state.lead = { id: 'lead-6', name: 'Sanjay', phone: '9830509996', email: null, event_type: 'wedding', event_date: null, guest_count: 50, budget: '4L', venue: null }
    state.advisorResult = makeAdvisor('pkg-1')
    state.pkg = makePackage({ venue: 'Monurama Homestay', maxGuests: 60 })
  })

  it('PASS (after fix): calling runAutoPackageRecommendation directly off the lead — same call chat/route.ts now makes once a lead has event_type — drafts a proposal with no visit required', async () => {
    const result = await runAutoPackageRecommendation('lead-6', null)
    expect(result.draftProposalId).toBe('draft-1')
    expect(state.insertedProposals).toHaveLength(1)
  })

  it('PASS: calling it twice in a row (e.g. two chat turns both carrying event_type) never creates a second proposal', async () => {
    await runAutoPackageRecommendation('lead-6', null)
    await runAutoPackageRecommendation('lead-6', null)
    expect(state.insertedProposals).toHaveLength(1)
  })
})

describe('RC2 Journey 8 — Customer never wants a site visit: still reaches a proposal via lead qualification alone', () => {
  beforeEach(() => {
    resetState()
    state.lead = { id: 'lead-8', name: 'Meera', phone: '9830509998', email: null, event_type: 'wedding', event_date: null, guest_count: 45, budget: '3L', venue: null }
    state.advisorResult = makeAdvisor('pkg-1')
    state.pkg = makePackage({ venue: 'Monurama Homestay', maxGuests: 60 })
  })

  it('PASS: a lead with no linked follow_ups/site_visit row still gets a draft proposal from event_type alone', async () => {
    // No state.visit set up at all — this journey never touches visit-to-proposal.ts.
    const result = await runAutoPackageRecommendation('lead-8', null)
    expect(result.draftProposalId).toBe('draft-1')
  })
})
