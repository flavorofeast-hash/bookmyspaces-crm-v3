// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/social/interaction-service.ts
// V3 Phase 5 — Unified Social Inbox business logic.
//
// Ingest path (webhooks → here): idempotent on (platform, external_id),
// best-effort CRM linkage (author name match is deliberately NOT attempted
// — too imprecise; linkage happens when a phone/email surfaces, same
// standard as the rest of identity resolution). Sentiment: cheap keyword
// pass now, upgradeable to model-scored behind the same column.
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabaseAdmin } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import type { NormalizedInteraction } from '@/lib/social/types'

const NEGATIVE = /\b(worst|terrible|horrible|bad|dirty|rude|scam|fraud|cheated|disappointed|refund|complaint)\b/i
const POSITIVE = /\b(great|amazing|excellent|beautiful|lovely|wonderful|best|fantastic|recommended|awesome)\b/i

export function classifySentiment(text: string | null): 'positive' | 'neutral' | 'negative' | null {
  if (!text) return null
  if (NEGATIVE.test(text)) return 'negative'
  if (POSITIVE.test(text)) return 'positive'
  return 'neutral'
}

export async function ingestInteraction(interaction: NormalizedInteraction): Promise<{ ok: boolean; id?: string; duplicate?: boolean }> {
  const supabase = getSupabaseAdmin()

  const { data: existing } = await supabase
    .from('social_interactions')
    .select('id')
    .eq('platform', interaction.platform)
    .eq('external_id', interaction.externalId)
    .maybeSingle()

  if (existing?.id) return { ok: true, id: existing.id, duplicate: true }

  const { data, error } = await supabase
    .from('social_interactions')
    .insert({
      platform: interaction.platform,
      interaction_type: interaction.interactionType,
      external_id: interaction.externalId,
      external_parent_id: interaction.externalParentId ?? null,
      author_name: interaction.authorName ?? null,
      author_external_id: interaction.authorExternalId ?? null,
      content: interaction.content,
      sentiment: classifySentiment(interaction.content),
      status: 'new',
      raw_payload: interaction.rawPayload ?? null,
    })
    .select('id')
    .single()

  if (error || !data) {
    logger.error('social', 'ingestInteraction insert failed', error)
    return { ok: false }
  }
  return { ok: true, id: data.id }
}
