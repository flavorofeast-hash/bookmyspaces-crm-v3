// src/lib/validation.ts
// ─────────────────────────────────────────────────────────────────────────────
// ISS-005 (audit/MASTER_ISSUE_REGISTER.csv): none of the 31 API routes validated
// their input shape before touching the database — malformed types (e.g. a
// string where a number was expected) surfaced as opaque Postgres errors, and
// PATCH-style routes that spread `...body` straight into a Supabase `.update()`
// call were open to mass assignment (a caller could set columns the UI never
// exposes, like `ai_score` or `created_at`, just by including them in the
// request body).
//
// This module is the shared helper + schema library. Routes import a schema
// from here and call `parseBody()`, which returns either validated data or a
// ready-to-return 400 NextResponse — callers never hand-roll validation error
// shapes. Scoped rollout: applied first to the highest write-risk routes
// (leads create/edit, lead stage transitions — the two flows this session's
// QA pass covered) as the reference pattern; the remaining ~29 routes are
// listed as follow-up work in audit/OPEN_ISSUES.md rather than claimed done
// here, since applying it blind to all 31 without individually verifying each
// route's actual expected shape would risk breaking routes this session
// didn't otherwise touch or verify.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { z } from 'zod'

export async function parseBody<T extends z.ZodTypeAny>(
  req: Request,
  schema: T
): Promise<{ ok: true; data: z.infer<T> } | { ok: false; response: NextResponse }> {
  let json: unknown
  try {
    json = await req.json()
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 }),
    }
  }

  const result = schema.safeParse(json)
  if (!result.success) {
    const issues = result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
    return {
      ok: false,
      response: NextResponse.json({ error: 'Invalid request body', issues }, { status: 400 }),
    }
  }

  return { ok: true, data: result.data }
}

// ─── Leads ──────────────────────────────────────────────────────────────────

const uuid = z.string().uuid({ message: 'must be a valid UUID' })

export const createLeadSchema = z.object({
  name                : z.string().trim().min(1).max(200).nullish(),
  phone               : z.string().trim().min(6).max(20).nullish(),
  email               : z.string().trim().email().nullish().or(z.literal('')),
  event_type          : z.string().trim().max(100).nullish(),
  event_date          : z.string().trim().nullish(), // date-ish string; DB column is permissive, matches existing behavior
  guest_count         : z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]).nullish(),
  budget              : z.string().trim().max(100).nullish(),
  special_requirements: z.string().trim().max(2000).nullish(),
  venue               : z.string().trim().max(200).nullish(),
  source              : z.string().trim().max(50).nullish(),
  status              : z.string().trim().max(50).nullish(),
  assigned_to         : z.string().trim().max(200).nullish(),
  notes               : z.string().trim().max(2000).nullish(),
})

// PATCH /api/leads allow-list — deliberately excludes columns that have their
// own dedicated, validated write path (lead_stage → /api/leads/[id]/stage) or
// that should never be client-writable (id, created_at, ai_score and other
// scoring-engine-owned fields). Anything not listed here is REJECTED with a
// 400, not silently dropped — a silent drop would hide the same class of bug
// this session spent most of its time on: a write the caller believes
// succeeded quietly doing nothing.
export const updateLeadSchema = z.object({
  id                  : uuid,
  name                : z.string().trim().min(1).max(200).nullish(),
  phone               : z.string().trim().min(6).max(20).nullish(),
  email               : z.string().trim().email().nullish().or(z.literal('')),
  event_type          : z.string().trim().max(100).nullish(),
  event_date          : z.string().trim().nullish(),
  guest_count         : z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]).nullish(),
  budget              : z.string().trim().max(100).nullish(),
  special_requirements: z.string().trim().max(2000).nullish(),
  venue               : z.string().trim().max(200).nullish(),
  source              : z.string().trim().max(50).nullish(),
  status              : z.string().trim().max(50).nullish(),
  assigned_to         : z.string().trim().max(200).nullish(),
  notes               : z.string().trim().max(2000).nullish(),
}).strict().partial({
  name: true, phone: true, email: true, event_type: true, event_date: true,
  guest_count: true, budget: true, special_requirements: true, venue: true,
  source: true, status: true, assigned_to: true, notes: true,
})

