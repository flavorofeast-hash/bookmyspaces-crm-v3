// src/app/api/dashboard/stats/route.ts
// GET /api/dashboard/stats
// Returns aggregated pipeline stats for the sales dashboard.
// Uses direct table queries with fallbacks — safe even if Phase 2 migration
// (009_phase2_sales_layer.sql) has not been run yet.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { DashboardSummary } from '@/modules/leads/types';
import { requireAuth } from '@/lib/auth-guard';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

// Explicit local type for the fields we SELECT — prevents GenericStringError inference
interface LeadStatsRow {
  id                : string;
  lead_temperature  : string | null;
  lead_stage        : string | null;
  escalation_required: boolean | null;
  estimated_revenue : number | null;
  last_contacted_at : string | null;
  created_at        : string;
  next_follow_up_at : string | null;
  ai_score          : number | null;
  whatsapp_opted_in : boolean | null;
}

export async function GET(): Promise<NextResponse> {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  try {
    const db = getSupabaseAdmin();

    // Fetch all leads in one query — derive all stats client-side.
    // This avoids any dependency on Phase 2 views (pipeline_summary,
    // stale_hot_leads_view, followup_due_view) which may not exist yet.
    const { data, error } = await db
      .from('leads')
      .select(
        'id, lead_temperature, lead_stage, escalation_required, ' +
        'estimated_revenue, last_contacted_at, created_at, ' +
        'next_follow_up_at, ai_score, whatsapp_opted_in'
      );

    if (error) {
      logger.error('dashboard-stats', 'Supabase error', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Cast through unknown → LeadStatsRow[] so TS uses our explicit field types
    // rather than inferring GenericStringError from the untyped Supabase client.
    const rows = (data ?? []) as unknown as LeadStatsRow[];
    const now  = Date.now();

    // Derived counts
    const totalLeads          = rows.length;
    const hotLeads            = rows.filter((r) => r.lead_temperature === 'HOT').length;
    const escalationsPending  = rows.filter((r) => r.escalation_required && r.lead_stage !== 'CONFIRMED').length;
    const confirmedLeads      = rows.filter((r) => r.lead_stage === 'CONFIRMED');
    const confirmedRevenue    = confirmedLeads.reduce((s, r) => s + (r.estimated_revenue ?? 0), 0);
    const totalPipelineValue  = rows.reduce((s, r) => s + (r.estimated_revenue ?? 0), 0);
    const conversionRate      = totalLeads > 0
      ? Math.round((confirmedLeads.length / totalLeads) * 100)
      : 0;

    // Stale HOT leads: HOT + last_contacted_at > 4 hours ago
    const staleHotLeads = rows.filter((r) => {
      if (r.lead_temperature !== 'HOT') return false;
      if (r.lead_stage === 'CONFIRMED' || r.lead_stage === 'LOST') return false;
      const ref = r.last_contacted_at ?? r.created_at;
      return ref && (now - new Date(ref).getTime()) > 4 * 3_600_000;
    }).length;

    // Follow-ups due: next_follow_up_at is in the past
    const followUpsDue = rows.filter((r) =>
      r.next_follow_up_at && new Date(r.next_follow_up_at).getTime() <= now
    ).length;

    // Pipeline breakdown by stage
    const STAGES = ['NEW','CONTACTED','QUALIFIED','NEGOTIATING','PROPOSAL_SENT','VISIT_SCHEDULED','CONFIRMED','LOST'] as const;
    const pipeline = STAGES.map((stage) => {
      const stageRows = rows.filter((r) => r.lead_stage === stage);
      return {
        lead_stage          : stage,
        lead_temperature    : null,
        lead_count          : stageRows.length,
        avg_score           : stageRows.length > 0
          ? Math.round(stageRows.reduce((s, r) => s + (r.ai_score ?? 0), 0) / stageRows.length * 10) / 10
          : 0,
        total_pipeline_value: stageRows.reduce((s, r) => s + (r.estimated_revenue ?? 0), 0),
        escalation_count    : stageRows.filter((r) => r.escalation_required).length,
        new_today           : stageRows.filter((r) => {
          const d = new Date(r.created_at);
          const today = new Date();
          return d.toDateString() === today.toDateString();
        }).length,
      };
    });

    const summary: DashboardSummary = {
      total_leads          : totalLeads,
      hot_leads            : hotLeads,
      stale_hot_leads      : staleHotLeads,
      follow_ups_due       : followUpsDue,
      escalations_pending  : escalationsPending,
      total_pipeline_value : totalPipelineValue,
      confirmed_revenue    : confirmedRevenue,
      conversion_rate      : conversionRate,
      pipeline,
    };

    return NextResponse.json(summary);

  } catch (err: unknown) {
    logger.error('dashboard-stats', 'Unexpected error', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
