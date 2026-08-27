import { describe, it, expect } from 'vitest'
import { formatMessage, HUMAN_HANDOVER_BLOCK } from './format-message'

// Separator styles this formatter must never produce, and must strip if a
// caller's raw text (typically AI-generated) still contains one.
const SEPARATOR_SAMPLES = [
  '───────────────',
  '━━━━━━━━━━━━━━',
  '----------------',
  '________________',
  '================',
  '~~~~~~~~~~~~~~~~',
]

describe('formatMessage', () => {
  it('does not wrap the message in a brand header or a top/bottom divider box', () => {
    const result = formatMessage({ body: 'Hello there! How can I help today?' })
    expect(result).not.toContain('BookMySpaces')
    expect(result).not.toMatch(/[-_─━=~]{3,}/)
    expect(result).toBe('Hello there! How can I help today?')
  })

  for (const separator of SEPARATOR_SAMPLES) {
    it(`strips a stray "${separator}" separator line from the body instead of passing it through`, () => {
      const result = formatMessage({ body: `Hello!\n\n${separator}\n\nHow can I help?` })
      expect(result).not.toContain(separator)
      expect(result).not.toMatch(/^[ \t]*[-_─━=*~]{3,}[ \t]*$/m)
    })
  }

  it('never contains a decorative separator line in a realistic multi-paragraph reply', () => {
    const result = formatMessage({
      heading: '👋 Welcome',
      body: [
        'Hi there! Happy to help you find the ideal room for your stay. 🏨✨',
        '───────────────',
        'Could you share your check-in and check-out dates?',
      ],
      closingQuestion: 'What dates work for you?',
    })
    expect(result).not.toMatch(/^[ \t]*[-_─━=*~]{3,}[ \t]*$/m)
  })

  it('preserves emojis and bold heading formatting', () => {
    const result = formatMessage({ heading: '🏨 Room Availability', body: 'Rooms from ₹999/night. ✨' })
    expect(result).toContain('*🏨 Room Availability*')
    expect(result).toContain('✨')
  })

  it('preserves the actual business facts/content unchanged (only chrome is presentation)', () => {
    const result = formatMessage({ body: 'Silver package is ₹42,000 for up to 60 guests.' })
    expect(result).toContain('₹42,000')
    expect(result).toContain('60 guests')
  })

  it('does not append a closing question when the body already ends in "?"', () => {
    const result = formatMessage({ body: 'Which dates work for you?', closingQuestion: 'A different question?' })
    expect(result).toBe('Which dates work for you?')
  })

  it('appends the closing question when the body does not already ask one', () => {
    const result = formatMessage({ body: 'We have rooms available.', closingQuestion: 'What dates should I check?' })
    expect(result).toBe('We have rooms available.\n\nWhat dates should I check?')
  })

  it('includes the fixed Human Handover block verbatim when requested, with no separator lines', () => {
    const result = formatMessage({ body: 'Connecting you now.', includeHandover: true })
    expect(result).toContain(HUMAN_HANDOVER_BLOCK)
    expect(HUMAN_HANDOVER_BLOCK).not.toMatch(/^[ \t]*[-_─━=*~]{3,}[ \t]*$/m)
  })

  it('strips backend <<LEAD:...>> tags as before (unrelated existing behavior, still intact)', () => {
    const result = formatMessage({ body: 'Thanks!\n<<LEAD:{"name":"Raju"}>>' })
    expect(result).not.toContain('<<LEAD:')
    expect(result).toBe('Thanks!')
  })

  it('still truncates an overlong body to the word limit without crashing', () => {
    const longBody = Array.from({ length: 300 }, (_, i) => `word${i}`).join(' ')
    const result = formatMessage({ body: longBody })
    expect(result.split(/\s+/).length).toBeLessThanOrEqual(185)
    expect(result).not.toMatch(/^[ \t]*[-_─━=*~]{3,}[ \t]*$/m)
  })
})
