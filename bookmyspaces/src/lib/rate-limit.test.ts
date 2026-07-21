import { describe, it, expect, beforeEach } from 'vitest'
import { checkRateLimit, resetRateLimitStore } from './rate-limit'

beforeEach(() => resetRateLimitStore())

describe('checkRateLimit', () => {
  it('allows up to the limit then blocks with a retry hint', () => {
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit('ip1', { limit: 5, windowMs: 60000 }).allowed).toBe(true)
    }
    const blocked = checkRateLimit('ip1', { limit: 5, windowMs: 60000 })
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0)
  })

  it('tracks keys independently', () => {
    for (let i = 0; i < 5; i++) checkRateLimit('ip1', { limit: 5, windowMs: 60000 })
    expect(checkRateLimit('ip2', { limit: 5, windowMs: 60000 }).allowed).toBe(true)
  })

  it('frees the window as time passes', () => {
    const realNow = Date.now
    let t = 1_000_000
    Date.now = () => t
    try {
      for (let i = 0; i < 3; i++) checkRateLimit('ip1', { limit: 3, windowMs: 1000 })
      expect(checkRateLimit('ip1', { limit: 3, windowMs: 1000 }).allowed).toBe(false)
      t += 1500
      expect(checkRateLimit('ip1', { limit: 3, windowMs: 1000 }).allowed).toBe(true)
    } finally {
      Date.now = realNow
    }
  })
})
