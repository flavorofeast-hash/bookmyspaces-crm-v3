// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/leads/lead-merge-service.ts
// Social Operations Priority 4 — duplicate lead prevention / merge.
//
// Automatic dedup ALREADY happens at write time — captureLeadWithJourney()'s
// resolveIdentity phone/email match, reused verbatim by
// interaction-service.ts's linkInteractionToLead() for social-originated
// leads. This module covers the remaining case: two leads that were created
// independently (different contact info supplied each time, e.g. a phone
// number on one channel and an Instagram handle with no phone on another)
// and a human later recognizes they're the same person and merges them
// explicitly from the CRM.
//
// SCOPE (deliberately conservative, disclosed): reassigns lead_id/
// customer_id on activity_logs, social_interactions, and reviews — the
// three record types Priority 4's own "Unified Inbox" merge is about — plus
// proposals (so proposal history is visible under one lead). Does NOT
// touch 1:1-per-lead tables (loyalty_accounts, which primary-keys on
// lead_id) or referral rows (referrer_lead_id/referred_lead_id) —
// reassigning those risks a primary-key/unique collision if the duplicate
// lead already has its own row in one of those tables, which this module
// cannot safely resolve generically without a business decision (whose
// loyalty balance wins?). The duplicate lead is never deleted, so none of
// its rows in those un-reassigned tables are lost — they simply remain
// attached to the (now merged-away) duplicate id, still reachable by
// following leads.merged_into_lead_id (migration 040) from there.
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabaseAdmin } from '@/lib/supabase'
import { logger } from '@/lib/logger'

type Result<T> = { ok: true; value: T } | { ok: false; error: string }

export interface MergeLeadsResult {
  primaryLeadId: string
  duplicateLeadId: string
  reassigned: { activityLogs: number; socialInteractions: number; reviews: number; proposals: number }
  enrichedFields: string[]
}

interface LeadRow {
  id: string
  name: string | null
  phone: string | null
  email: string | null
  notes: string | null
  merged_into_lead_id: string | null
}

export async function mergeLeads(primaryLeadId: string, duplicateLeadId: string, performedBy: string): Promise<Result<MergeLeadsResult>> {
  if (primaryLeadId === duplicateLeadId) return { ok: false, error: 'cannot_merge_lead_into_itself' }

  const db = getSupabaseAdmin()

  const [{ data: primary, error: primaryErr }, { data: duplicate, error: dupErr }] = await Promise.all([
    db.from('leads').select('id, name, phone, email, notes, merged_into_lead_id').eq('id', primaryLeadId).maybeSingle(),
    db.from('leads').select('id, name, phone, email, notes, merged_into_lead_id').eq('id', duplicateLeadId).maybeSingle(),
  ])
  if (primaryErr || !primary) return { ok: false, error: 'primary_lead_not_found' }
  if (dupErr || !duplicate) return { ok: false, error: 'duplicate_lead_not_found' }
  if ((primary as LeadRow).merged_into_lead_id) return { ok: false, error: 'primary_lead_is_itself_already_merged' }
  if ((duplicate as LeadRow).merged_into_lead_id) return { ok: false, error: 'duplicate_lead_already_merged' }

  const p = primary as LeadRow
  const d = duplicate as LeadRow

  // Concurrency guard: claim the duplicate FIRST, atomically, before doing
  // any reassignment work. Without this, two concurrent merge requests
  // naming the same duplicateLeadId but different primaries could both pass
  // the plain SELECT check above, both reassign activity_logs/
  // social_interactions/reviews/proposals (split between two primaries,
  // last write wins per table), and both set merged_into_lead_id (last
  // write wins) — leaving one primary silently missing rows it believes it
  // received, with no error ever surfaced. Conditioning this update on
  // merged_into_lead_id still being NULL makes it an atomic compare-and-
  // swap: only the first caller wins the row; the loser gets 0 rows back
  // and bails out before touching any other table.
  const { data: claimed, error: claimErr } = await db
    .from('leads')
    .update({ merged_into_lead_id: primaryLeadId })
    .eq('id', duplicateLeadId)
    .is('merged_into_lead_id', null)
    .select('id')
    .maybeSingle()
  if (claimErr) return { ok: false, error: claimErr.message }
  if (!claimed) return { ok: false, error: 'duplicate_lead_already_merged' }

  // Non-destructive enrichment — fill gaps on the primary from the
  // duplicate, never overwrite an existing value.
  const enrichedFields: string[] = []
  const enrichment: Record<string, string> = {}
  if (!p.name && d.name) { enrichment.name = d.name; enrichedFields.push('name') }
  if (!p.phone && d.phone) { enrichment.phone = d.phone; enrichedFields.push('phone') }
  if (!p.email && d.email) { enrichment.email = d.email; enrichedFields.push('email') }
  if (d.notes) {
    enrichment.notes = p.notes ? `${p.notes}\n\n[Merged from duplicate lead ${duplicateLeadId}]: ${d.notes}` : d.notes
    enrichedFields.push('notes')
  }

  const reassigned = { activityLogs: 0, socialInteractions: 0, reviews: 0, proposals: 0 }

  try {
    if (Object.keys(enrichment).length > 0) {
      const { error } = await db.from('leads').update(enrichment).eq('id', primaryLeadId)
      if (error) throw error
    }

    const { data: activityRows, error: activityErr } = await db
      .from('activity_logs').update({ lead_id: primaryLeadId }).eq('lead_id', duplicateLeadId).select('id')
    if (activityErr) logger.error('lead-merge-service', 'activity_logs reassign failed', activityErr)
    reassigned.activityLogs = activityRows?.length ?? 0

    const { data: interactionRows, error: interactionErr } = await db
      .from('social_interactions').update({ customer_id: primaryLeadId }).eq('customer_id', duplicateLeadId).select('id')
    if (interactionErr) logger.error('lead-merge-service', 'social_interactions reassign failed', interactionErr)
    reassigned.socialInteractions = interactionRows?.length ?? 0

    const { data: reviewRows, error: reviewErr } = await db
      .from('reviews').update({ customer_id: primaryLeadId }).eq('customer_id', duplicateLeadId).select('id')
    if (reviewErr) logger.error('lead-merge-service', 'reviews reassign failed', reviewErr)
    reassigned.reviews = reviewRows?.length ?? 0

    const { data: proposalRows, error: proposalErr } = await db
      .from('proposals').update({ lead_id: primaryLeadId }).eq('lead_id', duplicateLeadId).select('id')
    if (proposalErr) logger.error('lead-merge-service', 'proposals reassign failed', proposalErr)
    reassigned.proposals = proposalRows?.length ?? 0

    // merged_into_lead_id was already set atomically by the claim above —
    // no second write needed here.
    await db.from('activity_logs').insert({
      lead_id: primaryLeadId,
      action: 'lead_merged',
      description: `Merged duplicate lead ${duplicateLeadId} into this lead`,
      performed_by: performedBy,
      metadata: { duplicateLeadId, reassigned, enrichedFields },
    })

    return { ok: true, value: { primaryLeadId, duplicateLeadId, reassigned, enrichedFields } }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'merge_failed'
    logger.error('lead-merge-service', 'mergeLeads failed', err)
    return { ok: false, error: message }
  }
}
