import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = {
  lead: null as Record<string, unknown> | null,
  existingProposalCount: 0,
  advisorResult: null as any,
  pkg: null as any,
  insertedProposal: null as Record<string, unknown> | null,
  insertResult: { id: 'draft-proposal-1' } as Record<string, unknown> | null,
  insertError: null as { message: string } | null,
  activityLogInserted: null as Record<string, unknown> | null,
}

function resetState() {
  state.lead = null
  state.existingProposalCount = 0
  state.advisorResult = null
  state.pkg = null
  state.insertedProposal = null
  state.insertResult = { id: 'draft-proposal-1' }
  state.insertError = null
  state.activityLogInserted = null
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
        }
      }
      if (table === 'proposals') {
        return {
          select: () => ({
            eq: () => Promise.resolve({ count: state.existingProposalCount, error: null }),
          }),
          insert: (payload: Record<string, unknown>) => {
            state.insertedProposal = payload
            return {
              select: () => ({
                single: () => Promise.resolve({ data: state.insertResult, error: state.insertError }),
              }),
            }
          },
        }
      }
      if (table === 'activity_logs') {
        return { insert: (payload: Record<string, unknown>) => { state.activityLogInserted = payload; return Promise.resolve({ data: null, error: null }) } }
      }
      throw new Error(`unexpected table ${table}`)
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

function makePackage(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pkg-1',
    name: 'Wedding Gold',
    venue: 'Monurama Homestay',
    hall: 'Rooftop',
    maxGuests: 100,
    basePrice: 50000,
    addons: [],
    addonServiceIds: [],
    ...overrides,
  }
}

function makeAdvisor(packageId: string | null) {
  return {
    ok: true,
    result: {
      recommendation: {
        packageId, packageName: packageId ? 'Wedding Gold' : null,
        catering: null, decoration: null, upsells: [],
      },
      salesCopilot: { bookingProbability: 'HIGH' },
    },
  }
}

describe('runAutoPackageRecommendation — Property Intelligence guard (Sprint 2)', () => {
  beforeEach(() => {
    resetState()
    state.lead = { id: 'lead-1', name: 'Priya', phone: '919830509991', email: null, event_type: 'wedding', event_date: null, guest_count: 60 }
    state.existingProposalCount = 0
  })

  it('creates a draft proposal for a normal, within-capacity Monurama recommendation', async () => {
    state.advisorResult = makeAdvisor('pkg-1')
    state.pkg = makePackage({ venue: 'Monurama Homestay' })

    const result = await runAutoPackageRecommendation('lead-1')

    expect(result.draftProposalId).toBe('draft-proposal-1')
    expect(state.insertedProposal).toMatchObject({ status: 'draft', package_id: 'pkg-1', venue: 'Monurama Homestay' })
  })

  it('refuses to draft a Skyline package for an event lead — Skyline is accommodation-only', async () => {
    state.advisorResult = makeAdvisor('pkg-2')
    state.pkg = makePackage({ id: 'pkg-2', venue: 'Skyline Serenity', maxGuests: 20 })

    const result = await runAutoPackageRecommendation('lead-1')

    expect(result.draftProposalId).toBeNull()
    expect(result.packageId).toBe('pkg-2')
    expect(state.insertedProposal).toBeNull()
  })

  it('refuses to draft a Monurama package that would exceed the 100-guest cap', async () => {
    state.lead = { ...state.lead, guest_count: 150 }
    state.advisorResult = makeAdvisor('pkg-3')
    state.pkg = makePackage({ id: 'pkg-3', venue: 'Monurama Homestay', maxGuests: 150 })

    const result = await runAutoPackageRecommendation('lead-1')

    expect(result.draftProposalId).toBeNull()
    expect(state.insertedProposal).toBeNull()
  })

  it('allows exactly 100 guests at Monurama (the cap is a ceiling, not exclusive)', async () => {
    state.lead = { ...state.lead, guest_count: 100 }
    state.advisorResult = makeAdvisor('pkg-4')
    state.pkg = makePackage({ id: 'pkg-4', venue: 'Monurama Homestay', maxGuests: 100 })

    const result = await runAutoPackageRecommendation('lead-1')

    expect(result.draftProposalId).toBe('draft-proposal-1')
  })

  it('skips entirely when the lead has no event_type', async () => {
    state.lead = { ...state.lead, event_type: null }
    const result = await runAutoPackageRecommendation('lead-1')
    expect(result).toEqual({ ran: false, packageId: null, draftProposalId: null })
  })

  it('skips entirely when the lead already has a proposal', async () => {
    state.existingProposalCount = 1
    const result = await runAutoPackageRecommendation('lead-1')
    expect(result).toEqual({ ran: false, packageId: null, draftProposalId: null })
  })
})
