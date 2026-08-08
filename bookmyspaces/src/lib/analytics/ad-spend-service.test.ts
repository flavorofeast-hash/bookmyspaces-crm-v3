import { describe, it, expect } from 'vitest'
import { withSpendMetrics } from './ad-spend-service'
import type { AcquisitionPerformanceRow } from '@/lib/analytics/revenue-intelligence'

function row(overrides: Partial<AcquisitionPerformanceRow> = {}): AcquisitionPerformanceRow {
  return {
    key: 'Instagram',
    leads: 10,
    qualifiedLeads: 4,
    proposals: 3,
    bookings: 2,
    revenue: 50000,
    conversionPct: 20,
    avgBookingValue: 25000,
    ...overrides,
  }
}

describe('withSpendMetrics', () => {
  it('returns null spend/cost/roi fields when no matching spend record exists', () => {
    const [result] = withSpendMetrics([row()], new Map())
    expect(result.spend).toBeNull()
    expect(result.costPerEnquiry).toBeNull()
    expect(result.costPerBooking).toBeNull()
    expect(result.roiFromSpend).toBeNull()
  })

  it('matches spend case-insensitively by row.key', () => {
    const spendMap = new Map([['instagram', 2000]])
    const [result] = withSpendMetrics([row({ key: 'Instagram' })], spendMap)
    expect(result.spend).toBe(2000)
  })

  it('computes costPerEnquiry as spend / leads', () => {
    const spendMap = new Map([['instagram', 2000]])
    const [result] = withSpendMetrics([row({ leads: 10 })], spendMap)
    expect(result.costPerEnquiry).toBe(200)
  })

  it('computes costPerBooking as spend / bookings, null when bookings is 0', () => {
    const spendMap = new Map([['instagram', 2000]])
    const [withBookings] = withSpendMetrics([row({ bookings: 2 })], spendMap)
    expect(withBookings.costPerBooking).toBe(1000)

    const [noBookings] = withSpendMetrics([row({ bookings: 0 })], spendMap)
    expect(noBookings.costPerBooking).toBeNull()
  })

  it('computes roiFromSpend as (revenue - spend) / spend', () => {
    const spendMap = new Map([['instagram', 10000]])
    const [result] = withSpendMetrics([row({ revenue: 50000 })], spendMap)
    expect(result.roiFromSpend).toBe(4) // (50000-10000)/10000
  })

  it('never fabricates a zero — a row with 0 leads/bookings and real spend on file yields null cost fields, not Infinity or 0', () => {
    const spendMap = new Map([['instagram', 500]])
    const [result] = withSpendMetrics([row({ leads: 0, bookings: 0 })], spendMap)
    expect(result.costPerEnquiry).toBeNull()
    expect(result.costPerBooking).toBeNull()
  })
})
