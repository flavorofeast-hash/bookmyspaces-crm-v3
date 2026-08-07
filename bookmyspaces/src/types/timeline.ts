// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/types/timeline.ts
// V3 Day 4 — Priority 5 (Customer Timeline). Contracts only.
// ─────────────────────────────────────────────────────────────────────────────

export type TimelineEntryType =
  | 'chat'
  | 'whatsapp'
  | 'email'
  | 'lead_activity'
  | 'reservation'
  | 'proposal'
  | 'payment'
  | 'follow_up'
  | 'ai_interaction'
  // Phase 2 (Social + WhatsApp Growth) — Phase C: unified timeline additions.
  | 'social'    // Facebook/Instagram DM conversations (conversations table, channel != whatsapp/website)
  | 'review'    // reviews table (Review Engine, migration 014/033)
  | 'referral'  // referral_rewards (Referral Engine, migration 034)
  | 'loyalty'   // loyalty_transactions (Loyalty Foundation, migration 035)
  | 'campaign'  // message_queue rows tagged with metadata.campaign_id
  | 'call'      // follow_ups rows with type='call'
  | 'visit'     // follow_ups rows with type='site_visit'

export interface TimelineEntry {
  type: TimelineEntryType
  timestamp: string
  title: string
  description: string | null
  metadata: Record<string, unknown>
}

export interface CustomerTimeline {
  leadId: string
  entries: TimelineEntry[]
  /** Sources backed by not-yet-applied migration 012/013 tables (reservations, ai_interaction_log) — degraded, not thrown, when unavailable. */
  degraded: Partial<Record<TimelineEntryType, boolean>>
}
