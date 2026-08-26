import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV, META_PAGE_ID: 'page-123', META_PAGE_ACCESS_TOKEN: 'not-a-real-token' }
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
  vi.unstubAllGlobals()
})

import { sendFacebookMessage } from './facebook-send'

describe('sendFacebookMessage', () => {
  it('sends successfully and returns the external message id', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, opts: { body: string }) => {
      const body = JSON.parse(opts.body)
      expect(url).toContain('/page-123/messages')
      expect(body.messaging_type).toBe('RESPONSE')
      expect(body.recipient).toEqual({ id: 'psid-1' })
      expect(body.message).toEqual({ text: 'hello there' })
      expect(body.access_token).toBe('not-a-real-token')
      return new Response(JSON.stringify({ recipient_id: 'psid-1', message_id: 'mid.out.fb.1' }), { status: 200 })
    }))

    const result = await sendFacebookMessage('psid-1', 'hello there')
    expect(result).toEqual({ success: true, externalMessageId: 'mid.out.fb.1' })
  })

  it('fails cleanly when META_PAGE_ID is not configured', async () => {
    delete process.env.META_PAGE_ID
    const result = await sendFacebookMessage('psid-1', 'hi')
    expect(result).toEqual({ success: false, error: 'not_configured' })
  })

  it('fails cleanly when META_PAGE_ACCESS_TOKEN is not configured', async () => {
    delete process.env.META_PAGE_ACCESS_TOKEN
    const result = await sendFacebookMessage('psid-1', 'hi')
    expect(result).toEqual({ success: false, error: 'not_configured' })
  })

  it('reports failure (never success) when the Graph API call fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message: 'permission denied' } }), { status: 403 })))
    const result = await sendFacebookMessage('psid-1', 'hi')
    expect(result.success).toBe(false)
    expect(result.error).toBe('permission denied')
  })

  it('never includes the access token in the returned result', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message: 'bad' } }), { status: 400 })))
    const result = await sendFacebookMessage('psid-1', 'hi')
    expect(JSON.stringify(result)).not.toContain('not-a-real-token')
  })
})
