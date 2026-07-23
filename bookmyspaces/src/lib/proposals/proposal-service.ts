// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/proposals/proposal-service.ts
// V3 Day 4 — Priority 6: Proposal Integration.
//
// `src/app/api/proposals/route.ts` (LIVE) already creates/reads/updates
// `proposals` rows directly via free-text fields (venue, package_name).
// This file does not replace or duplicate that route's logic — it adds the
// one thing that didn't exist: a path from the new Reservation Platform
// (Property/Inventory/Reservation/Pricing Engine, migrations 012-013) INTO
// a proposal, using the exact same `proposals` column shape the existing
// route already writes (client_name/phone/email, event_type, venue,
// package_name, base_price, total_price, etc.), just also populating
// migration 013's new FK columns.
//
// linkProposalToReservation() is the minimal operation for the reverse
// case: an existing proposal (created the old way) gets connected to a
// reservation after the fact.
//
// NOT LIVE-TESTABLE for the reservation-sourced path (reads `reservations`,
// `properties`, `inventory_items` — migration 012, not applied). Reads/
// writes to `proposals` itself are against the LIVE table.
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabaseAdmin } from '@/lib/supabase'
import { calculatePrice } from '@/lib/reservations/reservation-workflow'
import { resolveIdentity } from '@/lib/identity/resolve-identity'
import { normalizePhone } from '@/lib/whatsapp/normalize-phone'
import { logger } from '@/lib/logger'

export interface ProposalReservationLinks {
  propertyId?: string | null
  inventoryItemId?: string | null
  reservationId?: string | null
  packageId?: string | null
  addonServiceIds?: string[]
}

export type LinkProposalResult =
  | { ok: true; proposalId: string }
  | { ok: false; error: 'not_found' }
  | { ok: false; error: 'db_error'; message: string }

/**
 * Sets migration 013's FK columns on an existing proposal. Purely additive
 * — never touches any of the proposal's original free-text fields.
 */
export async function linkProposalToReservation(
  proposalId: string,
  links: ProposalReservationLinks
): Promise<LinkProposalResult> {
  const supabase = getSupabaseAdmin()

  const { data, error } = await supabase
    .from('proposals')
    .update({
      property_id: links.propertyId ?? null,
      inventory_item_id: links.inventoryItemId ?? null,
      reservation_id: links.reservationId ?? null,
      package_id: links.packageId ?? null,
      addon_service_ids: links.addonServiceIds ?? [],
    })
    .eq('id', proposalId)
    .select('id')
    .maybeSingle()

  if (error) return { ok: false, error: 'db_error', message: error.message }
  if (!data) return { ok: false, error: 'not_found' }

  return { ok: true, proposalId: data.id }
}

export interface CreateProposalFromReservationInput {
  reservationId: string
  leadId: string | null
  clientName: string
  clientPhone: string | null
  clientEmail: string | null
  propertyId: string
  inventoryItemId: string
  checkInDate: string
  checkOutDate: string
  guestCount: number
  packageName: string | null
  packageId?: string | null
  addonServiceIds?: string[]
  addons?: Array<{ name: string; price: number }>
  specialRequirements?: string | null
}

export type CreateProposalResult =
  | { ok: true; proposalId: string; proposalNumber: string | null; totalPrice: number }
  | { ok: false; error: 'db_error'; message: string }

/**
 * Builds a proposal from an existing reservation, pricing it via
 * src/lib/reservations/reservation-workflow.ts's calculatePrice() (the same
 * Pricing Engine every other reservation operation uses — no separate
 * pricing logic here) and writing it with the same column shape
 * src/app/api/proposals/route.ts's POST handler already uses, plus
 * migration 013's new links.
 */
export async function createProposalFromReservation(
  input: CreateProposalFromReservationInput
): Promise<CreateProposalResult> {
  const quote = await calculatePrice(input.inventoryItemId, input.checkInDate, input.checkOutDate)
  const addonsTotal = (input.addons ?? []).reduce((sum, a) => sum + (Number(a.price) || 0), 0)
  const totalPrice = quote.subtotal + addonsTotal

  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('proposals')
    .insert({
      lead_id: input.leadId,
      client_name: input.clientName,
      client_phone: input.clientPhone,
      client_email: input.clientEmail,
      event_date: input.checkInDate,
      guest_count: input.guestCount,
      package_name: input.packageName,
      base_price: quote.subtotal,
      addons: input.addons ?? [],
      total_price: totalPrice,
      special_requirements: input.specialRequirements ?? null,
      status: 'draft',
      property_id: input.propertyId,
      inventory_item_id: input.inventoryItemId,
      reservation_id: input.reservationId,
      package_id: input.packageId ?? null,
      addon_service_ids: input.addonServiceIds ?? [],
    })
    .select('id, proposal_number')
    .single()

  if (error || !data) {
    return { ok: false, error: 'db_error', message: error?.message ?? 'Unknown error creating proposal' }
  }

  return { ok: true, proposalId: data.id, proposalNumber: data.proposal_number, totalPrice }
}


// ─── ensureLeadForProposal (fix/customer-proposal-sync) ─────────────────────
// ROOT CAUSE this addresses: POST /api/proposals accepted lead_id: null and
// created "orphan" proposals carrying only free-text client_* columns. The
// Customers module IS the leads table (Product Owner decision 2026-07-13,
// migration 012 header) — so an orphan proposal's customer is invisible in
// Customers, and email sends fail when client_email was also left blank.
//
// This function guarantees every proposal gets a lead: resolve an existing
// lead by phone/email via the standard resolver (same canonical phone
// normalization as every other channel), else create a minimal lead from
// the proposal's client fields. Returns null ONLY on unexpected DB failure —
// callers degrade to the old lead_id:null behavior rather than blocking
// proposal creation (a proposal without a customer link beats no proposal).

export interface EnsureLeadForProposalInput {
  name: string
  phone?: string | null
  email?: string | null
}

export interface EnsureLeadForProposalResult {
  leadId: string
  created: boolean
  matchedOn: 'phone' | 'email' | null
}

export async function ensureLeadForProposal(
  input: EnsureLeadForProposalInput
): Promise<EnsureLeadForProposalResult | null> {
  try {
    // 1. Try to match an existing lead on phone/email (canonicalized).
    if (input.phone?.trim() || input.email?.trim()) {
      const identity = await resolveIdentity({
        phone: input.phone ?? undefined,
        email: input.email ?? undefined,
      })
      if (identity) {
        return { leadId: identity.leadId, created: false, matchedOn: identity.matchedOn }
      }
    }

    // 2. No match — create a minimal lead so the customer exists in the CRM.
    const supabase = getSupabaseAdmin()
    const { data, error } = await supabase
      .from('leads')
      .insert({
        name  : input.name.trim() || null,
        phone : input.phone?.trim() ? normalizePhone(input.phone) : null,
        email : input.email?.trim() ? input.email.trim().toLowerCase() : null,
        source: 'proposal',
        status: 'new_inquiry',
      })
      .select('id')
      .single()

    if (error || !data?.id) {
      logger.error('proposal-service', 'ensureLeadForProposal insert failed', error)
      return null
    }
    return { leadId: data.id, created: true, matchedOn: null }
  } catch (err) {
    logger.error('proposal-service', 'ensureLeadForProposal threw', err)
    return null
  }
}
