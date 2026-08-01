// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/campaigns/campaign-config.ts
// Sprint 1 — Campaign Landing Page System. Single source of truth for the 5
// campaign-type landing pages (/wedding, /birthday, /corporate, /airport-stay,
// /staycation). Reuses confirmed business rules from
// docs/business/01_PROPERTY_INTELLIGENCE.md and 07_AI_BEHAVIOR_RULES.md —
// property assignment below is not a new decision, it enforces the existing
// hard rule (Skyline: accommodation only, never events; Monurama: events,
// capped at 100 guests) at the routing/config layer, not just in the AI prompt.
// ─────────────────────────────────────────────────────────────────────────────

export type CampaignSlug = 'wedding' | 'birthday' | 'corporate' | 'airport-stay' | 'staycation'

export const CAMPAIGN_SLUGS: CampaignSlug[] = [
  'wedding',
  'birthday',
  'corporate',
  'airport-stay',
  'staycation',
]

/** `leads.venue` free-text convention, per 001_initial_schema.sql's comment: 'skyline' | 'monurama' | 'bookmyspaces'. */
export type PropertyVenueValue = 'skyline' | 'monurama' | 'bookmyspaces'

export interface CampaignConfig {
  slug: CampaignSlug
  /** Human-readable label used in Hero/CTA copy. */
  label: string
  /** Sent to the AI as campaign context ("Intent = ..."). */
  intent: string
  /** `leads.event_type` value — matches the free-text convention already
   *  written by src/lib/extract-lead-details.ts (WEDDING/CORPORATE/BIRTHDAY),
   *  not the newer EVENT_TYPES enum used only by package management. */
  leadEventType: string | null
  /** Property this campaign is allowed to recommend. `null` = no single
   *  property forced (staycation applies to both). */
  propertyLabel: 'Skyline Serenity' | 'Monurama Homestay' | null
  venueValue: PropertyVenueValue
  whatsappNumber: string
  heroHeadline: string
  heroSubheadline: string
  whatsappPrefill: string
  faqs: { question: string; answer: string }[]
}

// Existing WhatsApp numbers, reused as-is from src/app/page.tsx (homepage) —
// not re-derived or guessed.
const SKYLINE_WHATSAPP = '919830509991'
const MONURAMA_WHATSAPP = '919051459463'