export const leadStageBodySchema = z.object({
  stage : z.enum(['NEW', 'CONTACTED', 'QUALIFIED', 'NEGOTIATING', 'PROPOSAL_SENT', 'VISIT_SCHEDULED', 'CONFIRMED', 'LOST']),
  reason: z.string().trim().max(500).optional(),
  force : z.boolean().optional(),
})

// ─── Reservations (V3 Day 6 — Operator Experience sprint) ──────────────────
// Same "validate before touching the database" rule as leads above, applied
// to the new Reservation API routes exposing Day 2/4's reservation-workflow.ts.

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a YYYY-MM-DD date')

/** Add-on Services booking-flow integration (Reservation Platform activation, Phase 4). */
export const addonLineSchema = z.object({
  addonServiceId: uuid,
  quantity      : z.number().int().positive().max(50).default(1),
})

export const checkAvailabilitySchema = z.object({
  inventoryItemId: uuid,
  checkInDate    : isoDate,
  checkOutDate   : isoDate,
  roomCount      : z.number().int().positive().max(50).nullish(),
  /** Meal Plan booking-flow integration (Reservation Platform activation, Phase 3) — lets the live quote preview include the meal plan charge before the reservation is created. */
  mealPlanId     : uuid.nullish(),
  /** Add-on Services booking-flow integration (Reservation Platform activation, Phase 4) — same live-preview reasoning as mealPlanId above. */
  addons         : z.array(addonLineSchema).max(20).nullish(),
})

export const createReservationSchema = z.object({
  customerId     : uuid.nullish(),
  guestName      : z.string().trim().min(1).max(200),
  guestMobile    : z.string().trim().min(6).max(20).nullish(),
  guestEmail     : z.string().trim().email().nullish().or(z.literal('')),
  propertyId     : uuid,
  inventoryItemId: uuid,
  checkInDate    : isoDate,
  checkOutDate   : isoDate,
  adults         : z.number().int().positive().max(50).nullish(),
  children       : z.number().int().min(0).max(50).nullish(),
  roomCount      : z.number().int().positive().max(50).nullish(),
  bookingSource  : z.enum([
    'direct', 'website', 'whatsapp', 'phone', 'walk_in', 'referral',
    'booking_com', 'agoda', 'expedia', 'airbnb', 'other',
  ]).nullish(),
  specialRequests: z.string().trim().max(2000).nullish(),
  crmLeadId      : uuid.nullish(),
  /** Set when converting an accepted proposal into a reservation (Sprint 3). */
  proposalId     : uuid.nullish(),
  /** Meal Plan booking-flow integration (Reservation Platform activation, Phase 3). */
  mealPlanId     : uuid.nullish(),
  /** Add-on Services booking-flow integration (Reservation Platform activation, Phase 4). */
  addons         : z.array(addonLineSchema).max(20).nullish(),
}).refine(
  (v) => v.checkOutDate > v.checkInDate,
  { message: 'checkOutDate must be after checkInDate', path: ['checkOutDate'] }
)

export const reservationStatusActionSchema = z.object({
  action   : z.enum(['confirm', 'cancel', 'check_in', 'check_out']),
  reason   : z.string().trim().max(500).nullish(),
  crmLeadId: uuid.nullish(),
})

// Sprint 1, Priority 1 — manual availability override. Deliberately much
// smaller than createReservationSchema above: no guest/pricing/meal-plan
// fields, since createManualBlock() (reservation-workflow.ts) doesn't accept
// or need them — reason is required so every block is self-explanatory.
export const createManualBlockSchema = z.object({
  propertyId     : uuid,
  inventoryItemId: uuid,
  checkInDate    : isoDate,
  checkOutDate   : isoDate,
  reason         : z.string().trim().min(1).max(500),
}).refine(
  (v) => v.checkOutDate > v.checkInDate,
  { message: 'checkOutDate must be after checkInDate', path: ['checkOutDate'] }
)

