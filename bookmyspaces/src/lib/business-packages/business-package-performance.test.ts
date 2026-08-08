import { describe, it, expect, vi } from 'vitest'

// computeBusinessPackagePerformance() reads six tables plus
// getSpendByBusinessPackage() in one Promise.all — this mock gives each
// table its own fixture and makes every builder both chainable (.not()) and
// thenable (awaited directly, matching how supabase-js's own
// PostgrestFilterBuilder works — no terminal .then()/.single() call needed
// in the source).
const tableData: Record<string, unknown[]> = {
  business_packages: [],
  leads: [],
  proposals: [],
  reservations: [],
  reviews: [],
  referral_rewards: [],
}

function makeBuilder(table: string) {
  const builder: Record<string, unknown> = {}
  builder.not = () => builder
  builder.then = (resolve: (v: { data: unknown[]; error: null }) => void) =>
    resolve({ data: tableData[table] ?? [], error: null })
  return builder
}

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => ({ select: () => makeBuilder(table) }),
  }),
}))

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))

const spendMap = new Map<string, number>()
vi.mock('@/lib/analytics/ad-spend-service', () => ({
  getSpendByBusinessPackage: vi.fn(() => Promise.resolve(spendMap)),
}))

import { computeBusinessPackagePerformance } from './business-package-service'

describe('computeBusinessPackagePerformance', () => {
  it('rolls up enquiries/conversion/revenue/ROI/repeat/reviews/referrals per package, matching campaigns.ts revenue/double-count rules', async () => {
    tableData.business_packages = [
      { id: 'pkg1', name: 'Wedding Bliss', status: 'active' },
      { id: 'pkg2', name: 'Retired Pkg', status: 'retired' },
    ]
    tableData.leads = [
      { id: 'lead1', business_package_id: 'pkg1' },
      { id: 'lead2', business_package_id: 'pkg1' },
      { id: 'lead3', business_package_id: 'pkg2' },
    ]
    tableData.proposals = [
      { lead_id: 'lead1', business_package_id: 'pkg1', status: 'accepted', accepted_at: '2026-01-01', total_price: 50000 },
    ]
    tableData.reservations = [
      // Walk-in-equivalent (no proposal_id) — its own revenue counts.
      { customer_id: 'lead2', business_package_id: 'pkg1', proposal_id: null, status: 'confirmed', final_room_rate: 20000, meal_plan_charge: 5000 },
      // Resulted from the accepted proposal above — revenue already counted
      // via the proposal, so must NOT be added again, but DOES still count
      // as a second booking for lead1 (repeat-customer eligibility).
      { customer_id: 'lead1', business_package_id: 'pkg1', proposal_id: 'prop_x', status: 'confirmed', final_room_rate: 9999, meal_plan_charge: 0 },
    ]
    tableData.reviews = [
      { customer_id: 'lead1', rating: 5 },
      { customer_id: 'lead2', rating: 4 },
    ]
    tableData.referral_rewards = [
      { referrer_lead_id: 'lead1', status: 'earned' },
      { referrer_lead_id: 'lead2', status: 'pending' },
    ]
    spendMap.clear()
    spendMap.set('pkg1', 10000)

    const result = await computeBusinessPackagePerformance()
    expect(result).toHaveLength(2)

    const pkg1 = result.find((r) => r.packageId === 'pkg1')!
    expect(pkg1.enquiries).toBe(2)
    expect(pkg1.convertedLeads).toBe(2)
    expect(pkg1.conversionPct).toBe(100)
    expect(pkg1.revenue).toBe(75000) // 50000 (accepted proposal) + 25000 (walk-in reservation) — proposal-linked reservation excluded
    expect(pkg1.spend).toBe(10000)
    expect(pkg1.roi).toBe(6.5) // (75000 - 10000) / 10000
    expect(pkg1.costPerLead).toBe(5000) // 10000 spend / 2 enquiries
    expect(pkg1.costPerBooking).toBe(5000) // 10000 spend / 2 bookings (accepted proposal + walk-in reservation)
    expect(pkg1.repeatCustomers).toBe(1) // only lead1 has 2 bookings (accepted proposal + its resulting reservation)
    expect(pkg1.reviewCount).toBe(2)
    expect(pkg1.avgRating).toBe(4.5)
    expect(pkg1.referralCount).toBe(2)
    expect(pkg1.referralsEarned).toBe(1)

    const pkg2 = result.find((r) => r.packageId === 'pkg2')!
    expect(pkg2.enquiries).toBe(1)
    expect(pkg2.convertedLeads).toBe(0)
    expect(pkg2.revenue).toBe(0)
    expect(pkg2.spend).toBeNull()
    expect(pkg2.roi).toBeNull() // never fabricated when there's no spend on file
    expect(pkg2.costPerLead).toBeNull()
    expect(pkg2.costPerBooking).toBeNull()
    expect(pkg2.repeatCustomers).toBe(0)
    expect(pkg2.reviewCount).toBe(0)
    expect(pkg2.avgRating).toBeNull()
  })

  it('returns an empty array when there are no business packages', async () => {
    tableData.business_packages = []
    tableData.leads = []
    tableData.proposals = []
    tableData.reservations = []
    tableData.reviews = []
    tableData.referral_rewards = []
    spendMap.clear()

    const result = await computeBusinessPackagePerformance()
    expect(result).toEqual([])
  })
})
