// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/timeline/timeline-service.ts
// V3 Day 4 — Priority 5: Customer Timeline.
//
// One unified, chronological view across every existing record of contact
// with a customer. Every source is a table that already exists and is
// already written to by live production code — this service only reads and
// merges, it doesn't introduce a new place to log events:
//   - chat        -> `conversations` (website chat + WhatsApp auto-reply transcript, LIVE)
//   - whatsapp     -> `whatsapp_messages` (per-send log, LIVE — src/lib/whatsapp/send-message.ts)
//   - email        -> `email_log` (LIVE — migration 011)
//   - lead_activity/follow_up -> `activity_logs` (LIVE, split by action name)
//   - proposal     -> `proposals` (LIVE)
//   - payment      -> `invoices` (LIVE — migration 009), joined via proposals.lead_id
//   - reservation  -> `reservations` (migration 012, NOT LIVE — degrades)
//   - ai_interaction -> `ai_interaction_log` (migration 012, NOT LIVE — degrades)
//   - social       -> `conversations` (channel='facebook'/'instagram' — same
//                      table as `chat`, reclassified by channel, Phase 2)
//   - review       -> `reviews` (migration 014/033, Phase 2)
//   - referral     -> `referral_rewards` (migration 034, Phase 2)
//   - loyalty      -> `loyalty_transactions` (migration 035, Phase 2)
//   - campaign     -> `message_queue` rows carrying metadata.campaign_id (Phase 2)
//   - call/visit   -> `follow_ups` where type IN ('call','site_visit') (Phase 2)
//
// Same fault-tolerance contract as src/lib/ai/context-builder.ts: each
// source is fetched independently and a failure in one (typically a
// not-yet-applied-migration table) never blocks the others.
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabaseAdmin } from '@/lib/supabase'
import type { CustomerTimeline, TimelineEntry, TimelineEntryType } from '@/types/timeline'

const FOLLOWUP_ACTIONS = new Set(['followup_sent', 'followup_completed', 'followup_scheduled'])

// Phase 2 (Social + WhatsApp Growth) — Phase C fix: this previously labeled
// EVERY non-whatsapp channel "Website chat", including Facebook/Instagram
// DM conversations (dm-capture-service.ts creates these with
// channel='facebook'/'instagram') — silently mislabeling social DMs as
// website chat and giving Phase C's "Social" timeline category nothing to
// bucket into. Now classified correctly per channel; website chat behavior
// (channel='website'/'chat', type stays 'chat') is unchanged.
const SOCIAL_CHANNELS = new Set(['facebook', 'instagram'])
const CHANNEL_LABEL: Record<string, string> = { whatsapp: 'WhatsApp', facebook: 'Facebook', instagram: 'Instagram' }

async function fetchChatEntries(leadId: string): Promise<TimelineEntry[]> {
  const supabase = getSupabaseAdmin()
  const { data } = await supabase
    .from('conversations')
    .select('id, channel, updated_at, is_active')
    .eq('lead_id', leadId)
    .order('updated_at', { ascending: false })
    .limit(20)

  return (data ?? []).map((c) => ({
    type: SOCIAL_CHANNELS.has(c.channel) ? ('social' as const) : ('chat' as const),
    timestamp: c.updated_at,
    title: `${CHANNEL_LABEL[c.channel] ?? 'Website'} chat`,
    description: c.is_active ? 'Active conversation' : 'Conversation ended',
    metadata: { conversationId: c.id, channel: c.channel },
  }))
}

async function fetchWhatsAppEntries(leadId: string): Promise<TimelineEntry[]> {
  const supabase = getSupabaseAdmin()
  const { data } = await supabase
    .from('whatsapp_messages')
    .select('id, direction, message_type, message_text, message_status, created_at')
    .eq('lead_id', leadId)
    .order('created_at', { ascending: false })
    .limit(30)

  return (data ?? []).map((m) => ({
    type: 'whatsapp' as const,
    timestamp: m.created_at,
    title: m.direction === 'inbound' ? 'WhatsApp received' : 'WhatsApp sent',
    description: m.message_text ?? `[${m.message_type}]`,
    metadata: { messageId: m.id, status: m.message_status },
  }))
}

