// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/whatsapp/auto-responder.test.ts
// Phase 1B, Step 3 (audit/PHASE_1B_IMPLEMENTATION_BACKLOG.md,
// audit/PHASE_1B_STEP3_READINESS_REVIEW.md).
//
// New file -- no test coverage existed for this module before Step 3
// (confirmed by grep across src/ during the Step 3 readiness review).
// Scope, per that review: pin every existing template's exact text (proves
// the `export` change didn't alter any customer-facing copy), pin the new
// ASK_EVENT_TYPE template, and confirm notifyOperator is exported and
// behaves exactly as before. Does NOT add regression coverage for
// processAutoResponse() itself -- that function had no test coverage
// before this file either, and backfilling it is explicitly out of Step
// 3's scope (see the readiness review's Section 8) since this step is
// about exports, not processAutoResponse()'s own correctness.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockDb = {
  notificationSetting: null as { value: string } | null,
}

const sendWhatsAppTextMock = vi.fn(async (_phone?: string, _message?: string, _opts?: unknown) => ({ success: true }))

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table !== 'notification_settings') throw new Error(`unexpected table: ${table}`)
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: mockDb.notificationSetting }),
          }),
        }),
      }
    },
  }),
}))

vi.mock('./send-message', () => ({
  sendWhatsAppText: (phone?: string, message?: string, opts?: unknown) => sendWhatsAppTextMock(phone, message, opts),
}))

import { MESSAGES, notifyOperator } from './auto-responder'

beforeEach(() => {
  mockDb.notificationSetting = null
  sendWhatsAppTextMock.mockClear()
})

describe('MESSAGES (Phase 1B, Step 3 -- export only, no content change)', () => {
  it('GREETING is unchanged', () => {
    expect(MESSAGES.GREETING('Priya')).toBe(
      `👋 Hi Priya! Welcome to *BookMySpaces* 🎉\n\nWe specialise in premium event venues in Kolkata — from intimate gatherings to grand celebrations.\n\nCould you tell us what *type of event* you're planning?\n\n_(e.g. Wedding, Birthday, Corporate Event, Engagement, etc.)_`
    )
  })

  it('GREETING handles a null name', () => {
    expect(MESSAGES.GREETING(null)).toBe(
      `👋 Hi! Welcome to *BookMySpaces* 🎉\n\nWe specialise in premium event venues in Kolkata — from intimate gatherings to grand celebrations.\n\nCould you tell us what *type of event* you're planning?\n\n_(e.g. Wedding, Birthday, Corporate Event, Engagement, etc.)_`
    )
  })

  it('ASK_EVENT_DATE is unchanged', () => {
    expect(MESSAGES.ASK_EVENT_DATE).toBe(
      `Great choice! 📅\n\nWhat *date* are you thinking for your event?\n\n_(Please share the date, e.g. "15 June 2025" or "15/06/2025")_`
    )
  })

  it('ASK_GUEST_COUNT is unchanged', () => {
    expect(MESSAGES.ASK_GUEST_COUNT).toBe(
      `Noted! 👥\n\nApproximately how many *guests* are you expecting?\n\n_(Share a rough number — e.g. 50, 100-150, 300+)_`
    )
  })

  it('QUALIFIED is unchanged', () => {
    expect(MESSAGES.QUALIFIED('Priya', 'Wedding', '150')).toBe(
      `Thank you Priya! 🙏\n\nHere's a summary of your inquiry:\n• *Event:* Wedding\n• *Guests:* 150\n\nOur team will review this and get back to you shortly with venue options and pricing. ⚡\n\nFor faster assistance, you can also reach us at:\n📞 +91 90514 59463 | +91 70038 53624`
    )
  })

  it('QUALIFIED handles a null name', () => {
    expect(MESSAGES.QUALIFIED(null, 'Birthday', '50')).toBe(
      `Thank you! 🙏\n\nHere's a summary of your inquiry:\n• *Event:* Birthday\n• *Guests:* 50\n\nOur team will review this and get back to you shortly with venue options and pricing. ⚡\n\nFor faster assistance, you can also reach us at:\n📞 +91 90514 59463 | +91 70038 53624`
    )
  })

  it('HANDOFF is unchanged', () => {
    expect(MESSAGES.HANDOFF).toBe(
      `I've notified our team — someone will reach out to you soon! 🤝\n\nIf you need immediate help, please call us on *+91 90514 59463*.`
    )
  })

  it('ALREADY_QUALIFIED is unchanged', () => {
    expect(MESSAGES.ALREADY_QUALIFIED).toBe(
      `👋 Hi again! Our team has already received your inquiry and will be in touch shortly.\n\nFor immediate help, please call *+91 90514 59463*.`
    )
  })

  it('UNRECOGNISED_DATE is unchanged', () => {
    expect(MESSAGES.UNRECOGNISED_DATE).toBe(
      `I didn't quite catch the date. Could you share it again in a simple format?\n_(e.g. "15 June 2025" or "15/06/2025")_`
    )
  })

  // Phase 1B, Step 3 -- the one net-new template.
  describe('ASK_EVENT_TYPE (new in Step 3)', () => {
    it('is exported with the approved copy', () => {
      expect(MESSAGES.ASK_EVENT_TYPE).toBe(
        `Could you tell us what *type of event* you're planning? 🎉\n\n_(e.g. Wedding, Birthday, Corporate Event, Engagement, etc.)_`
      )
    })

    it('is a plain string (no name parameter, unlike GREETING/QUALIFIED)', () => {
      expect(typeof MESSAGES.ASK_EVENT_TYPE).toBe('string')
    })

    it('does not re-greet -- has no "Hi"/"Welcome" preamble, unlike GREETING', () => {
      expect(MESSAGES.ASK_EVENT_TYPE).not.toMatch(/Hi|Welcome/)
    })
  })
})

describe('notifyOperator (Phase 1B, Step 3 -- export only, no behavior change)', () => {
  it('is exported and callable', () => {
    expect(typeof notifyOperator).toBe('function')
  })

  it('sends nothing when no operator number is configured', async () => {
    mockDb.notificationSetting = null
    await notifyOperator('919830509991', 'Priya', 'Wedding', '150', 'WHATSAPP')
    expect(sendWhatsAppTextMock).not.toHaveBeenCalled()
  })

  it('sends the operator alert to the configured number, prefixed with country code 91', async () => {
    mockDb.notificationSetting = { value: '9830509991' }
    await notifyOperator('919830509991', 'Priya', 'Wedding', '150', 'WHATSAPP')
    expect(sendWhatsAppTextMock).toHaveBeenCalledTimes(1)
    const [toPhone, message] = sendWhatsAppTextMock.mock.calls[0]
    expect(toPhone).toBe('919830509991')
    expect(message).toContain('New WhatsApp Inquiry')
    expect(message).toContain('Priya')
    expect(message).toContain('919830509991')
    expect(message).toContain('Wedding')
    expect(message).toContain('150')
  })

  it('falls back to "Unknown" when no name is supplied', async () => {
    mockDb.notificationSetting = { value: '9830509991' }
    await notifyOperator('919830509991', null, 'Birthday', '50', 'WEBSITE')
    const [, message] = sendWhatsAppTextMock.mock.calls[0]
    expect(message).toContain('Unknown')
  })
})
