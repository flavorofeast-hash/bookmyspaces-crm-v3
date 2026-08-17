import Anthropic from '@anthropic-ai/sdk'
import { getSupabaseAdmin } from './supabase'

let _anthropic: Anthropic | null = null
function getAnthropic() {
  if (!_anthropic) _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || '' })
  return _anthropic
}

export interface FestivalMessage {
  festival: string
  date: string
  message: string
  cta: string
  full_message: string
}

export async function generateFestivalMessage(
  festival: string,
  offerDetails?: string
): Promise<FestivalMessage> {
  const prompt = `Write a warm, short WhatsApp festival greeting for a premium hospitality venue in Kolkata.

Festival: ${festival}
Business: BookMySpaces / Monurama Homestay
Offer: ${offerDetails || 'Special celebration packages available'}

Requirements:
- 3-4 sentences max
- Start with festival wishes
- Naturally mention the venue for celebrations
- End with a soft call to action (WhatsApp to inquire)
- Use 2-3 relevant emojis
- Sound warm, not salesy
- Include phone: 8017035546

Return ONLY the message text, no preamble.`

  const response = await getAnthropic().messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 200,
    messages: [{ role: 'user', content: prompt }],
  })

  const message = response.content[0].type === 'text'
    ? response.content[0].text
    : `Wishing you a wonderful ${festival}! Celebrate with your loved ones at BookMySpaces. WhatsApp: 8017035546 🎉`

  const cta = `📱 WhatsApp: 8017035546`
  const fullMessage = message.includes('8017035546') ? message : `${message}\n\n${cta}`

  return {
    festival,
    date: new Date().toISOString().split('T')[0],
    message,
    cta,
    full_message: fullMessage,
  }
}

export async function getUpcomingFestivals(daysAhead = 30) {
  const supabaseAdmin = getSupabaseAdmin()
  const until = new Date(Date.now() + daysAhead * 86400000).toISOString().split('T')[0]
  const today = new Date().toISOString().split('T')[0]

  const { data } = await supabaseAdmin
    .from('festival_calendar')
    .select('*')
    .gte('date', today)
    .lte('date', until)
    .order('date', { ascending: true })

  return data || []
}

export interface SegmentFilter {
  status?: string[]
  source?: string[]
  min_score?: number
  event_type?: string
  venue?: string
  is_vip?: boolean
  /** Leads whose initial inquiry (created_at) falls within the last N days — recency of the lead, not staleness. */
  days_since_inquiry?: number
  /**
   * Marketing Automation (Priority 2) — "Birthday campaigns": leads whose
   * `leads.birthday` (migration 018) falls on or within the next N days,
   * matched by month+day only (year on the stored date is irrelevant — it's
   * either the actual birth year or a placeholder from import). Handles the
   * December -> January wraparound.
   */
  upcoming_birthday_days?: number
  /** Same recurring-annual-date matching as `upcoming_birthday_days`, against `leads.anniversary`. */
  upcoming_anniversary_days?: number
  /**
   * "Dormant customer campaigns": leads with no contact (`last_contacted_at`)
   * in at least N days, OR never contacted at all. Deliberately a separate
   * field from `days_since_inquiry` (which measures the opposite thing —
   * how recently a lead first came in, not how long they've gone quiet) so
   * the two aren't confused as interchangeable.
   */
  dormant_since_days?: number

