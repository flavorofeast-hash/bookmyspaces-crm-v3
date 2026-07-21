import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ getSupabaseAdmin: () => ({ from: () => ({}) }) }))
vi.mock('@/lib/settings/settings-service', () => ({ getSettingsSection: () => Promise.resolve({}) }))

import { evaluateHandoff, estimateConfidence } from './orchestrator'

const settings = { confidenceThreshold: 0.6, autoHandoff: true }

describe('evaluateHandoff', () => {
  it('escalates when the customer asks for a human', () => {
    expect(evaluateHandoff({ customerText: 'I want to talk to a human please', aiConfidence: 0.9, settings }))
      .toEqual({ escalate: true, reason: 'customer_requested_human' })
    expect(evaluateHandoff({ customerText: 'can I speak with the manager?', aiConfidence: 0.9, settings }).escalate)
      .toBe(true)
  })

  it('escalates refunds, payment issues and complaints', () => {
    expect(evaluateHandoff({ customerText: 'I need a refund now', aiConfidence: 0.9, settings }).reason).toBe('refund_request')
    expect(evaluateHandoff({ customerText: 'my payment failed but money was deducted', aiConfidence: 0.9, settings }).reason).toBe('payment_issue')
    expect(evaluateHandoff({ customerText: 'this is unacceptable, I have a complaint', aiConfidence: 0.9, settings }).reason).toBe('complaint')
  })

  it('escalates on low confidence when autoHandoff is on', () => {
    expect(evaluateHandoff({ customerText: 'what are your rates?', aiConfidence: 0.3, settings }).reason).toBe('low_confidence')
  })

  it('does not escalate on low confidence when autoHandoff is off', () => {
    expect(evaluateHandoff({
      customerText: 'what are your rates?',
      aiConfidence: 0.3,
      settings: { confidenceThreshold: 0.6, autoHandoff: false },
    }).escalate).toBe(false)
  })

  it('stays quiet on ordinary booking chat', () => {
    for (const text of [
      'Do you have rooms available this weekend?',
      'How much for a wedding package for 200 guests?',
      'Can I pay by card at check-in?', // mentions pay, but not a payment issue
    ]) {
      expect(evaluateHandoff({ customerText: text, aiConfidence: 0.9, settings }).escalate).toBe(false)
    }
  })
})

describe('estimateConfidence', () => {
  it('flags uncertainty markers and the fallback reply as low confidence', () => {
    expect(estimateConfidence("I'm not sure about that")).toBeLessThan(0.6)
    expect(estimateConfidence('I\'m having a brief connectivity issue 🙏 Please WhatsApp us')).toBeLessThan(0.6)
  })
  it('treats a substantive reply as confident', () => {
    expect(estimateConfidence('Our Gold rooftop package is ₹50,000 for up to 70 guests, including catering.')).toBeGreaterThan(0.8)
  })
})
