import { describe, it, expect } from 'vitest'
import { computeOutstanding, validatePaymentAmount } from './payment-validation'

describe('computeOutstanding', () => {
  it('returns total minus what has already been paid', () => {
    expect(computeOutstanding(25000, 0)).toBe(25000)
    expect(computeOutstanding(3000, 0)).toBe(3000)
    expect(computeOutstanding(2500, 500)).toBe(2000)
  })

  it('never goes negative', () => {
    expect(computeOutstanding(3000, 5000)).toBe(0)
  })

  it('treats missing values as zero', () => {
    expect(computeOutstanding(null, null)).toBe(0)
    expect(computeOutstanding(undefined, undefined)).toBe(0)
  })
})

describe('validatePaymentAmount', () => {
  it('rejects zero or negative amounts', () => {
    expect(validatePaymentAmount(0, 3000)).toMatch(/valid amount/i)
    expect(validatePaymentAmount(-100, 3000)).toMatch(/valid amount/i)
  })

  it('rejects an amount greater than the outstanding balance (the reported bug)', () => {
    // Proposal BMS-2026-028: total ₹3,000, outstanding ₹3,000.
    // A stale ₹25,000 carried over from a different proposal must be rejected.
    expect(validatePaymentAmount(25000, 3000)).toMatch(/outstanding balance/i)
  })

  it('accepts an amount equal to the outstanding balance', () => {
    expect(validatePaymentAmount(3000, 3000)).toBeNull()
  })

  it('accepts an amount less than the outstanding balance', () => {
    expect(validatePaymentAmount(1500, 3000)).toBeNull()
  })
})