export const CAMPAIGN_CONFIG: Record<CampaignSlug, CampaignConfig> = {
  wedding: {
    slug: 'wedding',
    label: 'Wedding',
    intent: 'Wedding',
    leadEventType: 'WEDDING',
    propertyLabel: 'Monurama Homestay',
    venueValue: 'monurama',
    whatsappNumber: MONURAMA_WHATSAPP,
    heroHeadline: 'A Wedding Celebration to Remember',
    heroSubheadline: 'Rooftop and hall venues at Monurama Homestay, Mukundapur — up to 100 guests.',
    whatsappPrefill: "Hi! I'm interested in a wedding celebration at Monurama Homestay.",
    faqs: [
      {
        question: 'What is the maximum guest count for a wedding at Monurama?',
        answer: 'The entire property caps at 100 guests. Rooftop events are ideal for 40–50 guests; each hall (Hall 1, Hall 2) holds up to 15.',
      },
      {
        question: 'Can I host a wedding at Skyline Serenity instead?',
        answer: 'Skyline Serenity is accommodation-only and does not host weddings or events — Monurama Homestay is the events venue.',
      },
      {
        question: 'What is included in a wedding package?',
        answer: 'UNKNOWN - FOUNDER INPUT REQUIRED: exact wedding package inclusions and pricing have not been confirmed yet. Chat with us or WhatsApp for current details.',
      },
    ],
  },
  birthday: {
    slug: 'birthday',
    label: 'Birthday',
    intent: 'Birthday',
    leadEventType: 'BIRTHDAY',
    propertyLabel: 'Monurama Homestay',
    venueValue: 'monurama',
    whatsappNumber: MONURAMA_WHATSAPP,
    heroHeadline: 'Birthdays Made Memorable',
    heroSubheadline: 'Rooftop and hall celebrations at Monurama Homestay, Mukundapur.',
    whatsappPrefill: "Hi! I'm interested in hosting a birthday celebration at Monurama Homestay.",
    faqs: [
      {
        question: 'How many guests can we host for a birthday party?',
        answer: 'Up to 100 guests across the property; the rooftop is ideal for 40–50, and each hall (Hall 1, Hall 2) holds up to 15.',
      },
      {
        question: 'Can Skyline Serenity host birthday parties?',
        answer: 'No — Skyline Serenity is accommodation-only. Birthday celebrations are hosted at Monurama Homestay.',
      },
    ],
  },
  corporate: {
    slug: 'corporate',
    label: 'Corporate Event',
    intent: 'Corporate Event',
    leadEventType: 'CORPORATE',
    propertyLabel: 'Monurama Homestay',
    venueValue: 'monurama',
    whatsappNumber: MONURAMA_WHATSAPP,
    heroHeadline: 'Corporate Events, Done Right',
    heroSubheadline: 'Meetings, offsites, and celebrations at Monurama Homestay — up to 100 guests.',
    whatsappPrefill: "Hi! I'm interested in a corporate event at Monurama Homestay.",
    faqs: [
      {
        question: 'What is the venue capacity for a corporate event?',
        answer: 'Up to 100 guests property-wide; halls (Hall 1, Hall 2) suit smaller meetings at 15 each, the rooftop suits 40–50 for larger gatherings.',
      },
      {
        question: 'Is Skyline Serenity available for corporate events?',
        answer: 'No — Skyline Serenity is accommodation-only and is never recommended for corporate events.',
      },
    ],
  },
  'airport-stay': {
    slug: 'airport-stay',
    label: 'Airport Stay',
    intent: 'Airport Stay',
    leadEventType: null,
    propertyLabel: 'Skyline Serenity',
    venueValue: 'skyline',
    whatsappNumber: SKYLINE_WHATSAPP,
    heroHeadline: 'Comfortable Stays Near Kolkata Airport',
    heroSubheadline: 'Deluxe & Premium AC rooms at Skyline Serenity — ideal for transit and short stays.',
    whatsappPrefill: "Hi! I'm interested in a room near the airport at Skyline Serenity.",
    faqs: [
      {
        question: 'How far is Skyline Serenity from Kolkata airport?',
        answer: 'Skyline Serenity is located near Kolkata airport. Exact distance/travel time: UNKNOWN - FOUNDER INPUT REQUIRED.',
      },
      {
        question: 'Does Skyline Serenity host events for arriving guests?',
        answer: 'No — Skyline Serenity is accommodation-only, with no events, banquet, or rooftop use.',
      },
    ],
  },
  staycation: {
    slug: 'staycation',
    label: 'Staycation',
    intent: 'Staycation',
    leadEventType: null,
    propertyLabel: null,
    venueValue: 'bookmyspaces',
    whatsappNumber: MONURAMA_WHATSAPP,
    heroHeadline: 'Your Next Staycation Awaits',
    heroSubheadline: 'Relaxed stays at Skyline Serenity or Monurama Homestay — pick what suits you.',
    whatsappPrefill: "Hi! I'm interested in a staycation — could you share options at Skyline Serenity and Monurama Homestay?",
    faqs: [
      {
        question: 'Which property should I pick for a staycation?',
        answer: 'Skyline Serenity (near the airport) and Monurama Homestay (Mukundapur) both offer accommodation. Chat with us or WhatsApp and we will help you choose.',
      },
    ],
  },
}

export function getCampaignConfig(slug: string): CampaignConfig | null {
  return (CAMPAIGN_CONFIG as Record<string, CampaignConfig>)[slug] ?? null
}
