// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/tax.ts
// Priority 3 (Taxes) — Autonomous Implementation session.
// GST/Billing rework — this pass.
//
// getTaxRatePercent()/DEFAULT_TAX_RATE_PERCENT (below) is UNCHANGED and
// serves an unrelated, pre-existing concern: src/lib/packages/
// package-service.ts's per-package `taxRatePct` display metadata. Left
// exactly as-is; not part of this change.
//
// calculateGst() is NEW and is the single source of truth for the final-
// billing GST calculation (src/app/api/proposals/[id]/invoice/route.ts).
// It deliberately REVERSES the tax model the old splitInclusiveTax() used:
//
//   OLD (removed): totalAmount was treated as tax-INCLUSIVE — GST was
//   split out of an already-agreed total, so turning tax on never changed
//   what the customer owed. That was an explicit, documented stand-in
//   because no business rule for real GST had been given at the time.
//
//   NEW: GST is tax-EXCLUSIVE, added ON TOP of the service value, exactly
//   as specified: "Final Service Value ₹50,000 + CGST/SGST @ 2.5% each =
//   Gross ₹52,500". This is the explicit business/tax decision the old
//   file's header said was required before changing the model — it has now
//   been given. Advance payments/receipts never call this function at all;
//   they have no GST concept by design (see the invoice route and
//   src/app/api/proposals/[id]/receipt/route.ts).
//
// CGST+SGST vs IGST: GST_RATE is split evenly into CGST+SGST for intra-
// state supply, or charged wholly as IGST for inter-state supply. The
// caller (the invoice route, driven by a user selection at final-billing
// time) decides which applies — this module only computes the numbers.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The configured flat tax rate, as a percentage (e.g. 12 for 12%). Reads
 * `DEFAULT_TAX_RATE_PERCENT` from the environment; defaults to 0 (no tax)
 * if unset, unparseable, or out of the sane 0-100 range.
 *
 * Unrelated to the GST billing flow below — this is package-service.ts's
 * per-package tax-rate display metadata, left untouched.
 */
export function getTaxRatePercent(): number {
  const raw = process.env.DEFAULT_TAX_RATE_PERCENT
  if (!raw) return 0

  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) return 0

  return parsed
}

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100
}

export interface GstBreakdown {
  /** The pre-tax service value GST was calculated on. */
  baseAmount: number
  /** The rate actually used for this calculation (0 for NON_GST). */
  ratePercent: number
  /** Whether IGST (true) or CGST+SGST (false) applies. Meaningless when ratePercent is 0. */
  isInterState: boolean
  cgstAmount: number
  sgstAmount: number
  igstAmount: number
  /** cgstAmount + sgstAmount + igstAmount. */
  taxAmount: number
  /** baseAmount + taxAmount — the amount actually payable before deducting any advance. */
  grossAmount: number
}

/**
 * Computes GST on top of a tax-exclusive base amount. Pass `ratePercent: 0`
 * for a NON_GST final invoice — every field comes back zeroed except
 * `grossAmount`, which equals `baseAmount` unchanged, so the same function
 * covers both tax modes without a separate branch.
 *
 * Never mutates or reinterprets `baseAmount` itself — GST is always added
 * on top, matching the explicit "Final Service Value + GST = Gross" rule.
 */
export function calculateGst(baseAmount: number, ratePercent: number, isInterState: boolean): GstBreakdown {
  const base = Number(baseAmount) || 0
  const rate = Number(ratePercent) || 0

  if (rate <= 0) {
    return {
      baseAmount: base, ratePercent: 0, isInterState,
      cgstAmount: 0, sgstAmount: 0, igstAmount: 0,
      taxAmount: 0, grossAmount: base,
    }
  }

  const taxAmount = round2(base * rate / 100)
  let cgstAmount = 0
  let sgstAmount = 0
  let igstAmount = 0

  if (isInterState) {
    igstAmount = taxAmount
  } else {
    // Split evenly (rate/2 each); sgstAmount takes the remainder so
    // cgstAmount + sgstAmount always sums exactly to taxAmount even after
    // independent rounding of each half.
    cgstAmount = round2(base * (rate / 2) / 100)
    sgstAmount = round2(taxAmount - cgstAmount)
  }

  return {
    baseAmount: base, ratePercent: rate, isInterState,
    cgstAmount, sgstAmount, igstAmount,
    taxAmount, grossAmount: round2(base + taxAmount),
  }
}
