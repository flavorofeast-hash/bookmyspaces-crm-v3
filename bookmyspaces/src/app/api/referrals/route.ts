// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/app/api/referrals/route.ts
// Growth Engine Epic 2 — Referral Engine.
//
// GET  ?leadId=X       → this lead's referral code + shareable link (creates
//                        the code on first request)
// GET  (default)       → list referral_rewards, newest first
// POST { action: 'generate_code', leadId }  → same as GET ?leadId= (explicit
//                        action form, for buttons that need a POST semantics)
// POST { action: 'sync_rewards' }           → syncReferralRewards()
// PATCH { id, status, reward_type?, reward_value?, notes? } → update a reward
//
// Same requireAuth() + getSupabaseAdmin() pattern as every other route.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth-guard'
import { getOrCreateReferralCode, buildReferralLink, syncReferralRewards } from '@/lib/customers/referrals'

export async function GET(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  const db = getSupabaseAdmin()
  try {
    const leadId = req.nextUrl.searchParams.get('leadId')
    if (leadId) {
      const code = await getOrCreateReferralCode(leadId)
      return NextResponse.json({ code, link: buildReferralLink(code) })
    }

    const { data, error } = await db.from('referral_rewards').select('*').order('created_at', { ascending: false }).limit(200)
    if (error) throw error

    const leadIds = Array.from(new Set((data ?? []).flatMap((r) => [r.referrer_lead_id, r.referred_lead_id])))
    const { data: leads } = leadIds.length > 0
      ? await db.from('leads').select('id, name, phone').in('id', leadIds)
      : { data: [] }
    const leadById = new Map((leads ?? []).map((l) => [l.id, l]))

    const rewards = (data ?? []).map((r) => ({
      ...r,
      referrer_name: leadById.get(r.referrer_lead_id)?.name ?? null,
      referred_name: leadById.get(r.referred_lead_id)?.name ?? null,
    }))

    return NextResponse.json({ rewards })
  } catch (err) {
    logger.error('referrals', 'GET failed', err)
    return NextResponse.json({ error: 'Failed to fetch referrals' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  try {
    const body = await req.json()
    const { action, leadId } = body as { action?: string; leadId?: string }

    if (action === 'generate_code') {
      if (!leadId) return NextResponse.json({ error: 'leadId is required' }, { status: 400 })
      const code = await getOrCreateReferralCode(leadId)
      return NextResponse.json({ code, link: buildReferralLink(code) })
    }

    if (action === 'sync_rewards') {
      const result = await syncReferralRewards()
      return NextResponse.json(result)
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (err) {
    logger.error('referrals', 'POST failed', err)
    return NextResponse.json({ error: 'Referral operation failed' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  const db = getSupabaseAdmin()
  try {
    const body = await req.json()
    const { id, ...rawUpdates } = body as { id?: string; [k: string]: unknown }
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

    // Allow-list: never referrer_lead_id/referred_lead_id/created_at, which
    // define the reward's identity and are set once at creation
    // (syncReferralRewards) — only the operator-editable fields.
    const updates: Record<string, unknown> = {}
    for (const key of ['status', 'reward_type', 'reward_value', 'notes'] as const) {
      if (key in rawUpdates) updates[key] = rawUpdates[key]
    }
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No updatable fields provided (status, reward_type, reward_value, notes)' }, { status: 400 })
    }

    const { data, error } = await db
      .from('referral_rewards')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .single()
    if (error) throw error
    return NextResponse.json({ reward: data })
  } catch (err) {
    logger.error('referrals', 'PATCH failed', err)
    return NextResponse.json({ error: 'Failed to update reward' }, { status: 500 })
  }
}