// ─── AI Operator Assistant (V3 Sprint 4 — Priority 4) ──────────────────────

export const operatorAssistActionSchema = z.object({
  action: z.enum([
    'customer_summary', 'conversation_summary', 'suggested_whatsapp_reply',
    'suggested_email', 'recommended_room', 'recommended_package', 'recommended_follow_up',
    'upsell_recommendations',
    // Direct Event Sales Engine, Section 2/7 — structured (JSON) action,
    // routed to runEventSalesAdvisor() instead of runOperatorAssist() by
    // src/app/api/customers/[id]/ai/route.ts, see that file.
    'event_sales_advisor',
  ]),
  conversationId: uuid.nullish(),
})

// ─── Settings (V3 Phase 2a — Settings backend) ─────────────────────────────
// Shape mirrors src/lib/settings/settings-service.ts's AppSettings. .strict()
// on every section: unknown keys are rejected (400), not silently dropped —
// same mass-assignment reasoning as updateLeadSchema above.

const venueSettingsSchema = z.object({
  venueName       : z.string().trim().min(1).max(200),
  phone           : z.string().trim().max(20),
  email           : z.string().trim().email().or(z.literal('')),
  website         : z.string().trim().max(300),
  address         : z.string().trim().max(500),
  standardCapacity: z.number().int().nonnegative().max(100000),
  hallCapacity    : z.number().int().nonnegative().max(100000),
  currency        : z.string().trim().min(1).max(10),
}).strict()

const aiSettingsSchema = z.object({
  model              : z.string().trim().min(1).max(100),
  maxTokens          : z.number().int().positive().max(100000),
  temperature        : z.number().min(0).max(2),
  systemLanguage     : z.string().trim().max(20),
  autoReply          : z.boolean(),
  replyDelay         : z.number().int().nonnegative().max(3600),
  confidenceThreshold: z.number().min(0).max(1),
  autoHandoff        : z.boolean(),
}).strict()

const notificationSettingsSchema = z.object({
  hotLeadAlert    : z.boolean(),
  newInquiryAlert : z.boolean(),
  followUpReminder: z.boolean(),
  dailySummary    : z.boolean(),
  adminEmail      : z.string().trim().email().or(z.literal('')),
}).strict()

const whatsappSettingsSchema = z.object({
  verifyToken   : z.string().trim().max(200),
  phoneNumberId : z.string().trim().max(100),
  accessTokenSet: z.boolean(),
  webhookUrl    : z.string().trim().max(500),
}).strict()

export const updateSettingsSchema = z.object({
  venue        : venueSettingsSchema.optional(),
  ai           : aiSettingsSchema.optional(),
  notifications: notificationSettingsSchema.optional(),
  whatsapp     : whatsappSettingsSchema.optional(),
}).strict()

// ─── Admin catalog (V3 Phase 2b — Admin CRUD) ──────────────────────────────
// One create + one update schema per catalog entity. Field names are the DB
// column names (this is an admin-facing API; no camelCase mapping layer).
// .strict() everywhere — unknown columns are a 400, never silently dropped.

const money = z.number().nonnegative().max(99999999)

export const createPropertySchema = z.object({
  name           : z.string().trim().min(1).max(200),
  slug           : z.string().trim().min(1).max(100).regex(/^[a-z0-9-]+$/, 'lowercase letters, digits and hyphens only'),
  address        : z.string().trim().max(500).nullish(),
  city           : z.string().trim().max(100).nullish(),
  gst_number     : z.string().trim().max(30).nullish(),
  google_maps_url: z.string().trim().max(500).nullish(),
  contact_phone  : z.string().trim().max(20).nullish(),
  contact_email  : z.string().trim().email().nullish().or(z.literal('')),
  amenities      : z.array(z.string().trim().max(100)).max(100).nullish(),
  images         : z.array(z.string().trim().max(500)).max(100).nullish(),
  policies       : z.string().trim().max(5000).nullish(),
  business_hours : z.record(z.unknown()).nullish(),
  is_active      : z.boolean().optional(),
}).strict()

