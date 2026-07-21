// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/audit-log.ts
// V3 — queryable audit trail for privileged actions (migration 015,
// VERSION1_1 Tier 1 #4). Fire-and-forget by design: an audit-write failure
// is logged but never fails the action it describes (the action already
// has structured app logs as the fallback trail).
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabaseAdmin } from '@/lib/supabase'
import { logger } from '@/lib/logger'

export function auditLog(input: {
  actor: string
  action: string
  entityType?: string
  entityId?: string
  detail?: Record<string, unknown>
}): void {
  Promise.resolve(
    getSupabaseAdmin().from('admin_audit_log').insert({
      actor: input.actor,
      action: input.action,
      entity_type: input.entityType ?? null,
      entity_id: input.entityId ?? null,
      detail: input.detail ?? {},
    })
  ).then(({ error }) => {
    if (error) logger.warn('audit', `audit write failed for ${input.action}`, { error: error.message })
  }).catch(() => {})
}
