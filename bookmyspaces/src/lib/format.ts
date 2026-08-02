// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/format.ts
// Lead Workspace v1 — extraction, not new logic. `fmtINR` and `fmtDate` were
// previously defined identically (byte-for-byte) inside
// src/app/(crm)/customers/[id]/page.tsx, and dashboard/leads/[id]/page.tsx
// already had its own identical `fmtDate`. Centralized here so every CRM
// screen that needs them (Customer Profile, Lead Workspace, and the new
// src/components/leads/* components) imports one implementation instead of
// redeclaring it. Behavior is unchanged — this is a pure extraction.
//
// `fmtDateTime` is deliberately NOT centralized here: the two existing
// call sites format it differently (Customer Profile's Timeline omits the
// year; Lead Details' record fields include it) and unifying them would
// change visible output, which the task rules for this pass explicitly
// prohibit ("preserve behaviour exactly"). Each stays local to its own
// component/page.
// ─────────────────────────────────────────────────────────────────────────────

export function fmtINR(n: number | null | undefined): string {
  if (!n) return '₹0'
  return '₹' + Number(n).toLocaleString('en-IN')
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
  } catch {
    return iso
  }
}