export const updatePropertySchema = createPropertySchema.partial()

const inventoryTypeEnum = z.enum([
  'room', 'suite', 'apartment', 'banquet_hall', 'conference_hall',
  'rooftop', 'restaurant_event_area', 'wedding_venue', 'birthday_venue', 'meeting_room',
])

export const createInventoryItemSchema = z.object({
  property_id   : uuid,
  inventory_type: inventoryTypeEnum,
  name          : z.string().trim().min(1).max(200),
  description   : z.string().trim().max(2000).nullish(),
  max_occupancy : z.number().int().positive().max(10000).nullish(),
  base_capacity : z.number().int().positive().max(10000).nullish(),
  is_active     : z.boolean().optional(),
}).strict()

export const updateInventoryItemSchema = createInventoryItemSchema.partial()

export const createMealPlanSchema = z.object({
  property_id: uuid,
  code       : z.enum(['room_only', 'breakfast', 'map', 'ap']),
  name       : z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullish(),
  price      : money,
  is_active  : z.boolean().optional(),
}).strict()

export const updateMealPlanSchema = createMealPlanSchema.partial()

export const createRatePlanSchema = z.object({
  inventory_item_id: uuid,
  rate_type        : z.enum(['base', 'weekend', 'seasonal', 'festival', 'holiday', 'corporate', 'ota', 'promotional']),
  start_date       : isoDate.nullish(),
  end_date         : isoDate.nullish(),
  price            : money,
  priority         : z.number().int().min(0).max(1000).optional(),
  is_active        : z.boolean().optional(),
}).strict().refine(
  (v) => !v.start_date || !v.end_date || v.end_date >= v.start_date,
  { message: 'end_date must be on or after start_date', path: ['end_date'] }
)

export const updateRatePlanSchema = z.object({
  inventory_item_id: uuid.optional(),
  rate_type        : z.enum(['base', 'weekend', 'seasonal', 'festival', 'holiday', 'corporate', 'ota', 'promotional']).optional(),
  start_date       : isoDate.nullish(),
  end_date         : isoDate.nullish(),
  price            : money.optional(),
  priority         : z.number().int().min(0).max(1000).optional(),
  is_active        : z.boolean().optional(),
}).strict()

export const createAddonServiceSchema = z.object({
  property_id: uuid,
  name       : z.string().trim().min(1).max(200),
  category   : z.string().trim().max(100).nullish(),
  price      : money,
  is_active  : z.boolean().optional(),
}).strict()

export const updateAddonServiceSchema = createAddonServiceSchema.partial()

// Direct Event Sales Engine, Section 3 — Event Package Management, added to
// the existing generic admin catalog CRUD (see catalog-service.ts's
// CATALOG_ENTITIES['packages']) rather than a bespoke validation path.
const packageAddonLineSchema = z.object({
  name       : z.string().trim().min(1).max(200),
  price      : money,
  description: z.string().trim().max(500).nullish(),
}).strict()

// Business-strategy expansion (migration 024) — additive seasonal pricing rule.
const packageSeasonalPricingRuleSchema = z.object({
  label             : z.string().trim().min(1).max(200),
  startDate         : z.string().trim().min(1).max(40),
  endDate           : z.string().trim().min(1).max(40),
  priceAdjustmentPct: z.number().min(-100).max(500),
}).strict()

