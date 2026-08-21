// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/packages/package-service.ts
// Direct Event Sales Engine, Section 3 — Event Package Management.
//
// CRUD over the existing `packages` table (migration 007, extended by
// migration 023 with event_types/images/room_inventory_item_ids/
// meal_plan_id/tax_rate_override_pct). No admin API/UI existed for this
// table before now — it was seed-data-only. Same select/map pattern as
// property-service.ts's listActiveMealPlans/listActiveAddonServices.
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabaseAdmin } from '@/lib/supabase'
import { getTaxRatePercent } from '@/lib/tax'
import type { EventType } from '@/lib/events/event-types'

export interface PackageAddon {
  name: string
  price: number
  description?: string
}

// Business-strategy expansion (migration 024) — additive seasonal pricing
// rule. Applied app-side via resolvePackagePrice() below; base_price on the
// row is never mutated by a rule firing.
export interface SeasonalPricingRule {
  label: string
  startDate: string // ISO date, inclusive
  endDate: string   // ISO date, inclusive
  priceAdjustmentPct: number // e.g. 15 = +15% over basePrice, -10 = 10% off
}

export interface EventPackage {
  id: string
  name: string
  venue: string
  hall: string | null
  seatingStyle: string | null
  tier: number
  basePrice: number
  priceUnit: 'per_event' | 'per_person' | 'per_hour' | 'per_night'
  maxGuests: number
  durationHours: number
  inclusions: string[]
  exclusions: string[]
  addons: PackageAddon[]
  addonServiceIds: string[]
  description: string | null
  isActive: boolean
  isPopular: boolean
  aiDescription: string | null
  eventTypes: string[]
  images: string[]
  roomInventoryItemIds: string[]
  mealPlanId: string | null
  taxRatePct: number
  seasonalPricing: SeasonalPricingRule[]
  standardDiscountPct: number | null
  // Catalog completion (migration 030) -- marketing/SEO/CTA fields Content
  // Studio and campaigns read to promote a package without re-deriving them.
  bookingUrl: string | null
  whatsappCtaText: string | null
  seoTitle: string | null
  seoDescription: string | null
  seoSlug: string | null
  targetAudience: string[]
  createdAt: string
}

function mapPackageRow(row: Record<string, any>): EventPackage {
  return {
    id: row.id,
    name: row.name,
    venue: row.venue,
    hall: row.hall ?? null,
    seatingStyle: row.seating_style ?? null,
    tier: row.tier ?? 1,
    basePrice: Number(row.base_price) || 0,
    priceUnit: row.price_unit ?? 'per_event',
    maxGuests: row.max_guests ?? 60,
    durationHours: row.duration_hours ?? 4,
    inclusions: row.inclusions ?? [],
    exclusions: row.exclusions ?? [],
    addons: row.addons ?? [],
    addonServiceIds: row.addon_service_ids ?? [],
    description: row.description ?? null,
    isActive: row.is_active ?? true,
    isPopular: row.is_popular ?? false,
    aiDescription: row.ai_description ?? null,
    eventTypes: row.event_types ?? [],
    images: row.images ?? [],
    roomInventoryItemIds: row.room_inventory_item_ids ?? [],
    mealPlanId: row.meal_plan_id ?? null,
    // Per-package override falls back to the global default (src/lib/tax.ts)
    // — reused, not duplicated, so a change to DEFAULT_TAX_RATE_PERCENT
    // still applies to every package that hasn't explicitly overridden it.
    taxRatePct: row.tax_rate_override_pct != null ? Number(row.tax_rate_override_pct) : getTaxRatePercent(),
    seasonalPricing: row.seasonal_pricing ?? [],
    standardDiscountPct: row.standard_discount_pct != null ? Number(row.standard_discount_pct) : null,
    bookingUrl: row.booking_url ?? null,
    whatsappCtaText: row.whatsapp_cta_text ?? null,
    seoTitle: row.seo_title ?? null,
    seoDescription: row.seo_description ?? null,
    seoSlug: row.seo_slug ?? null,
    targetAudience: row.target_audience ?? [],
    createdAt: row.created_at,
  }
}

