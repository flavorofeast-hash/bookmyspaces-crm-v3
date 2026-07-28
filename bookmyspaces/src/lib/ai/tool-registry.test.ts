import { describe, it, expect, vi } from 'vitest'

// Every action ultimately touches Supabase (directly or via the service it
// wraps); mocked here the same way src/lib/ai/orchestrator.test.ts already
// mocks it, so importing the registry never needs real credentials or
// network access. Sheets sync (captureLeadWithJourney's dependency chain)
// and the WhatsApp send/meta-configured modules (enqueueMessage's chain)
// are mocked for the same reason -- none of these tests exercise real
// side effects, only that the registry points at the right function.
vi.mock('@/lib/supabase', () => ({ getSupabaseAdmin: () => ({ from: () => ({ select: () => ({}) }) }) }))
vi.mock('@/lib/sheets', () => ({ syncLeadToSheets: () => Promise.resolve(), initializeSheet: () => Promise.resolve() }))
vi.mock('@/lib/whatsapp/send-message', () => ({ sendWhatsAppText: () => Promise.resolve({ success: true }), sendWhatsAppTemplateSimple: () => Promise.resolve({ success: true }) }))
vi.mock('@/lib/whatsapp/meta-configured', () => ({ isMetaConfigured: () => false }))
vi.mock('@/lib/settings/settings-service', () => ({ getSettingsSection: () => Promise.resolve({}) }))

import { toolRegistry, getTool, listKnownGaps } from './tool-registry'
import { chatWithAI } from '@/lib/ai'
import { checkAvailability } from '@/lib/reservations/availability-service'
import { runAutoPackageRecommendation } from '@/lib/leads/auto-package-recommendation'
import { getActivePackagePrices } from '@/lib/pricing/pricing-service'
import { createProposalFromReservation } from '@/lib/proposals/proposal-service'
import { captureLeadWithJourney } from '@/lib/leads/create-lead-with-journey'
import { enqueueMessage } from '@/lib/queue'
import { applyHandoff } from '@/lib/ai/orchestrator'
import type { OrchestrationAction } from './decision-table'

const ALL_ACTIONS: OrchestrationAction[] = [
  'handoff_to_human',
  'collect_missing_information',
  'ask_question',
  'check_room_availability',
  'check_banquet_availability',
  'generate_quotation',
  'recommend_package',
  'generate_proposal',
  'notify_staff',
  'schedule_follow_up',
  'create_lead',
  'update_lead',
  'answer_immediately',
]

describe('toolRegistry', () => {
  it('has exactly one entry for every OrchestrationAction -- no gaps, no extras', () => {
    const keys = Object.keys(toolRegistry).sort()
    expect(keys).toEqual([...ALL_ACTIONS].sort())
  })

  it('every entry\'s action field matches its own registry key', () => {
    for (const action of ALL_ACTIONS) {
      expect(toolRegistry[action].action).toBe(action)
    }
  })

  it('points at the real, unmodified exported functions -- reference equality, not a copy', () => {
    expect(toolRegistry.answer_immediately.fn).toBe(chatWithAI)
    expect(toolRegistry.ask_question.fn).toBe(chatWithAI)
    expect(toolRegistry.collect_missing_information.fn).toBe(chatWithAI)
    expect(toolRegistry.check_room_availability.fn).toBe(checkAvailability)
    expect(toolRegistry.check_banquet_availability.fn).toBe(checkAvailability)
    expect(toolRegistry.recommend_package.fn).toBe(runAutoPackageRecommendation)
    expect(toolRegistry.generate_quotation.fn).toBe(getActivePackagePrices)
    expect(toolRegistry.generate_proposal.fn).toBe(createProposalFromReservation)
    expect(toolRegistry.create_lead.fn).toBe(captureLeadWithJourney)
    expect(toolRegistry.update_lead.fn).toBe(captureLeadWithJourney)
    expect(toolRegistry.schedule_follow_up.fn).toBe(enqueueMessage)
    expect(toolRegistry.notify_staff.fn).toBe(enqueueMessage)
    expect(toolRegistry.handoff_to_human.fn).toBe(applyHandoff)
  })

  it('shares one real function between actions that documented it, rather than duplicating logic', () => {
    expect(toolRegistry.check_room_availability.fn).toBe(toolRegistry.check_banquet_availability.fn)
    expect(toolRegistry.create_lead.fn).toBe(toolRegistry.update_lead.fn)
    expect(toolRegistry.schedule_follow_up.fn).toBe(toolRegistry.notify_staff.fn)
  })

  it('getTool() returns the same entry as direct indexing', () => {
    for (const action of ALL_ACTIONS) {
      expect(getTool(action)).toBe(toolRegistry[action])
    }
  })

  it('flags exactly the three actions with no dedicated existing function as known gaps', () => {
    const gaps = listKnownGaps().map((g) => g.action).sort()
    expect(gaps).toEqual(['ask_question', 'collect_missing_information', 'notify_staff'].sort())
  })

  it('every known gap includes a non-empty explanation', () => {
    for (const gap of listKnownGaps()) {
      expect(gap.gap.length).toBeGreaterThan(10)
    }
  })

  // Hardening Sprint, High Issue 1 -- compile-time exhaustiveness via
  // `satisfies Record<OrchestrationAction, ...>`. This runtime test is a
  // belt-and-braces check (registry completeness); the real guarantee is
  // that this file fails to *compile* if any action is ever left unmapped.
  it('registry completeness: every OrchestrationAction has exactly one registry entry (belt-and-braces for the compile-time `satisfies` check)', () => {
    expect(Object.keys(toolRegistry).length).toBe(ALL_ACTIONS.length)
    for (const action of ALL_ACTIONS) {
      expect(toolRegistry).toHaveProperty(action)
    }
  })

  it('getTool() throws a structured error for an unregistered action instead of returning undefined (unknown tool, Security: safe failures)', () => {
    // Simulates a value that only *claims* to be an OrchestrationAction at
    // the type level (e.g. an unvalidated string from outside TypeScript's
    // view) -- getTool() must fail loudly and clearly, not hand back
    // `undefined` for a caller to blow up on later with an opaque TypeError.
    expect(() => getTool('totally_unknown_action' as unknown as OrchestrationAction)).toThrow(
      /no registered tool for action "totally_unknown_action"/
    )
  })
})
