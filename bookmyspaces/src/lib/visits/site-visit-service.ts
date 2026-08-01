// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/visits/site-visit-service.ts
// Sprint 1 — Revenue Capture Pipeline: Visit Scheduling.
//
// Reuses the existing `follow_ups` table (type = 'site_visit', a valid
// CHECK value since 007_missing_tables.sql, never written until now) rather
// than a new table — see migration 027's header for the full reasoning.
// Reuses resolveIdentity()/normalizePhone() exactly as
// src/lib/proposals/proposal-service.ts's ensureLeadForProposal() does, so
// a visit scheduled for an unknown phone/email creates exactly one lead
// (never a duplicate), and a visit scheduled for a known customer attaches
// to their existing lead. Any newly-created lead here uses
// source: 'other' — the real acquisition channel is unknown at scheduling
// time — per MASTER_DATABASE.md's "Column Semantics — leads.source".
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabaseAdmin } from '@/lib/supabase'
import { resolveIdentity } from '@/lib/identity/resolve-identity'
import { normalizePhone } from '@/lib/whatsapp/normalize-phone'
import { logger } from '@/lib/logger'

export interface ScheduleSiteVisitInput {
  leadId?: string | null
  name: string
  phone?: string | null
  email?: string | null
  property: string
  visitDate: string // YYYY-MM-DD
  visitTime: string // HH:MM (24h)
  purpose?: string | null
  guestCount?: number | null
  budget?: string | null
}

export interface ScheduleSiteVisitResult {
  visitId: string
  leadId: string
  leadCreated: boolean
  scheduledAt: string
}

/**
 * Resolve-or-create the lead (same pattern as ensureLeadForProposal), then
 * create the follow_ups row representing the visit appointment. Returns
 * null only on unexpected DB failure — this is a scheduling action a human
 * or the AI conversation is actively waiting on, so failures are surfaced
 * to the caller rather than failing open.
 */
export async function scheduleSiteVisit(
  input: ScheduleSiteVisitInput
): Promise<ScheduleSiteVisitResult | null> {
  const supabase = getSupabaseAdmin()

  try {
    let leadId = input.leadId?.trim() || null
    let leadCreated = false

    if (!leadId) {
      if (input.phone?.trim() || input.email?.trim()) {
        const identity = await resolveIdentity({
          phone: input.phone ?? undefined,
          email: input.email ?? undefined,
        })
        if (identity) leadId = identity.leadId
      }

      if (!leadId) {
        const { data, error } = await supabase
          .from('leads')
          .insert({
            name       : input.name.trim() || null,
            phone      : input.phone?.trim() ? normalizePhone(input.phone) : null,
            email      : input.email?.trim() ? input.email.trim().toLowerCase() : null,
            guest_count: input.guestCount ?? null,
            budget     : input.budget?.trim() || null,
            venue      : input.property || null,
            source     : 'other',
            status     : 'new_inquiry',
          })
          .select('id')
          .single()

        if (error || !data?.id) {
          logger.error('site-visit-service', 'lead insert failed', error)
          return null
        }
        leadId = data.id
        leadCreated = true
      }
    }

    const scheduledAt = new Date(`${input.visitDate}T${input.visitTime}:00+05:30`).toISOString()

    const { data: visit, error: visitError } = await supabase
      .from('follow_ups')
      .insert({
        lead_id     : leadId,
        type        : 'site_visit',
        status      : 'pending', // displayed as "Scheduled" — see siteVisitStatusLabel()
        scheduled_at: scheduledAt,
        property    : input.property || null,
        purpose     : input.purpose?.trim() || null,
        guest_count : input.guestCount ?? null,
        budget      : input.budget?.trim() || null,
        notes       : input.purpose?.trim() || null,
        created_by  : 'crm',
      })
      .select('id')
      .single()

    if (visitError || !visit?.id) {
      logger.error('site-visit-service', 'visit insert failed', visitError)
      return null
    }
    if (!leadId) {
      // Unreachable in practice (every path above either sets leadId or
      // returns null already) — guards the return type below.
      logger.error('site-visit-service', 'leadId unexpectedly null after resolution', null)
      return null
    }

    await supabase.from('activity_logs').insert({
      lead_id     : leadId,
      action      : 'site_visit_scheduled',
      description : `Site visit scheduled at ${input.property || 'TBD'} — ${new Date(scheduledAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })}${leadCreated ? ' (customer record auto-created)' : ''}`,
      performed_by: 'admin',
    })

    return { visitId: visit.id, leadId, leadCreated, scheduledAt }
  } catch (err) {
    logger.error('site-visit-service', 'scheduleSiteVisit threw', err)
    return null
  }
}

export interface SiteVisitRow {
  id: string
  scheduledAt: string
  customerName: string | null
  customerPhone: string | null
  property: string | null
  purpose: string | null
  guestCount: number | null
  budget: string | null
  status: string
  leadId: string | null
}

const STATUS_LABEL: Record<string, string> = {
  pending    : 'Scheduled',
  completed  : 'Completed',
  skipped    : 'No-show',
  rescheduled: 'Rescheduled',
}

export function siteVisitStatusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status
}

function mapVisitRow(row: {
  id: string; scheduled_at: string; property: string | null; purpose: string | null
  guest_count: number | null; budget: string | null; status: string; lead_id: string | null
  leads: { name: string | null; phone: string | null } | { name: string | null; phone: string | null }[] | null
}): SiteVisitRow {
  const lead = Array.isArray(row.leads) ? row.leads[0] : row.leads
  return {
    id           : row.id,
    scheduledAt  : row.scheduled_at,
    customerName : lead?.name ?? null,
    customerPhone: lead?.phone ?? null,
    property     : row.property,
    purpose      : row.purpose,
    guestCount   : row.guest_count,
    budget       : row.budget,
    status       : row.status,
    leadId       : row.lead_id,
  }
}

/** All site-visit appointments whose scheduled_at falls on the given IST calendar date (YYYY-MM-DD). */
export async function listSiteVisitsForDate(date: string): Promise<SiteVisitRow[]> {
  const supabase = getSupabaseAdmin()
  const dayStart = `${date}T00:00:00+05:30`
  const dayEnd   = `${date}T23:59:59+05:30`

  const { data, error } = await supabase
    .from('follow_ups')
    .select('id, scheduled_at, property, purpose, guest_count, budget, status, lead_id, leads(name, phone)')
    .eq('type', 'site_visit')
    .gte('scheduled_at', dayStart)
    .lte('scheduled_at', dayEnd)
    .order('scheduled_at', { ascending: true })

  if (error || !data) {
    logger.error('site-visit-service', 'listSiteVisitsForDate failed', error)
    return []
  }

  return (data as any[]).map(mapVisitRow)
}

/** Mark a scheduled visit as completed / no-show / rescheduled. */
export async function updateSiteVisitStatus(
  id: string,
  status: 'pending' | 'completed' | 'skipped' | 'rescheduled'
): Promise<boolean> {
  const supabase = getSupabaseAdmin()
  const { error } = await supabase
    .from('follow_ups')
    .update({
      status,
      completed_at: status === 'completed' ? new Date().toISOString() : null,
    })
    .eq('id', id)
    .eq('type', 'site_visit')

  if (error) {
    logger.error('site-visit-service', 'updateSiteVisitStatus failed', error)
    return false
  }
  return true
}
