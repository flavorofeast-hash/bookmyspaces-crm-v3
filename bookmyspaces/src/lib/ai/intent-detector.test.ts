import { describe, it, expect } from 'vitest'
import { detectIntent, intentFromSignals } from './intent-detector'

describe('detectIntent', () => {
  it('returns unclear when no buying signal matches', () => {
    expect(detectIntent('Hi there, just looking around').intent).toBe('unclear')
    expect(detectIntent('').intent).toBe('unclear')
  })

  it('detects a single clear signal', () => {
    expect(detectIntent('is it available on 15 Dec?').intent).toBe('availability_check')
    expect(detectIntent('what is the price for 100 guests').intent).toBe('price_request')
    expect(detectIntent('can I visit the venue this weekend').intent).toBe('site_visit_request')
    expect(detectIntent('checking other venues too, any discount').intent).toBe('comparison_shopping')
    expect(detectIntent('let me think about it, will confirm later').intent).toBe('hesitation')
    expect(detectIntent('I want to book now, please confirm the booking').intent).toBe('ready_to_book')
  })

  it('prefers ready_to_book over availability_check when both fire', () => {
    const result = detectIntent('is it available on 12 Dec, how do I book?')
    expect(result.matchedSignals).toEqual(expect.arrayContaining(['AVAILABILITY_CHECK', 'READY_TO_BOOK']))
    expect(result.intent).toBe('ready_to_book')
  })

  it('prefers availability_check over price_request when both fire', () => {
    const result = detectIntent('is the date available and what is the price?')
    expect(result.matchedSignals).toEqual(expect.arrayContaining(['AVAILABILITY_CHECK', 'PRICE_REQUEST']))
    expect(result.intent).toBe('availability_check')
  })

  it('surfaces every matched signal even though only one becomes the intent', () => {
    const result = detectIntent('send me the price, also is it available on 20 Dec?')
    expect(result.matchedSignals.length).toBeGreaterThan(1)
  })

  it('intentFromSignals produces the same result as detectIntent for an equivalent signal list', () => {
    const viaMessage = detectIntent('is it available on 12 Dec, how do I book?')
    const viaSignals = intentFromSignals(viaMessage.matchedSignals)
    expect(viaSignals).toEqual(viaMessage)
  })

  it('intentFromSignals handles null/undefined/empty without throwing', () => {
    expect(intentFromSignals(null).intent).toBe('unclear')
    expect(intentFromSignals(undefined).intent).toBe('unclear')
    expect(intentFromSignals([]).intent).toBe('unclear')
  })

  it('never calls out to a network or LLM -- purely synchronous', () => {
    // If this were ever changed to call chatWithAI() or any async API, this
    // call would need `await` and TypeScript would flag detectIntent()'s
    // return type as a Promise. Asserting the literal return value here
    // (not a Promise) locks in the "no second AI classifier" contract.
    const result = detectIntent('hello')
    expect(result).not.toHaveProperty('then')
    expect(result.intent).toBe('unclear')
  })
})
