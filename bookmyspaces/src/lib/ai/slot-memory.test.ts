import { describe, it, expect } from 'vitest'
import { mergeSlots, slotsFromExtraction, slotsFromLead, REQUIRED_SLOTS } from './slot-memory'
import type { ExtractedLeadDetails } from '@/lib/extract-lead-details'

describe('mergeSlots', () => {
  it('prefers CRM data over conversation memory and extraction when there is no genuine disagreement', () => {
    // conversation/extracted are both empty for eventDate, so CRM wins outright -- no conflict possible.
    const result = mergeSlots({
      crm: { eventDate: '2026-12-14' },
    })
    expect(result.slots.eventDate).toBe('2026-12-14')
    expect(result.filledBy.eventDate).toBe('crm')
    expect(result.hasConflicts).toBe(false)
  })

  it('Critical Issue 1 fix: a customer correction overrides a stale CRM value instead of being silently ignored', () => {
    // The exact scenario from the Hardening Sprint brief: CRM says 50 guests,
    // the customer just said 150. The old strict-priority merge kept 50
    // forever -- unacceptable. The conflict-aware merge must use 150, and
    // must say so, not silently swap it.
    const result = mergeSlots({
      crm: { guestCount: 50 },
      extracted: { guestCount: 150 },
    })
    expect(result.slots.guestCount).toBe(150)
    expect(result.filledBy.guestCount).toBe('extracted')
    expect(result.hasConflicts).toBe(true)
    expect(result.conflicts).toEqual([{
      slot: 'guestCount',
      crmValue: 50,
      customerValue: 150,
      customerValueSource: 'extracted',
      recommendedResolution: 'use_customer_value_pending_confirmation',
      resolutionRequired: true,
    }])
  })

  it('conflict detection also fires against conversation memory, not just this turn\'s extraction', () => {
    const result = mergeSlots({
      crm: { eventType: 'WEDDING' },
      conversation: { eventType: 'BIRTHDAY' },
      extracted: { eventType: 'CORPORATE' },
    })
    // conversation is the higher-priority *customer* tier, so it is the one compared against CRM and used.
    expect(result.slots.eventType).toBe('BIRTHDAY')
    expect(result.filledBy.eventType).toBe('conversation')
    expect(result.conflicts[0]).toMatchObject({ crmValue: 'WEDDING', customerValue: 'BIRTHDAY', customerValueSource: 'conversation' })
  })

  it('does not flag a conflict when CRM and the customer tier already agree (case/whitespace-insensitive)', () => {
    const result = mergeSlots({
      crm: { eventType: 'wedding' },
      conversation: { eventType: '  Wedding  ' },
    })
    expect(result.hasConflicts).toBe(false)
    expect(result.slots.eventType).toBe('wedding')
    expect(result.filledBy.eventType).toBe('crm')
  })

  it('never writes to the CRM or mutates the input sources -- conflicts are reported, not applied', () => {
    const crm = { guestCount: 50 }
    const result = mergeSlots({ crm, extracted: { guestCount: 150 } })
    expect(crm.guestCount).toBe(50)
    expect(result.conflicts[0].resolutionRequired).toBe(true)
  })

  it('prefers conversation memory over extraction when CRM has nothing', () => {
    const result = mergeSlots({
      conversation: { guestCount: 120 },
      extracted: { guestCount: 80 },
    })
    expect(result.slots.guestCount).toBe(120)
    expect(result.filledBy.guestCount).toBe('conversation')
  })

  it('falls back to extraction only when nothing higher-priority has a value', () => {
    const result = mergeSlots({ extracted: { budget: '150000' } })
    expect(result.slots.budget).toBe('150000')
    expect(result.filledBy.budget).toBe('extracted')
  })

  it('never lets a lower-priority tier overwrite a higher-priority tier already filled, when there is no disagreement', () => {
    // CRM has an event date; extraction (this turn) agrees. CRM stays the
    // filledBy source of record -- this is the "never ask twice / never
    // clobber a human-confirmed value" guarantee the architecture requires,
    // for the non-conflicting case.
    const result = mergeSlots({
      crm: { eventDate: '2026-12-14' },
      extracted: { eventDate: '2026-12-14' },
    })
    expect(result.slots.eventDate).toBe('2026-12-14')
    expect(result.filledBy.eventDate).toBe('crm')
    expect(result.hasConflicts).toBe(false)
  })

  it('treats empty strings and NaN as absent, not as a real value', () => {
    const result = mergeSlots({
      crm: { eventType: '   ' },
      conversation: { eventType: 'BIRTHDAY' },
    })
    expect(result.slots.eventType).toBe('BIRTHDAY')
    expect(result.filledBy.eventType).toBe('conversation')
  })

  it('reports missingSlots only for the required set, and isQualified once all three are present', () => {
    const partial = mergeSlots({ crm: { eventType: 'WEDDING' } })
    expect(partial.missingSlots).toEqual(expect.arrayContaining(['eventDate', 'guestCount']))
    expect(partial.missingSlots).not.toContain('eventType')
    expect(partial.isQualified).toBe(false)

    const complete = mergeSlots({
      crm: { eventType: 'WEDDING', eventDate: '2026-12-14', guestCount: 120 },
    })
    expect(complete.missingSlots).toEqual([])
    expect(complete.isQualified).toBe(true)
  })

  it('never requires budget/venue/specialRequirements for qualification', () => {
    expect(REQUIRED_SLOTS).toEqual(['eventType', 'eventDate', 'guestCount'])
  })

  it('returns null filledBy for slots no tier supplied', () => {
    const result = mergeSlots({})
    expect(result.slots).toEqual({
      eventType: null, eventDate: null, guestCount: null, budget: null, venue: null, specialRequirements: null,
    })
    expect(result.filledBy.eventType).toBeNull()
  })
})

