// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/whatsapp/drip-service.ts
// Phase 2 (Social + WhatsApp Growth) — Drip Sequences. Backs
// drip_sequences / drip_sequence_steps / drip_sequence_enrollments
// (migration 037). Multi-step, delay-based follow-up sequences, distinct
// from a single broadcast_campaigns send and from the reactive follow_ups
// queue (src/app/api/cron/followups/route.ts drains operator-scheduled
// one-off follow-ups; this drains a multi-step, pre-authored sequence).
//
// Idempotent sync-job pattern, same shape as publishSocialPost/
// syncReferralRewards — advanceDueDripSteps() is an explicit POST/cron
// action, never a read-time side effect.
//
// Channel support: 'whatsapp' sends for real via sendWhatsAppText (same
// primitive campaign-scheduler.ts and reservation-workflow.ts use).
// 'email' steps are recorded but not sent — no email send provider is
// wired into this codebase anywhere (confirmed absent in Content Studio's
// own "email templates are content-only" note) — sending a step never
// silently claims success for a channel that doesn't actually deliver.
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabaseAdmin } from '@/lib/supabase'
import { sendWhatsAppText } from '@/lib/whatsapp/send-message'
import { logJourneyEvent } from '@/lib/customers/journey'
import { logger } from '@/lib/logger'

type Result<T> = { ok: true; value: T } | { ok: false; error: string }

export interface DripSequenceRow {
  id: string
  name: string
  description: string | null
  trigger_event: string
  is_active: boolean
}

export interface DripStepRow {
  id: string
  sequence_id: string
  step_order: number
  delay_days: number
  channel: 'whatsapp' | 'email'
  message_template: string
}

export interface DripEnrollmentRow {
  id: string
  sequence_id: string
  lead_id: string
  current_step: number
  status: 'active' | 'completed' | 'cancelled'
  next_send_at: string | null
}

function renderTemplate(template: string, name: string | null): string {
  return template.replace(/\{\{\s*name\s*\}\}/gi, name || 'there')
}

export async function enrollLead(sequenceId: string, leadId: string): Promise<Result<DripEnrollmentRow>> {
  const db = getSupabaseAdmin()

  const { data: firstStep, error: stepError } = await db
    .from('drip_sequence_steps')
    .select('delay_days')
    .eq('sequence_id', sequenceId)
    .eq('step_order', 1)
    .maybeSingle()
  if (stepError) return { ok: false, error: stepError.message }
  if (!firstStep) return { ok: false, error: 'sequence_has_no_steps' }

  const nextSendAt = new Date(Date.now() + firstStep.delay_days * 86400000).toISOString()

  const { data, error } = await db
    .from('drip_sequence_enrollments')
    .upsert(
      { sequence_id: sequenceId, lead_id: leadId, current_step: 0, status: 'active', next_send_at: nextSendAt },
      { onConflict: 'sequence_id,lead_id' }
    )
    .select('*')
    .single()
  if (error || !data) return { ok: false, error: error?.message ?? 'enroll returned no row' }

  await logJourneyEvent(leadId, 'drip_sequence_enrolled', `Enrolled in drip sequence`, { sequenceId })
  return { ok: true, value: data as DripEnrollmentRow }
}

export async function cancelEnrollment(enrollmentId: string): Promise<Result<DripEnrollmentRow>> {
  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('drip_sequence_enrollments')
    .update({ status: 'cancelled', next_send_at: null })
    .eq('id', enrollmentId)
    .select('*')
    .maybeSingle()
  if (error) return { ok: false, error: error.message }
  if (!data) return { ok: false, error: 'enrollment_not_found' }
  return { ok: true, value: data as DripEnrollmentRow }
}

export interface AdvanceResult {
  processed: number
  sent: number
  skipped: number
  completed: number
  failed: number
}

