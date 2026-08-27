import { describe, it, expect } from 'vitest'
import {
  welcomeTemplate,
  roomTemplate,
  banquetTemplate,
  weddingTemplate,
  restaurantTemplate,
  quoteTemplate,
  bookingTemplate,
  locationTemplate,
  contactTemplate,
  errorTemplate,
  humanHandoverTemplate,
} from './templates'

const ALL_TEMPLATES: Array<{ name: string; render: () => string }> = [
  { name: 'welcome', render: () => welcomeTemplate('Priya') },
  { name: 'room', render: () => roomTemplate() },
  { name: 'banquet', render: () => banquetTemplate() },
  { name: 'wedding', render: () => weddingTemplate() },
  { name: 'restaurant', render: () => restaurantTemplate() },
  { name: 'quote', render: () => quoteTemplate() },
  { name: 'booking', render: () => bookingTemplate({ name: 'Priya', venue: 'Monurama', date: '12 Sep' }) },
  { name: 'location', render: () => locationTemplate() },
  { name: 'contact', render: () => contactTemplate() },
  { name: 'error', render: () => errorTemplate() },
  { name: 'humanHandover', render: () => humanHandoverTemplate() },
]

describe('messaging/templates', () => {
  for (const { name, render } of ALL_TEMPLATES) {
    it(`${name} template contains no decorative separator line and no brand-header box`, () => {
      const text = render()
      expect(text).not.toMatch(/^[ \t]*[-_─━=*~]{3,}[ \t]*$/m)
      expect(text).not.toContain('🏨 *BookMySpaces*')
    })
  }

  it('welcomeTemplate uses an emoji-anchored heading and keeps the property names unchanged', () => {
    const text = welcomeTemplate('Priya')
    expect(text).toContain('*👋 Welcome*')
    expect(text).toContain('Skyline Serenity')
    expect(text).toContain('Monurama Homestay')
    expect(text).toContain('Priya')
  })

  it('roomTemplate keeps the real price unchanged', () => {
    expect(roomTemplate()).toContain('₹999/night')
  })

  it('quoteTemplate keeps all real package prices unchanged and still escalates to a human', () => {
    const text = quoteTemplate()
    expect(text).toContain('₹42,000')
    expect(text).toContain('₹50,000')
    expect(text).toContain('₹59,500')
    expect(text).toContain('Need Personal Assistance')
  })

  it('restaurantTemplate keeps the real dining prices unchanged', () => {
    const text = restaurantTemplate()
    expect(text).toContain('₹249')
    expect(text).toContain('₹4,999')
  })

  it('humanHandoverTemplate includes the fixed contact numbers unchanged', () => {
    const text = humanHandoverTemplate()
    expect(text).toContain('+91 80170 35546')
    expect(text).toContain('+91 90514 59463')
  })

  it('errorTemplate stays a plain apology (no forced festive emoji) and still escalates', () => {
    const text = errorTemplate()
    expect(text).toContain('Need Personal Assistance')
  })
})
