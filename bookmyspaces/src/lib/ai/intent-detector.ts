// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/ai/intent-detector.ts
// AI Orchestration Foundation — Phase 1A.
//
// Per the approved architecture: "Reuse buying_signals, chatWithAI(). No
// second AI classifier." This file is deliberately a thin, synchronous,
// zero-LLM-call wrapper around src/lib/extract-lead-details.ts's
// extractLeadDetails().buying_signals — the buying-signal table there is
// already a real, tested, regex-based intent signal
// (READY_TO_BOOK / AVAILABILITY_CHECK / PRICE_REQUEST / SITE_VISIT_REQUEST /
// COMPARISON_SHOPPING / HESITATION). This file adds nothing to that
// detection logic — it only picks one canonical Intent when several buying
// signals fire on the same message, and names the "nothing matched" case.
//
// Why chatWithAI() is NOT called from inside this file, even though the
// approved design lists it as a reused input: chatWithAI() is the
// customer-facing reply generator (src/lib/ai.ts) — it is expensive (a real
// LLM call) and it already runs once per turn wherever a channel actually
// wants an AI-generated reply (today: the website chat route). Calling it a
// second time here, purely to "detect intent," would duplicate that LLM
// call rather than reuse it, which the architecture explicitly rules out
// ("No second AI classifier"). Instead: when no buying signal matches, this
// module reports intent 'unclear' and the Decision Table (decision-table.ts)
// routes 'unclear' to the 'answer_immediately' action -- whose registered
// tool (tool-registry.ts) IS chatWithAI(). The open-ended understanding the
// architecture asks for happens exactly once, at the point the reply is
// actually generated, not as a separate up-front classification pass.
// ─────────────────────────────────────────────────────────────────────────────

import { extractLeadDetails } from '@/lib/extract-lead-details'

export type Intent =
  | 'ready_to_book'
  | 'availability_check'
  | 'price_request'
  | 'site_visit_request'
  | 'comparison_shopping'
  | 'hesitation'
  | 'unclear'

/**
 * Highest-priority signal wins when a message trips more than one buying
 * signal at once (extractBuyingSignals() in extract-lead-details.ts already
 * documents this as possible, e.g. "is it available on 12 Dec, how do I
 * book?" fires both AVAILABILITY_CHECK and READY_TO_BOOK). Ready-to-book is
 * ranked highest because acting on it (recommend a package / generate a
 * proposal) is the most valuable and time-sensitive action available;
 * hesitation is ranked lowest because it is the least actionable in the
 * moment (its only real handling is "schedule a follow-up," not "act now").
 */
const SIGNAL_PRIORITY: string[] = [
  'READY_TO_BOOK',
  'AVAILABILITY_CHECK',
  'PRICE_REQUEST',
  'SITE_VISIT_REQUEST',
  'COMPARISON_SHOPPING',
  'HESITATION',
]

const SIGNAL_TO_INTENT: Record<string, Intent> = {
  READY_TO_BOOK: 'ready_to_book',
  AVAILABILITY_CHECK: 'availability_check',
  PRICE_REQUEST: 'price_request',
  SITE_VISIT_REQUEST: 'site_visit_request',
  COMPARISON_SHOPPING: 'comparison_shopping',
  HESITATION: 'hesitation',
}

export interface DetectIntentResult {
  intent: Intent
  /** Every buying signal extractLeadDetails() found, for observability/debugging -- not just the one that won. */
  matchedSignals: string[]
}

/**
 * Picks one canonical Intent from an already-extracted buying_signals list.
 * Split out from detectIntent() so a caller that has already run
 * extractLeadDetails() for another reason (e.g. the orchestration engine,
 * which also needs the same call's event_type/guest_count/budget for Slot
 * Memory) doesn't have to run the regex extraction a second time just to
 * get the intent.
 */
export function intentFromSignals(buying_signals: string[] | null | undefined): DetectIntentResult {
  if (!buying_signals || buying_signals.length === 0) {
    return { intent: 'unclear', matchedSignals: [] }
  }

  for (const signal of SIGNAL_PRIORITY) {
    if (buying_signals.includes(signal)) {
      return { intent: SIGNAL_TO_INTENT[signal], matchedSignals: buying_signals }
    }
  }

  // Defensive fallback: extractLeadDetails() returned a signal name this
  // module doesn't recognise (e.g. the table in extract-lead-details.ts
  // grows a new category later). Never throw -- degrade to 'unclear' rather
  // than silently picking an unlisted signal.
  return { intent: 'unclear', matchedSignals: buying_signals }
}

/**
 * Deterministic, synchronous, no network/LLM call. Safe to call on every
 * inbound message without any latency or cost concern. Convenience
 * single-argument form for direct/standalone use and tests; runs
 * extractLeadDetails() itself. See intentFromSignals() to reuse an
 * already-computed extraction instead.
 */
export function detectIntent(message: string): DetectIntentResult {
  const { buying_signals } = extractLeadDetails(message)
  return intentFromSignals(buying_signals)
}
