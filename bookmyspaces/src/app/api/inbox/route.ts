// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/app/api/inbox/route.ts
// V3 Phase 3 — Unified Inbox: one conversation list across every channel.
// Version 2.0 (Omnichannel Communication Platform) extension: this
// mission's Unified Inbox spec requires Opportunity Score, Proposal Status,
// Next Action, and Assigned Owner per conversation — added below by
// REUSING the exact functions Founder Dashboard already computes them
// with (getOpportunityScoreForLead, computeIntelligence), not a second
// implementation of either calculation. Proposal Status is a bulk query +
// in-memory "latest per lead" reduce, same pattern as founder/route.ts's
// own latestProposalByLead map — no new aggregation layer.
//
// GET /api/inbox?status=open|closed|escalated&limit=&offset=
// Returns unified_conversations with linked customer (leads), channel types
// and a last-message preview. This is the read model the Unified Inbox UI
// renders; WhatsApp, website chat, and (Version 2.0) Facebook Messenger/
// Instagram DM all mirror here, so this list is cross-channel by
// construction — Conversation Synchronization and Customer Timeline
// Synchronization are already true of this table, not new work.
//
// Query cost note (MASTER_ARCHITECTURE.md's "no N+1" posture, same disclosed
// trade-off as founder/route.ts): getOpportunityScoreForLead() is a per-lead
// function, so its cost scales with the number of leads on this page, not
// O(1). Bounded implicitly by this route's own existing page size (default
// 30, max 100) — the same order of magnitude as Founder Dashboard's
// explicit 12-candidate bound, not a new unbounded risk. Only computed for
// conversations with a linked lead (customer_id set) and only within the
// current page, never across the full inbox.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth-guard'
import { getOpportunityScoreForLead } from '@/lib/ai/opportunity-score'
import { computeIntelligence, type LeadIntelligenceInput } from '@/lib/leads/lead-intelligence'

interface InboxLeadRow {
  id?: string
  name: string | null
  phone: string | null
  email: string | null
  status?: string | null
  assigned_to: string | null
  created_at: string
  last_contacted_at: string | null
  ai_score: number | null
  lead_temperature: LeadIntelligenceInput['lead_temperature']
  lead_stage: LeadIntelligenceInput['lead_stage']
  escalation_required: boolean | null
  next_follow_up_at: string | null
}

interface ProposalStatusRow {
  lead_id: string | null
  status: string
  total_price: number | null
  created_at: string
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  const supabase = getSupabaseAdmin()

  try {
    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status')
    const limit = Math.min(parseInt(searchParams.get('limit') || '30', 10) || 30, 100)
    const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10) || 0, 0)

    let query = supabase
      .from('unified_conversations')
      .select(
        `id, created_at, status, ai_active, last_message_at, customer_id, leads(name, phone, email, status, assigned_to, created_at, last_contacted_at, ai_score, lead_temperature, lead_stage, escalation_required, next_follow_up_at)`,
        { count: 'exact' }
      )
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .range(offset, offset + limit - 1)

    if (status && ['open', 'closed', 'escalated'].includes(status)) {
      query = query.eq('status', status)
    }

    const { data: conversations, error, count } = await query
    if (error) throw error

    const ids = (conversations ?? []).map((c) => c.id)
    const leadIds = Array.from(
      new Set((conversations ?? []).map((c) => c.customer_id).filter((id): id is string => !!id))
    )

    // channel types per conversation
    const { data: links } = ids.length
      ? await supabase
          .from('unified_conversation_channels')
          .select('conversation_id, channel_identity, channels(channel_type)')
          .in('conversation_id', ids)
      : { data: [] }

    // last message preview per conversation (one query, reduce in JS)
    const { data: recent } = ids.length
      ? await supabase
          .from('unified_messages')
          .select('conversation_id, content, direction, sender_type, created_at')
          .in('conversation_id', ids)
          .order('created_at', { ascending: false })
          .limit(ids.length * 4)
      : { data: [] }

    // Proposal Status — one bulk query for every linked lead on this page,
    // reduced to "latest proposal per lead" in memory. Same pattern
    // founder/route.ts uses for its own latestProposalByLead map.
    const { data: proposalRows } = leadIds.length
      ? await supabase
          .from('proposals')
          .select('lead_id, status, total_price, created_at')
          .in('lead_id', leadIds)
          .order('created_at', { ascending: false })
      : { data: [] }

    const latestProposalByLead = new Map<string, ProposalStatusRow>()
    for (const p of (proposalRows ?? []) as unknown as ProposalStatusRow[]) {
      if (!p.lead_id) continue
      if (!latestProposalByLead.has(p.lead_id)) latestProposalByLead.set(p.lead_id, p)
    }

    // Opportunity Score / Next Action — reuses the exact Sprint 2/3A
    // functions Founder Dashboard already uses. Bounded to this page's
    // linked leads only (see file header).
    const scoreByLead = new Map<string, Awaited<ReturnType<typeof getOpportunityScoreForLead>>>()
    await Promise.all(
      leadIds.map(async (leadId) => {
        scoreByLead.set(leadId, await getOpportunityScoreForLead(leadId))
      })
    )

    const lastByConv = new Map<string, unknown>()
    for (const m of recent ?? []) {
      if (!lastByConv.has(m.conversation_id)) lastByConv.set(m.conversation_id, m)
    }

    const channelsByConv = new Map<string, { channelType: string; identity: string }[]>()
    for (const l of links ?? []) {
      const c = Array.isArray(l.channels) ? l.channels[0] : l.channels
      const arr = channelsByConv.get(l.conversation_id) ?? []
      arr.push({ channelType: c?.channel_type ?? 'unknown', identity: l.channel_identity })
      channelsByConv.set(l.conversation_id, arr)
    }

    const enriched = (conversations ?? []).map((c) => {
      const leadRaw = Array.isArray(c.leads) ? c.leads[0] : c.leads
      const lead = (leadRaw ?? null) as unknown as InboxLeadRow | null
      const leadId = c.customer_id as string | null

      const opportunityScore = leadId ? scoreByLead.get(leadId) ?? null : null
      const proposal = leadId ? latestProposalByLead.get(leadId) ?? null : null
      const nextAction = lead
        ? computeIntelligence({
            created_at: lead.created_at,
            last_contacted_at: lead.last_contacted_at,
            ai_score: lead.ai_score,
            lead_temperature: lead.lead_temperature,
            lead_stage: lead.lead_stage,
            escalation_required: lead.escalation_required ?? false,
            next_follow_up_at: lead.next_follow_up_at,
          }).nextAction
        : null

      return {
        ...c,
        channels: channelsByConv.get(c.id) ?? [],
        lastMessage: lastByConv.get(c.id) ?? null,
        revenueProbability: opportunityScore ? { score: opportunityScore.score, band: opportunityScore.band } : null,
        proposalStatus: proposal ? { status: proposal.status, totalPrice: proposal.total_price } : null,
        nextAction,
        assignedOwner: lead?.assigned_to ?? null,
      }
    })

    return NextResponse.json({ conversations: enriched, total: count })
  } catch (err) {
    logger.error('inbox', 'GET /api/inbox failed', err)
    return NextResponse.json({ error: 'Failed to load inbox' }, { status: 500 })
  }
}