describe('slotsFromExtraction', () => {
  it('maps only the fields extractLeadDetails actually produces', () => {
    const extracted: ExtractedLeadDetails = {
      event_type: 'WEDDING',
      occasion: null,
      guest_count: 150,
      budget: '300000',
      buying_signals: ['READY_TO_BOOK'],
    }
    expect(slotsFromExtraction(extracted)).toEqual({
      eventType: 'WEDDING',
      guestCount: 150,
      budget: '300000',
    })
  })

  it('omits null fields rather than writing null over a value', () => {
    const extracted: ExtractedLeadDetails = {
      event_type: null, occasion: null, guest_count: null, budget: null, buying_signals: [],
    }
    expect(slotsFromExtraction(extracted)).toEqual({})
  })

  it('never invents eventDate, venue, or specialRequirements -- extractLeadDetails does not produce them', () => {
    const extracted: ExtractedLeadDetails = {
      event_type: 'BIRTHDAY', occasion: null, guest_count: 20, budget: null, buying_signals: [],
    }
    const result = slotsFromExtraction(extracted)
    expect(result).not.toHaveProperty('eventDate')
    expect(result).not.toHaveProperty('venue')
    expect(result).not.toHaveProperty('specialRequirements')
  })
})

describe('slotsFromLead', () => {
  it('reshapes a leads-row-like object into slot form', () => {
    expect(slotsFromLead({
      event_type: 'CORPORATE',
      event_date: '2026-08-01',
      guest_count: 60,
      budget: '200000',
      venue: 'skyline',
      special_requirements: 'vegetarian only',
    })).toEqual({
      eventType: 'CORPORATE',
      eventDate: '2026-08-01',
      guestCount: 60,
      budget: '200000',
      venue: 'skyline',
      specialRequirements: 'vegetarian only',
    })
  })

  it('returns an empty object for null/undefined input', () => {
    expect(slotsFromLead(null)).toEqual({})
    expect(slotsFromLead(undefined)).toEqual({})
  })

  it('omits fields that are null on the lead row', () => {
    expect(slotsFromLead({ event_type: 'WEDDING', event_date: null })).toEqual({ eventType: 'WEDDING' })
  })
})