/**
 * Business-strategy expansion — resolves a package's effective base price
 * for a given event date, applying the first matching seasonalPricing rule
 * (rules are checked in array order; first match wins, same "first-touch"
 * simplicity already used for campaign attribution in revenue-intelligence.ts).
 * Returns basePrice unchanged when no rule matches or no eventDateISO is
 * given — this is additive pricing guidance, never a silent price change
 * the operator can't see (callers should surface which rule fired, if any).
 */
export function resolvePackagePrice(pkg: EventPackage, eventDateISO?: string | null): { price: number; appliedRule: SeasonalPricingRule | null } {
  if (!eventDateISO || pkg.seasonalPricing.length === 0) return { price: pkg.basePrice, appliedRule: null }
  const eventTime = new Date(eventDateISO).getTime()
  if (Number.isNaN(eventTime)) return { price: pkg.basePrice, appliedRule: null }

  for (const rule of pkg.seasonalPricing) {
    const start = new Date(rule.startDate).getTime()
    const end = new Date(rule.endDate).getTime()
    if (Number.isNaN(start) || Number.isNaN(end)) continue
    if (eventTime >= start && eventTime <= end) {
      const adjusted = Math.round(pkg.basePrice * (1 + rule.priceAdjustmentPct / 100))
      return { price: Math.max(0, adjusted), appliedRule: rule }
    }
  }
  return { price: pkg.basePrice, appliedRule: null }
}

export interface ListPackagesFilters {
  activeOnly?: boolean
  eventType?: EventType
  venue?: string
}

export async function listPackages(filters: ListPackagesFilters = {}): Promise<EventPackage[]> {
  const supabase = getSupabaseAdmin()
  let query = supabase.from('packages').select('*').order('tier', { ascending: true })

  if (filters.activeOnly !== false) query = query.eq('is_active', true)
  if (filters.venue) query = query.eq('venue', filters.venue)

  const { data, error } = await query
  if (error || !data) return []

  let packages = data.map(mapPackageRow)

  // event_types is filtered in-memory (not SQL) because an empty array on
  // a package means "applies to all event types" — a plain `.contains()`
  // filter can't express that OR condition cleanly, and the packages table
  // is small (tens of rows, not thousands) so this stays well within the
  // bounded-query, non-N+1 discipline established for Revenue Intelligence.
  if (filters.eventType) {
    packages = packages.filter((p) => p.eventTypes.length === 0 || p.eventTypes.includes(filters.eventType!))
  }

  return packages
}

export async function getPackageById(id: string): Promise<EventPackage | null> {
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase.from('packages').select('*').eq('id', id).maybeSingle()
  if (error || !data) return null
  return mapPackageRow(data)
}

export interface CreatePackageInput {
  name: string
  venue: string
  hall?: string | null
  seatingStyle?: string | null
  tier?: number
  basePrice: number
  priceUnit?: 'per_event' | 'per_person' | 'per_hour' | 'per_night'
  maxGuests?: number
  durationHours?: number
  inclusions?: string[]
  exclusions?: string[]
  addons?: PackageAddon[]
  addonServiceIds?: string[]
  description?: string | null
  isPopular?: boolean
  aiDescription?: string | null
  eventTypes?: string[]
  images?: string[]
  roomInventoryItemIds?: string[]
  mealPlanId?: string | null
  taxRateOverridePct?: number | null
  seasonalPricing?: SeasonalPricingRule[]
  standardDiscountPct?: number | null
  bookingUrl?: string | null
  whatsappCtaText?: string | null
  seoTitle?: string | null
  seoDescription?: string | null
  seoSlug?: string | null
  targetAudience?: string[]
}

