export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { smartSend } from '@/lib/queue'
import { WHATSAPP_MESSAGES } from '@/lib/templates'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth-guard'

export async function POST(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  const supabaseAdmin = getSupabaseAdmin()
  try {
    const body = await req.json()
    logger.info('whatsapp-send', 'request_received', { keys: Object.keys(body ?? {}) })

    const {
      phone: phoneRaw,
      // DEFENSIVE ALIAS: an earlier CRM build posted `to` instead of `phone`
      // (fixed at the call site in src/app/(crm)/whatsapp/page.tsx), which
      // 400'd here with no visibility into why. Accepting `to` as a fallback
      // means a stale/rolled-back frontend deploy degrades gracefully
      // instead of hard-failing manual sends.
      to,
      message,
      lead_id,
      template,
      type = 'session',
    } = body
    const phone = phoneRaw ?? to

    logger.info('whatsapp-send', 'parsed_values', {
      hasPhone: Boolean(phone),
      hasMessage: Boolean(message),
      hasTemplate: Boolean(template),
      lead_id: lead_id ?? null,
      type,
      usedToAlias: !phoneRaw && Boolean(to),
    })

    if (!phone) {
      logger.error('whatsapp-send', 'validation_failed: missing phone', undefined, { bodyKeys: Object.keys(body ?? {}) })
      return NextResponse.json({ error: 'Phone number required' }, { status: 400 })
    }

    let finalMessage = message
    if (template) {
      switch (template) {
        case 'greeting': finalMessage = WHATSAPP_MESSAGES.greeting(); break
        case 'packages': finalMessage = WHATSAPP_MESSAGES.packagesOverview(); break
        case 'followup': finalMessage = WHATSAPP_MESSAGES.followUp(); break
        case 'payment': finalMessage = WHATSAPP_MESSAGES.paymentInfo(); break
        case 'trust': finalMessage = WHATSAPP_MESSAGES.trustMessage(); break
        case 'urgency': finalMessage = WHATSAPP_MESSAGES.urgency(); break
        case 'escalate': finalMessage = WHATSAPP_MESSAGES.escalateToHuman(); break
        case 'rooftop': finalMessage = WHATSAPP_MESSAGES.rooftopInfo(); break
        case 'dining': finalMessage = WHATSAPP_MESSAGES.privateDining(); break
        case 'skyline': finalMessage = WHATSAPP_MESSAGES.skylineRooms(); break
        case 'cafe': finalMessage = WHATSAPP_MESSAGES.cafeInfo(); break
      }
    }

    if (!finalMessage) {
      logger.error('whatsapp-send', 'validation_failed: missing message', undefined, { template: template ?? null, bodyKeys: Object.keys(body ?? {}) })
      return NextResponse.json({ error: 'Message content required' }, { status: 400 })
    }

    logger.info('whatsapp-send', 'validation_passed: calling smartSend', { phone, type })
    const success = await smartSend(phone, finalMessage, { type })
    logger.info('whatsapp-send', 'smartSend_result', { phone, success })

    if (success && lead_id) {
      await supabaseAdmin.from('activity_logs').insert({ lead_id, action: 'whatsapp_sent', description: `WhatsApp message sent: "${finalMessage.substring(0, 100)}..."`, performed_by: 'staff', metadata: { template, phone } })
      await supabaseAdmin.from('leads').update({ last_contacted_at: new Date().toISOString() }).eq('id', lead_id)
    }

    return NextResponse.json({ success, phone, message_preview: finalMessage.substring(0, 100) })
  } catch (err) {
    logger.error('whatsapp-send', 'POST /api/whatsapp/send error', err)
    return NextResponse.json({ error: 'Failed to send message' }, { status: 500 })
  }
}
