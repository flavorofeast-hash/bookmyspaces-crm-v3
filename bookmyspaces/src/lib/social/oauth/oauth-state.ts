// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/social/oauth/oauth-state.ts
// Facebook/Instagram connector recovery — ported from
// release/v1.0.0-stabilization, verbatim (platform-agnostic already; no
// trimming needed). See oauth-config.ts's header for why this recovery is
// scoped to Facebook/Instagram only.
//
// Serverless (Vercel) has no reliable server-side session to stash a CSRF
// nonce in between the redirect-out and the provider's redirect-back.
// Standard fix: encode everything the callback needs INTO the state param
// itself, HMAC-signed so it can't be tampered with. Reuses Node's built-in
// crypto (no new dependency).
// ─────────────────────────────────────────────────────────────────────────────

import crypto from 'crypto'
import type { OAuthCapablePlatform } from './oauth-config'

export interface OAuthStatePayload {
  platform: OAuthCapablePlatform
  userId: string
  /** Random nonce — the actual CSRF-defeating value; verified byte-for-byte, never reused. */
  nonce: string
  issuedAt: number
}

function getStateSecret(): Buffer {
  const raw = process.env.SOCIAL_OAUTH_STATE_SECRET
  if (!raw) throw new Error('oauth_not_configured: set SOCIAL_OAUTH_STATE_SECRET (any random 32+ char string) in env')
  return Buffer.from(raw, 'utf8')
}

export function isOAuthStateConfigured(): boolean {
  return Boolean(process.env.SOCIAL_OAUTH_STATE_SECRET)
}

/** Signs and base64url-encodes the payload. The state param sent to the provider IS this string — nothing is stored server-side. */
export function encodeOAuthState(payload: OAuthStatePayload): string {
  const json = JSON.stringify(payload)
  const body = Buffer.from(json, 'utf8').toString('base64url')
  const sig = crypto.createHmac('sha256', getStateSecret()).update(body).digest('base64url')
  return `${body}.${sig}`
}

/** Verifies the HMAC and a max-age window (10 minutes — generous for a redirect round trip, short enough that a leaked/logged state param is useless soon after). Returns null on any failure (bad signature, expired, malformed) — callback treats this as a rejected login, never a partial trust. */
export function decodeOAuthState(state: string, maxAgeMs = 10 * 60_000): OAuthStatePayload | null {
  try {
    const [body, sig] = state.split('.')
    if (!body || !sig) return null

    const expectedSig = crypto.createHmac('sha256', getStateSecret()).update(body).digest('base64url')
    // Timing-safe compare — a state param is attacker-controlled input.
    const a = Buffer.from(sig)
    const b = Buffer.from(expectedSig)
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null

    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as OAuthStatePayload
    if (typeof payload.issuedAt !== 'number' || Date.now() - payload.issuedAt > maxAgeMs) return null
    if (!payload.platform || !payload.userId || !payload.nonce) return null

    return payload
  } catch {
    return null
  }
}
