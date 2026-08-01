// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/leads/visit-to-proposal.ts
// Sprint 2 — Revenue Conversion Engine.
//
// Mission: convert every completed Site Visit into a Proposal Opportunity.
// Pipeline: Site Visit -> AI Review -> Package Recommendation -> Pricing ->
// Proposal Draft -> Owner Review -> WhatsApp -> PDF -> Follow-up.
//
// This module is deliberately thin — it is the missing TRIGGER, not a new
// drafting engine. Package Recommendation, Pricing, Proposal Draft creation,
// and Property Intelligence enforcement all already exist and are reused
// unchanged via runAutoPackageRecommendation() (src/lib/leads/
// auto-package-recommendation.ts, built for Sprint 4's lead-qualification
// trigger, extended this sprint with a Property Intelligence guard shared
// by both triggers — see that file's header). Owner Review is the existing
// proposals.status='draft' state (no new status needed — every AI-drafted
// proposal in this app already requires a human click to send, per
// MASTER_ARCHITECTURE.md's AI Safety & Approval Layer). WhatsApp, PDF, and
// Follow-up are existing, already-live, human-triggered actions on the
// Proposals page (src/app/(crm)/proposals/page.tsx) — a draft proposal
// created here is immediately usable by all of them with zero new code.
//
// "Use CRM data already collected" / "Pre-fill proposal automatically": a
// site visit (follow_ups, type='site_visit') captures guest_count/budget/
// property at scheduling time (migration 027), but scheduleSiteVisit() only
// writes those onto a NEWLY-created lead — an existing lead's guest_count/
// budget/venue are left untouched even if the visit captured fresher values.
// This module closes that gap with a safe-fill (only writes fields that are
// currently null on the lead — never overwrites a value the lead already
// has), the same "fill empty fields only" convention POST /api/proposals
// already uses for its package_id safe-fill.
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabaseAdmin } from '@/lib/supabase'
import { runAutoPackageRecommendation, type AutoRecommendationResult } from '@/lib/leads/auto-package-recommendation'
import { logger } from '@/lib/logger'

export interface VisitToProposalResult extends AutoRecommendationResult {
  leadId: string | null
}

const NONE: VisitToProposalResult = { ran: false, packageId: null, draftProposalId: null, leadId: null }

interface VisitRow {
  lead_id: string | null
  property: string | null
  purpose: string | null
  guest_count: number | null
  budget: string | null
}

interface LeadRow {
  guest_count: number | null
  budget: string | null
  venue: string | null
  event_type: string | null
}

/**
 * Detects a completed Site Visit (by follow_ups.id) and, when the linked
 * lead is eligible, runs the existing Package Recommendation -> Pricing ->
 * Proposal Draft pipeline for it. Intended to be called right after a site
 * visit's status is set to 'completed' (PATCH /api/site-visits/[id]).
 *
 * Never throws — a failure here must not break the visit-status update it's
 * attached to. Skips (does not error) leads without an event_type, exactly
 * like runAutoPackageRecommendation's own existing gate — a visit for a
 * lead the AI/operator never captured an event type for legitimately has
 * nothing to recommend a package against yet.
 */
export async function runVisitToProposalConversion(visitId: string): Promise<VisitToProposalResult> {
  try {
    const db = getSupabaseAdmin()

    const { data: visit } = await db
      .from('follow_ups')
      .select('lead_id, property, purpose, guest_count, budget')
      .eq('id', visitId)
      .eq('type', 'site_visit')
      .maybeSingle()

    const visitRow = visit as unknown as VisitRow | null
    if (!visitRow?.lead_id) return NONE
    const leadId = visitRow.lead_id

    const { data: lead } = await db
      .from('leads')
      .select('guest_count, budget, venue, event_type')
      .eq('id', leadId)
      .maybeSingle()

    const leadRow = lead as unknown as LeadRow | null
    if (!leadRow) return { ...NONE, leadId }

    // ── Pre-fill from CRM data already collected (safe-fill: never overwrite) ──
    const fill: Record<string, unknown> = {}
    if (leadRow.guest_count === null && visitRow.guest_count !== null) fill.guest_count = visitRow.guest_count
    if (!leadRow.budget && visitRow.budget) fill.budget = visitRow.budget
    if (!leadRow.venue && visitRow.property) fill.venue = visitRow.property

    if (Object.keys(fill).length > 0) {
      const { error: fillError } = await db.from('leads').update(fill).eq('id', leadId)
      if (fillError) {
        // Non-fatal — the recommendation can still run against whatever the
        // lead already had; it just won't benefit from the visit's fresher data.
        logger.error('leads', 'visit-to-proposal: lead safe-fill failed', fillError)
      }
    }

    const result = await runAutoPackageRecommendation(leadId, null)
    return { ...result, leadId }
  } catch (err) {
    logger.error('leads', `runVisitToProposalConversion failed for visit ${visitId}`, err)
    return NONE
  }
}
