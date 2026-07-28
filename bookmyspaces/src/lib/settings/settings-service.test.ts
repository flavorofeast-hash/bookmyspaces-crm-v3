import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockDb = {
  rows: [] as Array<{ key: string; value: unknown }>,
  selectError: null as { message: string } | null,
  upserted: [] as unknown[],
  upsertError: null as { message: string } | null,
}

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table !== 'settings') throw new Error(`unexpected table: ${table}`)
      return {
        select: () => ({
          eq: () => Promise.resolve({ data: mockDb.selectError ? null : mockDb.rows, error: mockDb.selectError }),
        }),
        upsert: (rows: unknown[]) => {
          mockDb.upserted = rows
          return Promise.resolve({ error: mockDb.upsertError })
        },
      }
    },
  }),
}))

import {
  getAppSettings,
  getSettingsSection,
  saveAppSettings,
  DEFAULT_SETTINGS,
  isSettingsSectionKey,
} from './settings-service'

beforeEach(() => {
  mockDb.rows = []
  mockDb.selectError = null
  mockDb.upserted = []
  mockDb.upsertError = null
})

describe('getAppSettings', () => {
  it('returns defaults when the table is empty', async () => {
    const s = await getAppSettings()
    expect(s).toEqual(DEFAULT_SETTINGS)
  })

  it('returns defaults (not a throw) when the table is missing/select errors', async () => {
    mockDb.selectError = { message: 'relation "settings" does not exist' }
    const s = await getAppSettings()
    expect(s).toEqual(DEFAULT_SETTINGS)
  })

  it('merges stored rows over defaults, keeping default values for absent fields', async () => {
    mockDb.rows = [{ key: 'venue', value: { venueName: 'Skyline Serenity' } }]
    const s = await getAppSettings()
    expect(s.venue.venueName).toBe('Skyline Serenity')
    // untouched field falls back to default
    expect(s.venue.currency).toBe('INR')
    // other sections untouched
    expect(s.ai.confidenceThreshold).toBe(DEFAULT_SETTINGS.ai.confidenceThreshold)
  })

  it('ignores unknown keys instead of corrupting the shape', async () => {
    mockDb.rows = [{ key: 'not_a_section', value: { anything: true } }]
    const s = await getAppSettings()
    expect(s).toEqual(DEFAULT_SETTINGS)
  })

  // Phase 1B, Step 1 (audit/PHASE_1B_IMPLEMENTATION_BACKLOG.md): the new
  // 'orchestration' section must default safely and never break existing
  // sections when it is absent from the DB (the common case for every
  // environment until a later Phase 1B step explicitly saves a row for it).
  describe('orchestration section (Phase 1B, Step 1 -- config only, unread by any runtime code)', () => {
    it('defaults to { enabled: false } when no row exists for it', async () => {
      const s = await getAppSettings()
      expect(s.orchestration).toEqual({ enabled: false })
    })

    it('stays false even when the table has rows for every other section (backward compatibility)', async () => {
      mockDb.rows = [
        { key: 'venue', value: { venueName: 'Skyline Serenity' } },
        { key: 'ai', value: { temperature: 0.3 } },
        { key: 'notifications', value: { dailySummary: false } },
        { key: 'whatsapp', value: { phoneNumberId: '12345' } },
      ]
      const s = await getAppSettings()
      expect(s.orchestration).toEqual({ enabled: false })
      // and every pre-existing section still merges over defaults exactly as before
      expect(s.venue.venueName).toBe('Skyline Serenity')
      expect(s.ai.temperature).toBe(0.3)
      expect(s.notifications.dailySummary).toBe(false)
      expect(s.whatsapp.phoneNumberId).toBe('12345')
    })

    it('deserializes a stored orchestration row and merges it over the default (round-trip)', async () => {
      mockDb.rows = [{ key: 'orchestration', value: { enabled: true } }]
      const s = await getAppSettings()
      expect(s.orchestration).toEqual({ enabled: true })
    })

    it('getSettingsSection("orchestration") returns just the section, defaulted', async () => {
      const section = await getSettingsSection('orchestration')
      expect(section).toEqual({ enabled: false })
    })

    it('serializes via saveAppSettings the same way every other section does', async () => {
      const res = await saveAppSettings({ orchestration: { enabled: true } }, 'admin@bookmyspaces.in')
      expect(res.ok).toBe(true)
      expect(mockDb.upserted).toHaveLength(1)
      expect(mockDb.upserted[0]).toMatchObject({
        category: 'app',
        key: 'orchestration',
        value: { enabled: true },
        updated_by: 'admin@bookmyspaces.in',
      })
    })
  })
})

describe('saveAppSettings', () => {
  it('writes one row per provided section with the audit column set', async () => {
    const res = await saveAppSettings(
      { ai: { ...DEFAULT_SETTINGS.ai, temperature: 0.3 } },
      'admin@bookmyspaces.in'
    )
    expect(res.ok).toBe(true)
    expect(mockDb.upserted).toHaveLength(1)
    expect(mockDb.upserted[0]).toMatchObject({
      category: 'app',
      key: 'ai',
      updated_by: 'admin@bookmyspaces.in',
    })
  })

  it('is a no-op (ok) when no known sections are provided', async () => {
    const res = await saveAppSettings({}, 'x')
    expect(res.ok).toBe(true)
    expect(mockDb.upserted).toHaveLength(0)
  })

  it('surfaces DB errors as { ok: false }', async () => {
    mockDb.upsertError = { message: 'boom' }
    const res = await saveAppSettings({ venue: DEFAULT_SETTINGS.venue }, 'x')
    expect(res.ok).toBe(false)
  })
})

describe('isSettingsSectionKey', () => {
  it('accepts the five known sections and rejects others', () => {
    expect(isSettingsSectionKey('venue')).toBe(true)
    expect(isSettingsSectionKey('ai')).toBe(true)
    expect(isSettingsSectionKey('notifications')).toBe(true)
    expect(isSettingsSectionKey('whatsapp')).toBe(true)
    // Phase 1B, Step 1 -- new section, config only, not yet read by any runtime code.
    expect(isSettingsSectionKey('orchestration')).toBe(true)
    expect(isSettingsSectionKey('evil')).toBe(false)
  })
})
