import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const state = {
  connectedAccount: { id: 'acct-1', displayName: 'skyline.monurama', externalAccountId: '17841478674706194' } as
    { id: string; displayName: string; externalAccountId: string } | null,
  tokenRow: { access_token_encrypted: 'iv:tag:ciphertext' } as { access_token_encrypted: string } | null,
}

vi.mock('@/lib/social/social-account-routing', () => ({
  findConnectedSocialAccount: () => Promise.resolve(state.connectedAccount),
}))

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table !== 'social_accounts') throw new Error(`unexpected table: ${table}`)
      return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: state.tokenRow, error: null }) }) }) }
    },
  }),
}))

vi.mock('@/lib/social/token-cipher', () => ({
  decryptToken: (stored: string) => {
    if (stored === 'throw') throw new Error('malformed_encrypted_token')
    return 'decrypted-real-token-never-logged'
  },
}))

import { sendInstagramMessage } from './instagram-send'

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  state.connectedAccount = { id: 'acct-1', displayName: 'skyline.monurama', externalAccountId: '17841478674706194' }
  state.tokenRow = { access_token_encrypted: 'iv:tag:ciphertext' }
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
  vi.unstubAllGlobals()
})

describe('sendInstagramMessage', () => {
  it('sends successfully and returns the external message id', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, opts: { body: string }) => {
      const body = JSON.parse(opts.body)
      expect(url).toContain('/17841478674706194/messages')
      expect(body.recipient).toEqual({ id: 'igsid-1' })
      expect(body.message).toEqual({ text: 'hello there' })
      // The decrypted token must reach the request, but never be logged/returned.
      expect(body.access_token).toBe('decrypted-real-token-never-logged')
      return new Response(JSON.stringify({ recipient_id: 'igsid-1', message_id: 'mid.out.1' }), { status: 200 })
    }))

    const result = await sendInstagramMessage('17841478674706194', 'igsid-1', 'hello there')
    expect(result).toEqual({ success: true, externalMessageId: 'mid.out.1' })
  })

  it('fails cleanly when no connected/active account matches the igUserId', async () => {
    state.connectedAccount = null
    const result = await sendInstagramMessage('unknown-ig-id', 'igsid-1', 'hi')
    expect(result).toEqual({ success: false, error: 'account_not_connected' })
  })

  it('fails cleanly when the connected account has no stored token', async () => {
    state.tokenRow = null
    const result = await sendInstagramMessage('17841478674706194', 'igsid-1', 'hi')
    expect(result).toEqual({ success: false, error: 'token_not_found' })
  })

  it('fails cleanly when the stored token cannot be decrypted', async () => {
    state.tokenRow = { access_token_encrypted: 'throw' }
    const result = await sendInstagramMessage('17841478674706194', 'igsid-1', 'hi')
    expect(result).toEqual({ success: false, error: 'token_decrypt_failed' })
  })

  it('reports failure (never success) when the Graph API call fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message: 'rate limited' } }), { status: 429 })))
    const result = await sendInstagramMessage('17841478674706194', 'igsid-1', 'hi')
    expect(result.success).toBe(false)
    expect(result.error).toBe('rate limited')
  })

  it('never includes the decrypted token in the returned result', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message: 'bad' } }), { status: 400 })))
    const result = await sendInstagramMessage('17841478674706194', 'igsid-1', 'hi')
    expect(JSON.stringify(result)).not.toContain('decrypted-real-token-never-logged')
  })
})
