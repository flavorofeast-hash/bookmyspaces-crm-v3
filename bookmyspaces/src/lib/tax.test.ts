import { describe, it, expect, afterEach } from 'vitest'
import { getTaxRatePercent, calculateGst } from './tax'

describe('getTaxRatePercent', () => {
  const original = process.env.DEFAULT_TAX_RATE_PERCENT

  afterEach(() => {
    if (original === undefined) delete process.env.DEFAULT_TAX_RATE_PERCENT
    else process.env.DEFAULT_TAX_RATE_PERCENT = original
  })

  it('defaults to 0 when unset — preserves today\'s behavior', () => {
    delete process.env.DEFAULT_TAX_RATE_PERCENT
    expect(getTaxRatePercent()).toBe(0)
  })

  it('reads a configured rate', () => {
    process.env.DEFAULT_TAX_RATE_PERCENT = '12'
    expect(getTaxRatePercent()).toBe(12)
  })

  it('falls back to 0 for an unparseable value rather than throwing', () => {
    process.env.DEFAULT_TAX_RATE_PERCENT = 'not-a-number'
    expect(getTaxRatePercent()).toBe(0)
  })

  it('falls back to 0 for an out-of-range value (negative or over 100)', () => {
    process.env.DEFAULT_TAX_RATE_PERCENT = '-5'
    expect(getTaxRatePercent()).toBe(0)
    process.env.DEFAULT_TAX_RATE_PERCENT = '150'
    expect(getTaxRatePercent()).toBe(0)
  })
})

describe('calculateGst', () => {
  it('NON_GST (rate 0): returns all-zero tax and gross === base, unchanged', () => {
    const gst = calculateGst(50000, 0, false)
    expect(gst).toEqual({
      baseAmount: 50000, ratePercent: 0, isInterState: false,
      cgstAmount: 0, sgstAmount: 0, igstAmount: 0,
      taxAmount: 0, grossAmount: 50000,
    })
  })

  it('GST is added ON TOP of the base amount — the core exclusive-tax invariant (spec §4 example)', () => {
    const gst = calculateGst(50000, 5, false)
    expect(gst.baseAmount).toBe(50000)
    expect(gst.taxAmount).toBe(2500)
    expect(gst.grossAmount).toBe(52500) // 50,000 + 2,500 — NOT a split of 52,500
  })

  it('intra-state (5%): splits evenly into CGST 2.5% + SGST 2.5%', () => {
    const gst = calculateGst(50000, 5, false)
    expect(gst.cgstAmount).toBe(1250)
    expect(gst.sgstAmount).toBe(1250)
    expect(gst.igstAmount).toBe(0)
    expect(gst.cgstAmount + gst.sgstAmount).toBe(gst.taxAmount)
  })

  it('inter-state (5%): charges the full rate as IGST, no CGST/SGST', () => {
    const gst = calculateGst(50000, 5, true)
    expect(gst.igstAmount).toBe(2500)
    expect(gst.cgstAmount).toBe(0)
    expect(gst.sgstAmount).toBe(0)
  })

  it('matches the exact worked example from the spec (₹50,000 + 5% GST = ₹52,500)', () => {
    const gst = calculateGst(50000, 5, false)
    expect(gst.cgstAmount).toBe(1250)
    expect(gst.sgstAmount).toBe(1250)
    expect(gst.grossAmount).toBe(52500)
  })

  it('treats a non-numeric/undefined baseAmount as 0 rather than producing NaN', () => {
    const gst = calculateGst(Number('not-a-number'), 5, false)
    expect(gst.baseAmount).toBe(0)
    expect(gst.taxAmount).toBe(0)
    expect(gst.grossAmount).toBe(0)
  })

  it('CGST + SGST always sum exactly to taxAmount even with odd amounts (no rounding leak)', () => {
    const gst = calculateGst(333.33, 5, false)
    expect(Math.round((gst.cgstAmount + gst.sgstAmount) * 100) / 100).toBe(gst.taxAmount)
  })

  it('a different configured rate (12%) is honored, not hardcoded to 5', () => {
    const gst = calculateGst(10000, 12, false)
    expect(gst.taxAmount).toBe(1200)
    expect(gst.cgstAmount).toBe(600)
    expect(gst.sgstAmount).toBe(600)
  })
})
