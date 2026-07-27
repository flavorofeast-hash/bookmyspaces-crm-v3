// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/ai/operator-assistant.ts
// V3 Sprint 4 — Priority 4: AI Operator Assistant.
//
// Per the Sprint 4 protocol's explicit instruction ("Reuse the existing AI
// Context Builder. Do not introduce new AI architecture."), this is a thin
// prompt-selection layer over context-builder.ts's already-assembled
// AIContext object, not a new retrieval/orchestration system. Every one of
// the seven operator-facing features (Customer Summary, Conversation
// Summary, Suggested WhatsApp Reply, Suggested Email, Recommended Room,
// Recommended Package, Recommended Follow-up) shares one context-formatting
// function and one Anthropic call; only the task instruction appended at
// the end differs.
//
// Calls Anthropic directly with a single custom prompt, the same pattern
// src/lib/scoring.ts's generateProposalCoverNote() already uses for a
// one-shot "write text from structured data" task -- deliberately NOT
// src/lib/ai.ts's chatWithAI(), which is the multi-turn *customer-facing*
// chat pipeline with its own hardcoded SYSTEM_PROMPT that ignores caller-
// supplied context (see src/lib/providers/ai-provider.ts's header comment).
// These are operator-facing, single-shot generations with a completely
// different prompt need, so they get their own lazy-init Anthropic client,
// mirroring scoring.ts's existing pattern rather than repurposing (or
// modifying the behavior of) the customer chat pipeline.
// ─────────────────────────────────────────────────────────────────────────────

import Anthropic from '@anthropic-ai/sdk'
import { logger } from '@/lib/logger'
import { getSupabaseAdmin } from '@/lib/supabase'
import type { AIContext } from '@/types/ai-context'

let _anthropic: Anthropic | null = null
function getAnthropic(): Anthropic {
  if (!_anthropic) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set')
    _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  }
  return _anthropic
}

export type OperatorAssistAction =
  | 'customer_summary'
  | 'conversation_summary'
  | 'suggested_whatsapp_reply'
  | 'suggested_email'
  | 'recommended_room'
  | 'recommended_package'
  | 'recommended_follow_up'
  | 'upsell_recommendations'

const ACTION_LABEL: Record<OperatorAssistAction, string> = {
  customer_summary: 'Customer Summary',
  conversation_summary: 'Conversation Summary',
  suggested_whatsapp_reply: 'Suggested WhatsApp Reply',
  suggested_email: 'Suggested Email',
  recommended_room: 'Recommended Room',
  recommended_package: 'Recommended Package',
  recommended_follow_up: 'Recommended Follow-up',
  upsell_recommendations: 'Upsell Recommendations',
}

const TASK_INSTRUCTION: Record<OperatorAssistAction, string> = {
  customer_summary:
    'Write a concise 3-4 sentence summary of this customer for a hotel front-desk operator glancing at their profile: who they are, what they want, and anything noteworthy (repeat guest, price-sensitive, etc.). Plain prose, no headers or bullet points.',
  conversation_summary:
    'Summarize the conversation above for an operator picking up this thread cold. Cover, in short labeled lines: Requirements (what the customer has told us they need), Outstanding questions (anything the customer asked that has not been answered yet, or information we still need from them), Risks (anything suggesting they might not book — price concerns, comparing other venues, going quiet, unclear timeline), and Next action (the single most useful thing to do next). If there is no conversation history, say so plainly instead of inventing one.',
  suggested_whatsapp_reply:
    'Draft a warm, brief WhatsApp reply (Indian English, 2-4 sentences) the operator can send right now to move this conversation forward. Write it as an actual WhatsApp message would read, not a formal letter.',
  suggested_email:
    'Draft a short, professional email the operator can send this customer. Format it as "Subject: <subject line>" on the first line, a blank line, then the body. Keep the body under 150 words.',
  recommended_room:
    "Recommend which room/inventory type best fits this customer's stated preferences and history, with a one-sentence reason. If there isn't enough information to recommend confidently, say so plainly instead of guessing.",
  recommended_package:
    'Recommend which of the available packages best fits this customer, with a one-sentence reason referencing their guest count, budget, or history where known. If there is not enough information, say so plainly instead of guessing.',
  recommended_follow_up:
    'Recommend the next follow-up action for this customer in labeled lines: Best next action (what to do), Suggested timing (when — be concrete, e.g. "within 24 hours" or "in 3 days", based on how urgent/hot this lead looks from the context), Suggested channel (WhatsApp, email, or phone call — pick the one already working for this customer where evident), Conversion likelihood (High, Medium, or Low, with a half-sentence why — a qualitative read from the context, not a fabricated precise percentage), and Escalate to a human manager? (Yes/No — Yes only if you see a clear reason: high value, complaint, or repeated no-response).',
  upsell_recommendations:
    'Recommend upsells for this specific customer FROM THE AVAILABLE OPTIONS LISTED IN THE CONTEXT ABOVE ONLY (available packages, meal plans, add-on services) — never invent an offering, price, or service that is not listed. For each recommendation give: what to offer, and a one-sentence reason tied to their guest count, event type, budget, or history (e.g. a wedding lead may want a better room category, banquet space, or decoration; a returning guest may want a meal-plan upgrade; an out-of-town guest may want airport pickup). If nothing in the available options is a good fit, say so plainly instead of forcing a recommendation. Limit to the 3 best-fit upsells, most relevant first.',
}

