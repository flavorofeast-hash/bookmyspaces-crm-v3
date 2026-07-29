import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/ai/availability-escalation.integration.test.ts
// Sprint 1, Priority 1 — Integration Test stage (Implement -> Unit Test ->
// Integration Test -> End-to-End Test -> Deploy -> Pilot).
//
// Every module in this chain already has its own unit tests with its own
// isolated mock: availability-service.test.ts mocks @/lib/supabase directly;
// orchestration-executor.test.ts mocks tool-registry.ts entirely (replacing
// checkAvailability with a hand-rolled stand-in). Neither exercises the REAL
// seam this sprint actually built: checkAvailability() (availability-
// service.ts) -> the check_room_availability/check_banquet_availability
// entry in tool-registry.ts, unmocked here. A per-file mock can't catch a
// wiring bug at that seam (e.g. a tool-registry entry silently pointing at
// the wrong function, or a typo in the shared 'unknown' status literal)
// because each file's own test only ever checks its own hand-crafted
// input/output in isolation.
//
// Mock set below is deliberately identical to tool-registry.test.ts's own
// (that file already proved this is the correct, sufficient set for
// importing the real registry without any live network/credentials) --
// tool-registry.ts pulls in every action's dependency chain at import time
// (create_lead's Sheets sync, notify_staff's WhatsApp send, etc.) even
// though this file only exercises the two availability actions.
// ─────────────────────────────────────────────────────────────────────────────

const state = {
  reservationsQueryError: null as { message: string } | null,
  reservationsRows: [] as Array<{ id: string; check_in_date: string; check_out_date: string }>,
}

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table === 'reservations') {
        // availability-service.ts's checkAvailability(): select(...).eq().in().lt().gt()
        return {
          select: () => ({
            eq: () => ({
              in: () => ({
                lt: () => ({
                  gt: () =>
                    Promise.resolve(
                      state.reservationsQueryError
                        ? { data: null, error: state.reservationsQueryError }
                        : { data: state.reservationsRows, error: null }
                    ),
                }),
              }),
            }),
          }),
        }
      }
      return { select: () => ({}) }
    },
  }),
}))
vi.mock('@/lib/sheets', () => ({ syncLeadToSheets: () => Promise.resolve(), initializeSheet: () => Promise.resolve() }))
vi.mock('@/lib/whatsapp/send-message', () => ({ sendWhatsAppText: () => Promise.resolve({ success: true }), sendWhatsAppTemplateSimple: () => Promise.resolve({ success: true }) }))
vi.mock('@/lib/whatsapp/meta-configured', () => ({ isMetaConfigured: () => false }))
vi.mock('@/lib/settings/settings-service', () => ({ getSettingsSection: () => Promise.resolve({}) }))

import { getTool } from './tool-registry'
import { checkAvailability } from '@/lib/reservations/availability-service'

describe('Availability -> escalation, real seam (tool-registry.ts unmocked, wired to the real checkAvailability())', () => {
  beforeEach(() => {
    state.reservationsQueryError = null
    state.reservationsRows = []
  })

  it('check_room_availability\'s registered tool IS the real checkAvailability (reference equality, not a copy)', () => {
    expect(getTool('check_room_availability').fn).toBe(checkAvailability)
    expect(getTool('check_banquet_availability').fn).toBe(checkAvailability)
  })

  it('DB query failure, invoked through the registry entry exactly as orchestration-executor.ts calls it: status "unknown"', async () => {
    state.reservationsQueryError = { message: 'connection reset' }

    const tool = getTool('check_room_availability')
    const result = await tool.fn('item-1', '2026-09-10', '2026-09-10')

    expect(result.status).toBe('unknown')
    expect(result.available).toBe(false)
  })

  it('genuine conflict (no DB error), invoked through the registry entry: status "unavailable", distinct from "unknown"', async () => {
    state.reservationsRows = [{ id: 'res-existing', check_in_date: '2026-09-08', check_out_date: '2026-09-12' }]

    const tool = getTool('check_room_availability')
    const result = await tool.fn('item-1', '2026-09-10', '2026-09-10')

    expect(result.status).toBe('unavailable')
    expect(result.available).toBe(false)
  })

  it('genuinely free (no DB error, no conflicts): status "available", invoked through the registry entry', async () => {
    const tool = getTool('check_room_availability')
    const result = await tool.fn('item-1', '2026-09-10', '2026-09-11')

    expect(result.status).toBe('available')
    expect(result.available).toBe(true)
  })

  it('check_banquet_availability (a different registry key, same shared function per tool-registry.ts\'s own documented design) also surfaces "unknown" correctly', async () => {
    state.reservationsQueryError = { message: 'timeout' }

    const tool = getTool('check_banquet_availability')
    const result = await tool.fn('hall-1', '2026-09-10', '2026-09-10')

    expect(result.status).toBe('unknown')
  })
})
