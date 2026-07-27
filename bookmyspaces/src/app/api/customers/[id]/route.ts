// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/app/api/customers/[id]/route.ts
// V3 Day 6 — Operator Experience sprint.
//
// GET single customer — a thin `leads` lookup by id. There was no
// single-lead detail endpoint anywhere in the codebase before this (only
// list/search via GET /api/leads); the Customer Profile screen needs one.
// Named "customers" (not "leads") to match the product's Customer Profile
// vocabulary, but reads the same `leads` table — the Product-Owner-resolved
// decision (audit/PHASE1_ARCHITECTURE_REVIEW_OMNICHANNEL.md, Open Decision
// #1: extend `leads`, no new `customers` table) means "customer" and "lead"
// are the same row, not two systems to keep in sync.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth-guard'
import { computeLifetimeValue } from '@/lib/customers/lifetime-value'
import { getOpportunityScoreForLead } from '@/lib/ai/opportunity-score'

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response

  try {
    const supabase = getSupabaseAdmin()
    const { data, error } = await supabase
      .from('leads')
      .select('*')
      .eq('id', params.id)
      .maybeSingle()

    if (error) throw error
    if (!data) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })

    // Revenue Platform pivot — Customer Lifetime Value. Best-effort: a
    // failure here (e.g. migration 012 not live) must not break the whole
    // Customer Profile page, so it's fetched after the customer row is
    // already confirmed to exist and never re-throws.
    let lifetimeValue = null
    try {
      lifetimeValue = await computeLifetimeValue(params.id)
    } catch (lvError) {
      logger.error('customers/[id]', 'computeLifetimeValue failed', lvError)
    }

    // AI Sales Executive (Priority 1) — Opportunity Score. getOpportunityScoreForLead
    // already never throws (returns a LOW/0 fallback), but wrapped anyway so
    // a change to that contract can never take down this route.
    let opportunityScore = null
    try {
      opportunityScore = await getOpportunityScoreForLead(params.id)
    } catch (osError) {
      logger.error('customers/[id]', 'getOpportunityScoreForLead failed', osError)
    }

    return NextResponse.json({ customer: data, lifetimeValue, opportunityScore })
  } catch (error) {
    logger.error('customers/[id]', 'GET failed', error)
    return NextResponse.json({ error: 'Failed to fetch customer' }, { status: 500 })
  }
}
