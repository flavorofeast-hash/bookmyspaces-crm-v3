// src/lib/proposal-intelligence.ts
// ─────────────────────────────────────────────────────────────────────────────
// Phase 5: Proposal Intelligence Engine
// Pure TypeScript — no DB calls, no API calls, no side effects.
// Called from API routes and the /proposals page client-side.
//
// Two main exports:
//   generateProposalIntelligence(lead)   → AI-assisted proposal content
//   computeProposalUrgency(proposal, lead) → urgency scoring + next action
// ─────────────────────────────────────────────────────────────────────────────

// ─── Shared types ─────────────────────────────────────────────────────────────

export type ProposalStatus =
  | 'draft' | 'generated' | 'sent' | 'viewed'
  | 'followed_up' | 'accepted' | 'rejected' | 'expired'

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical'

export type ProposalNextAction =
  | 'generate_proposal'
  | 'send_via_whatsapp'
  | 'send_via_email'
  | 'follow_up_now'
  | 'resend_proposal'
  | 'escalate_to_sales'
  | 'suggest_alternate_package'
  | 'close_deal'
  | 'mark_accepted'
  | 'awaiting_response'
  | 'no_action_needed'

// ─── Lead snapshot (only what we need) ───────────────────────────────────────

export interface LeadSnapshot {
  id                 : string
  name               : string | null
  phone              : string | null
  email              : string | null
  event_type         : string | null
  event_date         : string | null
  guest_count        : number | null
  budget             : string | null
  venue              : string | null
  ai_score           : number | null
  lead_temperature   : string | null
  urgency_level      : string | null
  lead_stage         : string | null
  estimated_revenue  : number | null
  score_breakdown    : Record<string, unknown> | null
}

// ─── Proposal snapshot (only what we need) ───────────────────────────────────

export interface ProposalSnapshot {
  id                  : string
  status              : ProposalStatus
  total_price         : number | null
  package_name        : string | null
  guest_count         : number | null
  event_type          : string | null
  sent_at             : string | null
  first_viewed_at     : string | null
  last_viewed_at      : string | null
  followed_up_at      : string | null
  viewed_count        : number
  engagement_score    : number
  created_at          : string
}

// ─── OUTPUT TYPES ─────────────────────────────────────────────────────────────

export interface ProposalIntelligence {
  // Generated content for the proposal document
  summary              : string
  recommendedPackage   : string
  estimatedValue       : number
  venueFitReasoning    : string
  upsells              : string[]
  urgencyCTA           : string
  confidenceScore      : number   // 0–100

  // Pricing tiers
  packageOptions       : PackageOption[]
}

export interface PackageOption {
  name         : string
  price        : number
  includes     : string[]
  recommended  : boolean
}

export interface ProposalUrgencyResult {
  urgencyScore        : number           // 0–100
  nextAction          : ProposalNextAction
  riskLevel           : RiskLevel
  recommendation      : string
  escalationRequired  : boolean
  followUpRequired    : boolean
  resendRecommended   : boolean
  hoursWithoutResponse: number | null
  actionLabel         : string
  actionColor         : string
}

// ─── Venue + package knowledge (BookMySpaces specific) ───────────────────────

const VENUE_CONFIG = {
  skyline_serenity: {
    name        : 'Skyline Serenity',
    location    : 'near Kolkata Airport',
    contact     : '9830509991',
    capacity    : 120,
    strengths   : ['Airport proximity', 'Modern banquet hall', 'Corporate events', 'Wedding receptions'],
    perHead     : 2200,
  },
  monurama_homestay: {
    name        : 'Monurama Homestay',
    location    : 'Mukundapur, EM Bypass',
    contact     : '8017035546',
    capacity    : 70,
    strengths   : ['Intimate gatherings', 'Heritage ambience', 'Private celebrations', 'Stay-in option'],
    perHead     : 1800,
  },
}

