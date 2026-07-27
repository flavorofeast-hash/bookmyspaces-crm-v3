import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { getTaxRatePercent, splitInclusiveTax } from './tax'

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

describe('splitInclusiveTax', () => {
  it('returns zero tax and an unchanged total when rate is 0 (default, backward-compatible behavior)', () => {
    const split = splitInclusiveTax(20000, 0)
    expect(split).toEqual({ totalAmount: 20000, baseAmount: 20000, taxAmount: 0, ratePercent: 0 })
  })

  it('never changes totalAmount regardless of rate — the core backward-compatibility invariant', () => {
    expect(splitInclusiveTax(20000, 12).totalAmount).toBe(20000)
    expect(splitInclusiveTax(20000, 18).totalAmount).toBe(20000)
  })

  it('splits an inclusive total into base + tax at a 12% rate', () => {
    const split = splitInclusiveTax(11200, 12)
    expect(split.baseAmount).toBe(10000)
    expect(split.taxAmount).toBe(1200)
    expect(split.ratePercent).toBe(12)
  })

  it('base + tax always sum back to the original total (no rounding leak)', () => {
    const split = splitInclusiveTax(20000, 18)
    expect(Math.round((split.baseAmount + split.taxAmount) * 100) / 100).toBe(20000)
  })

  it('treats a non-numeric/undefined totalAmount as 0 rather than producing NaN', () => {
    const split = splitInclusiveTax(Number('not-a-number'), 12)
    expect(split.totalAmount).toBe(0)
    expect(split.taxAmount).toBe(0)
  })

  it('uses getTaxRatePercent() as the default when no rate argument is passed', () => {
    const original = process.env.DEFAULT_TAX_RATE_PERCENT
    process.env.DEFAULT_TAX_RATE_PERCENT = '18'
    try {
      const split = splitInclusiveTax(11800)
      expect(split.ratePercent).toBe(18)
      expect(split.taxAmount).toBe(1800)
    } finally {
      if (original === undefined) delete process.env.DEFAULT_TAX_RATE_PERCENT
      else process.env.DEFAULT_TAX_RATE_PERCENT = original
    }
  })
})
