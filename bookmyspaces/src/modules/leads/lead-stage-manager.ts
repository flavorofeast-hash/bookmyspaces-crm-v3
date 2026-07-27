// src/modules/leads/lead-stage-manager.ts
// Manages lead lifecycle stage transitions.
// All writes go through this module — never patch lead_stage directly.
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabaseAdmin } from '@/lib/supabase';
import { logger } from '@/lib/logger';
import {
  LeadStage,
  LEAD_STAGES,
  VALID_TRANSITIONS,
  Lead,
} from './types';

// ─── Validation helpers ───────────────────────────────────────────────────────

export function isValidStage(value: unknown): value is LeadStage {
  return typeof value === 'string' && (LEAD_STAGES as readonly string[]).includes(value);
}

export function canTransition(from: LeadStage | null, to: LeadStage): boolean {
  // From NULL (not yet set) — any stage is allowed as first assignment
  if (from === null) return true;
  const allowed = VALID_TRANSITIONS[from];
  return allowed.includes(to);
}

export function isTerminalStage(stage: LeadStage): boolean {
  return stage === 'CONFIRMED';
}

// ─── Stale stage detection ────────────────────────────────────────────────────

const STALE_THRESHOLDS_HOURS: Record<LeadStage, number> = {
  NEW             : 24,
  CONTACTED       : 48,
  QUALIFIED       : 72,
  NEGOTIATING     : 96,
  PROPOSAL_SENT   : 72,
  VISIT_SCHEDULED : 48,
  CONFIRMED       : Infinity,
  LOST            : Infinity,
};

export function isStale(lead: Pick<Lead, 'lead_stage' | 'last_contacted_at' | 'created_at'>): boolean {
  const stage = lead.lead_stage;
  if (!stage) return false;
  if (stage === 'CONFIRMED' || stage === 'LOST') return false;

  const threshold = STALE_THRESHOLDS_HOURS[stage];
  const referenceTime = lead.last_contacted_at ?? lead.created_at;
  const hoursElapsed =
    (Date.now() - new Date(referenceTime).getTime()) / (1000 * 60 * 60);

  return hoursElapsed > threshold;
}

// ─── Stage transition ─────────────────────────────────────────────────────────

interface TransitionOptions {
  leadId       : string;
  toStage      : LeadStage;
  reason      ?: string;
  performedBy ?: string;
  force       ?: boolean;  // skip validation — admin override only
}

interface TransitionResult {
  success      : boolean;
  previousStage: LeadStage | null;
  newStage     : LeadStage | null;
  error        : string | null;
}

export async function transitionStage({
  leadId,
  toStage,
  reason      = 'system',
  performedBy = 'system',
  force       = false,
}: TransitionOptions): Promise<TransitionResult> {
  const db = getSupabaseAdmin();

  try {
    // 1. Fetch current stage
    const { data: lead, error: fetchErr } = await db
      .from('leads')
      .select('id, lead_stage')
      .eq('id', leadId)
      .single();

    if (fetchErr || !lead) {
      return { success: false, previousStage: null, newStage: null, error: fetchErr?.message ?? 'Lead not found' };
    }

    const fromStage = isValidStage(lead.lead_stage) ? lead.lead_stage : null;

    // 2. Validate transition
    if (!force && !canTransition(fromStage, toStage)) {
      return {
        success      : false,
        previousStage: fromStage,
        newStage     : null,
        error        : `Invalid transition: ${fromStage ?? 'null'} → ${toStage}`,
      };
    }

    // 3. Apply stage update
    const { error: updateErr } = await db
      .from('leads')
      .update({ lead_stage: toStage, updated_at: new Date().toISOString() })
      .eq('id', leadId);

    if (updateErr) {
      return { success: false, previousStage: fromStage, newStage: null, error: updateErr.message };
    }

    // 4. Write audit trail — non-fatal: a missing/failing stage_transitions table
    // must never roll back a successful lead_stage update.
    try {
      await db.from('stage_transitions').insert({
        lead_id     : leadId,
        from_stage  : fromStage,
        to_stage    : toStage,
        reason,
        performed_by: performedBy,
        metadata    : { forced: force },
      });
    } catch (auditErr: unknown) {
      logger.warn('lead-stage-manager', 'Audit log failed (stage update already applied)', { leadId, error: auditErr instanceof Error ? auditErr.message : String(auditErr) });
    }

    return { success: true, previousStage: fromStage, newStage: toStage, error: null };

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, previousStage: null, newStage: null, error: msg };
  }
}

// ─── Auto-stage logic ─────────────────────────────────────────────────────────
// Called from webhook after scoring. Advances stage automatically based on rules.

export async function autoAdvanceStage(
  lead: Pick<Lead, 'id' | 'lead_stage' | 'ai_score' | 'estimated_revenue' | 'status'>
): Promise<void> {
  const currentStage = isValidStage(lead.lead_stage) ? lead.lead_stage : null;
  const score = lead.ai_score ?? 0;

  let targetStage: LeadStage | null = null;
  let reason = '';

  // Rule: high score → QUALIFIED
  // Fires when stage is null (not yet set), NEW, or CONTACTED.
  // null is explicitly included because lead_stage may not be in the webhook SELECT —
  // a missing/unset stage with a high score should still be auto-qualified.
  const isEarlyStage = currentStage === null || currentStage === 'NEW' || currentStage === 'CONTACTED';
  if (score >= 80 && isEarlyStage) {
    targetStage = 'QUALIFIED';
    reason = `Auto-qualified: ai_score ${score} ≥ 80`;
  }

  // Rule: existing CRM status → map to stage if no high-score rule already fired
  // Only bootstraps if we do not already have a better target from scoring.
  if (!targetStage && !currentStage) {
    const statusStageMap: Record<string, LeadStage> = {
      new_inquiry      : 'NEW',
      followup_pending : 'CONTACTED',
      proposal_sent    : 'PROPOSAL_SENT',
      negotiation      : 'NEGOTIATING',
      confirmed        : 'CONFIRMED',
      rejected         : 'LOST',
      future_prospect  : 'NEW',
    };
    const mapped = statusStageMap[lead.status];
    if (mapped) {
      targetStage = mapped;
      reason = `Bootstrapped from status: ${lead.status}`;
    }
  }

  if (!targetStage) return;
  if (targetStage === currentStage) return;

  // Score-based qualification is a system-level override — bypass transition
  // validation because the scoring rule is authoritative regardless of what
  // prior stage value the DB column holds (including null from un-run migrations).
  const isScoreQualification = targetStage === 'QUALIFIED' && (lead.ai_score ?? 0) >= 80;

  const result = await transitionStage({
    leadId  : lead.id,
    toStage : targetStage,
    reason,
    force   : isScoreQualification,
  });

  if (!result.success) {
    logger.warn('lead-stage-manager', 'Auto-advance failed', { leadId: lead.id, error: result.error });
  } else {
    logger.info('lead-stage-manager', `Auto-advanced ${result.previousStage} -> ${result.newStage}`, { leadId: lead.id });
  }
}
