// ⚠️ DEPRECATED — DEAD CODE, CONFIRMED UNREFERENCED (Production
// Stabilization, Priority 3, verified via repo-wide grep before this note
// was added: zero `import` statements anywhere in src/). Never wired to
// any live route or cron. Superseded by the AI Follow-up Assistant,
// Marketing Automations, and WhatsApp Drip Sequences — see
// src/modules/followups/followup-rules.ts's deprecation note (same
// module, same history) for the full explanation, and
// src/lib/messaging/orchestrator.ts for the shared coordination layer that
// now governs all three live systems. Could not be deleted in this
// environment (no file-delete permission on the mounted repo) — safe to
// remove entirely in a follow-up change; do not import from it.
export function getFollowUpCadence(
  temperature: 'HOT' | 'WARM' | 'COLD',
  followUpCount: number
): number | null {
  const cadenceMap = {
    HOT: [2, 12, 24],
    WARM: [24, 72],
    COLD: [168], // 7 days
  }

  const cadence =
    cadenceMap[temperature][followUpCount]

  return cadence ?? null
}