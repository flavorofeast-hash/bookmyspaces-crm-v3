import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { encodeOAuthState, decodeOAuthState, isOAuthStateConfigured, generatePkcePair, type OAuthStatePayload } from './oauth-state'

describe('oauth-state', () => {
  const ORIGINAL_ENV = process.env

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV, SOCIAL_OAUTH_STATE_SECRET: 'test-secret-at-least-32-characters-long' }
  })

  afterEach(() => {
    process.env = ORIGINAL_ENV
  })

  const basePayload: OAuthStatePayload = {
    platform: 'facebook',
    userId: 'user-123',
    nonce: 'nonce-abc',
    issuedAt: Date.now(),
  }

  it('isOAuthStateConfigured reflects whether SOCIAL_OAUTH_STATE_SECRET is set', () => {
    expect(isOAuthStateConfigured()).toBe(true)
    delete process.env.SOCIAL_OAUTH_STATE_SECRET
    expect(isOAuthStateConfigured()).toBe(false)
  })

  it('round-trips a valid payload', () => {
    const state = encodeOAuthState(basePayload)
    const decoded = decodeOAuthState(state)
    expect(decoded).toEqual(basePayload)
  })

  it('round-trips a payload with a PKCE codeVerifier (X)', () => {
    const payload: OAuthStatePayload = { ...basePayload, platform: 'x', codeVerifier: 'verifier-xyz' }
    const state = encodeOAuthState(payload)
    expect(decodeOAuthState(state)).toEqual(payload)
  })

  it('rejects a tampered state (body modified after signing)', () => {
    const state = encodeOAuthState(basePayload)
    const [body, sig] = state.split('.')
    const tamperedBody = Buffer.from(JSON.stringify({ ...basePayload, userId: 'attacker' }), 'utf8').toString('base64url')
    expect(decodeOAuthState(`${tamperedBody}.${sig}`)).toBeNull()
  })

  it('rejects a state signed with a different secret', () => {
    const state = encodeOAuthState(basePayload)
    process.env.SOCIAL_OAUTH_STATE_SECRET = 'a-completely-different-secret-value-here'
    expect(decodeOAuthState(state)).toBeNull()
  })

  it('rejects an expired state (older than maxAgeMs)', () => {
    const old: OAuthStatePayload = { ...basePayload, issuedAt: Date.now() - 20 * 60_000 }
    const state = encodeOAuthState(old)
    expect(decodeOAuthState(state, 10 * 60_000)).toBeNull()
  })

  it('rejects malformed input', () => {
    expect(decodeOAuthState('not-a-valid-state')).toBeNull()
    expect(decodeOAuthState('')).toBeNull()
  })

  it('generatePkcePair returns a verifier and a distinct S256 challenge', () => {
    const { codeVerifier, codeChallenge } = generatePkcePair()
    expect(codeVerifier.length).toBeGreaterThanOrEqual(43)
    expect(codeChallenge).not.toBe(codeVerifier)
    expect(typeof codeChallenge).toBe('string')
  })
})
