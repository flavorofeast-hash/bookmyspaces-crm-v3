// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/app/api/marketing/ad-spend/route.ts
// Marketing Intelligence Priority 3 — manual ad spend ingestion (GET list,
// POST create, DELETE remove). Gated behind requireRole(['admin','manager']),
// same posture as /api/social/accounts — spend figures feed ROI/cost-per-
// enquiry numbers shown to the founder, not general staff content.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { requireRole } from '@/lib/auth-guard'
import { parseBody, createAdSpendSchema } from '@/lib/validation'
import { createAdSpend, listAdSpend, deleteAdSpend } from '@/lib/analytics/ad-spend-service'

export async function GET(req: NextRequest) {
  const auth = await requireRole(['admin', 'manager'])
  if (!auth.ok) return auth.response

  const startDate = req.nextUrl.searchParams.get('startDate') || undefined
  const endDate = req.nextUrl.searchParams.get('endDate') || undefined

  const result = await listAdSpend(startDate, endDate)
  if (!result.ok) {
    logger.error('marketing/ad-spend', 'GET failed', result.error)
    return NextResponse.json({ error: 'Failed to fetch ad spend' }, { status: 500 })
  }
  return NextResponse.json({ records: result.value })
}

export async function POST(req: NextRequest) {
  const auth = await requireRole(['admin', 'manager'])
  if (!auth.ok) return auth.response

  const parsed = await parseBody(req, createAdSpendSchema)
  if (!parsed.ok) return parsed.response
  const body = parsed.data

  const result = await createAdSpend({
    platform: body.platform,
    campaignName: body.campaignName ?? null,
    spendDate: body.spendDate,
    amount: body.amount,
    currency: body.currency,
    notes: body.notes ?? null,
    createdBy: auth.user.id,
    businessPackageId: body.businessPackageId ?? null,
  })

  if (!result.ok) {
    logger.error('marketing/ad-spend', 'POST failed', result.error)
    return NextResponse.json({ error: 'Failed to record ad spend' }, { status: 500 })
  }
  return NextResponse.json({ record: result.value }, { status: 201 })
}

export async function DELETE(req: NextRequest) {
  const auth = await requireRole(['admin', 'manager'])
  if (!auth.ok) return auth.response

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id query param is required' }, { status: 400 })

  const result = await deleteAdSpend(id)
  if (!result.ok) {
    logger.error('marketing/ad-spend', 'DELETE failed', result.error)
    return NextResponse.json({ error: 'Failed to delete ad spend record' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
