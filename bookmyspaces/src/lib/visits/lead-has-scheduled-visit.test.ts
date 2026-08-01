import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/visits/lead-has-scheduled-visit.test.ts
// RC2 Production Readiness — closes a real test-coverage gap: leadHasScheduledVisit()
// (site-visit-service.ts) is the guard chat/route.ts relies on for "no duplicate
// visits" (Journey 7 — Customer requests a Site Visit) — the AI re-emits
// visit_date/visit_time in its <<LEAD:...>> tag on every subsequent turn once
// known, so without this guard a multi-turn conversation would schedule a new
// visit on every single reply. site-visit-service.test.ts covers
// scheduleSiteVisit/listSiteVisitsForDate/updateSiteVisitStatus but never this
// function — added here as its own file (separate, simpler mock shape) rather
// than reshaping that file's existing chain-mock and risking its already-
// passing assertions.
// ─────────────────────────────────────────────────────────────────────────────

const state = {
  rows: [] as Array<{ id: string }>,
  error: null as { message: string } | null,
}

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table === 'follow_ups') {
        return {
          // leadHasScheduledVisit(): select('id').eq('lead_id',...).eq('type','site_visit').eq('status','pending').limit(1)
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  limit: () => Promise.resolve({ data: state.rows, error: state.error }),
                }),
              }),
            }),
          }),
        }
      }
      throw new Error(`unexpected table: ${table}`)
    },
  }),
}))

import { leadHasScheduledVisit } from './site-visit-service'

describe('leadHasScheduledVisit — the duplicate-visit guard chat/route.ts calls before every scheduleSiteVisit()', () => {
  beforeEach(() => {
    state.rows = []
    state.error = null
  })

  it('PASS: returns false for a lead with no pending visit — first request is allowed through', async () => {
    expect(await leadHasScheduledVisit('lead-1')).toBe(false)
  })

  it('PASS: returns true once a pending visit exists — blocks scheduleSiteVisit from being called again for the same lead', async () => {
    state.rows = [{ id: 'visit-1' }]
    expect(await leadHasScheduledVisit('lead-1')).toBe(true)
  })

  it('fails open (documented, accepted risk) on a DB error — never silently blocks a real visit request', async () => {
    state.error = { message: 'connection reset' }
    expect(await leadHasScheduledVisit('lead-1')).toBe(false)
  })
})
