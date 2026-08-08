// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/social/unified-inbox-service.ts
// Social Operations Priority 4 — Unified Inbox merge.
//
// GET /api/inbox (inbox/route.ts) already unifies WhatsApp + website chat
// DMs via unified_conversations. Sprint 3 (Social CRM) built
// social_interactions (comments/mentions/reviews-as-interaction) and the
// separate `reviews` table (Google/Facebook/Booking star reviews), each
// with their own read paths, but nothing merged all THREE sources into one
// feed — the actual audit gap this closes.
//
// This module does not touch unified_conversations, social_interactions, or
// reviews — it reads all three (bounded, paginated) and normalizes them
// into one shared shape, sorted by recency. No new table: a merge view over
// existing data, same "compose, don't duplicate" posture as
// dashboard/marketing/route.ts composing multiple services.
//
// Deduplication / identity resolution is NOT reimplemented here — it already
// happened at write time (interaction-service.ts's linkInteractionToLead()
// resolveIdentity phone/email dedup + same-author reuse). This module only
// reads the customer_id each source already resolved.
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabaseAdmin } from '@/lib/supabase'
import { logger } from '@/lib/logger'

export type UnifiedInboxSource = 'social_interaction' | 'review' | 'conversation'

export interface UnifiedInboxItem {
  source: UnifiedInboxSource
  id: string
  platform: string
  kind: string // interaction_type | 'review' | channel_type
  authorName: string | null
  preview: string | null
  status: string | null
  sentiment: string | null
  intent: string | null
  customerId: string | null
  createdAt: string
  raw: Record<string, unknown>
}

export interface UnifiedInboxResult {
  items: UnifiedInboxItem[]
  total: number
}

/**
 * Merges social_interactions + reviews + unified_conversations' most recent
 * message per conversation into one recency-sorted feed. `limit` bounds the
 * MERGED result, not each source individually — each source is fetched with
 * its own `limit` (same page size) so a merge never silently starves one
 * source when another has a burst of recent rows.
 */
export async function getUnifiedInbox(limit = 30, offset = 0): Promise<UnifiedInboxResult> {
  const db = getSupabaseAdmin()

  const [interactionsRes, reviewsRes, conversationsRes] = await Promise.all([
    db
      .from('social_interactions')
      .select('id, platform, interaction_type, author_name, content, status, sentiment, intent, customer_id, created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(0, offset + limit - 1),
    db
      .from('reviews')
      .select('id, platform, author_name, content, response_status, rating, customer_id, created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(0, offset + limit - 1),
    db
      .from('unified_conversations')
      .select('id, status, customer_id, last_message_at, created_at', { count: 'exact' })
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .range(0, offset + limit - 1),
  ])

  if (interactionsRes.error) logger.error('social/unified-inbox', 'interactions fetch failed', interactionsRes.error)
  if (reviewsRes.error) logger.error('social/unified-inbox', 'reviews fetch failed', reviewsRes.error)
  if (conversationsRes.error) logger.error('social/unified-inbox', 'conversations fetch failed', conversationsRes.error)

  const items: UnifiedInboxItem[] = []

  for (const row of interactionsRes.data ?? []) {
    items.push({
      source: 'social_interaction',
      id: row.id,
      platform: row.platform,
      kind: row.interaction_type,
      authorName: row.author_name,
      preview: row.content ? row.content.slice(0, 200) : null,
      status: row.status,
      sentiment: row.sentiment,
      intent: row.intent,
      customerId: row.customer_id,
      createdAt: row.created_at,
      raw: row as unknown as Record<string, unknown>,
    })
  }

  for (const row of reviewsRes.data ?? []) {
    items.push({
      source: 'review',
      id: row.id,
      platform: row.platform,
      kind: 'review',
      authorName: row.author_name,
      preview: row.content ? row.content.slice(0, 200) : null,
      status: row.response_status,
      sentiment: row.rating != null ? (row.rating >= 4 ? 'positive' : row.rating <= 2 ? 'negative' : 'neutral') : null,
      intent: null,
      customerId: row.customer_id,
      createdAt: row.created_at,
      raw: row as unknown as Record<string, unknown>,
    })
  }

  for (const row of conversationsRes.data ?? []) {
    items.push({
      source: 'conversation',
      id: row.id,
      platform: 'whatsapp_or_website', // channel type requires a join already done by /api/inbox; this feed prioritizes cross-source recency, not per-conversation channel detail
      kind: 'conversation',
      authorName: null,
      preview: null,
      status: row.status,
      sentiment: null,
      intent: null,
      customerId: row.customer_id,
      createdAt: row.last_message_at ?? row.created_at,
      raw: row as unknown as Record<string, unknown>,
    })
  }

  items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

  const total = (interactionsRes.count ?? 0) + (reviewsRes.count ?? 0) + (conversationsRes.count ?? 0)
  return { items: items.slice(offset, offset + limit), total }
}