  // ── Advanced Segmentation (Priority 3 — Marketing Intelligence) ──────────
  // All computed from ONE additional bounded fetch of proposals+reservations
  // (only when at least one of these filters is used), grouped by lead_id
  // in memory — same "fetch once, reduce in JS" contract as
  // revenue-intelligence.ts, not per-customer queries.
  /** Leads whose lifetime value (accepted proposals + non-double-counted reservation revenue) is >= this amount. */
  min_clv?: number
  /** Leads with 2+ completed bookings (accepted proposal or revenue-recognized reservation). */
  repeat_customer?: boolean
  /** Leads with exactly 1 completed booking — the inverse audience of repeat_customer. */
  first_time_customer?: boolean
  /** Leads with a proposal sent >= N days ago that's neither accepted nor rejected — stalled mid-funnel. */
  proposal_abandoned_days?: number
  /** Leads with at least one cancelled or no-show reservation. */
  has_cancelled_booking?: boolean
  /** Leads with at least one reservation of >= N nights. */
  min_stay_nights?: number
  /** Leads tagged WEDDING (lead-scorer.ts auto-tag) with estimated_revenue >= this amount. */
  high_value_wedding_min?: number
  /** Leads tagged CORPORATE (lead-scorer.ts auto-tag). */
  is_corporate?: boolean
}

const REVENUE_RECOGNIZED_STATUSES = new Set(['confirmed', 'checked_in', 'checked_out'])
const CANCELLED_RESERVATION_STATUSES = new Set(['cancelled', 'no_show'])

interface SegmentProposalRow {
  lead_id: string | null
  status: string | null
  total_price: number | null
  sent_at: string | null
  accepted_at: string | null
}

interface SegmentReservationRow {
  customer_id: string | null
  proposal_id: string | null
  status: string | null
  final_room_rate: number | null
  meal_plan_charge: number | null
  check_in_date: string
  check_out_date: string
}

// Bounded, one-shot derived-segment sets — computed once from two queries
// regardless of how many leads exist, then used to filter the leads array
// already fetched by buildSegment(). Mirrors the exact revenue/double-
// counting rules from revenue-intelligence.ts and lifetime-value.ts.
async function computeAdvancedSegmentSets(filter: SegmentFilter) {
  const needsAdvanced =
    filter.min_clv !== undefined || filter.repeat_customer !== undefined ||
    filter.first_time_customer !== undefined || filter.proposal_abandoned_days !== undefined ||
    filter.has_cancelled_booking !== undefined || filter.min_stay_nights !== undefined ||
    filter.high_value_wedding_min !== undefined

  if (!needsAdvanced) return null

  const supabaseAdmin = getSupabaseAdmin()
  const [proposalsResult, reservationsResult] = await Promise.all([
    supabaseAdmin.from('proposals').select('lead_id, status, total_price, sent_at, accepted_at'),
    supabaseAdmin.from('reservations').select('customer_id, proposal_id, status, final_room_rate, meal_plan_charge, check_in_date, check_out_date'),
  ])
  const proposals = (proposalsResult.data ?? []) as unknown as SegmentProposalRow[]
  const reservations = (reservationsResult.data ?? []) as unknown as SegmentReservationRow[]

  const clvByLead = new Map<string, number>()
  const bookingCountByLead = new Map<string, number>()
  for (const p of proposals) {
    if (p.accepted_at && p.lead_id) {
      clvByLead.set(p.lead_id, (clvByLead.get(p.lead_id) ?? 0) + (Number(p.total_price) || 0))
      bookingCountByLead.set(p.lead_id, (bookingCountByLead.get(p.lead_id) ?? 0) + 1)
    }
  }
  // FIX: final_room_rate already includes meal_plan_charge (it's the
  // grand total persisted by reservation-workflow.ts's grandTotal) —
  // adding meal_plan_charge again double-counted it.
  const reservationRevenue = (r: SegmentReservationRow) => Number(r.final_room_rate) || 0
  const cancelledLeadIds = new Set<string>()
  const longStayLeadIds = new Set<string>()
  for (const r of reservations) {
    if (!r.customer_id) continue
    if (r.status && CANCELLED_RESERVATION_STATUSES.has(r.status)) cancelledLeadIds.add(r.customer_id)
    if (r.status && REVENUE_RECOGNIZED_STATUSES.has(r.status)) {
      const nights = Math.round((new Date(r.check_out_date).getTime() - new Date(r.check_in_date).getTime()) / 86_400_000)
      if (nights >= (filter.min_stay_nights ?? Infinity)) longStayLeadIds.add(r.customer_id)
      if (r.proposal_id === null) {
        clvByLead.set(r.customer_id, (clvByLead.get(r.customer_id) ?? 0) + reservationRevenue(r))
      }
      bookingCountByLead.set(r.customer_id, (bookingCountByLead.get(r.customer_id) ?? 0) + 1)
    }
  }

  const abandonedLeadIds = new Set<string>()
  if (filter.proposal_abandoned_days) {
    const cutoff = Date.now() - filter.proposal_abandoned_days * 86_400_000
    for (const p of proposals) {
      if (!p.lead_id || !p.sent_at || p.accepted_at || p.status === 'rejected') continue
      if (new Date(p.sent_at).getTime() <= cutoff) abandonedLeadIds.add(p.lead_id)
    }
  }

  return { clvByLead, bookingCountByLead, cancelledLeadIds, longStayLeadIds, abandonedLeadIds }
}

