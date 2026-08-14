import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const state = {
  insertedId: 'log-1' as string | null,
  insertError: null as { message: string } | null,
  updateCalls: [] as Array<{ status: string; waMessageId?: string | null }>,
}

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table !== 'whatsapp_messages') throw new Error(`unexpected table: ${table}`)
      return {
        insert: () => ({
          select: () => ({
            single: () => Promise.resolve({ data: state.insertedId ? { id: state.insertedId } : null, error: state.insertError }),
          }),
        }),
        update: (payload: { message_status: string; whatsapp_message_id?: string | null }) => ({
          eq: () => {
            state.updateCalls.push({ status: payload.message_status, waMessageId: payload.whatsapp_message_id })
            return Promise.resolve({ data: null, error: null })
          },
        }),
      }
    },
  }),
}))

import {
  sendWhatsAppText,
  sendWhatsAppTemplate,
  sendWhatsAppTemplateSimple,
  sendBroadcastCampaign,
} from './send-message'

const originalEnv = {
  token: process.env.WHATSAPP_ACCESS_TOKEN,
  numberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
}

function configureMeta() {
  process.env.WHATSAPP_ACCESS_TOKEN = 'test-token'
  process.env.WHATSAPP_PHONE_NUMBER_ID = '12345'
}

function unconfigureMeta() {
  delete process.env.WHATSAPP_ACCESS_TOKEN
  delete process.env.WHATSAPP_PHONE_NUMBER_ID
}

describe('send-message.ts (consolidated WhatsApp sender)', () => {
  beforeEach(() => {
    state.insertedId = 'log-1'
    state.insertError = null
    state.updateCalls = []
    vi.restoreAllMocks()
  })

  afterEach(() => {
    if (originalEnv.token === undefined) delete process.env.WHATSAPP_ACCESS_TOKEN
    else process.env.WHATSAPP_ACCESS_TOKEN = originalEnv.token
    if (originalEnv.numberId === undefined) delete process.env.WHATSAPP_PHONE_NUMBER_ID
    else process.env.WHATSAPP_PHONE_NUMBER_ID = originalEnv.numberId
  })

  describe('sendWhatsAppText', () => {
    it('skips the send and does not touch Supabase when Meta is not configured', async () => {
      unconfigureMeta()
      const fetchSpy = vi.spyOn(global, 'fetch')

      const result = await sendWhatsAppText('9051459463', 'hello')

      expect(result).toEqual({ success: false, error: 'not_configured' })
      expect(fetchSpy).not.toHaveBeenCalled()
    })

    it('normalizes the phone number and returns the real message id on success', async () => {
      configureMeta()
      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(''),
        json: () => Promise.resolve({ messaging_product: 'whatsapp', contacts: [], messages: [{ id: 'wamid.ABC' }] }),
      } as unknown as Response)

      const result = await sendWhatsAppText('9051459463', 'hello')

      expect(result).toEqual({ success: true, waMessageId: 'wamid.ABC' })
      expect(state.updateCalls).toEqual([{ status: 'sent', waMessageId: 'wamid.ABC' }])
    })

    it('retries on failure and reports failed after exhausting retries', async () => {
      configureMeta()
      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('server error'),
      } as unknown as Response)

      const result = await sendWhatsAppText('9051459463', 'hello')

      expect(result.success).toBe(false)
      expect(global.fetch).toHaveBeenCalledTimes(3) // MAX_RETRIES = 2 → 3 attempts total
      expect(state.updateCalls.at(-1)?.status).toBe('failed')
    }, 10000)
  })

  describe('sendWhatsAppTemplateSimple', () => {
    it('builds a single body component from name/value params', async () => {
      configureMeta()
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(''),
        json: () => Promise.resolve({ messaging_product: 'whatsapp', contacts: [], messages: [{ id: 'wamid.XYZ' }] }),
      } as unknown as Response)

      await sendWhatsAppTemplateSimple('9051459463', 'inquiry_followup', [{ name: 'guest_name', value: 'Priya' }])

      const [, options] = fetchSpy.mock.calls[0]
      const body = JSON.parse((options as RequestInit).body as string)
      expect(body.template.name).toBe('inquiry_followup')
      expect(body.template.language.code).toBe('en')
      expect(body.template.components).toEqual([{ type: 'body', parameters: [{ type: 'text', text: 'Priya' }] }])
    })

    it('sends no components when params are empty, matching the old sendTemplateMessage default', async () => {
      configureMeta()
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(''),
        json: () => Promise.resolve({ messaging_product: 'whatsapp', contacts: [], messages: [{ id: 'wamid.1' }] }),
      } as unknown as Response)

      await sendWhatsAppTemplateSimple('9051459463', 'festival_promo')

      const [, options] = fetchSpy.mock.calls[0]
      const body = JSON.parse((options as RequestInit).body as string)
      expect(body.template.components).toEqual([])
    })
  })

  describe('sendBroadcastCampaign', () => {
    it('returns all-failed without calling the API when Meta is not configured', async () => {
      unconfigureMeta()
      const fetchSpy = vi.spyOn(global, 'fetch')

      const result = await sendBroadcastCampaign(
        [{ whatsappNumber: '9051459463' }, { whatsappNumber: '9830012345' }],
        'inquiry_followup',
        'test_broadcast'
      )

      expect(result).toEqual({ success: 0, failed: 2 })
      expect(fetchSpy).not.toHaveBeenCalled()
    })

    it('counts successes and failures per-recipient', async () => {
      configureMeta()
      let call = 0
      vi.spyOn(global, 'fetch').mockImplementation(() => {
        call++
        if (call === 1) {
          return Promise.resolve({
            ok: true,
            text: () => Promise.resolve(''),
            json: () => Promise.resolve({ messaging_product: 'whatsapp', contacts: [], messages: [{ id: 'wamid.1' }] }),
          } as unknown as Response)
        }
        return Promise.resolve({ ok: false, status: 500, text: () => Promise.resolve('err') } as unknown as Response)
      })

      const result = await sendBroadcastCampaign(
        [{ whatsappNumber: '9051459463' }, { whatsappNumber: '9830012345' }],
        'inquiry_followup',
        'test_broadcast'
      )

      expect(result.success).toBe(1)
      expect(result.failed).toBe(1)
    }, 10000)
  })

  describe('sendWhatsAppTemplate (raw)', () => {
    it('skips when Meta is not configured', async () => {
      unconfigureMeta()
      const result = await sendWhatsAppTemplate('9051459463', 'x', 'en', [])
      expect(result).toEqual({ success: false, error: 'not_configured' })
    })

    it('retries on failure and reports failed after exhausting retries', async () => {
      configureMeta()
      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('server error'),
      } as unknown as Response)

      const result = await sendWhatsAppTemplate('9051459463', 'inquiry_followup', 'en', [])

      expect(result.success).toBe(false)
      expect(global.fetch).toHaveBeenCalledTimes(3) // MAX_RETRIES = 2 -> 3 attempts total
      expect(state.updateCalls.at(-1)?.status).toBe('failed')
    }, 10000)
  })
})