export const createPackageCatalogSchema = z.object({
  name                  : z.string().trim().min(1).max(200),
  venue                 : z.string().trim().min(1).max(200),
  hall                  : z.string().trim().max(200).nullish(),
  seating_style         : z.string().trim().max(100).nullish(),
  tier                  : z.number().int().min(1).max(10).optional(),
  base_price            : money,
  max_guests            : z.number().int().positive().max(10000).optional(),
  duration_hours        : z.number().int().positive().max(72).optional(),
  inclusions            : z.array(z.string().trim().max(300)).max(50).optional(),
  addons                : z.array(packageAddonLineSchema).max(50).optional(),
  addon_service_ids     : z.array(uuid).max(50).optional(),
  description           : z.string().trim().max(4000).nullish(),
  is_popular            : z.boolean().optional(),
  ai_description        : z.string().trim().max(4000).nullish(),
  event_types           : z.array(z.string().trim().max(50)).max(20).optional(),
  images                : z.array(z.string().trim().max(2000)).max(30).optional(),
  room_inventory_item_ids: z.array(uuid).max(50).optional(),
  meal_plan_id          : uuid.nullish(),
  tax_rate_override_pct : z.number().min(0).max(100).nullish(),
  seasonal_pricing      : z.array(packageSeasonalPricingRuleSchema).max(20).optional(),
  standard_discount_pct : z.number().min(0).max(100).nullish(),
  is_active             : z.boolean().optional(),
}).strict()

export const updatePackageCatalogSchema = createPackageCatalogSchema.partial()

// Entity → schema lookup used by the /api/admin/catalog/[entity] routes.
export const catalogCreateSchemas = {
  'properties'     : createPropertySchema,
  'inventory-items': createInventoryItemSchema,
  'meal-plans'     : createMealPlanSchema,
  'rate-plans'     : createRatePlanSchema,
  'addon-services' : createAddonServiceSchema,
  'packages'       : createPackageCatalogSchema,
} as const

export const catalogUpdateSchemas = {
  'properties'     : updatePropertySchema,
  'inventory-items': updateInventoryItemSchema,
  'meal-plans'     : updateMealPlanSchema,
  'rate-plans'     : updateRatePlanSchema,
  'addon-services' : updateAddonServiceSchema,
  'packages'       : updatePackageCatalogSchema,
} as const

// ─── Knowledge sources + AI prompts (V3 Phase 2c) ──────────────────────────

export const createKnowledgeSourceSchema = z.object({
  category: z.string().trim().min(1).max(100),
  title   : z.string().trim().min(1).max(300),
  content : z.string().trim().min(1).max(20000),
}).strict()

export const updateKnowledgeSourceSchema = z.object({
  category : z.string().trim().min(1).max(100).optional(),
  title    : z.string().trim().min(1).max(300).optional(),
  content  : z.string().trim().min(1).max(20000).optional(),
  is_active: z.boolean().optional(),
}).strict()

export const createPromptVersionSchema = z.object({
  name           : z.string().trim().min(1).max(100).regex(/^[a-z0-9_.-]+$/, 'lowercase letters, digits, _ . - only'),
  prompt_template: z.string().trim().min(1).max(50000),
}).strict()

// ─── Social posts (Step 2.2 — social_posts API, list/create only) ──────────

const socialPlatformEnum = z.enum([
  'facebook', 'instagram', 'linkedin', 'google_business', 'x', 'youtube', 'threads',
])

export const createSocialPostSchema = z.object({
  platform    : socialPlatformEnum,
  post_type   : z.enum(['text', 'image', 'carousel', 'video', 'reel', 'story']),
  content     : z.string().trim().max(10000).nullish(),
  media       : z.array(z.object({
    url : z.string().trim().min(1).max(1000),
    type: z.string().trim().min(1).max(50),
    alt : z.string().trim().max(500).optional(),
  }).strict()).max(20).optional(),
  hashtags    : z.array(z.string().trim().min(1).max(100)).max(50).optional(),
  account_id  : uuid.nullish(),
  scheduled_at: z.string().datetime({ offset: true, message: 'must be an ISO 8601 datetime' }).nullish(),
}).strict()
  .refine(
    (v) => (v.content && v.content.length > 0) || (v.media && v.media.length > 0),
    { message: 'Post needs content text and/or at least one media item', path: ['content'] }
  )
  .refine(
    (v) => !v.scheduled_at || new Date(v.scheduled_at).getTime() > Date.now(),
    { message: 'scheduled_at must be in the future', path: ['scheduled_at'] }
  )
