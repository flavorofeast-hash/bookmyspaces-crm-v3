// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/components/leads/NewLeadModal.test.ts
// This project's vitest config only includes src/**/*.test.ts (node
// environment, no jsdom/@testing-library — see vitest.config.ts), so there's
// no existing convention for rendering React components in tests. The two
// non-visual pieces of NewLeadModal.tsx that matter for correctness are
// exported as plain functions/data so they can still be verified here:
//   - leadWorkspaceHref(): the redirect target used after a successful
//     create (dashboard/leads/page.tsx's onCreated calls
//     router.push(leadWorkspaceHref(leadId))) — this is the "Redirect"
//     requirement.
//   - SOURCE_OPTIONS: every dbValue must be one the production
//     leads_source_check CHECK constraint actually accepts (see this file's
//     header comment), or every manual lead picking that option would fail
//     to save with a 500.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest'
import { SOURCE_OPTIONS, leadWorkspaceHref } from './NewLeadModal'

// Mirrors ALLOWED_LEAD_SOURCES in src/app/api/leads/import/route.ts, which is
// documented there as verified against the live `leads_source_check`
// constraint (migrations 001/016/017).
const DB_ALLOWED_SOURCES = [
  'website', 'whatsapp', 'instagram', 'justdial', 'referral', 'other',
  'proposal', 'excel_import', 'web', 'whatsapp_website', 'whatsapp_facebook',
  'whatsapp_instagram', 'facebook',
]

describe('leadWorkspaceHref', () => {
  it('builds the Lead Workspace route for a given lead id', () => {
    expect(leadWorkspaceHref('abc-123')).toBe('/dashboard/leads/abc-123')
  })
})

describe('SOURCE_OPTIONS', () => {
  it('covers every source required by the Manual Lead Creation spec', () => {
    const labels = SOURCE_OPTIONS.map((o) => o.label)
    expect(labels).toEqual([
      'Phone', 'Walk-in', 'WhatsApp', 'Website', 'Facebook', 'Instagram',
      'Google', 'Referral', 'Email', 'Other',
    ])
  })

  it('every dbValue is accepted by the production leads_source_check constraint', () => {
    for (const option of SOURCE_OPTIONS) {
      expect(DB_ALLOWED_SOURCES).toContain(option.dbValue)
    }
  })

  it('options with a direct DB-safe match map to themselves, not "other"', () => {
    const byLabel = Object.fromEntries(SOURCE_OPTIONS.map((o) => [o.label, o.dbValue]))
    expect(byLabel['WhatsApp']).toBe('whatsapp')
    expect(byLabel['Website']).toBe('website')
    expect(byLabel['Facebook']).toBe('facebook')
    expect(byLabel['Instagram']).toBe('instagram')
    expect(byLabel['Referral']).toBe('referral')
  })
})
