// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/app/api/cron/marketing-automations/route.ts
// Phase 2 (Social + WhatsApp Growth) — the automated-trigger half of Phase
// B's "Automations" requirement (Birthday, Anniversary, Proposal Expiry,
// Repeat Booking, Referral Request, Win-back). Reservation/Check-in/
// Check-out/Review-Request are already covered by the existing
// stay-lifecycle + review-reminders crons — not duplicated here.
//
// "Festival" is deliberately NOT an automated trigger in this route: unlike
// the others, a festival has no computable date/offer in this schema (no
// festival-calendar table exists, and inventing one with fabricated dates
// would violate this build's "never fabricate data" rule). Festival promos
// are already supported as a manual Campaign
// (WHATSAPP_MESSAGES/APPROVED_TEMPLATES.FESTIVAL_PROMO +
// TEMPLATE_PARAMS.festivalPromo in src/lib/templates.ts) — an operator
// picks the segment + writes the real offer/expiry via the existing
// Campaigns page, same as any other campaign.
//
// Every trigger below: (1) selects candidates via buildSegment() or a
// direct query, (2) checks a cooldown window against activity_logs via
// logJourneyEvent's own action name (same recency-check idiom used
// elsewhere in this codebase, e.g. wasRecentlyContacted() in queue.ts),
// (3) sends via sendWhatsAppText, (4) logs the send so the cooldown check
// prevents a duplicate next run. Bounded per-run (MAX_PER_TRIGGER) so one
// cron tick can't fan out an unbounded number of sends.
//
// Phase 3 (Revenue Automation) — added runProposalNudge(), the automated
// counterpart to "Proposal not opened" / "Proposal viewed but inactive".
// Distinct from runProposalExpiry() above (which fires only near
// expires_at, regardless of view state): this reuses the existing
// computeProposalUrgency() engine (src/lib/proposal-intelligence.ts,
// already used by /api/proposals/intelligence and the Chief of Staff) —
// its 'follow_up_now'/'resend_proposal' next-actions ARE the "not opened
// after 24/48h" and "viewed with no reply after 24h" signals the mission
// asked for. No second urgency calculation was written.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { getSupabaseAdmin } from '@/lib/supabase'
import { buildSegment } from '@/lib/campaigns'
import { sendWhatsAppText } from '@/lib/whatsapp/send-message'
import { logJourneyEvent, alreadySentWithin } from '@/lib/customers/journey'
import { WHATSAPP_MESSAGES } from '@/lib/templates'
import { buildReferralInvitationMessage } from '@/lib/customers/referrals'
import { computeProposalUrgency, LeadSnapshot, ProposalSnapshot } from '@/lib/proposal-intelligence'
import { listBusinessPackages, resolveBusinessPackageAudience, renderPackageWhatsAppMessage } from '@/lib/business-packages/business-package-service'
import { canSendAutomatedMessage } from '@/lib/messaging/orchestrator'

const MAX_PER_TRIGGER = 25

interface AutomationCounts {
  birthday: number
  anniversary: number
  winBack: number
  proposalExpiry: number
  repeatBooking: number
  referralRequest: number
  proposalNudge: number
  businessPackagePromo: number
}

async function runBirthday(): Promise<number> {
  const leads = await buildSegment({ upcoming_birthday_days: 3 })
  let sent = 0
  for (const lead of leads.slice(0, MAX_PER_TRIGGER)) {
    if (await alreadySentWithin(lead.id, 'whatsapp_birthday_sent', 300)) continue
    if (!(await canSendAutomatedMessage(lead.id, 'birthday'))) continue
    const result = await sendWhatsAppText(lead.phone!, WHATSAPP_MESSAGES.birthdayWish(lead.name ?? undefined), { leadId: lead.id })
    if (result.success) {
      sent++
      await logJourneyEvent(lead.id, 'whatsapp_birthday_sent', 'Birthday wish sent', {})
    }
  }
  return sent
}

async function runAnniversary(): Promise<number> {
  const leads = await buildSegment({ upcoming_anniversary_days: 3 })
  let sent = 0
  for (const lead of leads.slice(0, MAX_PER_TRIGGER)) {
    if (await alreadySentWithin(lead.id, 'whatsapp_anniversary_sent', 300)) continue
    if (!(await canSendAutomatedMessage(lead.id, 'anniversary'))) continue
    const result = await sendWhatsAppText(lead.phone!, WHATSAPP_MESSAGES.anniversaryWish(lead.name ?? undefined), { leadId: lead.id })
    if (result.success) {
      sent++
      await logJourneyEvent(lead.id, 'whatsapp_anniversary_sent', 'Anniversary wish sent', {})
    }
  }
  return sent
}

