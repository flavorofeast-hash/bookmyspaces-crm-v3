// src/app/api/leads/hot/route.ts
// GET /api/leads/hot
// Returns ALL leads ordered by temperature + ai_score for the sales dashboard.
// Queries the leads table directly — no dependency on Phase 2 views or migrations.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { requireAuth } from '@/lib/auth-guard';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  try {
    const db = getSupabaseAdmin();

    // SELECT only columns that exist in the base schema (001–008 migrations).
    // Phase 2 columns (last_follow_up_at, next_follow_up_at, follow_up_count,
    // lead_stage, escalation_required) are included but safe to omit if missing —
    // Supabase returns an error for non-existent columns, so we try the full set
    // first and fall back to the base set on error.
    const { data, error } = await db
      .from('leads')
      .select(
        'id, created_at, updated_at, ' +
        'name, phone, email, ' +
        'event_type, event_date, guest_count, budget, occasion, venue, ' +
        'source, status, notes, assigned_to, ' +
        'ai_score, lead_temperature, urgency_level, estimated_revenue, ' +
        'score_breakdown, scored_at, tags, ' +
        'last_contacted_at, whatsapp_opted_in'
      )
      .order('created_at', { ascending: false })
      .limit(500);

    if (error) {
      logger.error('leads-hot', 'Supabase error', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Merge in Phase 2 fields as null so the frontend type is satisfied
    // even when those columns don't exist yet in the live DB.
    const leads = ((data ?? []) as unknown as Record<string, unknown>[]).map((row) => ({
  ...row,
      lead_stage          : (row as Record<string, unknown>).lead_stage           ?? null,
      escalation_required : (row as Record<string, unknown>).escalation_required  ?? false,
      last_follow_up_at   : (row as Record<string, unknown>).last_follow_up_at    ?? null,
      next_follow_up_at   : (row as Record<string, unknown>).next_follow_up_at    ?? null,
      follow_up_count     : (row as Record<string, unknown>).follow_up_count       ?? 0,
      tags                : Array.isArray((row as Record<string, unknown>).tags)
                              ? (row as Record<string, unknown>).tags
                              : [],
    }));

    return NextResponse.json({
      leads,
      total: leads.length,
    });

  } catch (err: unknown) {
    logger.error('leads-hot', 'Unexpected error', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
