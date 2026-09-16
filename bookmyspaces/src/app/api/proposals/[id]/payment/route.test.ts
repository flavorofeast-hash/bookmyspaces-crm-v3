import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = {
  proposal: null as Record<string, unknown> | null,
  payments: [] as Array<Record<string, unknown>>,
}

function makeProposal(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'prop-028',
    client_name: 'Mia Amore',
    proposal_number: 'BMS-2026-028',
    total_price: 3000,
    ...overrides,
  }
}

vi.mock('@/lib/auth-guard', () => ({
  requireAuth: () => Promise.resolve({ ok: true, user: { id: 'u1', email: 'staff@bookmyspaces.in' } }),
}))

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table === 'proposals') {
        return {
          select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: state.proposal, error: state.proposal ? null : { message: 'not found' } }) }) }),
          update: () => ({ eq: () => ({ in: () => Promise.resolve({ data: null, error: null }) }) }),
        }
      }
      if (table === 'payments') {
        return {
          select: () => ({ eq: () => Promise.resolve({ data: state.payments, error: null }) }),
          insert: (payload: Record<string, unknown>) => ({
            select: () => ({
              single: () => Promise.resolve({ data: { id: 'pay-1', ...payload }, error: null }),
            }),
          }),
        }
      }
      if (table === 'activity_logs') {
        return { insert: () => ({ throwOnError: () => Promise.resolve({ data: null, error: null }) }) }
      }
      if (table === 'admin_audit_log') {
        return { insert: () => Promise.resolve({ error: null }) }
      }
      throw new Error(`unexpected table: ${table}`)
    },
  }),
}))

import { POST } from './route'

function makeRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/proposals/prop-028/payment', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }) as any
}

beforeEach(() => {
  state.proposal = makeProposal()
  state.payments = []
})

describe('POST /api/proposals/[id]/payment — outstanding-balance cap (regression for the ₹25,000 carry-over bug)', () => {
  it('rejects an amount greater than the outstanding balance', async () => {
    // Proposal BMS-2026-028: total ₹3,000, nothing paid yet — outstanding is ₹3,000.
    // A stale ₹25,000 carried over from a different proposal must be rejected server-side too.
    const res = await POST(makeRequest({ amount: 25000, payment_type: 'advance' }), { params: { id: 'prop-028' } })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/outstanding balance/i)
  })

  it('accounts for payments already recorded when computing the outstanding balance', async () => {
    state.payments = [{ amount: 500 }] // ₹500 already paid against a ₹3,000 total
    // ₹3,000 requested, but only ₹2,500 remains outstanding
    const res = await POST(makeRequest({ amount: 3000, payment_type: 'advance' }), { params: { id: 'prop-028' } })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/outstanding balance/i)
  })

  it('accepts an amount equal to the outstanding balance', async () => {
    const res = await POST(makeRequest({ amount: 3000, payment_type: 'advance' }), { params: { id: 'prop-028' } })
    expect(res.status).toBe(201)
  })

  it('accepts an amount less than the outstanding balance', async () => {
    const res = await POST(makeRequest({ amount: 1500, payment_type: 'advance' }), { params: { id: 'prop-028' } })
    expect(res.status).toBe(201)
  })

  it('rejects non-finite / non-numeric amounts (preserves the existing NaN-safety fix)', async () => {
    const res = await POST(makeRequest({ amount: 'abc', payment_type: 'advance' }), { params: { id: 'prop-028' } })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/valid amount/i)
  })

  it('exempts refunds from the outstanding-balance cap (preserves the existing refund workflow)', async () => {
    state.payments = [{ amount: 3000 }] // fully paid — outstanding is ₹0
    // A ₹3,000 refund is allowed even though it's "above" the ₹0 outstanding balance
    const res = await POST(makeRequest({ amount: 3000, payment_type: 'refund' }), { params: { id: 'prop-028' } })
    expect(res.status).toBe(201)
  })
})