async function runWinBack(): Promise<number> {
  const leads = await buildSegment({ dormant_since_days: 90 })
  let sent = 0
  for (const lead of leads.slice(0, MAX_PER_TRIGGER)) {
    if (await alreadySentWithin(lead.id, 'whatsapp_winback_sent', 60)) continue
    if (!(await canSendAutomatedMessage(lead.id, 'winback'))) continue
    const result = await sendWhatsAppText(lead.phone!, WHATSAPP_MESSAGES.winBack(lead.name ?? undefined), { leadId: lead.id })
    if (result.success) {
      sent++
      await logJourneyEvent(lead.id, 'whatsapp_winback_sent', 'Win-back message sent', {})
    }
  }
  return sent
}

async function runRepeatBooking(): Promise<number> {
  const leads = await buildSegment({ repeat_customer: true, dormant_since_days: 60 })
  let sent = 0
  for (const lead of leads.slice(0, MAX_PER_TRIGGER)) {
    if (await alreadySentWithin(lead.id, 'whatsapp_repeat_booking_sent', 90)) continue
    if (!(await canSendAutomatedMessage(lead.id, 'repeat_booking'))) continue
    const result = await sendWhatsAppText(lead.phone!, WHATSAPP_MESSAGES.repeatBookingInvite({ name: lead.name ?? undefined }), { leadId: lead.id })
    if (result.success) {
      sent++
      await logJourneyEvent(lead.id, 'whatsapp_repeat_booking_sent', 'Repeat-booking invite sent', {})
    }
  }
  return sent
}

async function runReferralRequest(): Promise<number> {
  const leads = await buildSegment({ repeat_customer: true })
  let sent = 0
  for (const lead of leads.slice(0, MAX_PER_TRIGGER)) {
    if (await alreadySentWithin(lead.id, 'whatsapp_referral_request_sent', 120)) continue
    if (!(await canSendAutomatedMessage(lead.id, 'referral_request'))) continue
    try {
      const { message, referralCode } = await buildReferralInvitationMessage({ id: lead.id, name: lead.name })
      const result = await sendWhatsAppText(lead.phone!, message, { leadId: lead.id })
      if (result.success) {
        sent++
        await logJourneyEvent(lead.id, 'whatsapp_referral_request_sent', 'Referral request sent', { referralCode })
      }
    } catch (err) {
      logger.error('marketing-automations', 'Referral request failed for lead', err, { leadId: lead.id })
    }
  }
  return sent
}

async function runProposalExpiry(): Promise<number> {
  const db = getSupabaseAdmin()
  const now = new Date()
  const soon = new Date(now.getTime() + 2 * 86400000).toISOString()

  const { data: proposals, error } = await db
    .from('proposals')
    .select('id, lead_id, proposal_number, share_token, expires_at, status')
    .in('status', ['sent', 'viewed'])
    .not('expires_at', 'is', null)
    .lte('expires_at', soon)
    .gt('expires_at', now.toISOString())
    .limit(MAX_PER_TRIGGER)

  if (error || !proposals) {
    if (error) logger.error('marketing-automations', 'Failed to load expiring proposals', error)
    return 0
  }

  let sent = 0
  for (const proposal of proposals) {
    if (!proposal.lead_id) continue
    // Dedup per-proposal (not per-lead) via metadata, since a lead could
    // have multiple proposals in flight.
    const { count } = await db
      .from('activity_logs')
      .select('id', { count: 'exact', head: true })
      .eq('lead_id', proposal.lead_id)
      .eq('action', 'whatsapp_proposal_expiry_sent')
      .contains('metadata', { proposalId: proposal.id })
    if ((count ?? 0) > 0) continue

    const { data: lead } = await db.from('leads').select('id, name, phone, whatsapp_opted_in').eq('id', proposal.lead_id).maybeSingle()
    if (!lead?.phone || !lead.whatsapp_opted_in || !proposal.share_token) continue
    if (!(await canSendAutomatedMessage(lead.id, 'proposal_expiry'))) continue

    const shareUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://bookmyspaces.in'}/proposals/share/${proposal.share_token}`
    const result = await sendWhatsAppText(
      lead.phone,
      WHATSAPP_MESSAGES.proposalFollowUp(lead.name ?? undefined, proposal.proposal_number ?? '', shareUrl),
      { leadId: lead.id }
    )
    if (result.success) {
      sent++
      await logJourneyEvent(lead.id, 'whatsapp_proposal_expiry_sent', 'Proposal expiry reminder sent', { proposalId: proposal.id })
    }
  }
  return sent
}