const PACKAGE_BASES: Record<string, { name: string; multiplier: number; includes: string[] }> = {
  silver: {
    name       : 'Silver',
    multiplier : 0.85,
    includes   : ['Basic decoration', 'Standard menu (veg)', 'Sound system', 'Basic lighting', 'Event coordinator'],
  },
  gold: {
    name       : 'Gold',
    multiplier : 1.0,
    includes   : ['Premium decoration', 'Veg + non-veg menu', 'DJ + sound system', 'LED lighting', 'Event coordinator', 'Welcome drink'],
  },
  platinum: {
    name       : 'Platinum',
    multiplier : 1.3,
    includes   : ['Luxury decoration', 'Multi-cuisine buffet', 'Live music or DJ', 'Designer lighting', 'Dedicated coordinator', 'Photography package', 'Welcome drink + mocktails'],
  },
  custom: {
    name       : 'Custom',
    multiplier : 1.0,
    includes   : ['Fully customizable', 'Tailored to your budget', 'Flexible inclusions', 'Dedicated planning team'],
  },
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseBudgetINR(raw: string | null | undefined): number {
  if (!raw) return 0
  const lower = raw.toLowerCase().replace(/,/g, '').trim()
  const lakhMatch = lower.match(/(\d+(?:\.\d+)?)\s*(?:lakh|lac|l\b)/)
  if (lakhMatch) return Math.round(parseFloat(lakhMatch[1]) * 100_000)
  const kMatch = lower.match(/(\d+(?:\.\d+)?)\s*k\b/)
  if (kMatch) return Math.round(parseFloat(kMatch[1]) * 1_000)
  const numMatch = lower.match(/(\d+(?:\.\d+)?)/)
  if (numMatch) {
    const n = parseFloat(numMatch[1])
    return n < 1000 ? Math.round(n * 1_000) : Math.round(n)
  }
  return 0
}

function hoursAgo(isoString: string | null): number | null {
  if (!isoString) return null
  return Math.floor((Date.now() - new Date(isoString).getTime()) / 3_600_000)
}

function detectVenue(venueRaw: string | null): keyof typeof VENUE_CONFIG | null {
  if (!venueRaw) return null
  const lower = venueRaw.toLowerCase()
  if (lower.includes('skyline') || lower.includes('airport')) return 'skyline_serenity'
  if (lower.includes('monurama') || lower.includes('mukundapur') || lower.includes('em bypass')) return 'monurama_homestay'
  return null
}

function selectPackage(budget: number, guests: number, eventType: string): string {
  const perHead = guests > 0 ? budget / guests : 0
  const isWedding = /wedding|reception|engagement|sangeet/i.test(eventType)
  if (perHead >= 3000 || isWedding) return 'platinum'
  if (perHead >= 2000) return 'gold'
  if (perHead >= 1200) return 'silver'
  return budget > 150_000 ? 'gold' : 'silver'
}

// ─── MAIN EXPORT 1: generateProposalIntelligence ─────────────────────────────

export function generateProposalIntelligence(lead: LeadSnapshot): ProposalIntelligence {
  const guests      = lead.guest_count ?? 30
  const eventType   = lead.event_type ?? 'event'
  const budgetINR   = parseBudgetINR(lead.budget)
  const aiScore     = lead.ai_score ?? 50
  const venueKey    = detectVenue(lead.venue)
  const venueInfo   = venueKey ? VENUE_CONFIG[venueKey] : VENUE_CONFIG.skyline_serenity
  const estimatedRev = lead.estimated_revenue ?? budgetINR ?? (guests * venueInfo.perHead)

  // Recommended package
  const packageKey  = selectPackage(budgetINR || estimatedRev, guests, eventType)
  const pkg         = PACKAGE_BASES[packageKey]

  // Confidence score — higher if we have more lead data
  let confidence = 50
  if (lead.guest_count)      confidence += 10
  if (lead.budget)           confidence += 10
  if (lead.event_date)       confidence += 10
  if (lead.event_type)       confidence += 10
  if (aiScore >= 70)         confidence += 10
  confidence = Math.min(confidence, 100)

  // Event-type specific language
  const eventLabel = eventType.charAt(0).toUpperCase() + eventType.slice(1).toLowerCase()
  const isWedding  = /wedding|reception|engagement/i.test(eventType)
  const isCorp     = /corporate|seminar|conference/i.test(eventType)

  // Summary
  const summary = isWedding
    ? `Thank you for choosing BookMySpaces for your special celebration. We have carefully reviewed your requirements for ${guests} guests and curated a personalized proposal that matches your vision and budget.`
    : isCorp
    ? `BookMySpaces is pleased to present this proposal for your ${eventLabel} event. Our venues are equipped with professional AV infrastructure, reliable connectivity, and experienced event coordination teams.`
    : `We are delighted to present this personalized event proposal for your ${eventLabel}. Our team has designed this package to deliver a memorable experience for you and your ${guests} guests.`

  // Venue fit reasoning
  const venueFitReasoning = [
    `${venueInfo.name} (${venueInfo.location}) is an excellent fit for your ${eventLabel}.`,
    `With capacity for up to ${venueInfo.capacity} guests, your party of ${guests} will be comfortably accommodated.`,
    `Key strengths: ${venueInfo.strengths.slice(0, 3).join(', ')}.`,
    budgetINR > 0
      ? `Your estimated budget of ₹${(budgetINR / 1000).toFixed(0)}K aligns well with our ${pkg.name} package offering.`
      : `Our ${pkg.name} package offers the best value for your event profile.`,
  ].join(' ')

  // Upsells based on event type
  const upsells: string[] = []
  if (isWedding) {
    upsells.push('Pre-wedding photoshoot package', 'Mehendi + Sangeet combo booking', 'Honeymoon suite reservation', 'Floral centerpiece upgrade')
  } else if (isCorp) {
    upsells.push('Business lunch catering add-on', 'Live streaming setup', 'Conference kit & stationery', 'Post-event networking dinner')
  } else {
    upsells.push('Photo booth rental', 'Custom cake package', 'Live entertainment', 'Welcome gift hampers')
  }

  // Urgency CTA based on lead temperature
  const urgencyCTA =
    lead.lead_temperature === 'HOT'
      ? `⚡ This date is in high demand. Confirm your booking with a 30% advance today to secure your preferred slot.`
      : lead.event_date
      ? `📅 Your event on ${new Date(lead.event_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })} is approaching. Secure your booking before slots fill up.`
      : `Book early to get the best package and preferred date. Our team is ready to finalize details at your convenience.`

  // Package options
  const basePerHead = venueInfo.perHead
  const packageOptions: PackageOption[] = Object.entries(PACKAGE_BASES).map(([key, p]) => ({
    name        : p.name,
    price       : Math.round(guests * basePerHead * p.multiplier),
    includes    : p.includes,
    recommended : key === packageKey,
  }))

  return {
    summary,
    recommendedPackage  : pkg.name,
    estimatedValue      : estimatedRev || Math.round(guests * basePerHead * pkg.multiplier),
    venueFitReasoning,
    upsells             : upsells.slice(0, 3),
    urgencyCTA,
    confidenceScore     : confidence,
    packageOptions,
  }
}

// ─── MAIN EXPORT 2: computeProposalUrgency ───────────────────────────────────

export function computeProposalUrgency(
  proposal : ProposalSnapshot,
  lead     : LeadSnapshot
): ProposalUrgencyResult {
  const now            = Date.now()
  const aiScore        = lead.ai_score ?? 0
  const temp           = lead.lead_temperature ?? 'COLD'
  const viewCount      = proposal.viewed_count ?? 0
  const status         = proposal.status
  const hoursSinceSent = hoursAgo(proposal.sent_at)
  const hoursSinceView = hoursAgo(proposal.last_viewed_at)

  let urgencyScore       = aiScore
  let riskLevel          : RiskLevel          = 'low'
  let nextAction         : ProposalNextAction  = 'awaiting_response'
  let recommendation     = 'Continue monitoring.'
  let escalationRequired = false
  let followUpRequired   = false
  let resendRecommended  = false

  // ── Not sent yet ──────────────────────────────────────────────────────────
  if (status === 'draft' || status === 'generated') {
    nextAction    = 'send_via_whatsapp'
    urgencyScore += 20
    riskLevel     = 'medium'
    recommendation = 'Proposal is ready but not sent. Send via WhatsApp now.'
    if (aiScore >= 80) {
      urgencyScore += 20
      riskLevel     = 'high'
      recommendation = 'HOT lead has an unsent proposal — send immediately.'
    }
    return buildResult(urgencyScore, nextAction, riskLevel, recommendation, escalationRequired, followUpRequired, resendRecommended, null)
  }

  // ── Sent but never viewed ─────────────────────────────────────────────────
  if (status === 'sent' && viewCount === 0) {
    if (hoursSinceSent !== null && hoursSinceSent > 48) {
      resendRecommended = true
      nextAction        = 'resend_proposal'
      urgencyScore     += 25
      riskLevel         = 'high'
      recommendation    = `Proposal sent ${hoursSinceSent}h ago but never opened. Resend or follow up via call.`
    } else if (hoursSinceSent !== null && hoursSinceSent > 24) {
      nextAction        = 'follow_up_now'
      followUpRequired  = true
      urgencyScore     += 15
      riskLevel         = 'medium'
      recommendation    = 'Proposal not opened after 24h. Send a WhatsApp nudge.'
    } else {
      nextAction    = 'awaiting_response'
      recommendation = 'Proposal sent recently. Allow 24h before following up.'
    }
  }

  // ── Viewed but no response ────────────────────────────────────────────────
  if (status === 'viewed') {
    if (hoursSinceView !== null && hoursSinceView > 24 && !proposal.followed_up_at) {
      followUpRequired = true
      nextAction       = 'follow_up_now'
      urgencyScore    += 30
      riskLevel        = 'high'
      recommendation   = `Customer viewed the proposal ${hoursSinceView}h ago with no reply. Follow up immediately.`
    }
    if (viewCount > 2 && temp === 'HOT') {
      escalationRequired = true
      nextAction         = 'escalate_to_sales'
      urgencyScore      += 20
      riskLevel          = 'critical'
      recommendation     = `HOT lead viewed proposal ${viewCount} times — high intent. Escalate to senior sales.`
    }
    if (hoursSinceView !== null && hoursSinceView < 2) {
      nextAction    = 'close_deal'
      urgencyScore += 25
      recommendation = 'Customer just viewed the proposal. Best time to call and close.'
    }
  }

  // ── Budget mismatch detection ─────────────────────────────────────────────
  const leadBudget    = parseBudgetINR(lead.budget)
  const proposalPrice = proposal.total_price ?? 0
  if (leadBudget > 0 && proposalPrice > 0 && proposalPrice > leadBudget * 1.3) {
    if (nextAction === 'awaiting_response') nextAction = 'suggest_alternate_package'
    riskLevel     = riskLevel === 'low' ? 'medium' : riskLevel
    recommendation = `Proposal value (₹${(proposalPrice/1000).toFixed(0)}K) exceeds stated budget (₹${(leadBudget/1000).toFixed(0)}K). Consider suggesting ${proposal.total_price && leadBudget ? 'Silver' : 'alternate'} package.`
    urgencyScore += 10
  }

  // ── Accepted ─────────────────────────────────────────────────────────────
  if (status === 'accepted') {
    return buildResult(0, 'mark_accepted', 'low', 'Proposal accepted. Proceed to booking confirmation.', false, false, false, hoursSinceSent)
  }

  // ── Temperature boosts ───────────────────────────────────────────────────
  if (temp === 'HOT')       urgencyScore = Math.min(urgencyScore + 15, 100)
  else if (temp === 'COLD') urgencyScore = Math.max(urgencyScore - 10, 0)

  // ── Escalation threshold ─────────────────────────────────────────────────
  if (aiScore >= 90 && (lead.estimated_revenue ?? 0) >= 300_000 && !escalationRequired) {
    escalationRequired = true
    urgencyScore      += 10
  }

  return buildResult(
    Math.min(urgencyScore, 100),
    nextAction, riskLevel, recommendation,
    escalationRequired, followUpRequired, resendRecommended,
    hoursSinceSent
  )
}

function buildResult(
  urgencyScore       : number,
  nextAction         : ProposalNextAction,
  riskLevel          : RiskLevel,
  recommendation     : string,
  escalationRequired : boolean,
  followUpRequired   : boolean,
  resendRecommended  : boolean,
  hoursWithoutResponse: number | null
): ProposalUrgencyResult {
  const ACTION_LABELS: Record<ProposalNextAction, { label: string; color: string }> = {
    generate_proposal        : { label: 'Generate Proposal', color: 'text-blue-600'    },
    send_via_whatsapp        : { label: 'Send via WhatsApp', color: 'text-green-600'   },
    send_via_email           : { label: 'Send via Email',    color: 'text-blue-600'    },
    follow_up_now            : { label: 'Follow Up Now',     color: 'text-red-600'     },
    resend_proposal          : { label: 'Resend Proposal',   color: 'text-amber-600'   },
    escalate_to_sales        : { label: 'Escalate',          color: 'text-red-700'     },
    suggest_alternate_package: { label: 'Suggest Alt Package',color: 'text-purple-600' },
    close_deal               : { label: 'Close Deal',        color: 'text-emerald-600' },
    mark_accepted            : { label: 'Mark Accepted',     color: 'text-emerald-600' },
    awaiting_response        : { label: 'Awaiting Reply',    color: 'text-gray-500'    },
    no_action_needed         : { label: 'No Action Needed',  color: 'text-gray-400'    },
  }

  return {
    urgencyScore,
    nextAction,
    riskLevel,
    recommendation,
    escalationRequired,
    followUpRequired,
    resendRecommended,
    hoursWithoutResponse,
    actionLabel : ACTION_LABELS[nextAction].label,
    actionColor : ACTION_LABELS[nextAction].color,
  }
}
