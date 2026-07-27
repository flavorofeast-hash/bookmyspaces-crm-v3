// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/events/event-types.ts
// Direct Event Sales Engine, Section 2 — canonical event type catalog.
//
// AUDIT FINDING: leads.event_type is a free TEXT column (no CHECK/enum),
// populated today by src/lib/extract-lead-details.ts's regex extraction,
// which recognizes WEDDING/CORPORATE/BIRTHDAY/ANNIVERSARY/ENGAGEMENT/
// FAREWELL/GET_TOGETHER/BABY_SHOWER/PRIVATE_DINNER/PHOTOSHOOT — a workable
// but different set from the directive's 10 categories (no RECEPTION split
// from WEDDING, no CONFERENCE split from CORPORATE, no PRIVATE_PARTY/CUSTOM).
//
// Deliberately NOT modifying extract-lead-details.ts's regex tables — that
// module is tested and live in the WhatsApp qualification pipeline; changing
// its canonical values would risk breaking already-scored leads and its
// existing test suite for a UI/reporting concern, not an extraction one.
// Instead, this module is the single source of truth for Package
// Management / Proposal Generator / Event Revenue Dashboard, with
// normalizeToEventType() as the one-way bridge from whatever free text
// ends up in leads.event_type to one of these 10 canonical buckets.
// ─────────────────────────────────────────────────────────────────────────────

export const EVENT_TYPES = [
  'WEDDING',
  'RECEPTION',
  'BIRTHDAY',
  'ANNIVERSARY',
  'CORPORATE_MEETING',
  'CONFERENCE',
  'ENGAGEMENT',
  'BABY_SHOWER',
  'PRIVATE_PARTY',
  'CUSTOM_EVENT',
] as const

export type EventType = (typeof EVENT_TYPES)[number]

export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  WEDDING: 'Wedding',
  RECEPTION: 'Reception',
  BIRTHDAY: 'Birthday',
  ANNIVERSARY: 'Anniversary',
  CORPORATE_MEETING: 'Corporate Meeting',
  CONFERENCE: 'Conference',
  ENGAGEMENT: 'Engagement',
  BABY_SHOWER: 'Baby Shower',
  PRIVATE_PARTY: 'Private Party',
  CUSTOM_EVENT: 'Custom Event',
}

// Maps values already in production (from extract-lead-details.ts's broader
// keyword set, or free-typed values from manual entry/imports) onto the
// canonical 10. Unrecognized input falls back to CUSTOM_EVENT rather than
// null, so every lead/package/proposal can always be grouped for reporting.
const LEGACY_ALIASES: Record<string, EventType> = {
  WEDDING: 'WEDDING',
  RECEPTION: 'RECEPTION',
  BIRTHDAY: 'BIRTHDAY',
  ANNIVERSARY: 'ANNIVERSARY',
  CORPORATE: 'CORPORATE_MEETING',
  CORPORATE_MEETING: 'CORPORATE_MEETING',
  MEETING: 'CORPORATE_MEETING',
  CONFERENCE: 'CONFERENCE',
  SEMINAR: 'CONFERENCE',
  WORKSHOP: 'CONFERENCE',
  ENGAGEMENT: 'ENGAGEMENT',
  BABY_SHOWER: 'BABY_SHOWER',
  FAREWELL: 'PRIVATE_PARTY',
  GET_TOGETHER: 'PRIVATE_PARTY',
  PRIVATE_DINNER: 'PRIVATE_PARTY',
  PRIVATE_PARTY: 'PRIVATE_PARTY',
  PHOTOSHOOT: 'CUSTOM_EVENT',
}

export function normalizeToEventType(raw: string | null | undefined): EventType {
  if (!raw) return 'CUSTOM_EVENT'
  const key = raw.trim().toUpperCase().replace(/\s+/g, '_')
  return LEGACY_ALIASES[key] ?? 'CUSTOM_EVENT'
}
