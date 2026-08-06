// src/app/api/proposals/intelligence/route.ts
// GET  /api/proposals/intelligence          → list proposals with urgency scores
// POST /api/proposals/intelligence          → generate intelligence for a lead
// PATCH /api/proposals/intelligence         → update urgency score on a proposal

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth-guard'
import { logger } from '@/lib/logger'
import {
  generateProposalIntelligence,
  computeProposalUrgency,
  LeadSnapshot,
  ProposalSnapshot,
} from '@/lib/proposal-intelligence'

export const dynamic = 'force-dynamic'

// ─── GET — list proposals with intelligence computed client-side ──────────────
export async function GET(): Promise<NextResponse> {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  try {
    const db = getSupabaseAdmin()

    const { data, error } = await db
      .from('proposals')
      .select(
        'id, proposal_number, share_token, lead_id, client_name, client_phone, ' +
        'event_type, event_date, guest_count, package_name, total_price, ' +
        'status, reservation_id, urgency_score, risk_level, next_action, escalation_required, ' +
        'engagement_score, viewed_count, sent_at, first_viewed_at, ' +
        'last_viewed_at, followed_up_at, created_at, updated_at, ' +
        'ai_summary, recommended_package, venue_fit_reasoning, ' +
        'upsell_suggestions, urgency_cta, confidence_score, ' +
        'leads(id, name, phone, ai_score, lead_temperature, urgency_level, ' +
        'lead_stage, estimated_revenue, budget, event_type, venue)'
      )
      .order('urgency_score', { ascending: false, nullsFirst: false })
      .limit(100)

    if (error) {
      logger.error('proposals-intelligence', 'GET failed', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ proposals: data ?? [] })

  } catch (err: unknown) {
    logger.error('proposals-intelligence', 'GET unexpected error', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// ─── POST — generate intelligence content for a lead ─────────────────────────
export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  try {
    const body = await req.json() as { lead_id?: string; lead?: LeadSnapshot }

    let lead: LeadSnapshot | null = body.lead ?? null

    // If only lead_id provided, fetch lead from DB
    if (!lead && body.lead_id) {
      const db = getSupabaseAdmin()
      const { data, error } = await db
        .from('leads')
        .select('id, name, phone, email, event_type, event_date, guest_count, budget, venue, ai_score, lead_temperature, urgency_level, lead_stage, estimated_revenue, score_breakdown')
        .eq('id', body.lead_id)
        .single()

      if (error || !data) {
        return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
      }
      lead = data as unknown as LeadSnapshot
    }

    if (!lead) {
      return NextResponse.json({ error: 'Provide lead_id or lead object' }, { status: 400 })
    }

    const intelligence = generateProposalIntelligence(lead)
    return NextResponse.json(intelligence)

  } catch (err: unknown) {
    logger.error('proposals-intelligence', 'POST failed', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// ─── PATCH — recompute and persist urgency score for a proposal ───────────────
export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  try {
    const body = await req.json() as { proposal_id: string }

    if (!body.proposal_id) {
      return NextResponse.json({ error: 'proposal_id required' }, { status: 400 })
    }

    const db = getSupabaseAdmin()

    // Fetch proposal + lead
    const { data: proposal, error: propErr } = await db
      .from('proposals')
      .select('*, leads(*)')
      .eq('id', body.proposal_id)
      .single()

    if (propErr || !proposal) {
      return NextResponse.json({ error: 'Proposal not found' }, { status: 404 })
    }

    const leadRaw = (proposal as Record<string, unknown>).leads as Record<string, unknown> | null
    const lead: LeadSnapshot = {
      id                : (leadRaw?.id as string) ?? '',
      name              : (leadRaw?.name as string) ?? null,
      phone             : (leadRaw?.phone as string) ?? null,
      email             : (leadRaw?.email as string) ?? null,
      event_type        : (leadRaw?.event_type as string) ?? null,
      event_date        : (leadRaw?.event_date as string) ?? null,
      guest_count       : (leadRaw?.guest_count as number) ?? null,
      budget            : (leadRaw?.budget as string) ?? null,
      venue             : (leadRaw?.venue as string) ?? null,
      ai_score          : (leadRaw?.ai_score as number) ?? null,
      lead_temperature  : (leadRaw?.lead_temperature as string) ?? null,
      urgency_level     : (leadRaw?.urgency_level as string) ?? null,
      lead_stage        : (leadRaw?.lead_stage as string) ?? null,
      estimated_revenue : (leadRaw?.estimated_revenue as number) ?? null,
      score_breakdown   : (leadRaw?.score_breakdown as Record<string, unknown>) ?? null,
    }

    const proposalSnap: ProposalSnapshot = {
      id              : proposal.id as string,
      status          : proposal.status as ProposalSnapshot['status'],
      total_price     : proposal.total_price as number ?? null,
      package_name    : proposal.package_name as string ?? null,
      guest_count     : proposal.guest_count as number ?? null,
      event_type      : proposal.event_type as string ?? null,
      sent_at         : proposal.sent_at as string ?? null,
      first_viewed_at : proposal.first_viewed_at as string ?? null,
      last_viewed_at  : proposal.last_viewed_at as string ?? null,
      followed_up_at  : proposal.followed_up_at as string ?? null,
      viewed_count    : (proposal.viewed_count as number) ?? 0,
      engagement_score: (proposal.engagement_score as number) ?? 0,
      created_at      : proposal.created_at as string,
    }

    const urgency = computeProposalUrgency(proposalSnap, lead)

    const { error: updateErr } = await db
      .from('proposals')
      .update({
        urgency_score       : urgency.urgencyScore,
        risk_level          : urgency.riskLevel,
        next_action         : urgency.nextAction,
        recommendation      : urgency.recommendation,
        escalation_required : urgency.escalationRequired,
        updated_at          : new Date().toISOString(),
      })
      .eq('id', body.proposal_id)

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 })
    }

    return NextResponse.json(urgency)

  } catch (err: unknown) {
    logger.error('proposals-intelligence', 'PATCH failed', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