async function fetchEmailEntries(leadId: string): Promise<TimelineEntry[]> {
  const supabase = getSupabaseAdmin()
  const { data } = await supabase
    .from('email_log')
    .select('id, subject, template_type, to_email, created_at')
    .eq('related_entity_type', 'lead')
    .eq('related_entity_id', leadId)
    .order('created_at', { ascending: false })
    .limit(20)

  return (data ?? []).map((e) => ({
    type: 'email' as const,
    timestamp: e.created_at,
    title: `Email: ${e.subject}`,
    description: `${e.template_type} sent to ${e.to_email}`,
    metadata: { emailId: e.id, templateType: e.template_type },
  }))
}

async function fetchActivityEntries(leadId: string): Promise<{ leadActivity: TimelineEntry[]; followUp: TimelineEntry[] }> {
  const supabase = getSupabaseAdmin()
  const { data } = await supabase
    .from('activity_logs')
    .select('id, action, description, created_at, performed_by')
    .eq('lead_id', leadId)
    .order('created_at', { ascending: false })
    .limit(50)

  const leadActivity: TimelineEntry[] = []
  const followUp: TimelineEntry[] = []

  for (const row of data ?? []) {
    const entry: TimelineEntry = {
      type: FOLLOWUP_ACTIONS.has(row.action) ? 'follow_up' : 'lead_activity',
      timestamp: row.created_at,
      title: row.action.replace(/_/g, ' '),
      description: row.description,
      metadata: { activityId: row.id, performedBy: row.performed_by },
    }
    if (entry.type === 'follow_up') followUp.push(entry)
    else leadActivity.push(entry)
  }

  return { leadActivity, followUp }
}

async function fetchProposalEntries(leadId: string): Promise<{ entries: TimelineEntry[]; proposalIds: string[] }> {
  const supabase = getSupabaseAdmin()
  const { data } = await supabase
    .from('proposals')
    .select('id, proposal_number, package_name, total_price, status, created_at')
    .eq('lead_id', leadId)
    .order('created_at', { ascending: false })
    .limit(20)

  const proposals = data ?? []

  return {
    entries: proposals.map((p) => ({
      type: 'proposal' as const,
      timestamp: p.created_at,
      title: `Proposal ${p.proposal_number ?? p.id.slice(0, 8)} (${p.status})`,
      description: p.package_name ? `${p.package_name} — Rs${p.total_price ?? 0}` : null,
      metadata: { proposalId: p.id, status: p.status },
    })),
    proposalIds: proposals.map((p) => p.id),
  }
}

async function fetchPaymentEntries(proposalIds: string[]): Promise<TimelineEntry[]> {
  if (proposalIds.length === 0) return []
  const supabase = getSupabaseAdmin()
  const { data } = await supabase
    .from('invoices')
    .select('id, invoice_number, total_amount, advance_received, balance_due, status, paid_at, created_at')
    .in('proposal_id', proposalIds)
    .order('created_at', { ascending: false })
    .limit(20)

  return (data ?? []).map((inv) => ({
    type: 'payment' as const,
    timestamp: inv.paid_at ?? inv.created_at,
    title: `Invoice ${inv.invoice_number ?? inv.id.slice(0, 8)} — ${inv.status}`,
    description: `Total Rs${inv.total_amount}, advance Rs${inv.advance_received}, balance Rs${inv.balance_due}`,
    metadata: { invoiceId: inv.id, status: inv.status },
  }))
}

async function fetchReservationEntries(leadId: string): Promise<{ entries: TimelineEntry[]; degraded: boolean }> {
  const supabase = getSupabaseAdmin()
  try {
    const { data, error } = await supabase
      .from('reservations')
      .select('id, status, check_in_date, check_out_date, final_room_rate, created_at')
      .eq('customer_id', leadId)
      .order('created_at', { ascending: false })
      .limit(20)

    if (error) return { entries: [], degraded: true }

    return {
      entries: (data ?? []).map((r) => ({
        type: 'reservation' as const,
        timestamp: r.created_at,
        title: `Reservation ${r.status}`,
        description: `${r.check_in_date} -> ${r.check_out_date}, Rs${r.final_room_rate}`,
        metadata: { reservationId: r.id, status: r.status },
      })),
      degraded: false,
    }
  } catch {
    return { entries: [], degraded: true }
  }
}

