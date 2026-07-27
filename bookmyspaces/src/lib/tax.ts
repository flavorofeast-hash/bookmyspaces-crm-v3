// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/tax.ts
// Priority 3 (Taxes) — Autonomous Implementation session.
//
// WHY THIS EXISTS: `invoices.tax_amount` (migration 009, live) has existed
// since that table was created but no code path has ever set it to anything
// other than 0 — confirmed by reading src/app/api/proposals/[id]/invoice/
// route.ts, the only place an invoice row is ever inserted. This file is the
// single source of truth for tax computation, so any future invoice-writing
// path (this route today; a future reservation-direct invoice path later)
// computes tax the same way once, not reimplemented per caller.
//
// A DELIBERATE, DOCUMENTED ASSUMPTION — flagged, not silently made:
// `proposal.total_price` (and by extension `reservations.final_room_rate` +
// `meal_plan_charge`) has never included a separate tax component anywhere
// in this codebase; every price shown to a customer today (package prices,
// room rates, add-on prices) is a single flat number with no tax line. The
// only reasonable interpretation consistent with "preserve backward
// compatibility" is that these are TAX-INCLUSIVE prices — the customer's
// total amount owed does not change when tax is turned on, this module only
// SPLITS that already-agreed total into a base + tax component for GST-
// compliant display on the invoice. If the business intends prices to be
// tax-EXCLUSIVE (tax added on top, increasing what the customer owes), that
// is a genuine pricing-policy change requiring an explicit decision — do not
// change this module's inclusive-split behavior without that decision being
// made explicitly, since it would silently change customer-facing totals.
//
// THE RATE ITSELF IS A BUSINESS/COMPLIANCE DECISION, NOT AN ENGINEERING ONE:
// India hotel-industry GST slabs are tariff-dependent and have changed more
// than once in recent years; this codebase has no live per-property or
// per-package tax-rate field to read (properties.gst_number exists in
// migration 012 but that migration is not yet applied, and even once it is,
// a GST *number* is not a GST *rate*). Rather than hardcode a specific
// percentage, the rate is read from an environment variable, defaulting to
// 0% — i.e., invoices behave exactly as they do today (tax_amount = 0) until
// someone with the authority to set tax policy configures a real rate.
//
// NOT IMPLEMENTED HERE, AND DELIBERATELY SO: a fully GST-compliant tax
// invoice in India typically requires a CGST/SGST vs. IGST split (intra- vs.
// inter-state supply), HSN/SAC codes, and the supplier's GSTIN displayed in
// a specific format — none of which this module or the invoice HTML
// template attempt. This module computes and displays a single flat "GST"
// line, which is enough to make `tax_amount` meaningful instead of always
// zero, but is NOT a claim of full statutory GST-invoice compliance. Treat
// full compliance as a follow-up decision for whoever owns tax filing for
// this business, not something inferred from the repository.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The configured flat tax rate, as a percentage (e.g. 12 for 12%). Reads
 * `DEFAULT_TAX_RATE_PERCENT` from the environment; defaults to 0 (no tax —
 * today's existing behavior, unchanged) if unset, unparseable, or out of the
 * sane 0-100 range.
 */
export function getTaxRatePercent(): number {
  const raw = process.env.DEFAULT_TAX_RATE_PERCENT
  if (!raw) return 0

  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) return 0

  return parsed
}

export interface TaxSplit {
  /** The customer's total, unchanged from what was already agreed (e.g. proposal.total_price). */
  totalAmount: number
  /** totalAmount with tax removed — what the business actually earns before tax. */
  baseAmount: number
  /** The tax component of totalAmount. 0 when no rate is configured. */
  taxAmount: number
  /** The rate used to compute this split, for display/audit purposes. */
  ratePercent: number
}

/**
 * Splits an already-agreed, tax-inclusive total into base + tax components
 * at the configured rate. Never changes `totalAmount` — see the file header
 * for why that invariant matters (customer-facing amount owed must not
 * silently change when tax reporting is turned on).
 */
export function splitInclusiveTax(totalAmount: number, ratePercent: number = getTaxRatePercent()): TaxSplit {
  const total = Number(totalAmount) || 0

  if (ratePercent <= 0) {
    return { totalAmount: total, baseAmount: total, taxAmount: 0, ratePercent: 0 }
  }

  const baseAmount = total / (1 + ratePercent / 100)
  const taxAmount = total - baseAmount

  return {
    totalAmount: total,
    baseAmount: Math.round(baseAmount * 100) / 100,
    taxAmount: Math.round(taxAmount * 100) / 100,
    ratePercent,
  }
}
