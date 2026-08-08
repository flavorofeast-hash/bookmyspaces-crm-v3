// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/business-packages/business-package-service.ts
// Business Package Engine (migration 043).
//
// Replaces hardcoded campaign templates (src/lib/campaigns/campaign-config.ts's
// 5-slug CAMPAIGN_CONFIG) as the way new marketable offers are defined.
// A Business Package is a CONFIGURATION row, not a new engine — every method
// below either does plain CRUD on `business_packages` or hands the row's
// content to an EXISTING engine:
//   - resolveAudience()        -> buildSegment() (src/lib/campaigns.ts)
//   - toCampaignConfig()       -> shape consumed by the EXISTING /[campaign]
//                                 landing page + Landing* components
//   - buildContentGenerationInput() -> {platform-agnostic goal/context} fed to
//                                 the EXISTING generateSocialPostDraft()
//                                 (src/lib/social/content-generator.ts) by
//                                 whichever caller (Content Studio) invokes it
//   - renderWhatsAppMessage()/renderEmail() -> the SAME {{name}} token
//                                 convention already established (and now
//                                 exported) by drip-service.ts's renderTemplate()
//
// No new segment engine, no new AI prompt pipeline, no new template
// renderer, no new landing-page renderer — this module is glue + storage.
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabaseAdmin } from '@/lib/supabase'
import { renderTemplate } from '@/lib/whatsapp/drip-service'
import { buildSegment, type SegmentFilter } from '@/lib/campaigns'
import { getSpendByBusinessPackage } from '@/lib/analytics/ad-spend-service'

type Result<T> = { ok: true; value: T } | { ok: false; error: string }

export type BusinessPackageStatus = 'active' | 'inactive' | 'retired'

export interface BusinessPackage {
  id: string
  createdAt: string
  updatedAt: string
  name: string
  category: string | null
  description: string | null
  targetAudience: string | null
  highlights: string[]
  budgetRange: string | null
  cta: string | null
  landingPageSlug: string | null
  pricingPackageId: string | null
  proposalTemplateNotes: string | null
  aiPrompt: string | null
  hashtags: string[]
  recommendedMedia: string | null
  recommendedPostingTime: string | null
  whatsappTemplate: string | null
  emailSubjectTemplate: string | null
  emailTemplate: string | null
  followUpSequenceId: string | null
  marketingSegment: SegmentFilter
  status: BusinessPackageStatus
}

function mapRow(row: Record<string, any>): BusinessPackage {
  return {
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    name: row.name,
    category: row.category ?? null,
    description: row.description ?? null,
    targetAudience: row.target_audience ?? null,
    highlights: row.highlights ?? [],
    budgetRange: row.budget_range ?? null,
    cta: row.cta ?? null,
    landingPageSlug: row.landing_page_slug ?? null,
    pricingPackageId: row.pricing_package_id ?? null,
    proposalTemplateNotes: row.proposal_template_notes ?? null,
    aiPrompt: row.ai_prompt ?? null,
    hashtags: row.hashtags ?? [],
    recommendedMedia: row.recommended_media ?? null,
    recommendedPostingTime: row.recommended_posting_time ?? null,
    whatsappTemplate: row.whatsapp_template ?? null,
    emailSubjectTemplate: row.email_subject_template ?? null,
    emailTemplate: row.email_template ?? null,
    followUpSequenceId: row.follow_up_sequence_id ?? null,
    marketingSegment: (row.marketing_segment ?? {}) as SegmentFilter,
    status: (row.status ?? 'active') as BusinessPackageStatus,
  }
}

export interface ListBusinessPackagesFilters {
  status?: BusinessPackageStatus
  category?: string
}

export async function listBusinessPackages(filters: ListBusinessPackagesFilters = {}): Promise<BusinessPackage[]> {
  const db = getSupabaseAdmin()
  let query = db.from('business_packages').select('*').order('created_at', { ascending: false })
  if (filters.status) query = query.eq('status', filters.status)
  if (filters.category) query = query.eq('category', filters.category)

  const { data, error } = await query
  if (error || !data) return []
  return data.map(mapRow)
}

