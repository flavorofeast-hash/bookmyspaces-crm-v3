// src/lib/google/gbp-oauth-state.ts
// Stateless, HMAC-signed OAuth state for the GBP connect/callback round trip.
//
// Replaces the original httpOnly-cookie-based state (see git history on
// connect/route.ts and callback/route.ts): production logs showed the cookie
// arriving at the callback (hasStateCookie: true) but its value not matching
// the state Google echoed back -- the same class of problem
// src/lib/social/oauth/oauth-state.ts's own header already documents:
// "Serverless (Vercel) has no reliable server-side session to stash a CSRF
// nonce in between the redirect-out and the provider's redirect-back."
// That file solved it for Facebook/Instagram by encoding everything the
// callback needs INTO the signed state param itself, so there is nothing to
// stash or look up. Same technique here, GBP-specific payload shape (that
// file's OAuthStatePayload.platform is typed to Facebook/Instagram only, so
// it can't be reused directly for GBP).

import crypto from 'crypto'

export interface GbpOAuthStatePayload {
  userId: string
  /** Random nonce -- the actual CSRF-defeating value; verified byte-for-byte, never reused. */
  nonce: string
  issuedAt: number
}

function getStateSecret(): Buffer {
  const raw = process.env.SOCIAL_OAUTH_STATE_SECRET
  if (!raw) throw new Error('oauth_not_configured: set SOCIAL_OAUTH_STATE_SECRET (any random 32+ char string) in env')
  return Buffer.from(raw, 'utf8')
}

export function isGbpOAuthStateConfigured(): boolean {
  return Boolean(process.env.SOCIAL_OAUTH_STATE_SECRET)
}

/** Signs and base64url-encodes the payload. The state param sent to Google IS this string -- nothing stored server-side, no cookie. */
export function encodeGbpOAuthState(payload: GbpOAuthStatePayload): string {
  const json = JSON.stringify(payload)
  const body = Buffer.from(json, 'utf8').toString('base64url')
  const sig = crypto.createHmac('sha256', getStateSecret()).update(body).digest('base64url')
  return `${body}.${sig}`
}

/** Verifies the HMAC and a max-age window. Returns null on any failure (bad signature, expired, malformed) -- callback treats this as a rejected attempt, never a partial trust. */
export function decodeGbpOAuthState(state: string, maxAgeMs = 10 * 60_000): GbpOAuthStatePayload | null {
  try {
    const [body, sig] = state.split('.')
    if (!body || !sig) return null

    const expectedSig = crypto.createHmac('sha256', getStateSecret()).update(body).digest('base64url')
    // Timing-safe compare -- a state param is attacker-controlled input.
    const a = Buffer.from(sig)
    const b = Buffer.from(expectedSig)
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null

    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as GbpOAuthStatePayload
    if (typeof payload.issuedAt !== 'number' || Date.now() - payload.issuedAt > maxAgeMs) return null
    if (!payload.userId || !payload.nonce) return null

    return payload
  } catch {
    return null
  }
}
