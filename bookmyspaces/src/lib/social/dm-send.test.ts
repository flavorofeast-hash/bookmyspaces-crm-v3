import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/social/dm-send.test.ts
// Version 2.0 — Omnichannel Communication Platform.
// Same credential-gating contract as meta-adapter.test.ts's own tests for
// publishPost/replyToInteraction: returns ok:false with a clear reason when
// unconfigured, never throws.
// ─────────────────────────────────────────────────────────────────────────────

const originalEnv = { ...process.env }

describe('sendMetaDirectMessage', () => {
  beforeEach(() => {
    vi.resetModules()
    process.env = { ...originalEnv }
    delete process.env.META_PAGE_ACCESS_TOKEN
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    vi.unstubAllGlobals()
  })

  it('returns ok:false without ever calling fetch when META_PAGE_ACCESS_TOKEN is unset', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const { sendMetaDirectMessage, isMetaDMConfigured } = await import('./dm-send')

    expect(isMetaDMConfigured()).toBe(false)
    const result = await sendMetaDirectMessage('psid-1', 'hello')

    expect(result).toEqual({ ok: false, error: 'meta_not_configured: set META_PAGE_ACCESS_TOKEN' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('rejects an empty message before calling fetch, even when configured', async () => {
    process.env.META_PAGE_ACCESS_TOKEN = 'token-123'
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const { sendMetaDirectMessage } = await import('./dm-send')
    const result = await sendMetaDirectMessage('psid-1', '   ')

    expect(result).toEqual({ ok: false, error: 'empty_message' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('POSTs to the Graph Send API and returns the message id on success', async () => {
    process.env.META_PAGE_ACCESS_TOKEN = 'token-123'
    const fetchSpy = vi.fn((..._args: unknown[]) =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ message_id: 'mid-1' }) })
    )
    vi.stubGlobal('fetch', fetchSpy)

    const { sendMetaDirectMessage } = await import('./dm-send')
    const result = await sendMetaDirectMessage('psid-1', 'Hello from Aria!')

    expect(result).toEqual({ ok: true, externalMessageId: 'mid-1' })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, options] = fetchSpy.mock.calls[0]
    expect(String(url)).toContain('/me/messages')
    expect(String(url)).toContain('access_token=token-123')
    const body = JSON.parse((options as RequestInit).body as string)
    expect(body).toEqual({
      recipient: { id: 'psid-1' },
      message: { text: 'Hello from Aria!' },
      messaging_type: 'RESPONSE',
    })
  })

  it('returns ok:false (never throws) on a Graph API error response', async () => {
    process.env.META_PAGE_ACCESS_TOKEN = 'token-123'
    const fetchSpy = vi.fn(() =>
      Promise.resolve({ ok: false, status: 400, json: () => Promise.resolve({ error: { message: 'Invalid PSID' } }) })
    )
    vi.stubGlobal('fetch', fetchSpy)

    const { sendMetaDirectMessage } = await import('./dm-send')
    const result = await sendMetaDirectMessage('bad-psid', 'hi')

    expect(result).toEqual({ ok: false, error: 'Invalid PSID' })
  })

  it('returns ok:false (never throws) when fetch itself rejects', async () => {
    process.env.META_PAGE_ACCESS_TOKEN = 'token-123'
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network error'))))

    const { sendMetaDirectMessage } = await import('./dm-send')
    const result = await sendMetaDirectMessage('psid-1', 'hi')

    expect(result).toEqual({ ok: false, error: 'network error' })
  })
})