async function fetchAIInteractionEntries(leadId: string): Promise<{ entries: TimelineEntry[]; degraded: boolean }> {
  const supabase = getSupabaseAdmin()
  try {
    const { data, error } = await supabase
      .from('ai_interaction_log')
      .select('id, interaction_type, summary, created_at')
      .eq('lead_id', leadId)
      .order('created_at', { ascending: false })
      .limit(20)

    if (error) return { entries: [], degraded: true }

    return {
      entries: (data ?? []).map((a) => ({
        type: 'ai_interaction' as const,
        timestamp: a.created_at,
        title: `AI ${a.interaction_type}`,
        description: a.summary ?? null,
        metadata: { interactionId: a.id },
      })),
      degraded: false,
    }
  } catch {
    return { entries: [], degraded: true }
  }
}

// ── Phase 2 (Social + WhatsApp Growth) — Phase C: Review / Referral /
// Loyalty / Campaign / Call / Visit. Same fault-tolerance contract as the
// sources above: each wrapped so one failure never blocks the rest.

async function fetchReviewEntries(leadId: string): Promise<TimelineEntry[]> {
  const supabase = getSupabaseAdmin()
  try {
    const { data, error } = await supabase
      .from('reviews')
      .select('id, platform, rating, content, review_date, response_status, created_at')
      .eq('customer_id', leadId)
      .order('review_date', { ascending: false, nullsFirst: false })
      .limit(20)
    if (error) return []
    return (data ?? []).map((r) => ({
      type: 'review' as const,
      timestamp: r.review_date ?? r.created_at,
      title: `Review on ${r.platform}${r.rating != null ? ` — ${r.rating}★` : ''}`,
      description: r.content ?? (r.response_status !== 'none' ? `Reply status: ${r.response_status}` : null),
      metadata: { reviewId: r.id, platform: r.platform, rating: r.rating, responseStatus: r.response_status },
    }))
  } catch {
    return []
  }
}

async function fetchReferralEntries(leadId: string): Promise<TimelineEntry[]> {
  const supabase = getSupabaseAdmin()
  try {
    const { data, error } = await supabase
      .from('referral_rewards')
      .select('id, referrer_lead_id, referred_lead_id, status, reward_type, reward_value, created_at')
      .or(`referrer_lead_id.eq.${leadId},referred_lead_id.eq.${leadId}`)
      .order('created_at', { ascending: false })
      .limit(20)
    if (error) return []
    return (data ?? []).map((r) => ({
      type: 'referral' as const,
      timestamp: r.created_at,
      title: r.referrer_lead_id === leadId ? `Referral made (${r.status})` : `Referred by another customer (${r.status})`,
      description: r.reward_value != null ? `Reward: ${r.reward_type ?? 'unspecified'} — ${r.reward_value}` : null,
      metadata: { referralRewardId: r.id, status: r.status, rewardType: r.reward_type, rewardValue: r.reward_value },
    }))
  } catch {
    return []
  }
}

async function fetchLoyaltyEntries(leadId: string): Promise<TimelineEntry[]> {
  const supabase = getSupabaseAdmin()
  try {
    const { data, error } = await supabase
      .from('loyalty_transactions')
      .select('id, points_delta, reason, reference_type, created_at')
      .eq('lead_id', leadId)
      .order('created_at', { ascending: false })
      .limit(20)
    if (error) return []
    return (data ?? []).map((t) => ({
      type: 'loyalty' as const,
      timestamp: t.created_at,
      title: `${t.points_delta >= 0 ? '+' : ''}${t.points_delta} loyalty points`,
      description: t.reason,
      metadata: { transactionId: t.id, referenceType: t.reference_type },
    }))
  } catch {
    return []
  }
}