// Matches a stored DATE (birthday/anniversary) against an annual recurring
// window of `days` from today, comparing month+day only so the stored year
// never matters. Checks both this year's and next year's occurrence of that
// month/day so a window spanning a December -> January boundary still
// matches correctly.
function isWithinAnnualWindow(dateStr: string | null, days: number): boolean {
  if (!dateStr) return false
  const parsed = new Date(dateStr)
  if (Number.isNaN(parsed.getTime())) return false

  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const windowEnd = new Date(startOfToday.getTime() + days * 86400000)

  const thisYear = new Date(now.getFullYear(), parsed.getMonth(), parsed.getDate())
  const nextYear = new Date(now.getFullYear() + 1, parsed.getMonth(), parsed.getDate())

  return (thisYear >= startOfToday && thisYear <= windowEnd) ||
         (nextYear >= startOfToday && nextYear <= windowEnd)
}

export async function buildSegment(filter: SegmentFilter) {
  const supabaseAdmin = getSupabaseAdmin()

  let query = supabaseAdmin
    .from('leads')
    .select('id, name, phone, email, event_type, status, ai_score, source, birthday, anniversary, last_contacted_at, tags, estimated_revenue')
    .not('phone', 'is', null)
    .eq('whatsapp_opted_in', true)

  if (filter.status?.length) {
    query = query.in('status', filter.status)
  }
  if (filter.source?.length) {
    query = query.in('source', filter.source)
  }
  if (filter.min_score) {
    query = query.gte('ai_score', filter.min_score)
  }
  if (filter.event_type) {
    query = query.ilike('event_type', `%${filter.event_type}%`)
  }
  if (filter.venue) {
    query = query.eq('venue', filter.venue)
  }
  if (filter.is_vip === true) {
    query = query.eq('is_vip', true)
  }
  if (filter.days_since_inquiry) {
    const since = new Date(Date.now() - filter.days_since_inquiry * 86400000).toISOString()
    query = query.gte('created_at', since)
  }
  if (filter.dormant_since_days) {
    const cutoff = new Date(Date.now() - filter.dormant_since_days * 86400000).toISOString()
    query = query.or(`last_contacted_at.is.null,last_contacted_at.lt.${cutoff}`)
  }

  let { data } = await query.limit(1000)
  let leads = data || []

  // Month/day matching can't be expressed as a single Postgres filter via
  // the query builder without raw SQL, so it's applied client-side after
  // the DB-side filters above have already narrowed the candidate set.
  if (filter.upcoming_birthday_days) {
    leads = leads.filter((l) => isWithinAnnualWindow((l as { birthday: string | null }).birthday, filter.upcoming_birthday_days!))
  }
  if (filter.upcoming_anniversary_days) {
    leads = leads.filter((l) => isWithinAnnualWindow((l as { anniversary: string | null }).anniversary, filter.upcoming_anniversary_days!))
  }

  // Tag-based filters — reuse lead-scorer.ts's auto-tags (WEDDING, CORPORATE)
  // directly, no separate classification logic.
  if (filter.is_corporate === true) {
    leads = leads.filter((l) => Array.isArray((l as { tags?: string[] }).tags) && (l as { tags: string[] }).tags.includes('CORPORATE'))
  }

  // Advanced segments — one bounded fetch, applied as an in-memory filter.
  const advanced = await computeAdvancedSegmentSets(filter)
  if (advanced) {
    const { clvByLead, bookingCountByLead, cancelledLeadIds, longStayLeadIds, abandonedLeadIds } = advanced

    if (filter.min_clv !== undefined) {
      leads = leads.filter((l) => (clvByLead.get(l.id) ?? 0) >= filter.min_clv!)
    }
    if (filter.repeat_customer === true) {
      leads = leads.filter((l) => (bookingCountByLead.get(l.id) ?? 0) > 1)
    }
    if (filter.first_time_customer === true) {
      leads = leads.filter((l) => (bookingCountByLead.get(l.id) ?? 0) === 1)
    }
    if (filter.proposal_abandoned_days !== undefined) {
      leads = leads.filter((l) => abandonedLeadIds.has(l.id))
    }
    if (filter.has_cancelled_booking === true) {
      leads = leads.filter((l) => cancelledLeadIds.has(l.id))
    }
    if (filter.min_stay_nights !== undefined) {
      leads = leads.filter((l) => longStayLeadIds.has(l.id))
    }
    if (filter.high_value_wedding_min !== undefined) {
      leads = leads.filter((l) => {
        const tags = (l as { tags?: string[] }).tags
        const revenue = (l as { estimated_revenue?: number | null }).estimated_revenue ?? 0
        return Array.isArray(tags) && tags.includes('WEDDING') && revenue >= filter.high_value_wedding_min!
      })
    }
  }

  return leads
}

