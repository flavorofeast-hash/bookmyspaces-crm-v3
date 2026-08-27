import { describe, it, expect } from 'vitest'
import { SYSTEM_PROMPT } from './ai'

// Guards the style-instruction edit that removed the old "a brand header/
// divider is added automatically" claim (no longer true -- format-message.ts
// no longer adds one) and replaced it with an explicit ban plus positive
// warm/emoji-anchored style guidance, shared by WhatsApp, Instagram/Facebook,
// and the website chat (all three call the same chatWithAI()/SYSTEM_PROMPT).
describe('SYSTEM_PROMPT style guidance', () => {
  it('explicitly forbids the model from producing decorative separator lines', () => {
    expect(SYSTEM_PROMPT).toMatch(/NEVER produce horizontal separator/i)
  })

  it('no longer claims a divider/header is added automatically (that presentation layer was removed)', () => {
    expect(SYSTEM_PROMPT).not.toMatch(/added automatically after your reply/i)
  })

  it('instructs tasteful, non-exhaustive emoji use as section anchors, not per-sentence', () => {
    expect(SYSTEM_PROMPT).toMatch(/tasteful emojis/i)
    expect(SYSTEM_PROMPT).toMatch(/NOT on every sentence/i)
  })

  it('still requires the mandatory <<LEAD:...>> extraction tag (business logic untouched)', () => {
    expect(SYSTEM_PROMPT).toContain('<<LEAD:')
  })
})