// Phase 3 (Revenue Automation) — "Proposal not opened" + "Proposal viewed
// but inactive" triggers, both driven by computeProposalUrgency() rather
// than a second hand-rolled staleness check. Scans open (sent/viewed)
// proposals with a lead attached, computes urgency, and:
//   1. Persists urgency_score/risk_level/next_action back onto the
//      proposal (same fields /api/proposals/intelligence's PATCH writes)
//      so this field stays fresh automatically instead of only on a
//      manual recompute — closes the staleness gap the AI Chief of Staff
//      sprint doc explicitly flagged ("only updated by a manual PATCH
//      call and can be stale").
//   2. Sends a WhatsApp nudge (reusing the same proposalFollowUp template
//      runProposalExpiry() already uses — one template, not two) only
//      when the urgency engine says follow-up/resend is actually due,
//      deduped per-proposal via the same activity_logs.metadata.contains
//      idiom runProposalExpiry() already established.
async function runProposalNudge(): Promise<number> {
  const db = getSupabaseAdmin()

  const { data: proposals, error } = await db
    .from('proposals')
    // A single literal (not string-concatenated with `+`) so supabase-js can
    // infer the joined row shape from this literal instead of falling back
    // to a generic error type — pre-existing runtime behavior is unchanged.
    .select(
      `id, status, total_price, package_name, guest_count, event_type, sent_at, first_viewed_at,
      last_viewed_at, followed_up_at, viewed_count, engagement_score, created_at, proposal_number, share_token, lead_id,
      leads(id, name, phone, whatsapp_opted_in, ai_score, lead_temperature, urgency_level, lead_stage, estimated_revenue, budget, event_type, venue, email, event_date, guest_count)`
    )
    .in('status', ['sent', 'viewed'])
    .limit(MAX_PER_TRIGGER * 3) // headroom — most scanned proposals won't need a nudge this run

  if (error || !proposals) {
    if (error) logger.error('marketing-automations', 'Failed to load open proposals for nudge scan', error)
    return 0
  }

  let sent = 0
  for (const proposal of proposals) {
    if (sent >= MAX_PER_TRIGGER) break
    const leadRaw = (Array.isArray(proposal.leads) ? proposal.leads[0] : proposal.leads) as Record<string, unknown> | null
    if (!leadRaw?.id) continue

    const lead: LeadSnapshot = {
      id: leadRaw.id as string,
      name: (leadRaw.name as string) ?? null,
      phone: (leadRaw.phone as string) ?? null,
      email: (leadRaw.email as string) ?? null,
      event_type: (leadRaw.event_type as string) ?? null,
      event_date: (leadRaw.event_date as string) ?? null,
      guest_count: (leadRaw.guest_count as number) ?? null,
      budget: (leadRaw.budget as string) ?? null,
      venue: (leadRaw.venue as string) ?? null,
      ai_score: (leadRaw.ai_score as number) ?? null,
      lead_temperature: (leadRaw.lead_temperature as string) ?? null,
      urgency_level: (leadRaw.urgency_level as string) ?? null,
      lead_stage: (leadRaw.lead_stage as string) ?? null,
      estimated_revenue: (leadRaw.estimated_revenue as number) ?? null,
      score_breakdown: null,
    }

    const proposalSnap: ProposalSnapshot = {
      id: proposal.id,
      status: proposal.status as ProposalSnapshot['status'],
      total_price: proposal.total_price ?? null,
      package_name: proposal.package_name ?? null,
      guest_count: proposal.guest_count ?? null,
      event_type: proposal.event_type ?? null,
      sent_at: proposal.sent_at ?? null,
      first_viewed_at: proposal.first_viewed_at ?? null,
      last_viewed_at: proposal.last_viewed_at ?? null,
      followed_up_at: proposal.followed_up_at ?? null,
      viewed_count: proposal.viewed_count ?? 0,
      engagement_score: proposal.engagement_score ?? 0,
      created_at: proposal.created_at,
    }

    const urgency = computeProposalUrgency(proposalSnap, lead)

    // Keep urgency_score/risk_level/next_action fresh on every scan, not
    // just when a nudge is sent — best-effort, never blocks the send path.
    const { error: updateErr } = await db
      .from('proposals')
      .update({
        urgency_score: urgency.urgencyScore,
        risk_level: urgency.riskLevel,
        next_action: urgency.nextAction,
        recommendation: urgency.recommendation,
        escalation_required: urgency.escalationRequired,
      })
      .eq('id', proposal.id)
    if (updateErr) logger.error('marketing-automations', 'Failed to refresh proposal urgency', updateErr, { proposalId: proposal.id })

    if (!urgency.followUpRequired && !urgency.resendRecommended) continue
    if (!lead.phone || leadRaw.whatsapp_opted_in === false || !proposal.share_token) continue

    const { count } = await db
      .from('activity_logs')
      .select('id', { count: 'exact', head: true })
      .eq('lead_id', lead.id)
      .eq('action', 'whatsapp_proposal_nudge_sent')
      .contains('metadata', { proposalId: proposal.id })
    if ((count ?? 0) > 0) continue
    if (!(await canSendAutomatedMessage(lead.id, 'proposal_nudge'))) continue

    const shareUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://bookmyspaces.in'}/proposals/share/${proposal.share_token}`
    const result = await sendWhatsAppText(
      lead.phone,
      WHATSAPP_MESSAGES.proposalFollowUp(lead.name ?? undefined, proposal.proposal_number ?? '', shareUrl),
      { leadId: lead.id }
    )
    if (result.success) {
      sent++
      await logJourneyEvent(lead.id, 'whatsapp_proposal_nudge_sent', `Proposal nudge sent (${urgency.nextAction})`, {
        proposalId: proposal.id,
        nextAction: urgency.nextAction,
        riskLevel: urgency.riskLevel,
      })
    }
  }
  return sent
}

