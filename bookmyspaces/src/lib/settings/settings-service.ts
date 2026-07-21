// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/settings/settings-service.ts
// V3 Phase 2a — Settings backend.
//
// Replaces the Settings page's localStorage-only persistence
// (audit/PHASE1_ARCHITECTURE_REVIEW_OMNICHANNEL.md Section 1, "Settings page
// is non-functional") with reads/writes against the `settings` table drawn
// in migration 012 (category + key + JSONB value, UNIQUE(category, key)).
//
// Storage model: one row per settings SECTION — category 'app', key =
// 'venue' | 'ai' | 'notifications' | 'whatsapp', value = the whole section
// object. Matches the page's existing AppSettings shape 1:1 so the UI needs
// no reshaping, and keeps the table useful for future non-'app' categories
// (channel adapters, social accounts) without schema changes.
//
// Missing-table behavior: returns DEFAULT_SETTINGS rather than throwing,
// same degrade-gracefully convention as property-service.ts — the page
// stays usable before migration 012 is applied to production.
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabaseAdmin } from '@/lib/supabase'

export interface VenueSettings {
  venueName: string
  phone: string
  email: string
  website: string
  address: string
  standardCapacity: number
  hallCapacity: number
  currency: string
}

export interface AISettings {
  model: string
  maxTokens: number
  temperature: number
  systemLanguage: string
  autoReply: boolean
  replyDelay: number
  // Phase 4 (AI Orchestrator) — human-handoff tuning, editable without deploys.
  confidenceThreshold: number // below this, escalate to a human (0..1)
  autoHandoff: boolean        // master switch for confidence-based escalation
}

export interface NotificationSettings {
  hotLeadAlert: boolean
  newInquiryAlert: boolean
  followUpReminder: boolean
  dailySummary: boolean
  adminEmail: string
}

export interface WhatsAppSettings {
  verifyToken: string
  phoneNumberId: string
  accessTokenSet: boolean
  webhookUrl: string
}

export interface AppSettings {
  venue: VenueSettings
  ai: AISettings
  notifications: NotificationSettings
  whatsapp: WhatsAppSettings
}

export const DEFAULT_SETTINGS: AppSettings = {
  venue: {
    venueName: 'BookMySpaces',
    phone: '9830509991',
    email: 'info@bookmyspaces.in',
    website: 'https://bookmyspaces.in',
    address: 'Kolkata, West Bengal, India',
    standardCapacity: 70,
    hallCapacity: 120,
    currency: 'INR',
  },
  ai: {
    model: 'claude-3-haiku-20240307',
    maxTokens: 300,
    temperature: 0.7,
    systemLanguage: 'auto',
    autoReply: true,
    replyDelay: 0,
    confidenceThreshold: 0.6,
    autoHandoff: true,
  },
  notifications: {
    hotLeadAlert: true,
    newInquiryAlert: true,
    followUpReminder: true,
    dailySummary: true,
    adminEmail: 'admin@bookmyspaces.in',
  },
  whatsapp: {
    verifyToken: '',
    phoneNumberId: '',
    accessTokenSet: false,
    webhookUrl: '',
  },
}

const APP_CATEGORY = 'app'
const SECTION_KEYS = ['venue', 'ai', 'notifications', 'whatsapp'] as const
export type SettingsSectionKey = (typeof SECTION_KEYS)[number]

export function isSettingsSectionKey(key: string): key is SettingsSectionKey {
  return (SECTION_KEYS as readonly string[]).includes(key)
}

/**
 * Full app settings: DB rows merged over defaults, so newly-added fields
 * (e.g. ai.confidenceThreshold) pick up their default until first saved,
 * and a partially-populated table never produces missing sections.
 */
export async function getAppSettings(): Promise<AppSettings> {
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('settings')
    .select('key, value')
    .eq('category', APP_CATEGORY)

  const merged: AppSettings = structuredClone(DEFAULT_SETTINGS)
  if (error || !data) return merged

  for (const row of data) {
    if (isSettingsSectionKey(row.key) && row.value && typeof row.value === 'object') {
      merged[row.key] = { ...merged[row.key], ...(row.value as object) } as never
    }
  }
  return merged
}

/** One section (e.g. just 'ai') — for server-side consumers like the AI orchestrator. */
export async function getSettingsSection<K extends SettingsSectionKey>(
  section: K
): Promise<AppSettings[K]> {
  const all = await getAppSettings()
  return all[section]
}

/**
 * Upserts the given sections (partial update: only sections present in the
 * payload are written). `updatedBy` is the authenticated user's email/id for
 * the settings table's audit column.
 */
export async function saveAppSettings(
  sections: Partial<AppSettings>,
  updatedBy: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = getSupabaseAdmin()

  const rows = SECTION_KEYS.filter((k) => sections[k] !== undefined).map((k) => ({
    category: APP_CATEGORY,
    key: k,
    value: sections[k],
    updated_by: updatedBy,
  }))

  if (rows.length === 0) return { ok: true }

  const { error } = await supabase
    .from('settings')
    .upsert(rows, { onConflict: 'category,key' })

  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