export async function createPackage(input: CreatePackageInput): Promise<EventPackage | null> {
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('packages')
    .insert({
      name: input.name,
      venue: input.venue,
      hall: input.hall ?? null,
      seating_style: input.seatingStyle ?? null,
      tier: input.tier ?? 1,
      base_price: input.basePrice,
      price_unit: input.priceUnit ?? 'per_event',
      max_guests: input.maxGuests ?? 60,
      duration_hours: input.durationHours ?? 4,
      inclusions: input.inclusions ?? [],
      exclusions: input.exclusions ?? [],
      addons: input.addons ?? [],
      addon_service_ids: input.addonServiceIds ?? [],
      description: input.description ?? null,
      is_popular: input.isPopular ?? false,
      ai_description: input.aiDescription ?? null,
      event_types: input.eventTypes ?? [],
      images: input.images ?? [],
      room_inventory_item_ids: input.roomInventoryItemIds ?? [],
      meal_plan_id: input.mealPlanId ?? null,
      tax_rate_override_pct: input.taxRateOverridePct ?? null,
      seasonal_pricing: input.seasonalPricing ?? [],
      standard_discount_pct: input.standardDiscountPct ?? null,
      booking_url: input.bookingUrl ?? null,
      whatsapp_cta_text: input.whatsappCtaText ?? null,
      seo_title: input.seoTitle ?? null,
      seo_description: input.seoDescription ?? null,
      seo_slug: input.seoSlug ?? null,
      target_audience: input.targetAudience ?? [],
    })
    .select('*')
    .single()

  if (error || !data) return null
  return mapPackageRow(data)
}

export interface UpdatePackageInput extends Partial<CreatePackageInput> {
  isActive?: boolean
}

export async function updatePackage(id: string, input: UpdatePackageInput): Promise<EventPackage | null> {
  const supabase = getSupabaseAdmin()
  const updates: Record<string, unknown> = {}
  if (input.name !== undefined) updates.name = input.name
  if (input.venue !== undefined) updates.venue = input.venue
  if (input.hall !== undefined) updates.hall = input.hall
  if (input.seatingStyle !== undefined) updates.seating_style = input.seatingStyle
  if (input.tier !== undefined) updates.tier = input.tier
  if (input.basePrice !== undefined) updates.base_price = input.basePrice
  if (input.priceUnit !== undefined) updates.price_unit = input.priceUnit
  if (input.maxGuests !== undefined) updates.max_guests = input.maxGuests
  if (input.durationHours !== undefined) updates.duration_hours = input.durationHours
  if (input.inclusions !== undefined) updates.inclusions = input.inclusions
  if (input.exclusions !== undefined) updates.exclusions = input.exclusions
  if (input.addons !== undefined) updates.addons = input.addons
  if (input.addonServiceIds !== undefined) updates.addon_service_ids = input.addonServiceIds
  if (input.description !== undefined) updates.description = input.description
  if (input.isPopular !== undefined) updates.is_popular = input.isPopular
  if (input.isActive !== undefined) updates.is_active = input.isActive
  if (input.aiDescription !== undefined) updates.ai_description = input.aiDescription
  if (input.eventTypes !== undefined) updates.event_types = input.eventTypes
  if (input.images !== undefined) updates.images = input.images
  if (input.roomInventoryItemIds !== undefined) updates.room_inventory_item_ids = input.roomInventoryItemIds
  if (input.mealPlanId !== undefined) updates.meal_plan_id = input.mealPlanId
  if (input.taxRateOverridePct !== undefined) updates.tax_rate_override_pct = input.taxRateOverridePct
  if (input.seasonalPricing !== undefined) updates.seasonal_pricing = input.seasonalPricing
  if (input.standardDiscountPct !== undefined) updates.standard_discount_pct = input.standardDiscountPct
  if (input.bookingUrl !== undefined) updates.booking_url = input.bookingUrl
  if (input.whatsappCtaText !== undefined) updates.whatsapp_cta_text = input.whatsappCtaText
  if (input.seoTitle !== undefined) updates.seo_title = input.seoTitle
  if (input.seoDescription !== undefined) updates.seo_description = input.seoDescription
  if (input.seoSlug !== undefined) updates.seo_slug = input.seoSlug
  if (input.targetAudience !== undefined) updates.target_audience = input.targetAudience

  const { data, error } = await supabase.from('packages').update(updates).eq('id', id).select('*').single()
  if (error || !data) return null
  return mapPackageRow(data)
}

/** Soft-delete — same convention as every other catalog table in this app (is_active flag, never a hard DELETE, so historical proposals/reservations that reference a package keep working). */
export async function deactivatePackage(id: string): Promise<boolean> {
  const supabase = getSupabaseAdmin()
  const { error } = await supabase.from('packages').update({ is_active: false }).eq('id', id)
  return !error
}
