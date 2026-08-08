// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/social/publish-config.ts
// Content Operations Priority 5 — Approval workflow hard gate, opt-in.
//
// Reuses the existing `settings` table (category/key/value JSONB,
// migration 012 — same table settings-service.ts's getAppSettings() already
// reads) rather than a new table or a new column on social_posts. Kept as
// its own tiny read/write pair instead of extending settings-service.ts's
// AppSettings/SECTION_KEYS union — that file's shape is a fixed, tested
// union of 'app'-category sections; a social-publishing toggle is a
// different category ('social_publish'), not another 'app' section, so
// this is additive alongside it, not a change to it.
//
// Default false (approval NOT required) — preserves today's behavior
// exactly (draft/scheduled can already publish directly) until an operator
// explicitly opts in from Content Studio settings.
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabaseAdmin } from '@/lib/supabase'

const CATEGORY = 'social_publish'
const KEY = 'config'

export interface PublishConfig {
  requireApproval: boolean
}

const DEFAULT_CONFIG: PublishConfig = { requireApproval: false }

export async function getPublishConfig(): Promise<PublishConfig> {
  try {
    const db = getSupabaseAdmin()
    const { data } = await db.from('settings').select('value').eq('category', CATEGORY).eq('key', KEY).maybeSingle()
    if (data?.value && typeof data.value === 'object') {
      return { ...DEFAULT_CONFIG, ...(data.value as Partial<PublishConfig>) }
    }
    return DEFAULT_CONFIG
  } catch {
    // Missing `settings` table/row degrades to today's existing behavior —
    // never blocks publishing because of a config-read failure.
    return DEFAULT_CONFIG
  }
}

export async function setPublishConfig(config: Partial<PublishConfig>, updatedBy: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const db = getSupabaseAdmin()
  const current = await getPublishConfig()
  const next = { ...current, ...config }
  const { error } = await db
    .from('settings')
    .upsert({ category: CATEGORY, key: KEY, value: next, updated_by: updatedBy }, { onConflict: 'category,key' })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