// Drains due enrollments (status='active' AND next_send_at<=now). For each:
// sends the NEXT step (current_step+1), advances current_step, and either
// schedules next_send_at from the following step's delay_days or marks the
// enrollment 'completed' when there is no next step.
export async function advanceDueDripSteps(limit = 20): Promise<AdvanceResult> {
  const db = getSupabaseAdmin()
  const result: AdvanceResult = { processed: 0, sent: 0, skipped: 0, completed: 0, failed: 0 }

  const { data: due, error } = await db
    .from('drip_sequence_enrollments')
    .select('*')
    .eq('status', 'active')
    .lte('next_send_at', new Date().toISOString())
    .order('next_send_at', { ascending: true })
    .limit(limit)

  if (error) {
    logger.error('drip-service', 'advanceDueDripSteps: failed to load due enrollments', error)
    return result
  }

  for (const enrollment of (due ?? []) as DripEnrollmentRow[]) {
    result.processed++
    try {
      const stepOrder = enrollment.current_step + 1

      const { data: step } = await db
        .from('drip_sequence_steps')
        .select('*')
        .eq('sequence_id', enrollment.sequence_id)
        .eq('step_order', stepOrder)
        .maybeSingle()

      if (!step) {
        // No more steps — sequence complete.
        await db.from('drip_sequence_enrollments').update({ status: 'completed', next_send_at: null }).eq('id', enrollment.id)
        result.completed++
        continue
      }

      const { data: lead } = await db.from('leads').select('id, name, phone, whatsapp_opted_in').eq('id', enrollment.lead_id).maybeSingle()

      if (step.channel === 'whatsapp' && lead?.phone && lead.whatsapp_opted_in) {
        const message = renderTemplate(step.message_template, lead.name)
        const sendResult = await sendWhatsAppText(lead.phone, message, { leadId: enrollment.lead_id })
        if (sendResult.success) {
          result.sent++
          await logJourneyEvent(enrollment.lead_id, 'drip_sequence_step_sent', `Drip step ${stepOrder} sent`, { sequenceId: enrollment.sequence_id, stepOrder })
        } else {
          result.failed++
          logger.error('drip-service', 'Drip step send failed', sendResult.error, { leadId: enrollment.lead_id, stepOrder })
        }
      } else {
        // Email channel (not wired) or lead not WhatsApp-contactable —
        // still advances the sequence rather than blocking it forever.
        result.skipped++
      }

      const { data: nextStep } = await db
        .from('drip_sequence_steps')
        .select('delay_days')
        .eq('sequence_id', enrollment.sequence_id)
        .eq('step_order', stepOrder + 1)
        .maybeSingle()

      await db
        .from('drip_sequence_enrollments')
        .update({
          current_step: stepOrder,
          status: nextStep ? 'active' : 'completed',
          next_send_at: nextStep ? new Date(Date.now() + nextStep.delay_days * 86400000).toISOString() : null,
        })
        .eq('id', enrollment.id)
    } catch (err) {
      result.failed++
      logger.error('drip-service', 'advanceDueDripSteps: enrollment processing threw', err, { enrollmentId: enrollment.id })
    }
  }

  return result
}

export async function listSequences(): Promise<Result<(DripSequenceRow & { steps: DripStepRow[] })[]>> {
  const db = getSupabaseAdmin()
  const { data: sequences, error } = await db.from('drip_sequences').select('*').order('created_at', { ascending: false })
  if (error) return { ok: false, error: error.message }

  const { data: steps, error: stepsError } = await db.from('drip_sequence_steps').select('*').order('step_order', { ascending: true })
  if (stepsError) return { ok: false, error: stepsError.message }

  const value = (sequences ?? []).map((s) => ({
    ...(s as DripSequenceRow),
    steps: (steps ?? []).filter((st) => st.sequence_id === s.id) as DripStepRow[],
  }))
  return { ok: true, value }
}

export interface CreateSequenceInput {
  name: string
  description?: string | null
  trigger_event?: string
  steps: { delay_days: number; channel: 'whatsapp' | 'email'; message_template: string }[]
}

export async function createSequence(input: CreateSequenceInput): Promise<Result<DripSequenceRow & { steps: DripStepRow[] }>> {
  if (input.steps.length === 0) return { ok: false, error: 'At least one step is required' }
  const db = getSupabaseAdmin()

  const { data: sequence, error } = await db
    .from('drip_sequences')
    .insert({ name: input.name, description: input.description ?? null, trigger_event: input.trigger_event ?? 'manual' })
    .select('*')
    .single()
  if (error || !sequence) return { ok: false, error: error?.message ?? 'insert returned no row' }

  const stepRows = input.steps.map((s, i) => ({
    sequence_id: sequence.id,
    step_order: i + 1,
    delay_days: s.delay_days,
    channel: s.channel,
    message_template: s.message_template,
  }))

  const { data: steps, error: stepsError } = await db.from('drip_sequence_steps').insert(stepRows).select('*')
  if (stepsError) {
    // Roll back the orphaned sequence row rather than leaving a stepless sequence.
    await db.from('drip_sequences').delete().eq('id', sequence.id)
    return { ok: false, error: stepsError.message }
  }

  return { ok: true, value: { ...(sequence as DripSequenceRow), steps: (steps ?? []) as DripStepRow[] } }
}
