'use client'

// ─────────────────────────────────────────────────────────────────────────────
// Revenue Attribution Priority 2 — client-safe click beacon.
//
// Non-blocking, fire-and-forget: uses fetch(..., {keepalive:true}) so the
// request survives page unload (the browser navigates away immediately for
// tel:/wa.me/external links) without ever calling preventDefault() on the
// triggering click. Deliberately never awaited by callers and never throws
// — a tracking failure must never block or break the underlying
// call/WhatsApp/website navigation, which is the actual revenue-critical
// action.
// ─────────────────────────────────────────────────────────────────────────────

export type ClickTrackType = 'whatsapp' | 'call' | 'website'

export interface ClickTrackPayload {
  type: ClickTrackType
  target: string
  sessionId?: string | null
  leadId?: string | null
  campaign?: string | null
  page?: string | null
  /** End-to-End Campaign Attribution — the Business Package this click's landing page resolved to, if any. */
  businessPackageId?: string | null
}

export function trackClick(payload: ClickTrackPayload): void {
  try {
    fetch('/api/track/click', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, page: payload.page ?? (typeof window !== 'undefined' ? window.location.pathname : null) }),
      keepalive: true,
    }).catch(() => {})
  } catch {
    // Beacon is best-effort only — never let a tracking error surface.
  }
}
