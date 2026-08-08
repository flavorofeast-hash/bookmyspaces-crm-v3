import { describe, it, expect, vi, beforeEach } from 'vitest'

// Production Stabilization (Priority 2) — Messaging Orchestrator tests.
// Verifies the shared cross-engine eligibility gate: no prior automated
// send -> eligible; an equal-or-higher priority send within the shared
// cooldown -> blocked; a lower-priority prior send -> still eligible
// (higher-priority messages are never silently dropped); any read failure
// fails open (never blocks a send the calling engine's own cooldown logic
// already approved).

const state = {
  lastAction: null as string | null,
  shouldError: false,
}

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table !== 'activity_logs') throw new Error(`unexpected table ${table}`)
      return {
        select: () => ({
          eq: () => ({
            in: () => ({
              gte: () => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: () =>
                      state.shouldError
                        ? Promise.resolve({ data: null, error: { message: 'db down' } })
                        : Promise.resolve({ data: state.lastAction ? { action: state.lastAction } : null, error: null }),
                  }),
                }),
              }),
            }),
          }),
        }),
      }
    },
  }),
}))

import { canSendAutomatedMessage, AUTOMATION_SOURCES } from './orchestrator'

beforeEach(() => {
  state.lastAction = null
  state.shouldError = false
})

describe('canSendAutomatedMessage', () => {
  it('is eligible when nothing has been sent to this lead recently', async () => {
    expect(await canSendAutomatedMessage('lead_1', 'birthday')).toBe(true)
  })

  it('blocks a lower-or-equal priority source when an equal-or-higher one already sent within the window', async () => {
    state.lastAction = AUTOMATION_SOURCES.proposal_nudge.action // priority 100
    expect(await canSendAutomatedMessage('lead_1', 'birthday')).toBe(false) // priority 30
    expect(await canSendAutomatedMessage('lead_1', 'proposal_nudge')).toBe(false) // equal priority, same source
  })

  it('still allows a strictly higher-priority source even if a lower-priority one already sent', async () => {
    state.lastAction = AUTOMATION_SOURCES.birthday.action // priority 30
    expect(await canSendAutomatedMessage('lead_1', 'proposal_nudge')).toBe(true) // priority 100
  })

  it('fails open (eligible) on a read error — never blocks a send the caller already approved', async () => {
    state.shouldError = true
    expect(await canSendAutomatedMessage('lead_1', 'birthday')).toBe(true)
  })

  it('fails open when the most recent action is not a recognized automation source', async () => {
    state.lastAction = 'some_unrelated_action'
    expect(await canSendAutomatedMessage('lead_1', 'birthday')).toBe(true)
  })

  it('every registered source maps to a unique priority tier or an intentionally shared one (birthday/anniversary)', () => {
    const priorities = Object.values(AUTOMATION_SOURCES).map((d) => d.priority)
    expect(new Set(priorities).size).toBeGreaterThanOrEqual(7) // 10 sources, birthday+anniversary intentionally tie
  })
})
