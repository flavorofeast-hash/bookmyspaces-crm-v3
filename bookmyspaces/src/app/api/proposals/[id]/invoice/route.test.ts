import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = {
  authOk: true,
  proposal: null as Record<string, unknown> | null,
  payments: [] as Array<Record<string, unknown>>,
  existingInvoice: null as Record<string, unknown> | null,
  billing: { gstRatePercent: 5, gstin: '19AOIPB1154J1Z2', businessName: 'BookMySpaces', businessUnitLine: 'An Unit of Flavors of East' },
}

function makeProposal(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'prop-1',
    proposal_number: 'BMS-2026-001',
    client_name: 'Rohit Jaiswal',
    client_phone: '9836014495',
    client_email: '',
    package_name: 'Silver',
    venue: 'Monurama',
    event_type: 'Birthday',
    event_date: '2026-09-20',
    base_price: 50000,
    room_items: [],
    addons: [],
    discount_amount: 0,
    total_price: 50000,
    reservation_id: null,
    ...overrides,
  }
}

vi.mock('@/lib/auth-guard', () => ({
  requireAuth: () => Promise.resolve(state.authOk ? { ok: true, user: { id: 'u1', email: 'staff@bookmyspaces.in' } } : { ok: false, response: new Response('no', { status: 401 }) }),
}))

vi.mock('@/lib/settings/settings-service', () => ({
  getSettingsSection: (key: string) => Promise.resolve(key === 'billing' ? state.billing : {}),
}))

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table === 'proposals') {
        return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: state.proposal, error: state.proposal ? null : { message: 'not found' } }) }) }) }
      }
      if (table === 'payments') {
        return { select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: state.payments }) }) }) }
      }
      if (table === 'invoices') {
        return {
          select: () => ({ eq: () => ({ limit: () => ({ maybeSingle: () => Promise.resolve({ data: state.existingInvoice }) }) }) }),
          insert: (payload: Record<string, unknown>) => ({
            select: () => ({
              single: () => {
                state.existingInvoice = { id: 'inv-1', invoice_number: 'INV-2026-0001', created_at: '2026-09-05T00:00:00Z', ...payload }
                return Promise.resolve({ data: state.existingInvoice, error: null })
              },
            }),
          }),
          update: (payload: Record<string, unknown>) => ({
            eq: () => ({
              select: () => ({
                single: () => {
                  state.existingInvoice = { ...(state.existingInvoice as object), ...payload }
                  return Promise.resolve({ data: state.existingInvoice, error: null })
                },
              }),
            }),
          }),
        }
      }
      if (table === 'reservations') {
        return { update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }) }
      }
      throw new Error(`unexpected table: ${table}`)
    },
  }),
}))

import { GET } from './route'

function makeRequest(query: string) {
  return { url: `https://crm.bookmyspaces.in/api/proposals/prop-1/invoice${query ? `?${query}` : ''}` } as unknown as Parameters<typeof GET>[0]
}
const ctx = { params: { id: 'prop-1' } }

beforeEach(() => {
  state.authOk = true
  state.proposal = makeProposal()
  state.payments = []
  state.existingInvoice = null
  state.billing = { gstRatePercent: 5, gstin: '19AOIPB1154J1Z2', businessName: 'BookMySpaces', businessUnitLine: 'An Unit of Flavors of East' }
})

describe('GET /api/proposals/[id]/invoice — checkOnly status', () => {
  it('reports exists:false before any invoice has been generated', async () => {
    const res = await GET(makeRequest('checkOnly=1'), ctx)
    const json = await res.json()
    expect(json).toEqual({ exists: false, taxMode: null, isInterState: false })
  })
})

