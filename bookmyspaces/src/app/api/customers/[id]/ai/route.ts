// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/app/api/customers/[id]/ai/route.ts
// V3 Sprint 4 — Priority 4: AI Operator Assistant.
//
// POST — runs one of the seven operator-facing AI actions against a
// customer's already-assembled AIContext (buildAIContext(), Day 4's AI
// Context Builder, reused unchanged). Thin wrapper over
// src/lib/ai/operator-assistant.ts's runOperatorAssist() — no AI call logic
// here, this route only resolves the leadId, builds the context, and shapes
// the HTTP response.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { requireAuth } from '@/lib/auth-guard'
import { parseBody, operatorAssistActionSchema } from '@/lib/validation'
import { buildAIContext } from '@/lib/ai/context-builder'
import { runOperatorAssist, runEventSalesAdvisor } from '@/lib/ai/operator-assistant'

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response

  const parsed = await parseBody(req, operatorAssistActionSchema)
  if (!parsed.ok) return parsed.response
  const { action, conversationId } = parsed.data

  try {
    const context = await buildAIContext({
      leadId: params.id,
      query: '',
      conversationId: conversationId ?? null,
    })

    // Direct Event Sales Engine, Section 2/7 — 'event_sales_advisor' is a
    // structured-JSON action with its own return shape, not the free-text
    // OperatorAssistResult every other action here returns, so it's routed
    // to its own function rather than forcing it through runOperatorAssist().
    if (action === 'event_sales_advisor') {
      const result = await runEventSalesAdvisor(context, params.id, conversationId ?? null)
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 })
      return NextResponse.json({ action, ...result.result })
    }

    const result = await runOperatorAssist(action, context, params.id, conversationId ?? null)

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 502 })
    }

    return NextResponse.json({ action: result.action, text: result.text })
  } catch (error) {
    logger.error('customers/[id]/ai', 'POST failed', error)
    return NextResponse.json({ error: 'Failed to generate AI assistance' }, { status: 500 })
  }
}