export async function getBusinessPackageById(id: string): Promise<BusinessPackage | null> {
  const db = getSupabaseAdmin()
  const { data, error } = await db.from('business_packages').select('*').eq('id', id).maybeSingle()
  if (error || !data) return null
  return mapRow(data)
}

/** Active packages whose landing_page_slug matches — the DB-fallback lookup /[campaign]/page.tsx uses once a slug isn't one of the 5 hardcoded ones. */
export async function getActiveBusinessPackageBySlug(slug: string): Promise<BusinessPackage | null> {
  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('business_packages')
    .select('*')
    .eq('landing_page_slug', slug)
    .eq('status', 'active')
    .maybeSingle()
  if (error || !data) return null
  return mapRow(data)
}

export interface BusinessPackageInput {
  name: string
  category?: string | null
  description?: string | null
  target_audience?: string | null
  highlights?: string[]
  budget_range?: string | null
  cta?: string | null
  landing_page_slug?: string | null
  pricing_package_id?: string | null
  proposal_template_notes?: string | null
  ai_prompt?: string | null
  hashtags?: string[]
  recommended_media?: string | null
  recommended_posting_time?: string | null
  whatsapp_template?: string | null
  email_subject_template?: string | null
  email_template?: string | null
  follow_up_sequence_id?: string | null
  marketing_segment?: Record<string, unknown>
  status?: BusinessPackageStatus
}

const UNIQUE_VIOLATION = '23505'

export async function createBusinessPackage(input: BusinessPackageInput): Promise<Result<BusinessPackage>> {
  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('business_packages')
    .insert({
      name: input.name,
      category: input.category ?? null,
      description: input.description ?? null,
      target_audience: input.target_audience ?? null,
      highlights: input.highlights ?? [],
      budget_range: input.budget_range ?? null,
      cta: input.cta ?? null,
      landing_page_slug: input.landing_page_slug ?? null,
      pricing_package_id: input.pricing_package_id ?? null,
      proposal_template_notes: input.proposal_template_notes ?? null,
      ai_prompt: input.ai_prompt ?? null,
      hashtags: input.hashtags ?? [],
      recommended_media: input.recommended_media ?? null,
      recommended_posting_time: input.recommended_posting_time ?? null,
      whatsapp_template: input.whatsapp_template ?? null,
      email_subject_template: input.email_subject_template ?? null,
      email_template: input.email_template ?? null,
      follow_up_sequence_id: input.follow_up_sequence_id ?? null,
      marketing_segment: input.marketing_segment ?? {},
      status: input.status ?? 'active',
    })
    .select('*')
    .single()

  if (error) {
    if (error.code === UNIQUE_VIOLATION) return { ok: false, error: 'landing_page_slug is already in use by another package' }
    return { ok: false, error: error.message }
  }
  if (!data) return { ok: false, error: 'insert returned no row' }
  return { ok: true, value: mapRow(data) }
}