function formatContextForPrompt(context: AIContext): string {
  const lines: string[] = []
  const p = context.customerProfile
  const prefs = context.customerPreferences

  lines.push(`Customer: ${p.name ?? 'Unknown'} (${p.phone ?? 'no phone on file'}, ${p.email ?? 'no email on file'}), status: ${p.status ?? 'unknown'}`)

  if (prefs.preferredEventType || prefs.preferredGuestCount || prefs.preferredVenue || prefs.notes) {
    lines.push(
      `Preferences: event type ${prefs.preferredEventType ?? '—'}, guest count ${prefs.preferredGuestCount ?? '—'}, venue ${prefs.preferredVenue ?? '—'}${prefs.notes ? `, notes: ${prefs.notes}` : ''}`
    )
  }

  if (context.reservationHistory.length) {
    lines.push('Reservation history:')
    for (const r of context.reservationHistory.slice(0, 5)) {
      lines.push(`  - ${r.status}, ${r.checkInDate} -> ${r.checkOutDate}, Rs${r.finalRoomRate}`)
    }
  }

  if (context.proposalHistory.length) {
    lines.push('Proposal history:')
    for (const pr of context.proposalHistory.slice(0, 5)) {
      lines.push(`  - ${pr.proposalNumber ?? pr.id.slice(0, 8)} (${pr.status}): ${pr.packageName ?? 'package'} — Rs${pr.totalPrice ?? 0}`)
    }
  }

  if (context.activePackages.length) {
    lines.push('Available packages:')
    for (const pkg of context.activePackages) {
      lines.push(`  - ${pkg.name}: Rs${pkg.basePrice}, up to ${pkg.maxGuests} guests, ${pkg.durationHours}h${pkg.isPopular ? ' (most popular)' : ''}`)
    }
  }

  // Direct Event Sales Engine, Section 2 — event-type-aware package
  // catalog, richer than activePackages above (has id + eventTypes so the
  // AI Event Sales Advisor can match a specific package to this lead's
  // event type instead of guessing). Only the event-advisor prompt needs
  // this level of detail — kept in formatContextForPrompt() (not a second
  // formatter) so every action sees a consistent context block.
  if (context.eventPackages.length) {
    lines.push('Available event packages (with ids, for structured recommendations):')
    for (const pkg of context.eventPackages) {
      lines.push(
        `  - id=${pkg.id} "${pkg.name}" (${pkg.venue}): Rs${pkg.basePrice}, up to ${pkg.maxGuests} guests, ${pkg.durationHours}h, event types: ${pkg.eventTypes.length ? pkg.eventTypes.join('/') : 'all'}${pkg.isPopular ? ' (most popular)' : ''}${pkg.addons.length ? `, addons: ${pkg.addons.map((a) => `${a.name} (Rs${a.price})`).join(', ')}` : ''}`
      )
    }
  }

  // Priority 1 (AI Sales Executive) — upsell inventory (meal plans, add-on
  // services). Only included when non-empty so the prompt doesn't grow for
  // customers/properties with nothing configured yet.
  if (context.upsellInventory.mealPlans.length) {
    lines.push('Available meal plans:')
    for (const mp of context.upsellInventory.mealPlans) {
      lines.push(`  - ${mp.name} (${mp.code}): Rs${mp.price}`)
    }
  }
  if (context.upsellInventory.addonServices.length) {
    lines.push('Available add-on services:')
    for (const a of context.upsellInventory.addonServices) {
      lines.push(`  - ${a.name}${a.category ? ` [${a.category}]` : ''}: Rs${a.price}`)
    }
  }

  if (context.conversationHistory.length) {
    lines.push('Recent conversation:')
    for (const m of context.conversationHistory.slice(-10)) {
      lines.push(`  ${m.role === 'user' ? 'Customer' : 'Us'}: ${m.content}`)
    }
  }

  if (context.knowledgeBaseResults.length) {
    lines.push('Relevant knowledge base notes:')
    for (const k of context.knowledgeBaseResults) lines.push(`  - ${k.content}`)
  }

  lines.push(
    `Business rules: cancellation window ${context.businessRules.cancellationWindowHours}h, advance payment ${context.businessRules.advancePaymentPercent}%, check-in ${context.businessRules.checkInTime}, check-out ${context.businessRules.checkOutTime}`
  )

  return lines.join('\n')
}