// ─────────────────────────────────────────────────────────────────────────────
// Marketing Analytics (Revenue Intelligence, Priority 2).
//
// AUDIT NOTE: broadcast_campaigns.conversion_count exists in the schema
// (migration 004) but is never written by any code path — confirmed by a
// full-repo grep before writing this function. Attributing a booking back
// to a specific campaign send would need some join key (e.g. a
// campaign_id on leads/proposals, or a time-window "last campaign touched"
// rule) that doesn't exist anywhere in this codebase today. Rather than
// invent an attribution model, campaign-level ROI/conversion stays
// explicitly unavailable (see `conversionTrackingAvailable: false` below)
// until someone makes that call. Everything else here is real, already-
// stored data: send/delivery/reply counts, and lead source -> pipeline
// outcome using leads.source + leads.lead_stage (both live).
// ─────────────────────────────────────────────────────────────────────────────

interface CampaignRow {
  type: string
  status: string
  sent_count: number | null
  delivered_count: number | null
  failed_count: number | null
  reply_count: number | null
  recipient_count: number | null
}

interface SourceLeadRow {
  source: string
  lead_stage: string | null
  created_at: string
}

export interface CampaignTypePerformance {
  type: string
  campaigns: number
  sent: number
  delivered: number
  failed: number
  replies: number
  replyRatePct: number
}

export interface LeadSourcePerformance {
  source: string
  count: number
  confirmedCount: number
  conversionPct: number
}

export interface MarketingPerformance {
  byType: CampaignTypePerformance[]
  bySource: LeadSourcePerformance[]
  whatsappConversionPct: number
  acquisitionByMonth: Array<{ month: string; count: number }>
  conversionTrackingAvailable: false
  conversionTrackingNote: string
}

