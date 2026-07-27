// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/leads/auto-package-recommendation.ts
// Direct Event Sales Engine — Phase 5, Revenue Automation.
//
// Closes the gap between "AI Qualification" and "Booking" the business
// directive's pipeline calls for:
//   Lead Created -> AI Qualification -> Package Recommendation ->
//   Proposal Suggestion -> Follow-up -> Booking -> Customer Journey
//
// AI Qualification (qualifyLeadFromMessage), Follow-up (followup-rules.ts /
// cron/followups), Booking (reservation-workflow.ts) and Customer Journey
// (Customer Journey Automation) already exist and are already live. Package
// Recommendation and Proposal Suggestion did not — the AI Event Sales
// Advisor (runEventSalesAdvisor, Section 2/7) only ran when an operator
// clicked a button on the customer detail page. This module is the missing
// automatic trigger: it calls that SAME function (no new AI logic) right
// after qualification, and — when the advisor names a real package with
// enough confidence — creates an actual DRAFT proposal via the SAME
// package-driven safe-fill fields POST /api/proposals already writes, so
// "Proposal Suggestion" is a real, ready-to-review row in the Proposals
// list, not just text an operator has to act on manually.
//
// Never sends anything to the customer. status: 'draft' only — same
// human-approval-required convention as every other AI drafting feature in
// this app (proposal cover notes, upsell recommendations, etc.). Never
// throws — a failure here must not break lead creation.
// ─────────────────────────────────────────────────────────────────────────────

import { v4 as uuidv4 } from 'uuid'
import { getSupabaseAdmin } from '@/lib/supabase'
import { buildAIContext } from '@/lib/ai/context-builder'
import { runEventSalesAdvisor } from '@/lib/ai/operator-assistant'
import { getPackageById, resolvePackagePrice } from '@/lib/packages/package-service'
import { generateProposalCoverNote } from '@/lib/scoring'
import { logger } from '@/lib/logger'

export interface AutoRecommendationResult {
  ran: boolean
  packageId: string | null
  draftProposalId: string | null
}

const NONE: AutoRecommendationResult = { ran: false, packageId: null, draftProposalId: null }

/**
 * Runs the AI Event Sales Advisor for a lead and, when it confidently names
 * a real catalog package, auto-creates a draft proposal from it. Intended
 * to be called right after qualifyLeadFromMessage() so leads.event_type
 * reflects whatever could be extracted.
 *
 * Gated to leads that already carry an event_type — recommending a package
 * genuinely requires knowing what kind of event this is, and skipping the
 * Anthropic call entirely when there is no signal avoids spending API
 * budget on a call the advisor's own prompt would answer with nulls anyway.
 * Also skipped for leads that already have a proposal, so re-engagement/
 * re-qualification touches don't spam duplicate drafts.
 */
export async function runAutoPackageRecommendation(
  leadId: string,
  conversationId: string | null = null
): Promise<AutoRecommendationResult> {
  try {
    const db = getSupabaseAdmin()

    const { data: lead } = await db
      .from('leads')
      .select('id, name, phone, email, event_type, event_date, guest_count')
      .eq('id', leadId)
      .maybeSingle()

    if (!lead || !lead.event_type) return NONE

    const { count } = await db
      .from('proposals')
      .select('id', { count: 'exact', head: true })
      .eq('lead_id', leadId)
    if ((count ?? 0) > 0) return NONE

    const context = await buildAIContext({ leadId, query: '', conversationId })
    const advisor = await runEventSalesAdvisor(context, leadId, conversationId)
    if (!advisor.ok) return NONE

    const { recommendation, salesCopilot } = advisor.result
    if (!recommendation.packageId) return { ran: true, packageId: null, draftProposalId: null }

    const pkg = await getPackageById(recommendation.packageId)
    if (!pkg) return { ran: true, packageId: recommendation.packageId, draftProposalId: null }

    const { price: basePrice } = resolvePackagePrice(pkg, lead.event_date)
    const addons = pkg.addons.map((a) => ({ name: a.name, price: a.price }))
    const addonsTotal = addons.reduce((sum, a) => sum + (Number(a.price) || 0), 0)
    const totalPrice = Math.max(0, basePrice + addonsTotal)

    let aiCoverNote: string | null = null
    try {
      aiCoverNote = await generateProposalCoverNote({
        client_name: lead.name,
        event_type: lead.event_type,
        venue: pkg.venue,
        package_name: pkg.name,
        base_price: basePrice,
        addons,
        total_price: totalPrice,
      } as any)
    } catch {
      // Best-effort — the draft is still useful for the operator without it.
    }

    const noteParts = [
      'AI-suggested draft — review before sending.',
      recommendation.catering ? `Catering: ${recommendation.catering}.` : null,
      recommendation.decoration ? `Decoration: ${recommendation.decoration}.` : null,
      recommendation.upsells.length > 0 ? `Upsell ideas: ${recommendation.upsells.join(', ')}.` : null,
    ].filter(Boolean)

    const { data: proposal, error } = await db
      .from('proposals')
      .insert({
        lead_id: leadId,
        client_name: lead.name,
        client_phone: lead.phone,
        client_email: lead.email,
        event_type: lead.event_type,
        event_date: lead.event_date,
        guest_count: lead.guest_count ?? pkg.maxGuests,
        venue: pkg.venue,
        hall: pkg.hall,
        package_name: pkg.name,
        package_id: pkg.id,
        base_price: basePrice,
        addons,
        addon_service_ids: pkg.addonServiceIds,
        total_price: totalPrice,
        advance_required: Math.round(totalPrice * 0.5),
        special_requirements: noteParts.join(' '),
        ai_cover_note: aiCoverNote,
        status: 'draft',
        share_token: uuidv4().replace(/-/g, ''),
      })
      .select('id')
      .single()

    if (error || !proposal) {
      logger.error('leads', 'runAutoPackageRecommendation: draft proposal insert failed', error)
      return { ran: true, packageId: pkg.id, draftProposalId: null }
    }

    await db.from('activity_logs').insert({
      lead_id: leadId,
      action: 'ai_draft_proposal_created',
      description: `AI recommended the "${pkg.name}" package — draft proposal ready for review (booking probability: ${salesCopilot.bookingProbability})`,
      performed_by: 'system',
      metadata: { proposal_id: proposal.id, package_id: pkg.id, booking_probability: salesCopilot.bookingProbability },
    })

    return { ran: true, packageId: pkg.id, draftProposalId: proposal.id }
  } catch (err) {
    logger.error('leads', `runAutoPackageRecommendation failed for lead ${leadId}`, err)
    return NONE
  }
}