export type OperatorAssistResult =
  | { ok: true; action: OperatorAssistAction; text: string }
  | { ok: false; action: OperatorAssistAction; error: string }

/**
 * Single entry point for every AI Operator Assistant feature. `leadId`/
 * `conversationId` are only used for the ai_interaction_log audit trail
 * (best-effort, degrades silently until migration 012 is live) — the model
 * call itself only ever sees `context`.
 */
export async function runOperatorAssist(
  action: OperatorAssistAction,
  context: AIContext,
  leadId: string | null,
  conversationId: string | null = null
): Promise<OperatorAssistResult> {
  const startedAt = Date.now()
  try {
    const prompt = `You are assisting a BookMySpaces hotel/event-venue operator — you are NOT talking to the customer directly, you are helping the human operator who is.

CUSTOMER CONTEXT:
${formatContextForPrompt(context)}

TASK: ${TASK_INSTRUCTION[action]}`

    const response = await getAnthropic().messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      messages: [{ role: 'user', content: prompt }],
    })

    const block = response.content[0]
    const text = block?.type === 'text' ? block.text.trim() : ''
    if (!text) throw new Error('Empty response from AI provider')

    await logInteraction(leadId, conversationId, action, text, Date.now() - startedAt)
    return { ok: true, action, text }
  } catch (err) {
    logger.error('operator-assistant', `${ACTION_LABEL[action]} failed`, err)
    return { ok: false, action, error: err instanceof Error ? err.message : String(err) }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Direct Event Sales Engine — Section 2 (AI Event Sales Advisor) + Section 7
// (AI Sales Copilot), one combined action.
//
// WHY ONE ACTION, NOT TWO: per audit finding F, "AI Sales Copilot" (best
// package, expected budget, booking probability, next follow-up, upsell/
// cross-sell, best response) overlaps almost entirely with what Section 2
// asks for (identify event type/guest count/budget/date/requirements,
// recommend venue/package/catering/decoration/add-ons/price/upsells) plus
// what recommended_follow_up already half-covers. Building two separate
// actions would mean two Anthropic calls returning overlapping fields from
// the same context — this returns one structured object instead, reusing
// runOperatorAssist()'s existing prompt-assembly/context-formatting/
// logging plumbing, just with a JSON-mode task instruction and a parsed
// return type instead of free prose.
// ─────────────────────────────────────────────────────────────────────────────

export interface EventSalesAdvisorResult {
  identified: {
    eventType: string | null
    guestCount: number | null
    budget: string | null
    preferredDate: string | null
    foodRequirements: string | null
    hallRequirements: string | null
    roomRequirements: string | null
  }
  recommendation: {
    venue: string | null
    packageId: string | null
    packageName: string | null
    catering: string | null
    decoration: string | null
    addons: string[]
    estimatedPrice: number | null
    upsells: string[]
  }
  salesCopilot: {
    expectedBudgetRange: string | null
    bookingProbability: 'HIGH' | 'MEDIUM' | 'LOW'
    bookingProbabilityReason: string
    nextFollowUpAction: string
    nextFollowUpTiming: string
    nextFollowUpChannel: string
    bestResponse: string
  }
}

const EVENT_ADVISOR_INSTRUCTION = `You are the AI Event Sales Advisor. From the CUSTOMER CONTEXT above (including "Available event packages" with their ids), do all of the following and respond with ONLY a single JSON object — no prose before or after, no markdown code fences.

1. Identify what you can about this lead's event from the context (conversation, preferences, notes): event type, guest count, budget, preferred date, food requirements, hall/venue requirements, room requirements. Use null for anything not evident — never invent a value.
2. Recommend ONE best-fit package FROM THE "Available event packages" LIST ONLY (use its exact id and name) — never invent a package, venue, or price not listed. If nothing fits well, set packageId/packageName to null and explain why in "catering"/"decoration" as best-effort text guidance instead.
3. Recommend catering and decoration notes, up to 3 relevant add-ons (from the package's own addons or the available add-on services in context), and an estimated total price (a number, built from the package base price plus any addons you recommend — never a price not derivable from the context).
4. As a sales copilot: estimate an expected budget range as free text (e.g. "Rs45,000 - 60,000"), a booking probability of HIGH/MEDIUM/LOW with a short reason, the single best next follow-up action/timing/channel, and the best next WhatsApp-style response to send this customer right now.

Respond with exactly this JSON shape (all keys required, use null/[] where you have nothing):
{"identified":{"eventType":string|null,"guestCount":number|null,"budget":string|null,"preferredDate":string|null,"foodRequirements":string|null,"hallRequirements":string|null,"roomRequirements":string|null},"recommendation":{"venue":string|null,"packageId":string|null,"packageName":string|null,"catering":string|null,"decoration":string|null,"addons":string[],"estimatedPrice":number|null,"upsells":string[]},"salesCopilot":{"expectedBudgetRange":string|null,"bookingProbability":"HIGH"|"MEDIUM"|"LOW","bookingProbabilityReason":string,"nextFollowUpAction":string,"nextFollowUpTiming":string,"nextFollowUpChannel":string,"bestResponse":string}}`

export type EventSalesAdvisorApiResult =
  | { ok: true; result: EventSalesAdvisorResult }
  | { ok: false; error: string }

/**
 * Structured (JSON) counterpart to runOperatorAssist() — same context,
 * same Anthropic client, same ai_interaction_log audit trail, but the model
 * is asked for one parseable object instead of free text so the result can
 * drive UI (a recommendation panel) and downstream automation (Smart
 * Proposal Generator auto-populate) directly, not just be read by a human.
 */
export async function runEventSalesAdvisor(
  context: AIContext,
  leadId: string | null,
  conversationId: string | null = null
): Promise<EventSalesAdvisorApiResult> {
  const startedAt = Date.now()
  try {
    const prompt = `You are assisting a BookMySpaces hotel/event-venue operator — you are NOT talking to the customer directly, you are helping the human operator who is.

CUSTOMER CONTEXT:
${formatContextForPrompt(context)}

TASK: ${EVENT_ADVISOR_INSTRUCTION}`

    const response = await getAnthropic().messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 900,
      messages: [{ role: 'user', content: prompt }],
    })

    const block = response.content[0]
    const raw = block?.type === 'text' ? block.text.trim() : ''
    if (!raw) throw new Error('Empty response from AI provider')

    // Defensive: strip accidental markdown fences even though the prompt
    // asks the model not to use them — cheap insurance against a parse
    // failure on an otherwise-correct response.
    const jsonText = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '')
    const parsed = JSON.parse(jsonText) as EventSalesAdvisorResult

    // Wider slice than the other logInteraction() call sites (2000 chars) —
    // this JSON payload is now a read path for Phase 6's "AI Recommendation
    // Success Rate" dashboard metric (revenue-intelligence.ts parses
    // recommendation.packageId back out of it), so truncating mid-JSON
    // would silently break that metric on verbose responses. 6000 chars
    // comfortably covers this call's max_tokens: 900 response.
    await logInteraction(leadId, conversationId, 'event_sales_advisor', JSON.stringify(parsed).slice(0, 6000), Date.now() - startedAt)
    return { ok: true, result: parsed }
  } catch (err) {
    logger.error('operator-assistant', 'Event Sales Advisor failed', err)
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Best-effort write to ai_interaction_log — migration 012 (see
 * supabase/migrations/012_v3_foundation_schema.sql, whose lead_id/
 * interaction_type/summary columns were added this same sprint after the
 * end-to-end workflow trace found timeline-service.ts already expected
 * them). Same fault-tolerance contract as every other Reservation Platform
 * write: a logging failure never fails the actual operator-facing feature.
 */
async function logInteraction(
  leadId: string | null,
  conversationId: string | null,
  // Widened from OperatorAssistAction to string: runEventSalesAdvisor()
  // logs under 'event_sales_advisor', a distinct action name from the
  // OperatorAssistAction union (it has its own structured-JSON return type,
  // not OperatorAssistResult) — this column is a free-text audit label,
  // not a foreign key, so widening it here is safe.
  action: OperatorAssistAction | string,
  summary: string,
  responseTimeMs: number
): Promise<void> {
  try {
    const supabase = getSupabaseAdmin()
    await supabase.from('ai_interaction_log').insert({
      lead_id: leadId,
      conversation_id: conversationId,
      interaction_type: action,
      summary,
      response_time_ms: responseTimeMs,
    })
  } catch {
    // Not live yet, or any other transient failure — this is an audit
    // trail, not a correctness requirement.
  }
}