export async function getMarketingPerformance(): Promise<MarketingPerformance> {
  const supabaseAdmin = getSupabaseAdmin()

  const [campaignsResult, leadsResult] = await Promise.all([
    supabaseAdmin.from('broadcast_campaigns').select('type, status, sent_count, delivered_count, failed_count, reply_count, recipient_count'),
    supabaseAdmin.from('leads').select('source, lead_stage, created_at'),
  ])

  const campaigns = (campaignsResult.data ?? []) as unknown as CampaignRow[]
  const leads = (leadsResult.data ?? []) as unknown as SourceLeadRow[]

  // By campaign type — bounded in-memory grouping over one query's result.
  const typeMap = new Map<string, CampaignTypePerformance>()
  for (const c of campaigns) {
    if (!typeMap.has(c.type)) typeMap.set(c.type, { type: c.type, campaigns: 0, sent: 0, delivered: 0, failed: 0, replies: 0, replyRatePct: 0 })
    const t = typeMap.get(c.type)!
    t.campaigns += 1
    t.sent += c.sent_count ?? 0
    t.delivered += c.delivered_count ?? 0
    t.failed += c.failed_count ?? 0
    t.replies += c.reply_count ?? 0
  }
  const byType = Array.from(typeMap.values()).map((t) => ({
    ...t,
    replyRatePct: t.delivered > 0 ? Math.round((t.replies / t.delivered) * 1000) / 10 : 0,
  }))

  // By lead source — count + how many reached CONFIRMED (the live pipeline's terminal "won" stage).
  const sourceMap = new Map<string, { count: number; confirmed: number }>()
  for (const l of leads) {
    const s = l.source || 'other'
    if (!sourceMap.has(s)) sourceMap.set(s, { count: 0, confirmed: 0 })
    const bucket = sourceMap.get(s)!
    bucket.count += 1
    if (l.lead_stage === 'CONFIRMED') bucket.confirmed += 1
  }
  const bySource = Array.from(sourceMap.entries())
    .map(([source, b]) => ({ source, count: b.count, confirmedCount: b.confirmed, conversionPct: b.count > 0 ? Math.round((b.confirmed / b.count) * 1000) / 10 : 0 }))
    .sort((a, b) => b.count - a.count)

  const whatsappBucket = sourceMap.get('whatsapp')
  const whatsappConversionPct = whatsappBucket && whatsappBucket.count > 0
    ? Math.round((whatsappBucket.confirmed / whatsappBucket.count) * 1000) / 10
    : 0

  // Customer acquisition trend — last 6 months, all sources combined.
  const now = new Date()
  const monthCounts: Record<string, number> = {}
  for (const l of leads) {
    const d = new Date(l.created_at)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    monthCounts[key] = (monthCounts[key] ?? 0) + 1
  }
  const acquisitionByMonth = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    return { month: d.toLocaleString('en-IN', { month: 'short', year: '2-digit' }), count: monthCounts[key] ?? 0 }
  })

  return {
    byType,
    bySource,
    whatsappConversionPct,
    acquisitionByMonth,
    conversionTrackingAvailable: false,
    conversionTrackingNote:
      'Campaign ROI and per-campaign conversion counts are not available — broadcast_campaigns.conversion_count exists in the schema but nothing attributes a booking back to a specific campaign send (no campaign_id on leads/proposals, no attribution window). Adding that is a tracking-design decision, not something inferred here.',
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// AI Campaign Builder (Priority 3 — Marketing Intelligence).
//
// Reuses the exact same Anthropic client/call pattern already established
// in this file (generateFestivalMessage, generateCampaignMessage) — no new
// AI infrastructure, just a richer single-shot prompt that returns every
// field an operator needs to review before creating a campaign. This ONLY
// drafts content; it has no side effects and never calls buildSegment(),
// create a campaign row, or send anything — the caller (POST /api/campaigns
// action=generate_brief) hands the result back to the UI for the operator
// to review, edit, and explicitly submit via the existing create/send
// actions, same human-approval gate this codebase uses for every other
// customer-facing AI draft (proposals, WhatsApp replies).
// ─────────────────────────────────────────────────────────────────────────────

export interface CampaignBrief {
  title: string
  whatsappMessage: string
  emailSubject: string
  emailBody: string
  cta: string
  suggestedAudience: string
  bestSendTime: string
}

export async function generateCampaignBrief(goal: string, context?: string): Promise<CampaignBrief> {
  const prompt = `You are a marketing copywriter for BookMySpaces, a premium hospitality venue (rooftop events, private dining, room stays) in Kolkata.

Campaign goal: ${goal}
${context ? `Additional context: ${context}` : ''}

Draft a complete campaign brief. Respond with ONLY valid JSON, no markdown fences, in exactly this shape:
{
  "title": "short internal campaign name",
  "whatsappMessage": "the actual WhatsApp message, Indian English, 2-4 sentences, 1-2 emojis, ends with a soft CTA and phone 8017035546",
  "emailSubject": "email subject line",
  "emailBody": "short email body, under 150 words, professional but warm",
  "cta": "one short call-to-action phrase, e.g. 'Reply to book your date'",
  "suggestedAudience": "a one-sentence plain-English description of who this campaign should target (e.g. 'Leads tagged VIP with no booking in 60+ days')",
  "bestSendTime": "a one-sentence recommendation for send timing (e.g. 'Weekday evenings, 6-8pm, when WhatsApp reply rates are historically highest for this audience') — a reasonable general recommendation, not a claim backed by analyzed send-time data this system doesn't have"
}`

  try {
    const response = await getAnthropic().messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 700,
      messages: [{ role: 'user', content: prompt }],
    })
    const text = response.content[0].type === 'text' ? response.content[0].text : '{}'
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim())
    return {
      title: parsed.title || 'Untitled Campaign',
      whatsappMessage: parsed.whatsappMessage || '',
      emailSubject: parsed.emailSubject || '',
      emailBody: parsed.emailBody || '',
      cta: parsed.cta || '',
      suggestedAudience: parsed.suggestedAudience || 'Not enough context to suggest — pick manually.',
      bestSendTime: parsed.bestSendTime || 'Not enough context to suggest — pick manually.',
    }
  } catch {
    return {
      title: 'Untitled Campaign',
      whatsappMessage: `Hi! We have something special for you at BookMySpaces. Contact us at 8017035546 to know more.`,
      emailSubject: 'A special offer from BookMySpaces',
      emailBody: 'We have something special for you — reach out to learn more.',
      cta: 'Contact us to learn more',
      suggestedAudience: 'AI draft failed — pick an audience manually.',
      bestSendTime: 'AI draft failed — pick a send time manually.',
    }
  }
}

export async function generateCampaignMessage(
  type: string,
  context: string,
  tone: 'warm' | 'urgent' | 'exclusive' = 'warm'
): Promise<string> {
  const toneGuide = {
    warm: 'friendly, caring, relationship-focused',
    urgent: 'creates FOMO, mentions limited availability, not pushy',
    exclusive: 'VIP feeling, premium, personalized',
  }

  const prompt = `Write a WhatsApp marketing message for a hospitality venue in Kolkata.

Campaign type: ${type}
Context: ${context}
Tone: ${toneGuide[tone]}

Business: BookMySpaces — Premium Rooftop Events & Stay in Kolkata
Contact: 8017035546

Rules:
- Max 150 words
- 2-3 emojis max
- End with clear CTA (WhatsApp or visit)
- Sound human, not corporate
- DO NOT use ALL CAPS
- DO NOT use exclamation marks excessively

Return ONLY the message text.`

  const response = await getAnthropic().messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 250,
    messages: [{ role: 'user', content: prompt }],
  })

  return response.content[0].type === 'text'
    ? response.content[0].text
    : `Hi! We have exciting offers at BookMySpaces. Contact us at 8017035546 to know more.`
}
