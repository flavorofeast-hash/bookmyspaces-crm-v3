// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/rate-limit.ts
// V3 — rate limiting for public routes (VERSION1_1 Tier 1 #5: none existed
// beyond the WhatsApp-specific queue throttle).
//
// In-memory sliding window, per key (typically IP). HONEST SCOPE NOTE: on
// Vercel serverless each warm instance has its own memory, so the real
// ceiling is (limit × concurrent instances) — this blunts abuse and
// accidental loops rather than being a hard global cap. A Redis/Upstash
// backend can replace the store behind the same check() signature when a
// hard cap is needed; taking the in-memory version now is the deliberate
// Tier-1 trade (protection today, zero new infrastructure/credentials).
// ─────────────────────────────────────────────────────────────────────────────

interface Window { timestamps: number[] }

const store = new Map<string, Window>()
const MAX_KEYS = 10_000 // bound memory; oldest-touched evicted

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  retryAfterSeconds: number
}

export function checkRateLimit(
  key: string,
  opts: { limit: number; windowMs: number }
): RateLimitResult {
  const now = Date.now()
  const cutoff = now - opts.windowMs

  let win = store.get(key)
  if (!win) {
    if (store.size >= MAX_KEYS) {
      const first = store.keys().next().value
      if (first !== undefined) store.delete(first)
    }
    win = { timestamps: [] }
    store.set(key, win)
  } else {
    // Map iteration order is insertion order; re-inserting keeps
    // frequently-used keys away from the eviction end.
    store.delete(key)
    store.set(key, win)
  }

  win.timestamps = win.timestamps.filter((t) => t > cutoff)

  if (win.timestamps.length >= opts.limit) {
    const oldest = win.timestamps[0]
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((oldest + opts.windowMs - now) / 1000)),
    }
  }

  win.timestamps.push(now)
  return { allowed: true, remaining: opts.limit - win.timestamps.length, retryAfterSeconds: 0 }
}

/** Client IP from proxy headers (Vercel sets x-forwarded-for). */
export function clientIpFrom(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0].trim()
  return req.headers.get('x-real-ip') ?? 'unknown'
}

/** Test hook. */
export function resetRateLimitStore(): void {
  store.clear()
}