describe('GET /api/proposals/[id]/invoice — Test 2: GST final billing', () => {
  it('applies 5% GST as CGST+SGST for intra-state, shows GSTIN, deducts the advance, correct balance', async () => {
    state.payments = [{ id: 'p1', amount: 10000, payment_date: '2026-09-01', payment_mode: 'upi', receipt_number: 'RCPT-2026-0001' }]
    const res = await GET(makeRequest('tax_mode=GST&interstate=false'), ctx)
    const html = await res.text()

    expect(res.status).toBe(200)
    expect(state.existingInvoice).toMatchObject({
      tax_mode: 'GST', is_interstate: false, gst_rate_percent: 5, gstin: '19AOIPB1154J1Z2',
      cgst_amount: 1250, sgst_amount: 1250, igst_amount: 0,
      tax_amount: 2500, total_amount: 52500, advance_received: 10000, balance_due: 42500,
    })
    expect(html).toContain('19AOIPB1154J1Z2') // GSTIN displayed
    expect(html).toContain('CGST @ 2.5%')
    expect(html).toContain('SGST @ 2.5%')
    expect(html).toContain('An Unit of Flavors of East')
  })

  it('applies 5% GST as IGST for inter-state billing', async () => {
    const res = await GET(makeRequest('tax_mode=GST&interstate=true'), ctx)
    const html = await res.text()
    expect(res.status).toBe(200)
    expect(state.existingInvoice).toMatchObject({ cgst_amount: 0, sgst_amount: 0, igst_amount: 2500 })
    expect(html).toContain('IGST @ 5%')
    expect(html).not.toContain('CGST @')
  })
})

describe('GET /api/proposals/[id]/invoice — Test 3: Non-GST final billing', () => {
  it('has no GST, no GSTIN, still deducts the advance correctly', async () => {
    state.payments = [{ id: 'p1', amount: 10000, payment_date: '2026-09-01', payment_mode: 'cash', receipt_number: 'RCPT-2026-0001' }]
    const res = await GET(makeRequest('tax_mode=NON_GST'), ctx)
    const html = await res.text()

    expect(res.status).toBe(200)
    expect(state.existingInvoice).toMatchObject({
      tax_mode: 'NON_GST', gstin: null, cgst_amount: 0, sgst_amount: 0, igst_amount: 0,
      tax_amount: 0, total_amount: 50000, advance_received: 10000, balance_due: 40000,
    })
    expect(html).not.toContain('19AOIPB1154J1Z2')
    expect(html).not.toContain('CGST')
    expect(html).not.toContain('SGST')
    expect(html).not.toContain('IGST')
  })

  it('defaults to NON_GST (never silently adds GST) when tax_mode is omitted on first generation', async () => {
    await GET(makeRequest(''), ctx)
    expect(state.existingInvoice).toMatchObject({ tax_mode: 'NON_GST', gstin: null })
  })
})

describe('GET /api/proposals/[id]/invoice — Test 4: historical snapshot immutability', () => {
  it('a GST invoice keeps its original rate/GSTIN/amounts even after billing config changes and it is reopened', async () => {
    // First generation — GST at 5%, real GSTIN.
    await GET(makeRequest('tax_mode=GST&interstate=false'), ctx)
    const firstSnapshot = { ...(state.existingInvoice as object) }
    expect(firstSnapshot).toMatchObject({ gst_rate_percent: 5, gstin: '19AOIPB1154J1Z2', cgst_amount: 1250, sgst_amount: 1250 })

    // Config changes AFTER the invoice was finalized.
    state.billing = { ...state.billing, gstRatePercent: 18, gstin: 'DIFFERENT_GSTIN' }

    // Reopen (no tax_mode param — regeneration path must ignore it entirely).
    const res = await GET(makeRequest(''), ctx)
    const html = await res.text()

    expect(res.status).toBe(200)
    expect(state.existingInvoice).toMatchObject({
      tax_mode: 'GST', gst_rate_percent: 5, gstin: '19AOIPB1154J1Z2',
      cgst_amount: 1250, sgst_amount: 1250, tax_amount: 2500, total_amount: 52500,
    })
    expect(html).toContain('19AOIPB1154J1Z2')
    expect(html).not.toContain('DIFFERENT_GSTIN')
  })
})

describe('GET /api/proposals/[id]/invoice — Test 5: Non-GST invoice never shows GST info', () => {
  it('GST info never appears anywhere in the rendered HTML for a NON_GST invoice, including print mode', async () => {
    const res = await GET(makeRequest('tax_mode=NON_GST&print=1'), ctx)
    const html = await res.text()
    expect(html).not.toMatch(/GSTIN/i)
    expect(html).not.toMatch(/CGST|SGST|IGST/)
  })
})

describe('GET /api/proposals/[id]/invoice — error handling', () => {
  it('returns 404 when the proposal does not exist', async () => {
    state.proposal = null
    const res = await GET(makeRequest(''), ctx)
    expect(res.status).toBe(404)
  })
})