export async function updateBusinessPackage(id: string, input: Partial<BusinessPackageInput>): Promise<Result<BusinessPackage>> {
  const db = getSupabaseAdmin()
  const updates: Record<string, unknown> = {}
  if (input.name !== undefined) updates.name = input.name
  if (input.category !== undefined) updates.category = input.category
  if (input.description !== undefined) updates.description = input.description
  if (input.target_audience !== undefined) updates.target_audience = input.target_audience
  if (input.highlights !== undefined) updates.highlights = input.highlights
  if (input.budget_range !== undefined) updates.budget_range = input.budget_range
  if (input.cta !== undefined) updates.cta = input.cta
  if (input.landing_page_slug !== undefined) updates.landing_page_slug = input.landing_page_slug
  if (input.pricing_package_id !== undefined) updates.pricing_package_id = input.pricing_package_id
  if (input.proposal_template_notes !== undefined) updates.proposal_template_notes = input.proposal_template_notes
  if (input.ai_prompt !== undefined) updates.ai_prompt = input.ai_prompt
  if (input.hashtags !== undefined) updates.hashtags = input.hashtags
  if (input.recommended_media !== undefined) updates.recommended_media = input.recommended_media
  if (input.recommended_posting_time !== undefined) updates.recommended_posting_time = input.recommended_posting_time
  if (input.whatsapp_template !== undefined) updates.whatsapp_template = input.whatsapp_template
  if (input.email_subject_template !== undefined) updates.email_subject_template = input.email_subject_template
  if (input.email_template !== undefined) updates.email_template = input.email_template
  if (input.follow_up_sequence_id !== undefined) updates.follow_up_sequence_id = input.follow_up_sequence_id
  if (input.marketing_segment !== undefined) updates.marketing_segment = input.marketing_segment
  if (input.status !== undefined) updates.status = input.status

  if (Object.keys(updates).length === 0) return { ok: false, error: 'No fields to update' }

  const { data, error } = await db.from('business_packages').update(updates).eq('id', id).select('*').maybeSingle()
  if (error) {
    if (error.code === UNIQUE_VIOLATION) return { ok: false, error: 'landing_page_slug is already in use by another package' }
    return { ok: false, error: error.message }
  }
  if (!data) return { ok: false, error: 'Package not found' }
  return { ok: true, value: mapRow(data) }
}

/** Activate / deactivate / retire — a plain status transition, never a hard delete (historical proposals/posts that reference this package keep working). */
export async function setBusinessPackageStatus(id: string, status: BusinessPackageStatus): Promise<Result<BusinessPackage>> {
  return updateBusinessPackage(id, { status })
}

// ─────────────────────────────────────────────────────────────────────────────
// Reuse helpers — each delegates to an existing engine; none re-implements one.
// ─────────────────────────────────────────────────────────────────────────────

/** Marketing Segments reuse: resolves the audience this package's stored SegmentFilter matches, via the EXISTING buildSegment() — no second segment engine. */
export async function resolveBusinessPackageAudience(pkg: Pick<BusinessPackage, 'marketingSegment'>) {
  return buildSegment(pkg.marketingSegment ?? {})
}

/**
 * Landing Page reuse: shapes a package row into the exact object
 * src/lib/campaigns/campaign-config.ts's CampaignConfig already is, so
 * /[campaign]/page.tsx can render a DB-driven package through the SAME
 * Landing* components used for the 5 hardcoded campaigns — no second
 * landing-page template.
 */
export interface BusinessPackageCampaignConfig {
  slug: string
  label: string
  intent: string
  leadEventType: string | null
  propertyLabel: null
  venueValue: 'bookmyspaces'
  whatsappNumber: string
  heroHeadline: string
  heroSubheadline: string
  whatsappPrefill: string
  faqs: { question: string; answer: string }[]
}

const DEFAULT_WHATSAPP_NUMBER = '919051459463' // Monurama — same default already used by campaign-config.ts's staycation entry

export function toCampaignConfig(pkg: BusinessPackage): BusinessPackageCampaignConfig | null {
  if (!pkg.landingPageSlug) return null

  // Built only from the package's own real, stored fields — never a
  // fabricated answer (same discipline LandingFAQ's own header comment
  // documents for the 5 hardcoded campaigns).
  const faqs: { question: string; answer: string }[] = []
  if (pkg.highlights.length > 0) {
    faqs.push({ question: `What's included in ${pkg.name}?`, answer: pkg.highlights.join(', ') })
  }
  if (pkg.budgetRange) {
    faqs.push({ question: `What is the budget range for ${pkg.name}?`, answer: `Indicative budget: ${pkg.budgetRange}. Contact us for an exact quote based on your requirements.` })
  }

  return {
    slug: pkg.landingPageSlug,
    label: pkg.name,
    intent: pkg.category ?? pkg.name,
    leadEventType: pkg.category ?? null,
    propertyLabel: null,
    venueValue: 'bookmyspaces',
    whatsappNumber: DEFAULT_WHATSAPP_NUMBER,
    heroHeadline: pkg.name,
    heroSubheadline: pkg.description ?? pkg.targetAudience ?? '',
    whatsappPrefill: pkg.cta || `Hi! I'm interested in ${pkg.name}.`,
    faqs,
  }
}

