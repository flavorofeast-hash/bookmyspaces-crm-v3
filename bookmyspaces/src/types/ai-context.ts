// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/types/ai-context.ts
// V3 Day 4 — Priority 3 (AI Context Builder).
//
// The single structured object every AI call should receive going forward,
// per the master specification's requirement that the AI answer from real
// business data instead of the multiple unrelated ad-hoc DB lookups
// scattered across the codebase today (e.g. buildPricingReply() in the
// WhatsApp webhook querying `packages` directly). Assembled by
// src/lib/ai/context-builder.ts from existing services only — this file is
// contracts-only, no logic.
// ─────────────────────────────────────────────────────────────────────────────

export interface CustomerProfile {
  leadId: string | null
  name: string | null
  phone: string | null
  email: string | null
  status: string | null
  /** True when Identity Resolution found the lead but the caller's identifier disagreed with the record. */
  hasConflictingIdentifier: boolean
}

export interface ConversationHistoryEntry {
  role: 'user' | 'assistant'
  content: string
  timestamp: string | null
}

export interface ReservationSummary {
  id: string
  status: string
  propertyId: string
  checkInDate: string
  checkOutDate: string
  finalRoomRate: number
}

export interface ProposalSummary {
  id: string
  proposalNumber: string | null
  packageName: string | null
  totalPrice: number | null
  status: string
  createdAt: string
}

export interface CustomerPreferences {
  preferredEventType: string | null
  preferredGuestCount: number | null
  preferredVenue: string | null
  notes: string | null
}

export interface ActivePackage {
  name: string
  basePrice: number
  maxGuests: number
  durationHours: number
  isPopular: boolean
}

export interface KnowledgeContextItem {
  content: string
  sourceFile: string
  category: string | null
  similarity: number
}

export interface PricingContext {
  activePackages: ActivePackage[]
  pricingDrift: Array<{ packageName: string; hardcodedPrice: number; livePrice: number }>
}

// AI Sales Executive (Priority 1) — "AI Upsell Recommendations". Sourced
// from the Reservation Platform's meal_plans/addon_services (migration 012),
// via the exact same src/lib/reservations/property-service.ts functions the
// booking UI already uses (listActiveMealPlans/listActiveAddonServices) —
// no new query pattern, no hardcoded upsell catalog. `category` on an addon
// service is a free-text DB column (e.g. "decoration", "airport_pickup",
// "banquet"), not a fixed enum, so this stays data-driven: whatever a
// property actually has configured is what the AI can recommend.
export interface UpsellMealPlan {
  name: string
  code: string
  price: number
}

export interface UpsellAddonService {
  name: string
  category: string | null
  price: number
}

export interface UpsellInventory {
  mealPlans: UpsellMealPlan[]
  addonServices: UpsellAddonService[]
}

// Direct Event Sales Engine, Section 2 — AI Event Sales Advisor. Richer
// than ActivePackage above (id + eventTypes so the AI can actually match a
// lead's identified event type to a specific package instead of guessing
// from name alone) — sourced from src/lib/packages/package-service.ts
// (migration 023's extended `packages` table), additive alongside the
// existing activePackages/pricing fields, which stay untouched so
// recommended_package/upsell_recommendations keep working unchanged.
export interface EventPackageOption {
  id: string
  name: string
  venue: string
  basePrice: number
  maxGuests: number
  durationHours: number
  eventTypes: string[]
  inclusions: string[]
  addons: Array<{ name: string; price: number }>
  isPopular: boolean
}

export interface BusinessRules {
  cancellationWindowHours: number
  advancePaymentPercent: number
  checkInTime: string
  checkOutTime: string
  /** True when these came from the live `settings` table rather than the documented defaults below. */
  isLiveConfig: boolean
}

export interface AIContext {
  customerProfile: CustomerProfile
  conversationHistory: ConversationHistoryEntry[]
  reservationHistory: ReservationSummary[]
  proposalHistory: ProposalSummary[]
  customerPreferences: CustomerPreferences
  activePackages: ActivePackage[]
  upsellInventory: UpsellInventory
  eventPackages: EventPackageOption[]
  knowledgeBaseResults: KnowledgeContextItem[]
  pricing: PricingContext
  businessRules: BusinessRules
  /** True when the lookup for that section failed or the underlying schema isn't live yet — lets a caller distinguish "empty" from "unavailable." */
  degraded: {
    reservationHistory: boolean
    conversationHistory: boolean
    upsellInventory: boolean
    eventPackages: boolean
  }
}

export interface BuildAIContextInput {
  /** Resolved lead id (from src/lib/identity/resolve-identity.ts), or null for an unidentified visitor. */
  leadId: string | null
  /** The customer's current message / query — used to retrieve knowledge base results relevant to it. */
  query: string
  /** Optional: conversation id in the Unified Conversation Platform, to pull message history from. */
  conversationId?: string | null
  /**
   * Hardening Sprint (Performance) — opt-in, additive-only. When true,
   * skips the four heaviest sections — knowledge base vector search,
   * pricing, reservation history, proposal history — and returns their
   * safe empty defaults instead, same shape as an unidentified visitor
   * gets for those fields today. Omitted/false behaves EXACTLY as before
   * for every existing caller (unified-conversation-service.ts,
   * auto-package-recommendation.ts, and api/customers/[id]/ai/route.ts all
   * leave this unset and are completely unaffected by its existence).
   * Intended for a caller (orchestration-engine.ts) that can already prove,
   * from cheap/synchronous signals alone and before context is built, that
   * the eventual decision cannot possibly need this data — see
   * orchestration-engine.ts's own skip predicate for the exact condition.
   */
  skipExpensiveRetrieval?: boolean
}
