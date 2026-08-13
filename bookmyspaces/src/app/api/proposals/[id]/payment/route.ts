// src/app/api/proposals/[id]/payment/route.ts
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { getSupabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth-guard'
import { auditLog } from '@/lib/audit-log'

// ─── POST — record a payment ──────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  const supabase = getSupabaseAdmin()
  try {
    const body = await req.json()
    const {
      amount,
      payment_date  = new Date().toISOString().slice(0, 10),
      payment_mode  = 'cash',
      transaction_ref,
      notes,
      payment_type  = 'advance',
    } = body

    // V3 refund workflow (migration 015): refunds are first-class rows with
    // payment_type='refund' and a NEGATIVE amount — no more "type a negative
    // number by convention". The API takes a positive refund amount from the
    // operator and applies the sign itself.
    const isRefund = payment_type === 'refund'
    // FIX: `!amount || Number(amount) <= 0` let a non-numeric string (e.g.
    // "abc") through — !amount is false for a truthy string, and
    // Number("abc") <= 0 is also false (NaN comparisons are always false) —
    // so NaN reached the payments.amount insert below. Number.isFinite()
    // rejects NaN/Infinity/non-numeric input directly.
    if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) {
      return NextResponse.json({ error: 'Valid amount is required (positive; refunds are negated automatically)' }, { status: 400 })
    }

    // Verify proposal exists
    const { data: proposal, error: propErr } = await supabase
      .from('proposals')
      .select('id, client_name, total_price, proposal_number')
      .eq('id', params.id)
      .single()

    if (propErr || !proposal) {
      return NextResponse.json({ error: 'Proposal not found' }, { status: 404 })
    }

    // Insert payment — receipt_number assigned by DB trigger
    const { data: payment, error: payErr } = await supabase
      .from('payments')
      .insert({
        proposal_id    : params.id,
        amount         : isRefund ? -Math.abs(Number(amount)) : Number(amount),
        payment_date,
        payment_mode,
        transaction_ref: transaction_ref || null,
        notes          : notes || null,
        payment_type,
      })
      .select('*')
      .single()

    if (payErr) throw payErr

    if (isRefund) {
      auditLog({
        actor: auth.user.email ?? auth.user.id,
        action: 'payment.refund',
        entityType: 'payments',
        entityId: String(payment?.id ?? ''),
        detail: { proposal_id: params.id, amount: -Math.abs(Number(amount)) },
      })
    }

    // Mark proposal as accepted if it isn't already. Must set accepted_at here
    // too, not just status: the Revenue Dashboard's revenue totals and
    // "accepted" proposal count (src/app/api/dashboard/revenue/route.ts) are
    // keyed strictly on accepted_at IS NOT NULL, matching the explicit
    // "Mark as Accepted" action in src/app/(crm)/proposals/page.tsx
    // (handleStatusUpdate). Without this, a proposal transitioned to
    // 'accepted' via this path alone (e.g. a direct API call, bypassing the
    // UI's isAccepted-gated Record Payment button) would silently never
    // appear in revenue figures despite real money being recorded against it.
    await supabase
      .from('proposals')
      .update({ status: 'accepted', accepted_at: new Date().toISOString() })
      .eq('id', params.id)
      .in('status', ['draft', 'sent', 'viewed', 'generated'])

    // Activity log
    await supabase.from('activity_logs').insert({
      lead_id     : null,
      action      : 'payment_recorded',
      description : `${isRefund ? 'Refund' : 'Payment'} of ₹${Number(amount).toLocaleString('en-IN')} recorded for ${proposal.proposal_number} (${payment_mode})`,
      performed_by: 'admin',
    }).throwOnError()

    return NextResponse.json({ payment }, { status: 201 })
  } catch (err) {
    logger.error('payment', 'POST failed', err)
    return NextResponse.json({ error: 'Failed to record payment' }, { status: 500 })
  }
}

// ─── GET — list payments for a proposal ──────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  const supabase = getSupabaseAdmin()
  try {
    const { data, error } = await supabase
      .from('payments')
      .select('*')
      .eq('proposal_id', params.id)
      .order('payment_date', { ascending: false })

    if (error) throw error
    return NextResponse.json({ payments: data })
  } catch (err) {
    logger.error('payment', 'GET failed', err)
    return NextResponse.json({ error: 'Failed to fetch payments' }, { status: 500 })
  }
}