/** AI Content Generator reuse: {goal, context} ready to hand to generateSocialPostDraft(platform, goal, context) — this module never calls the Anthropic API itself. */
export function buildContentGenerationInput(pkg: BusinessPackage): { goal: string; context: string } {
  const goal = pkg.aiPrompt?.trim() || `Promote our ${pkg.name} package`
  const contextParts = [
    pkg.description ? `Description: ${pkg.description}` : null,
    pkg.targetAudience ? `Target audience: ${pkg.targetAudience}` : null,
    pkg.highlights.length ? `Highlights: ${pkg.highlights.join(', ')}` : null,
    pkg.cta ? `CTA: ${pkg.cta}` : null,
  ].filter((p): p is string => !!p)
  return { goal, context: contextParts.join('\n') }
}

/** WhatsApp reuse: renders this package's stored template with the SAME {{name}} convention drip sequences use — sending stays the caller's responsibility via sendWhatsAppText/enqueueMessage, exactly as every other automation in this codebase. */
export function renderPackageWhatsAppMessage(pkg: Pick<BusinessPackage, 'whatsappTemplate' | 'name'>, leadName: string | null): string | null {
  if (!pkg.whatsappTemplate) return null
  return renderTemplate(pkg.whatsappTemplate, leadName)
}

/** Email reuse: renders subject+body with the same token convention; sending (when needed) reuses the existing sendEmail() (src/lib/email/provider.ts), not a new provider. */
export function renderPackageEmail(pkg: Pick<BusinessPackage, 'emailSubjectTemplate' | 'emailTemplate'>, leadName: string | null): { subject: string; body: string } | null {
  if (!pkg.emailTemplate) return null
  return {
    subject: pkg.emailSubjectTemplate ? renderTemplate(pkg.emailSubjectTemplate, leadName) : '',
    body: renderTemplate(pkg.emailTemplate, leadName),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Analytics — "Business Packages should be the primary entity driving the
// complete customer lifecycle" requires reporting across it. Every number
// below is read from tables that ALREADY exist and are ALREADY the source
// of truth elsewhere in this codebase (leads, proposals, reservations,
// reviews, referral_rewards, ad_spend) — same "fetch once, reduce in JS"
// contract as revenue-intelligence.ts/campaigns.ts, joined here in-memory
// by business_package_id/lead_id rather than N+1 queries. No new tables, no
// second revenue-recognition or booking-count definition: the constant
// below is copied verbatim from campaigns.ts/loyalty.ts's own
// REVENUE_RECOGNIZED_STATUSES (a plain string-set literal, not logic).
// ─────────────────────────────────────────────────────────────────────────────

const REVENUE_RECOGNIZED_STATUSES = new Set(['confirmed', 'checked_in', 'checked_out'])

export interface BusinessPackagePerformance {
  packageId: string
  packageName: string
  status: BusinessPackageStatus
  enquiries: number
  convertedLeads: number
  conversionPct: number
  revenue: number
  spend: number | null
  roi: number | null // (revenue - spend) / spend; null when spend is null or 0 — never fabricated
  // End-to-End Campaign Attribution — same spend/enquiries and spend/bookings
  // formulas as ad-spend-service.ts's withSpendMetrics() (costPerEnquiry/
  // costPerBooking), applied at the package level instead of channel level.
  // Null whenever spend is null (never a fabricated cost).
  costPerLead: number | null
  costPerBooking: number | null
  repeatCustomers: number
  reviewCount: number
  avgRating: number | null
  referralCount: number
  referralsEarned: number
}

interface LeadRow { id: string; business_package_id: string | null }
interface ProposalRow { lead_id: string | null; business_package_id: string | null; status: string | null; accepted_at: string | null; total_price: number | null }
interface ReservationRow { customer_id: string | null; business_package_id: string | null; proposal_id: string | null; status: string | null; final_room_rate: number | null; meal_plan_charge: number | null }
interface ReviewRow { customer_id: string | null; rating: number | null }
interface ReferralRewardRow { referrer_lead_id: string | null; status: string | null }

export async function computeBusinessPackagePerformance(): Promise<BusinessPackagePerformance[]> {
  const db = getSupabaseAdmin()

  const [packagesResult, leadsResult, proposalsResult, reservationsResult, reviewsResult, referralsResult, spendByPackage] = await Promise.all([
    db.from('business_packages').select('id, name, status'),
    db.from('leads').select('id, business_package_id').not('business_package_id', 'is', null),
    db.from('proposals').select('lead_id, business_package_id, status, accepted_at, total_price'),
    db.from('reservations').select('customer_id, business_package_id, proposal_id, status, final_room_rate, meal_plan_charge'),
    db.from('reviews').select('customer_id, rating'),
    db.from('referral_rewards').select('referrer_lead_id, status'),
    getSpendByBusinessPackage(),
  ])

  const packages = (packagesResult.data ?? []) as unknown as Array<{ id: string; name: string; status: BusinessPackageStatus }>
  const leads = (leadsResult.data ?? []) as unknown as LeadRow[]
  const proposals = (proposalsResult.data ?? []) as unknown as ProposalRow[]
  const reservations = (reservationsResult.data ?? []) as unknown as ReservationRow[]
  const reviews = (reviewsResult.data ?? []) as unknown as ReviewRow[]
  const referrals = (referralsResult.data ?? []) as unknown as ReferralRewardRow[]

  // Lead -> package, for joining reviews/referrals (which key on lead_id,
  // not business_package_id directly) back to a package.
  const packageByLead = new Map<string, string>()
  for (const l of leads) if (l.business_package_id) packageByLead.set(l.id, l.business_package_id)

  // Global booking count per lead — same accepted-proposal-OR-revenue-
  // recognized-reservation definition campaigns.ts's computeAdvancedSegmentSets()
  // already established for repeat_customer, not a second one. Counted
  // globally (not per-package) because a lead's total booking history is
  // what makes them a "repeat customer," regardless of which package each
  // individual booking came from.
  const bookingCountByLead = new Map<string, number>()
  for (const p of proposals) {
    if (p.accepted_at && p.lead_id) bookingCountByLead.set(p.lead_id, (bookingCountByLead.get(p.lead_id) ?? 0) + 1)
  }
  for (const r of reservations) {
    if (r.customer_id && r.status && REVENUE_RECOGNIZED_STATUSES.has(r.status)) {
      bookingCountByLead.set(r.customer_id, (bookingCountByLead.get(r.customer_id) ?? 0) + 1)
    }
  }

  const enquiriesByPackage = new Map<string, number>()
  for (const l of leads) if (l.business_package_id) enquiriesByPackage.set(l.business_package_id, (enquiriesByPackage.get(l.business_package_id) ?? 0) + 1)

  const convertedLeadIdsByPackage = new Map<string, Set<string>>()
  const repeatLeadIdsByPackage = new Map<string, Set<string>>()
  for (const l of leads) {
    if (!l.business_package_id) continue
    const bookings = bookingCountByLead.get(l.id) ?? 0
    if (bookings >= 1) {
      if (!convertedLeadIdsByPackage.has(l.business_package_id)) convertedLeadIdsByPackage.set(l.business_package_id, new Set())
      convertedLeadIdsByPackage.get(l.business_package_id)!.add(l.id)
    }
    if (bookings >= 2) {
      if (!repeatLeadIdsByPackage.has(l.business_package_id)) repeatLeadIdsByPackage.set(l.business_package_id, new Set())
      repeatLeadIdsByPackage.get(l.business_package_id)!.add(l.id)
    }
  }

  // Revenue by package — accepted proposals count directly. A reservation
  // only adds its own revenue when it has no proposal_id (a walk-in), same
  // "don't double-count a proposal's revenue via its own resulting
  // reservation" rule campaigns.ts's CLV calculation already applies.
  const revenueByPackage = new Map<string, number>()
  // Cost per Booking — counts the exact same revenue-generating events as
  // revenueByPackage above (one accepted proposal or one walk-in reservation
  // = one booking), so spend / bookingsByPackage is spend per real booking,
  // not per lead.
  const bookingsByPackage = new Map<string, number>()
  for (const p of proposals) {
    if (p.accepted_at && p.business_package_id) {
      revenueByPackage.set(p.business_package_id, (revenueByPackage.get(p.business_package_id) ?? 0) + (Number(p.total_price) || 0))
      bookingsByPackage.set(p.business_package_id, (bookingsByPackage.get(p.business_package_id) ?? 0) + 1)
    }
  }
  for (const r of reservations) {
    if (r.business_package_id && r.proposal_id === null && r.status && REVENUE_RECOGNIZED_STATUSES.has(r.status)) {
      const revenue = (Number(r.final_room_rate) || 0) + (Number(r.meal_plan_charge) || 0)
      revenueByPackage.set(r.business_package_id, (revenueByPackage.get(r.business_package_id) ?? 0) + revenue)
      bookingsByPackage.set(r.business_package_id, (bookingsByPackage.get(r.business_package_id) ?? 0) + 1)
    }
  }

  const reviewStatsByPackage = new Map<string, { count: number; ratingSum: number; ratingCount: number }>()
  for (const rev of reviews) {
    const packageId = rev.customer_id ? packageByLead.get(rev.customer_id) : undefined
    if (!packageId) continue
    if (!reviewStatsByPackage.has(packageId)) reviewStatsByPackage.set(packageId, { count: 0, ratingSum: 0, ratingCount: 0 })
    const stats = reviewStatsByPackage.get(packageId)!
    stats.count++
    if (rev.rating !== null) { stats.ratingSum += rev.rating; stats.ratingCount++ }
  }

  const referralStatsByPackage = new Map<string, { total: number; earned: number }>()
  for (const ref of referrals) {
    const packageId = ref.referrer_lead_id ? packageByLead.get(ref.referrer_lead_id) : undefined
    if (!packageId) continue
    if (!referralStatsByPackage.has(packageId)) referralStatsByPackage.set(packageId, { total: 0, earned: 0 })
    const stats = referralStatsByPackage.get(packageId)!
    stats.total++
    if (ref.status === 'earned' || ref.status === 'redeemed') stats.earned++
  }

  return packages.map((pkg) => {
    const enquiries = enquiriesByPackage.get(pkg.id) ?? 0
    const convertedLeads = convertedLeadIdsByPackage.get(pkg.id)?.size ?? 0
    const revenue = revenueByPackage.get(pkg.id) ?? 0
    const spend = spendByPackage.get(pkg.id) ?? null
    const bookings = bookingsByPackage.get(pkg.id) ?? 0
    const reviewStats = reviewStatsByPackage.get(pkg.id)
    const referralStats = referralStatsByPackage.get(pkg.id)

    return {
      packageId: pkg.id,
      packageName: pkg.name,
      status: pkg.status,
      enquiries,
      convertedLeads,
      conversionPct: enquiries > 0 ? Math.round((convertedLeads / enquiries) * 1000) / 10 : 0,
      revenue,
      spend,
      roi: spend != null && spend > 0 ? Math.round(((revenue - spend) / spend) * 1000) / 1000 : null,
      costPerLead: spend != null && enquiries > 0 ? Math.round((spend / enquiries) * 100) / 100 : null,
      costPerBooking: spend != null && bookings > 0 ? Math.round((spend / bookings) * 100) / 100 : null,
      repeatCustomers: repeatLeadIdsByPackage.get(pkg.id)?.size ?? 0,
      reviewCount: reviewStats?.count ?? 0,
      avgRating: reviewStats && reviewStats.ratingCount > 0 ? Math.round((reviewStats.ratingSum / reviewStats.ratingCount) * 10) / 10 : null,
      referralCount: referralStats?.total ?? 0,
      referralsEarned: referralStats?.earned ?? 0,
    }
  })
}
