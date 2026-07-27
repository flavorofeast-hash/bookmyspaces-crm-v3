// src/modules/automation/escalation-engine.ts
// Determines when a lead requires human intervention.
// Called from webhook after scoring. Writes to leads.escalation_required.
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabaseAdmin } from '@/lib/supabase';
import { logger } from '@/lib/logger';
import { Lead, EscalationResult } from '../leads/types';

// ─── Escalation rules ─────────────────────────────────────────────────────────

interface EscalationRule {
  name   : string;
  check  : (lead: Partial<Lead>) => boolean;
  reason : string;
}

const ESCALATION_RULES: EscalationRule[] = [
  {
    name  : 'very_high_value',
    check : (l) => (l.ai_score ?? 0) >= 90 && (l.estimated_revenue ?? 0) >= 300_000,
    reason: 'AI score ≥ 90 and estimated revenue ≥ ₹3L — high-value lead requiring personal attention',
  },
  {
    name  : 'vip_event',
    check : (l) => (l.tags ?? []).includes('VIP'),
    reason: 'VIP lead — requires direct owner/manager handling',
  },
  {
    name  : 'large_corporate',
    check : (l) =>
      l.event_type?.toLowerCase().includes('corporate') === true &&
      (l.guest_count ?? 0) >= 80,
    reason: 'Large corporate event (80+ guests) — requires custom proposal and human follow-up',
  },
  {
    name  : 'stale_hot_lead',
    check : (l) => {
      if (l.lead_temperature !== 'HOT') return false;
      if (!l.last_contacted_at) return false;
      const hoursElapsed =
        (Date.now() - new Date(l.last_contacted_at).getTime()) / (1000 * 60 * 60);
      return hoursElapsed > 12;
    },
    reason: 'HOT lead with no contact in 12+ hours — may be losing interest',
  },
  {
    name  : 'negotiation_stale',
    check : (l) => {
      if (l.lead_stage !== 'NEGOTIATING') return false;
      if (!l.last_contacted_at) return false;
      const hoursElapsed =
        (Date.now() - new Date(l.last_contacted_at).getTime()) / (1000 * 60 * 60);
      return hoursElapsed > 48;
    },
    reason: 'Lead in NEGOTIATING stage with no contact in 48+ hours — requires human follow-up',
  },
  {
    name  : 'high_score_no_stage',
    check : (l) => (l.ai_score ?? 0) >= 75 && !l.lead_stage,
    reason: 'High-scoring lead with no stage assignment — needs qualification call',
  },
];

// ─── Evaluate a lead ──────────────────────────────────────────────────────────

export function evaluateEscalation(lead: Partial<Lead>): EscalationResult {
  for (const rule of ESCALATION_RULES) {
    try {
      if (rule.check(lead)) {
        return {
          escalated: true,
          reason   : `[${rule.name}] ${rule.reason}`,
          notified : false,
        };
      }
    } catch {
      // Rule evaluation error — skip this rule, continue checking others
    }
  }
  return { escalated: false, reason: null, notified: false };
}

// ─── Apply escalation to DB ───────────────────────────────────────────────────

export async function applyEscalation(
  leadId: string,
  lead  : Partial<Lead>
): Promise<EscalationResult> {
  const result = evaluateEscalation(lead);

  if (!result.escalated) return result;

  const db = getSupabaseAdmin();

  const { error } = await db
    .from('leads')
    .update({
      escalation_required: true,
      updated_at         : new Date().toISOString(),
    })
    .eq('id', leadId)
    .eq('escalation_required', false);  // only update if not already escalated

  if (error) {
    logger.error('escalation-engine', 'Failed to write escalation', error, { leadId });
    return { ...result, notified: false };
  }

  logger.info('escalation-engine', `Lead escalated: ${result.reason}`, { leadId });

  // Write activity log
  await db.from('activity_logs').insert({
    lead_id    : leadId,
    action     : 'escalation_triggered',
    description: result.reason ?? 'Escalation triggered',
    channel    : 'system',
    metadata   : { rules_checked: ESCALATION_RULES.length },
  });

  return { ...result, notified: true };
}
