// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/social/oauth/oauth-state.ts
// Social Connectivity Priority 1 — stateless, signed OAuth `state` parameter.
//
// Serverless (Vercel) has no reliable server-side session to stash a CSRF
// nonce/PKCE verifier in between the redirect-out and the provider's
// redirect-back. Standard fix: encode everything the callback needs INTO
// the state param itself, HMAC-signed so it can't be tampered with. Same
// "encrypt/sign rather than trust a server-side store" posture as
// token-cipher.ts, reusing Node's built-in crypto (no new dependency).
// ─────────────────────────────────────────────────────────────────────────────

import crypto from 'crypto'
import type { OAuthCapablePlatform } from './oauth-config'

export interface OAuthStatePayload {
  platform: OAuthCapablePlatform
  userId: string
  /** Random nonce — the actual CSRF-defeating value; verified byte-for-byte, never reused. */
  nonce: string
  issuedAt: number
  /** PKCE code_verifier, only present for platforms with usesPkce=true (X). Never logged. */
  codeVerifier?: string
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

/** PKCE (X / OAuth 2.0): code_verifier (43-128 char unreserved-charset string) + its S256 code_challenge. */
export function generatePkcePair(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = crypto.randomBytes(48).toString('base64url')
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url')
  return { codeVerifier, codeChallenge }
}
