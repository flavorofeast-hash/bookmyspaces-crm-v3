// ═══════════════════════════════════════════════════════════════
// MESSAGE QUEUE — Rate limiting + anti-spam
// ═══════════════════════════════════════════════════════════════

import { getSupabaseAdmin } from './supabase'
import { logger }           from './logger'
import {
  sendWhatsAppText,
  sendWhatsAppTemplateSimple,
} from './whatsapp/send-message'
import { isMetaConfigured } from './whatsapp/meta-configured'

// ─── TYPES ────────────────────────────────────────────────────
export interface QueuedMessage {
  phone:             string
  message:           string
  type?:             'session' | 'template'
  template_name?:    string
  template_params?:  Record<string, string>[]
  scheduled_at?:     string
  metadata?:         Record<string, unknown>
}

// ─── ENQUEUE (write to message_queue table) ───────────────────
export async function enqueueMessage(msg: QueuedMessage): Promise<string | null> {
  const supabaseAdmin = getSupabaseAdmin()
  try {
    const { data, error } = await supabaseAdmin
      .from('message_queue')
      .insert({
        phone:           msg.phone,
        message:         msg.message,
        type:            msg.type || 'session',
        template_name:   msg.template_name,
        template_params: msg.template_params,
        scheduled_at:    msg.scheduled_at || new Date().toISOString(),
        metadata:        msg.metadata || {},
        status:          'pending',
        attempts:        0,
      })
      .select('id')
      .single()
    if (error) throw error
    return data?.id || null
  } catch (err) {
    logger.error('queue','enqueueMessage error', err)
    return null
  }
}

// ─── IN-MEMORY RATE LIMITER ───────────────────────────────────
const phoneLastSent: Map<string, number> = new Map()
const MIN_DELAY_MS = 1500

export function isRateLimited(phone: string): boolean {
  const last = phoneLastSent.get(phone)
  if (!last) return false
  return Date.now() - last < MIN_DELAY_MS
}

export function markSent(phone: string): void {
  phoneLastSent.set(phone, Date.now())
}

// ─── DB-BACKED SPAM CHECK ─────────────────────────────────────
export async function wasRecentlyContacted(
  phone:          string,
  withinMinutes = 60
): Promise<boolean> {
  const supabaseAdmin = getSupabaseAdmin()
  try {
    const since = new Date(Date.now() - withinMinutes * 60 * 1000).toISOString()
    const { count } = await supabaseAdmin
      .from('message_queue')
      .select('*', { count: 'exact', head: true })
      .eq('phone',  phone)
      .eq('status', 'sent')
      .gte('last_attempted_at', since)
    return (count || 0) > 0
  } catch {
    return false
  }
}

// ─── SMART SEND ───────────────────────────────────────────────
export async function smartSend(
  phone:   string,
  message: string,
  options: {
    type?:           'session' | 'template'
    templateName?:   string
    templateParams?: Array<{ name: string; value: string }>
    forceSpamCheck?: boolean
    // AUDIT FINDING (Priority 3 — Customer Journey Timeline): sendWhatsAppText/
    // sendWhatsAppTemplateSimple already log every send to `whatsapp_messages`
    // with a `lead_id` column, and timeline-service.ts's fetchWhatsAppEntries()
    // already filters strictly on that column — but smartSend() never forwarded
    // a leadId through, so every message sent via this queue (campaigns,
    // journey automation, and the pre-existing followups/escalations crons)
    // was logged with lead_id=null and silently never showed up on the
    // customer's Timeline. This closes that gap; no new timeline code needed.
    leadId?:         string | null
  } = {}
): Promise<boolean> {
  if (!isMetaConfigured()) {
    logger.info('queue','WhatsApp not configured — message skipped (mock mode)',
      { preview: message.slice(0, 60) })
    return false
  }
  if (options.forceSpamCheck || options.type === 'template') {
    const spammed = await wasRecentlyContacted(phone, 60)
    if (spammed) {
      logger.info('queue','Rate limit applied — message skipped')
      return false
    }
  }
  if (isRateLimited(phone)) {
    await new Promise(r => setTimeout(r, MIN_DELAY_MS))
  }
  let success = false
  if (options.type === 'template' && options.templateName) {
    success = (await sendWhatsAppTemplateSimple(phone, options.templateName, options.templateParams, { leadId: options.leadId })).success
  } else {
    success = (await sendWhatsAppText(phone, message, { leadId: options.leadId })).success
  }
  if (success) markSent(phone)
  return success
}
