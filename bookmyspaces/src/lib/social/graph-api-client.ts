// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/social/graph-api-client.ts
// Meta integration hardening pass — shared Graph API caller.
//
// Before this file: meta-adapter.ts (publishPost's 3 call sites,
// replyToInteraction) and meta-lead-capture.ts (fetchLeadgenDetails) each
// hand-rolled their own fetch + JSON-parse + error-shape handling, none of
// them logged anything, and none of them retried a transient failure — a
// single 5xx from Graph permanently failed that publish/reply/fetch, the
// same gap sendWhatsAppTemplate() had before its own retry fix. This is the
// one place that logic lives now; every Graph caller in src/lib/social
// should go through here instead of calling fetch() directly.
//
// Retry policy: only on 5xx/network errors (a transient Graph/infra issue) —
// never on 4xx (bad request, invalid token, permission denied), since
// retrying a client error just repeats the same failure 3x slower and can
// duplicate the resulting side effect (e.g. a re-tried publish creating two
// posts) if Graph partially applied the request before erroring.
// ─────────────────────────────────────────────────────────────────────────────

import { logger } from '@/lib/logger'

const MAX_RETRIES    = 2
const RETRY_DELAY_MS = 500

interface GraphErrorBody {
  error?: { message?: string; code?: number; error_subcode?: number; fbtrace_id?: string }
}

export interface GraphAPIResult<T> {
  ok: boolean
  status: number
  data: (T & GraphErrorBody) | null
  error: string | null
}

/**
 * Calls the Meta Graph API with retry-with-backoff on 5xx/network failures,
 * structured logging on every failed attempt, and consistent error-shape
 * extraction (Graph's `{error:{message,code,...}}` body). `context` is a
 * short tag identifying the call site for logs, e.g. 'publish-fb-feed',
 * 'fetch-leadgen-details'.
 */
export async function callGraphAPI<T = Record<string, unknown>>(
  url: string,
  options: RequestInit,
  context: string
): Promise<GraphAPIResult<T>> {
  let lastError: string | null = null
  let lastStatus = 0

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res  = await fetch(url, options)
      const json = (await res.json().catch(() => ({}))) as T & GraphErrorBody

      if (res.ok && !json?.error) {
        return { ok: true, status: res.status, data: json, error: null }
      }

      lastStatus = res.status
      lastError  = json?.error?.message ?? `graph_error_${res.status}`

      // 4xx: not retryable — permission/token/validation errors don't fix
      // themselves on retry, and Graph may have partially applied the
      // request (e.g. a container created before the 4xx on publish).
      if (res.status < 500) {
        logger.error('meta-graph', `${context} failed (non-retryable, status ${res.status})`, lastError, {
          code: json?.error?.code, subcode: json?.error?.error_subcode, fbtrace_id: json?.error?.fbtrace_id,
        })
        return { ok: false, status: res.status, data: json, error: lastError }
      }

      logger.error('meta-graph', `${context} attempt ${attempt + 1}/${MAX_RETRIES + 1} failed (status ${res.status})`, lastError)
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
      logger.error('meta-graph', `${context} attempt ${attempt + 1}/${MAX_RETRIES + 1} threw`, lastError)
    }

    if (attempt < MAX_RETRIES) {
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)))
    }
  }

  logger.error('meta-graph', `${context}: all retries exhausted`, lastError)
  return { ok: false, status: lastStatus, data: null, error: lastError }
}
