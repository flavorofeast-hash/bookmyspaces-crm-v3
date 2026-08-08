// src/modules/followups/followup-rules.ts
//
// ⚠️ DEPRECATED — DEAD CODE, CONFIRMED UNREFERENCED (Production
// Stabilization, Priority 3, verified via repo-wide grep for
// `followup-rules`/`modules/followups` before this note was added: zero
// `import` statements anywhere in src/, only a handful of comments in
// unrelated files mentioning it historically). Never wired to any live
// route or cron. Superseded by three real, live systems: the AI Follow-up
// Assistant (src/app/api/cron/ai-followup-assistant/route.ts + its drain
// cron src/app/api/cron/followups/route.ts), Marketing Automations
// (src/app/api/cron/marketing-automations/route.ts), and WhatsApp Drip
// Sequences (src/lib/whatsapp/drip-service.ts) — all three now coordinated
// by the shared Messaging Orchestrator (src/lib/messaging/orchestrator.ts).
// This file could not be deleted in this environment (no file-delete
// permission on the mounted repo) — safe to remove entirely in a follow-up
// change; do not import from it.
//
// Defines follow-up cadence rules per lead temperature.
// Pure data — no side effects. Import into scheduler and engine.

import { LeadTemperature } from '../leads/types';

// ─── Cadence definition ───────────────────────────────────────────────────────

export interface CadenceStep {
  delayHours   : number;   // hours after previous contact (or creation)
  triggerReason: string;   // logged in followup_queue.trigger_reason
}

export interface TemperatureCadence {
  temperature  : LeadTemperature;
  steps        : CadenceStep[];
  maxFollowUps : number;
}

// HOT: fast, aggressive — 2h → 12h → 24h
// WARM: moderate — 24h → 72h
// COLD: nurture — weekly (168h)

export const CADENCE_RULES: Record<LeadTemperature, TemperatureCadence> = {
  HOT: {
    temperature : 'HOT',
    maxFollowUps: 5,
    steps: [
      { delayHours: 2,   triggerReason: 'hot_lead_2h'  },
      { delayHours: 12,  triggerReason: 'hot_lead_12h' },
      { delayHours: 24,  triggerReason: 'hot_lead_24h' },
      { delayHours: 48,  triggerReason: 'hot_lead_48h' },
      { delayHours: 72,  triggerReason: 'hot_lead_72h' },
    ],
  },
  WARM: {
    temperature : 'WARM',
    maxFollowUps: 3,
    steps: [
      { delayHours: 24,  triggerReason: 'warm_lead_24h' },
      { delayHours: 72,  triggerReason: 'warm_lead_72h' },
      { delayHours: 168, triggerReason: 'warm_lead_7d'  },
    ],
  },
  COLD: {
    temperature : 'COLD',
    maxFollowUps: 2,
    steps: [
      { delayHours: 168, triggerReason: 'cold_lead_7d'  },
      { delayHours: 336, triggerReason: 'cold_lead_14d' },
    ],
  },
};

// ─── Message templates per trigger ───────────────────────────────────────────

export function buildFollowUpMessage(
  triggerReason: string,
  leadName     : string | null,
  eventType    : string | null,
): string {
  const name = leadName ? leadName.split(' ')[0] : 'there';
  const event = eventType?.toLowerCase() ?? 'event';

  const templates: Record<string, string> = {
    hot_lead_2h:
      `Hi ${name}! 👋 Just checking in — did you have any questions about your ${event} at BookMySpaces? We're here to help you plan the perfect celebration.`,

    hot_lead_12h:
      `Hello ${name}! We noticed your inquiry about a ${event} venue. Our team would love to help you finalize the details. Would you like to schedule a quick call or visit?`,

    hot_lead_24h:
      `Hi ${name}, we want to make sure your ${event} is perfectly planned! We have some great options available. Shall we discuss further? 😊`,

    hot_lead_48h:
      `Hi ${name}! Your ${event} inquiry is still open with us. If you need any changes to requirements or have budget questions, feel free to ask anytime.`,

    hot_lead_72h:
      `Hello ${name}! We'd love to host your ${event} at BookMySpaces. If you're comparing venues, we're happy to offer a special arrangement for your group. Let us know! 🙏`,

    warm_lead_24h:
      `Hi ${name}! Following up on your venue inquiry. We'd love to help you plan a memorable ${event}. Any questions we can answer for you?`,

    warm_lead_72h:
      `Hello ${name}! We wanted to touch base about your ${event} plans. BookMySpaces has some beautiful arrangements available — happy to share details!`,

    warm_lead_7d:
      `Hi ${name}, we hope your ${event} planning is going well! If you're still looking for the right venue, we'd love to welcome you at BookMySpaces. 🎉`,

    cold_lead_7d:
      `Hello ${name}! We hope all is well. We're reaching out in case you're still planning your ${event}. BookMySpaces has new packages available — would you like to know more?`,

    cold_lead_14d:
      `Hi ${name}! It's been a while since we connected. If your ${event} plans are back on track, BookMySpaces is ready to help. Feel free to message us anytime! 😊`,
  };

  return templates[triggerReason]
    ?? `Hi ${name}! Just checking in about your ${event} inquiry at BookMySpaces. We're here whenever you're ready! 🙏`;
}

// ─── Retry backoff ────────────────────────────────────────────────────────────
// Returns delay in minutes before next retry attempt.

export function retryDelayMinutes(attemptNumber: number): number {
  // Exponential backoff: 5m → 15m → 45m
  const delays = [5, 15, 45];
  return delays[Math.min(attemptNumber - 1, delays.length - 1)];
}
