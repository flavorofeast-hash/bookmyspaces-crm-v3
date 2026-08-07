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
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { getSupabaseAdmin } from '@/lib/supabase'
import { buildSegment } from '@/lib/campaigns'
import { sendWhatsAppText } from '@/lib/whatsapp/send-message'
import { logJourneyEvent } from '@/lib/customers/journey'
import { WHATSAPP_MESSAGES } from '@/lib/templates'
import { getOrCreateReferralCode, buildReferralLink } from '@/lib/customers/referrals'

const MAX_PER_TRIGGER = 25

async function alreadySentWithin(leadId: string, action: string, cooldownDays: number): Promise<boolean> {
  const db = getSupabaseAdmin()
  const since = new Date(Date.now() - cooldownDays * 86400000).toISOString()
  const { count } = await db
    .from('activity_logs')
    .select('id', { count: 'exact', head: true })
    .eq('lead_id', leadId)
    .eq('action', action)
    .gte('created_at', since)
  return (count ?? 0) > 0
}

interface AutomationCounts {
  birthday: number
  anniversary: number
  winBack: number
  proposalExpiry: number
  repeatBooking: number
  referralRequest: number
}

async function runBirthday(): Promise<number> {
  const leads = await buildSegment({ upcoming_birthday_days: 3 })
  let sent = 0
  for (const lead of leads.slice(0, MAX_PER_TRIGGER)) {
    if (await alreadySentWithin(lead.id, 'whatsapp_birthday_sent', 300)) continue
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
    try {
      const code = await getOrCreateReferralCode(lead.id)
      const link = buildReferralLink(code)
      const result = await sendWhatsAppText(lead.phone!, WHATSAPP_MESSAGES.referralRequestMessage({ name: lead.name ?? undefined, referralLink: link }), { leadId: lead.id })
      if (result.success) {
        sent++
        await logJourneyEvent(lead.id, 'whatsapp_referral_request_sent', 'Referral request sent', { referralCode: code })
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

export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const auth = req.headers.get('authorization')
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const counts: AutomationCounts = {
    birthday: 0, anniversary: 0, winBack: 0, proposalExpiry: 0, repeatBooking: 0, referralRequest: 0,
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

  return NextResponse.json({ sent: counts })
}

export async function GET(req: NextRequest) {
  return POST(req)
}