// Business Package Engine — "WhatsApp Automation" integration requirement.
// Reuses resolveBusinessPackageAudience() (= buildSegment(pkg.marketingSegment),
// same audience engine every other trigger in this file is built on) and
// renderPackageWhatsAppMessage() (this package's own stored template) — no
// new segmentation or messaging logic. Per-lead cooldown via
// alreadySentWithin(), same idiom as birthday/anniversary/winBack/repeatBooking
// above, since this is a per-lead promo cadence, not a per-item event like
// proposal expiry/nudge.
async function runBusinessPackagePromo(): Promise<number> {
  let packages
  try {
    packages = await listBusinessPackages({ status: 'active' })
  } catch (err) {
    logger.error('marketing-automations', 'Failed to load active business packages', err)
    return 0
  }

  let sent = 0
  for (const pkg of packages) {
    if (sent >= MAX_PER_TRIGGER) break
    if (!pkg.whatsappTemplate) continue

    let leads
    try {
      leads = await resolveBusinessPackageAudience(pkg)
    } catch (err) {
      logger.error('marketing-automations', 'Failed to resolve business package audience', err, { packageId: pkg.id })
      continue
    }

    for (const lead of leads) {
      if (sent >= MAX_PER_TRIGGER) break
      if (!lead.phone) continue
      if (await alreadySentWithin(lead.id, 'whatsapp_business_package_promo_sent', 14)) continue
      if (!(await canSendAutomatedMessage(lead.id, 'business_package_promo'))) continue

      const message = renderPackageWhatsAppMessage(pkg, lead.name ?? null)
      if (!message) continue

      const result = await sendWhatsAppText(lead.phone, message, { leadId: lead.id })
      if (result.success) {
        sent++
        await logJourneyEvent(lead.id, 'whatsapp_business_package_promo_sent', `Business Package promo sent: ${pkg.name}`, { businessPackageId: pkg.id })
      }
    }
  }
  return sent
}

export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const auth = req.headers.get('authorization')
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const counts: AutomationCounts = {
    birthday: 0, anniversary: 0, winBack: 0, proposalExpiry: 0, repeatBooking: 0, referralRequest: 0, proposalNudge: 0, businessPackagePromo: 0,
  }

  try {
    counts.birthday = await runBirthday()
  } catch (err) { logger.error('marketing-automations', 'Birthday trigger failed', err) }

  try {
    counts.anniversary = await runAnniversary()
  } catch (err) { logger.error('marketing-automations', 'Anniversary trigger failed', err) }

  try {
    counts.winBack = await runWinBack()
  } catch (err) { logger.error('marketing-automations', 'Win-back trigger failed', err) }

  try {
    counts.proposalExpiry = await runProposalExpiry()
  } catch (err) { logger.error('marketing-automations', 'Proposal expiry trigger failed', err) }

  try {
    counts.repeatBooking = await runRepeatBooking()
  } catch (err) { logger.error('marketing-automations', 'Repeat booking trigger failed', err) }

  try {
    counts.referralRequest = await runReferralRequest()
  } catch (err) { logger.error('marketing-automations', 'Referral request trigger failed', err) }

  try {
    counts.proposalNudge = await runProposalNudge()
  } catch (err) { logger.error('marketing-automations', 'Proposal nudge trigger failed', err) }

  try {
    counts.businessPackagePromo = await runBusinessPackagePromo()
  } catch (err) { logger.error('marketing-automations', 'Business package promo trigger failed', err) }

  return NextResponse.json({ sent: counts })
}

export async function GET(req: NextRequest) {
  return POST(req)
}
