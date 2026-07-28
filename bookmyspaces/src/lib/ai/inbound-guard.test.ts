import { describe, it, expect } from 'vitest'
import { validateInboundMessage, MAX_MESSAGE_LENGTH, type InboundGuardInput } from './inbound-guard'

const valid: InboundGuardInput = {
  channel: 'whatsapp',
  direction: 'inbound',
  messageId: 'wamid.123',
  conversationId: 'conv-1',
  source: 'customer',
  message: 'Need a hall for 150 guests',
}

describe('validateInboundMessage', () => {
  it('allows a well-formed inbound customer message', () => {
    const result = validateInboundMessage(valid)
    expect(result).toEqual({ allowed: true, rejectionReason: null, detail: 'ok' })
  })

  // --- Critical Issue 2: infinite loop protection -----------------------------

  it('rejects an outbound message (outbound loop protection)', () => {
    const result = validateInboundMessage({ ...valid, direction: 'outbound' })
    expect(result.allowed).toBe(false)
    expect(result.rejectionReason).toBe('not_inbound_direction')
  })

  it('rejects an AI-generated reply echoed back in as if it were new input', () => {
    const result = validateInboundMessage({ ...valid, source: 'ai' })
    expect(result.allowed).toBe(false)
    expect(result.rejectionReason).toBe('non_customer_source')
  })

  it('rejects a human/operator send echoed back in as if it were new input', () => {
    const result = validateInboundMessage({ ...valid, source: 'human' })
    expect(result.allowed).toBe(false)
    expect(result.rejectionReason).toBe('non_customer_source')
  })

  it('rejects a replay event', () => {
    const result = validateInboundMessage({ ...valid, isReplayEvent: true })
    expect(result.allowed).toBe(false)
    expect(result.rejectionReason).toBe('replay_event')
  })

  it('rejects a duplicated webhook delivery', () => {
    const result = validateInboundMessage({ ...valid, isDuplicateDelivery: true })
    expect(result.allowed).toBe(false)
    expect(result.rejectionReason).toBe('duplicate_delivery')
  })

  it('direction is checked before source/replay/duplicate flags -- cheapest signal first', () => {
    const result = validateInboundMessage({
      ...valid,
      direction: 'outbound',
      source: 'ai',
      isReplayEvent: true,
      isDuplicateDelivery: true,
    })
    expect(result.rejectionReason).toBe('not_inbound_direction')
  })

  // --- High Issue 4: mandatory contract fields --------------------------------

  it('rejects a missing channel', () => {
    const result = validateInboundMessage({ ...valid, channel: undefined })
    expect(result.allowed).toBe(false)
    expect(result.rejectionReason).toBe('missing_required_field')
    expect(result.detail).toContain('channel')
  })

  it('rejects a missing direction', () => {
    const result = validateInboundMessage({ ...valid, direction: null })
    expect(result.allowed).toBe(false)
    expect(result.rejectionReason).toBe('missing_required_field')
    expect(result.detail).toContain('direction')
  })

  it('rejects a missing messageId', () => {
    const result = validateInboundMessage({ ...valid, messageId: '' })
    expect(result.allowed).toBe(false)
    expect(result.rejectionReason).toBe('missing_required_field')
  })

  it('rejects a missing (undefined) conversationId, but allows an explicit null', () => {
    const missing = validateInboundMessage({ ...valid, conversationId: undefined })
    expect(missing.allowed).toBe(false)
    expect(missing.rejectionReason).toBe('missing_required_field')

    const explicitNull = validateInboundMessage({ ...valid, conversationId: null })
    expect(explicitNull.allowed).toBe(true)
  })

  it('rejects a missing source', () => {
    const result = validateInboundMessage({ ...valid, source: undefined })
    expect(result.allowed).toBe(false)
    expect(result.rejectionReason).toBe('missing_required_field')
  })

  // --- Security: message validation --------------------------------------------

  it('rejects an empty/whitespace-only message body (invalid message)', () => {
    expect(validateInboundMessage({ ...valid, message: '' }).rejectionReason).toBe('empty_message')
    expect(validateInboundMessage({ ...valid, message: '   ' }).rejectionReason).toBe('empty_message')
    expect(validateInboundMessage({ ...valid, message: undefined }).rejectionReason).toBe('empty_message')
  })

  it('rejects a message over the maximum length', () => {
    const result = validateInboundMessage({ ...valid, message: 'a'.repeat(MAX_MESSAGE_LENGTH + 1) })
    expect(result.allowed).toBe(false)
    expect(result.rejectionReason).toBe('message_too_long')
  })

  it('allows a message exactly at the maximum length', () => {
    const result = validateInboundMessage({ ...valid, message: 'a'.repeat(MAX_MESSAGE_LENGTH) })
    expect(result.allowed).toBe(true)
  })

  it('is a pure function -- never throws, always returns a structured result', () => {
    expect(() => validateInboundMessage({} as InboundGuardInput)).not.toThrow()
    const result = validateInboundMessage({} as InboundGuardInput)
    expect(result.allowed).toBe(false)
    expect(typeof result.detail).toBe('string')
  })
})
