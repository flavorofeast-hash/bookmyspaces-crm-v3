export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { initializeSheet, isSheetsConfigured } from '@/lib/sheets'

export async function GET() {
  const supabaseAdmin = getSupabaseAdmin()
  const checks: Record<string, { status: 'ok' | 'warn' | 'error'; message: string }> = {}

  if (isSheetsConfigured()) initializeSheet().catch(() => {})
  const start = Date.now()

  try {
    const { count, error } = await supabaseAdmin.from('leads').select('*', { count: 'exact', head: true })
    checks.supabase = error
      ? { status: 'error', message: `Connection failed: ${error.message}` }
      : { status: 'ok', message: `Connected — ${count ?? 0} leads` }
  } catch (e: any) {
    checks.supabase = { status: 'error', message: e.message }
  }

  const requiredTables = [
    'leads', 'conversations', 'activity_logs', 'knowledge_chunks',
    'documents', 'proposals', 'message_queue', 'broadcast_campaigns',
    'ai_summaries', 'festival_calendar', 'notification_settings',
  ]

  for (const table of requiredTables) {
    try {
      const { error } = await supabaseAdmin.from(table).select('*', { count: 'exact', head: true })
      checks[`table_${table}`] = error
        ? { status: 'error', message: `Table error: ${error.message}` }
        : { status: 'ok', message: 'Table exists and accessible' }
    } catch (e: any) {
      checks[`table_${table}`] = { status: 'error', message: e.message }
    }
  }

  try {
    const { error } = await supabaseAdmin.from('leads_needing_followup').select('id', { count: 'exact', head: true })
    checks.view_followup = error
      ? { status: 'warn', message: `View missing or broken: ${error.message}` }
      : { status: 'ok', message: 'Followup view accessible' }
  } catch (e: any) {
    checks.view_followup = { status: 'warn', message: e.message }
  }

  try {
    const { error } = await supabaseAdmin.from('leads').select('id, phone, ai_score, whatsapp_opted_in, is_vip, event_date').limit(1)
    checks.leads_schema = error
      ? { status: 'error', message: `Schema mismatch: ${error.message}` }
      : { status: 'ok', message: 'All required columns present' }
  } catch (e: any) {
    checks.leads_schema = { status: 'error', message: e.message }
  }

  try {
    const { error } = await supabaseAdmin.from('conversations').select('id, session_id, messages, extracted_phone, lead_id, is_escalated').limit(1)
    checks.conversations_schema = error
      ? { status: 'error', message: `Schema mismatch: ${error.message}` }
      : { status: 'ok', message: 'All required columns present' }
  } catch (e: any) {
    checks.conversations_schema = { status: 'error', message: e.message }
  }

  try {
    const { error } = await supabaseAdmin.rpc('match_knowledge_chunks', { query_embedding: new Array(1536).fill(0), match_threshold: 0.99, match_count: 1 })
    checks.rag_function = error
      ? { status: 'warn', message: `RPC error: ${error.message}` }
      : { status: 'ok', message: 'match_knowledge_chunks() working' }
  } catch (e: any) {
    checks.rag_function = { status: 'warn', message: e.message }
  }

  try {
    const { count } = await supabaseAdmin.from('knowledge_chunks').select('*', { count: 'exact', head: true })
    checks.knowledge_base = {
      status: (count || 0) > 0 ? 'ok' : 'warn',
      message: `${count ?? 0} chunks indexed${(count || 0) === 0 ? ' — seed from /admin' : ''}`,
    }
  } catch (e: any) {
    checks.knowledge_base = { status: 'warn', message: e.message }
  }

  checks.anthropic_key = process.env.ANTHROPIC_API_KEY ? { status: 'ok', message: 'Configured' } : { status: 'error', message: 'ANTHROPIC_API_KEY not set' }
  checks.openai_key = process.env.OPENAI_API_KEY ? { status: 'ok', message: 'Configured' } : { status: 'warn', message: 'OPENAI_API_KEY not set — RAG embeddings disabled' }
  checks.google_sheets = process.env.GOOGLE_SHEETS_ID ? { status: 'ok', message: 'Sheet ID configured' } : { status: 'warn', message: 'GOOGLE_SHEETS_ID not set — sync disabled' }

  // FIX (repo-wide audit finding): this used to check WATI_BASE_URL/
  // WATI_API_TOKEN — Wati.io is the legacy provider, not what actually
  // sends/receives WhatsApp messages (that's the Meta Cloud API, see
  // src/lib/whatsapp/send-message.ts and the webhook at
  // src/app/api/whatsapp/webhook/route.ts). Ops monitoring this endpoint
  // was getting a signal from a subsystem nothing else depends on.
  const metaWhatsappConfigured = !!(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID)
  checks.whatsapp = {
    status: metaWhatsappConfigured ? 'ok' : 'warn',
    message: metaWhatsappConfigured
      ? 'Meta Cloud API configured — webhook active'
      : 'WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID not set — WhatsApp send/receive disabled',
  }
  const watiConfigured = !!(process.env.WATI_BASE_URL && process.env.WATI_API_TOKEN)
  checks.wati_legacy = {
    status: watiConfigured ? 'ok' : 'warn',
    message: watiConfigured ? 'Wati configured (legacy, transcription helper only)' : 'Wati not configured (legacy, optional — see .env.example)',
  }

  const values = Object.values(checks)
  const hasErrors = values.some(c => c.status === 'error')
  const hasWarnings = values.some(c => c.status === 'warn')
  const overallStatus = hasErrors ? 'unhealthy' : hasWarnings ? 'degraded' : 'healthy'

  return NextResponse.json(
    { status: overallStatus, timestamp: new Date().toISOString(), elapsed_ms: Date.now() - start, checks, summary: { total: values.length, ok: values.filter(c => c.status === 'ok').length, warn: values.filter(c => c.status === 'warn').length, error: values.filter(c => c.status === 'error').length } },
    { status: hasErrors ? 503 : 200 }
  )
}