async function fetchCampaignEntries(leadId: string): Promise<TimelineEntry[]> {
  const supabase = getSupabaseAdmin()
  try {
    // No dedicated per-recipient/campaign_id column exists in this schema —
    // campaign linkage lives inside message_queue.metadata (set by
    // campaign-scheduler.ts's scheduleCampaignSend()). Bounded per-lead
    // fetch + in-JS filter, same idiom as revenue-intelligence.ts's own
    // campaign_id-from-metadata reads.
    const { data, error } = await supabase
      .from('message_queue')
      .select('id, message, status, scheduled_at, last_attempted_at, metadata')
      .eq('lead_id', leadId)
      .order('scheduled_at', { ascending: false })
      .limit(30)
    if (error) return []
    return (data ?? [])
      .filter((m) => m.metadata && typeof m.metadata === 'object' && 'campaign_id' in (m.metadata as Record<string, unknown>))
      .map((m) => {
        const meta = m.metadata as Record<string, unknown>
        return {
          type: 'campaign' as const,
          timestamp: m.last_attempted_at ?? m.scheduled_at,
          title: `Campaign message — ${m.status}`,
          description: m.message,
          metadata: { messageQueueId: m.id, campaignId: meta.campaign_id, status: m.status },
        }
      })
  } catch {
    return []
  }
}

const TASK_TYPE_MAP: Record<string, 'call' | 'visit'> = { call: 'call', site_visit: 'visit' }

async function fetchTaskEntries(leadId: string): Promise<TimelineEntry[]> {
  const supabase = getSupabaseAdmin()
  try {
    const { data, error } = await supabase
      .from('follow_ups')
      .select('id, type, status, scheduled_at, completed_at, notes, purpose, property, created_at')
      .eq('lead_id', leadId)
      .in('type', ['call', 'site_visit'])
      .order('scheduled_at', { ascending: false })
      .limit(20)
    if (error) return []
    return (data ?? []).map((f) => ({
      type: TASK_TYPE_MAP[f.type] ?? ('call' as const),
      timestamp: f.completed_at ?? f.scheduled_at ?? f.created_at,
      title: `${f.type === 'site_visit' ? 'Site visit' : 'Call'} — ${f.status}${f.property ? ` (${f.property})` : ''}`,
      description: f.purpose ?? f.notes,
      metadata: { followUpId: f.id, status: f.status },
    }))
  } catch {
    return []
  }
}

/**
 * Builds one chronological (most recent first) timeline across every
 * existing customer touchpoint. Safe to call today — live sources (chat,
 * WhatsApp, email, activity, proposals, payments) always populate; sources
 * behind migration 012 (reservations, AI interactions) return an empty
 * array with `degraded[type] = true` instead of throwing until that
 * migration is applied.
 */
export async function getCustomerTimeline(leadId: string): Promise<CustomerTimeline> {
  const [
    chat, whatsapp, email, activity, proposalResult, reservationResult, aiResult,
    review, referral, loyalty, campaign, task,
  ] = await Promise.all([
    fetchChatEntries(leadId),
    fetchWhatsAppEntries(leadId),
    fetchEmailEntries(leadId),
    fetchActivityEntries(leadId),
    fetchProposalEntries(leadId),
    fetchReservationEntries(leadId),
    fetchAIInteractionEntries(leadId),
    fetchReviewEntries(leadId),
    fetchReferralEntries(leadId),
    fetchLoyaltyEntries(leadId),
    fetchCampaignEntries(leadId),
    fetchTaskEntries(leadId),
  ])

  const payment = await fetchPaymentEntries(proposalResult.proposalIds)

  const entries: TimelineEntry[] = [
    ...chat,
    ...whatsapp,
    ...email,
    ...activity.leadActivity,
    ...activity.followUp,
    ...proposalResult.entries,
    ...payment,
    ...reservationResult.entries,
    ...aiResult.entries,
    ...review,
    ...referral,
    ...loyalty,
    ...campaign,
    ...task,
  ].sort((a, b) => (a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0))

  const degraded: Partial<Record<TimelineEntryType, boolean>> = {}
  if (reservationResult.degraded) degraded.reservation = true
  if (aiResult.degraded) degraded.ai_interaction = true

  return { leadId, entries, degraded }
}
