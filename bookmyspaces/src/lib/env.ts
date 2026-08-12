// src/lib/env.ts
// ─────────────────────────────────────────────────────────────────────────────
// ISS-036/ISS-050 (audit/MASTER_ISSUE_REGISTER.csv): there was no centralized
// env var configuration or startup validation. Each file read process.env
// directly, so a missing/misspelled var only surfaced as a runtime error deep
// inside whatever feature happened to touch it — often minutes or requests
// later, with no clear message pointing back to the actual cause.
//
// This module is the single place that knows which env vars the app needs,
// which are hard-required vs optional, and validates them eagerly. Import
// `assertEnv()` from src/instrumentation.ts so validation runs once at
// server startup, not scattered across request handlers.
//
// Design choice: REQUIRED vars throw (the app genuinely cannot serve any
// request without them). OPTIONAL vars only warn — this matches the
// graceful-degradation pattern already established elsewhere in this
// codebase (see WHATSAPP_APP_SECRET in whatsapp/webhook/route.ts and
// CRON_SECRET in cron/*/route.ts, both of which fail open with a console
// warning rather than crashing when unset).
// ─────────────────────────────────────────────────────────────────────────────

import { z } from 'zod'

const requiredSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL     : z.string().url({ message: 'must be a valid URL, e.g. https://xxxx.supabase.co' }),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY    : z.string().min(1),
  ANTHROPIC_API_KEY            : z.string().min(1),
})

// Optional vars: not validated for shape, only checked for presence so we can
// warn. Grouped by feature so the startup log tells you which *feature* is
// degraded, not just which env var name is blank.
const OPTIONAL_VARS: Record<string, string[]> = {
  'RAG / embeddings (OpenAI fallback)'      : ['OPENAI_API_KEY'],
  'Google Sheets sync'                      : ['GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_PRIVATE_KEY', 'GOOGLE_SHEETS_ID'],
  'WhatsApp (Meta Cloud API)'               : ['WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_WEBHOOK_VERIFY_TOKEN'],
  'WhatsApp webhook signature verification' : ['WHATSAPP_APP_SECRET'],
  'Cron endpoint authentication'            : ['CRON_SECRET'],
  'Transactional email (Resend)'            : ['RESEND_API_KEY', 'EMAIL_FROM'],
  'Secondary WhatsApp subsystem (Wati)'     : ['WATI_BASE_URL', 'WATI_API_TOKEN'],
  // RC blocker fix — Social OAuth connect flow (Facebook/Instagram share
  // META_APP_ID/META_APP_SECRET via Meta Login; Google Business/LinkedIn/X
  // each have their own client id/secret env vars, already validated
  // per-platform at request time by isOAuthConfigured() in oauth-config.ts).
  // Same graceful-degradation posture as every other integration here: the
  // rest of the CRM works fine without these, only the OAuth connect
  // buttons are disabled/degraded until they're set — so this warns at
  // startup rather than throwing, consistent with WhatsApp/Resend/Wati
  // above, not the hard-required Supabase/Anthropic vars.
  'Social OAuth connect flow (Facebook/Instagram)': ['META_APP_ID', 'META_APP_SECRET'],
  'Social OAuth state signing (all platforms)'    : ['SOCIAL_OAUTH_STATE_SECRET'],
  // RC Phase 2 (environment audit) — this was previously read by the OAuth
  // routes and share-link generators with no startup diagnostic at all, so
  // its absence only surfaced as a request-time 503/wrong-link. Same
  // graceful-warn posture as everything else in this list.
  'App base URL (OAuth redirects, share links)'   : ['NEXT_PUBLIC_APP_URL'],
}

let validated = false

/**
 * Validates required env vars (throws with a clear message if any are
 * missing/malformed) and logs a one-time warning report for missing optional
 * vars, grouped by the feature they'd disable. Safe to call multiple times —
 * only does real work once per process.
 */
export function assertEnv(): void {
  if (validated) return
  validated = true

  const result = requiredSchema.safeParse(process.env)
  if (!result.success) {
    const missing = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n')
    const message =
      `\n[env] Missing or invalid required environment variables:\n${missing}\n` +
      `[env] The app cannot serve requests correctly without these. Check .env.local ` +
      `against .env.example, or the Vercel project's Environment Variables settings.\n`
    console.error(message)
    throw new Error('[env] Required environment variables are missing or invalid — see log above.')
  }

  const missingOptionalByFeature: string[] = []
  for (const [feature, vars] of Object.entries(OPTIONAL_VARS)) {
    const missing = vars.filter((v) => !process.env[v])
    if (missing.length > 0) {
      missingOptionalByFeature.push(`  - ${feature}: missing ${missing.join(', ')} — this feature is disabled/degraded, not a hard failure.`)
    }
  }

  if (missingOptionalByFeature.length > 0) {
    console.warn(`\n[env] Optional environment variables not set (features running in degraded mode):\n${missingOptionalByFeature.join('\n')}\n`)
  } else {
    console.log('[env] All required and optional environment variables are configured.')
  }
}

/** Typed, validated access to the required vars — use instead of raw process.env where practical. */
export function getRequiredEnv() {
  assertEnv()
  return requiredSchema.parse(process.env)
}
