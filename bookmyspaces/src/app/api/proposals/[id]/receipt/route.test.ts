import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = {
  authOk: true,
  proposal: null as Record<string, unknown> | null,
  payment: null as Record<string, unknown> | null,
}

vi.mock('@/lib/auth-guard', () => ({
  requireAuth: () => Promise.resolve(state.authOk ? { ok: true, user: { id: 'u1' } } : { ok: false, response: new Response('no', { status: 401 }) }),
}))

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table === 'proposals') {
        return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: state.proposal, error: state.proposal ? null : { message: 'not found' } }) }) }) }
      }
      if (table === 'payments') {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({ limit: () => Promise.resolve({ data: state.payment ? [state.payment] : [], error: null }) }),
            }),
          }),
        }
      }
      throw new Error(`unexpected table: ${table}`)
    },
  }),
}))

import { GET } from './route'

function makeRequest() {
  return { url: 'https://crm.bookmyspaces.in/api/proposals/prop-1/receipt' } as unknown as Parameters<typeof GET>[0]
}
const ctx = { params: { id: 'prop-1' } }

beforeEach(() => {
  state.authOk = true
  state.proposal = {
    id: 'prop-1', proposal_number: 'BMS-2026-001', client_name: 'Rohit Jaiswal',
    client_phone: '9836014495', total_price: 50000, advance_paid: 10000,
  }
  state.payment = {
    id: 'pay-1', receipt_number: 'RCPT-2026-0001', amount: 10000, payment_date: '2026-09-01',
    payment_mode: 'upi', payment_type: 'advance', transaction_ref: null, notes: null,
  }
})

describe('GET /api/proposals/[id]/receipt — Test 1: advance receipt has no GST', () => {
  it('shows the business identity but never any GST/GSTIN/tax fields', async () => {
    const res = await GET(makeRequest(), ctx)
    const html = await res.text()

    expect(res.status).toBe(200)
    expect(html).toContain('BookMySpaces')
    expect(html).toContain('An Unit of Flavors of East')
    expect(html).not.toMatch(/GSTIN/i)
    expect(html).not.toMatch(/CGST|SGST|IGST/)
    expect(html).not.toMatch(/GST\s*rate/i)
    expect(html).toContain('₹10,000') // amount received, recorded plainly
  })
})
