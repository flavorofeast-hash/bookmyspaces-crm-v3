// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/messaging/templates.ts
// The 11 reusable message templates (Welcome, Room, Banquet, Wedding,
// Restaurant, Quote, Booking, Location, Contact, Error, Human Handover).
// Each is a thin composer over formatMessage() -- no new facts invented;
// content is carried over from the existing, already-approved copy in
// src/lib/templates.ts's WHATSAPP_MESSAGES and src/lib/ai.ts's prompt
// (property details, packages, contact numbers) wherever a close match
// already existed. Wedding, Location, and Error are net-new (no prior
// equivalent).
// ─────────────────────────────────────────────────────────────────────────────

import { formatMessage } from './format-message'

export function welcomeTemplate(name?: string): string {
  return formatMessage({
    heading: '👋 Welcome',
    body: [
      `Hi${name ? ` ${name}` : ''}! Welcome to BookMySpaces — we manage two premium properties in Kolkata:\n\n🏨 Skyline Serenity, near the airport\n✨ Monurama Homestay, in Mukundapur`,
      `We can help with rooftop events, private dining, room stays, or our open-air café.`,
    ],
    closingQuestion: 'What are you looking to plan today?',
  })
}

export function roomTemplate(): string {
  return formatMessage({
    heading: '🏨 Room Availability',
    body: [
      `Skyline Serenity, near Kolkata Airport, has Deluxe and Premium AC rooms starting from ₹999/night — attached washroom, geyser, smart TV, WiFi, and in-house dining, couple-friendly.`,
    ],
    closingQuestion: 'What check-in date and number of guests should I check availability for?',
  })
}

export function banquetTemplate(): string {
  return formatMessage({
    heading: '🎉 Rooftop & Banquet',
    body: [
      `Our Monurama rooftop in Mukundapur suits birthdays, engagements, anniversaries, corporate gatherings, and private evening events — 30 to 70 guests.`,
      `Day and Premium Evening setups are both available.`,
    ],
    closingQuestion: 'Could you share your event date, guest count, and occasion?',
  })
}

export function weddingTemplate(): string {
  return formatMessage({
    heading: '🎉 Wedding & Celebrations',
    body: [
      `We host intimate wedding-related celebrations — engagements, sangeet, and reception evenings — on the Monurama rooftop, with décor, catering, and coordination handled end-to-end.`,
      `Packages scale from 30 up to 70 guests, with premium theme décor and full coordination available at the top tier.`,
    ],
    closingQuestion: 'What is your expected guest count and preferred date?',
  })
}

export function restaurantTemplate(): string {
  return formatMessage({
    heading: '🍽️ Dining',
    body: [
      `Monurama Café, "Under the Mango Tree," is an open-air dining experience from ₹249 — great for casual visits or small celebrations.`,
      `For something more private, our Private Dining Room starts from ₹4,999 — ideal for couple dinners or intimate birthday surprises.`,
    ],
    closingQuestion: 'Would you like the café or a private dining slot, and for how many guests?',
  })
}

export function quoteTemplate(): string {
  return formatMessage({
    heading: '💰 Rooftop Event Packages',
    body: [
      `Silver — ₹42,000, up to 60 guests: venue, décor, buffet, sound, lighting, staff.`,
      `Gold — ₹50,000, up to 60 guests, our most popular: premium décor, expanded buffet, mic, party lighting, cake table.`,
      `Platinum — ₹59,500, up to 60 guests: theme décor, full buffet, DJ, welcome drink, stage, full coordination.`,
      `Add-ons: music ₹6,000, photography ₹8,000, extra guest ₹750/person, theme décor ₹5,000–12,000.`,
    ],
    closingQuestion: 'Which package suits your event best, or would you like a custom quote?',
    includeHandover: true, // "quotation needed" is always a Human Handover trigger
  })
}

export function bookingTemplate(params?: { name?: string; venue?: string; date?: string }): string {
  const details = [
    params?.venue ? `Venue: ${params.venue}` : null,
    params?.date ? `Date: ${params.date}` : null,
  ].filter(Boolean).join('\n')

  return formatMessage({
    heading: '✅ Booking',
    body: [
      `Great${params?.name ? `, ${params.name}` : ''}! ${details || 'Here are your booking details so far.'}`,
      `A small advance confirms and blocks your slot.`,
    ],
    closingQuestion: 'Shall I go ahead and share the payment details?',
  })
}

export function locationTemplate(): string {
  return formatMessage({
    heading: '📍 Our Locations',
    body: [
      `Skyline Serenity is near Kolkata Airport.`,
      `Monurama Homestay is in Mukundapur, near EM Bypass.`,
    ],
    closingQuestion: 'Which property would you like directions or details for?',
  })
}

export function contactTemplate(): string {
  return formatMessage({
    heading: '✨ About Us',
    body: [
      `BookMySpaces is a verified hospitality platform, listed on Google Business, JustDial, and VenueLook, with 100+ events successfully hosted.`,
      `You're welcome to visit either property before booking.`,
    ],
    closingQuestion: 'Would you like to schedule a visit, or shall I help you book directly?',
  })
}

export function errorTemplate(): string {
  return formatMessage({
    heading: 'One Moment',
    body: [
      `I'm having a brief connectivity issue on my end — sorry about that.`,
    ],
    closingQuestion: 'Could you try sending that again in a moment?',
    includeHandover: true, // a failure is exactly the "repeated failures" trigger
  })
}

/** Human Handover -- shown only when the caller has already decided to escalate
 *  (see evaluateHandoff() in src/lib/ai/orchestrator.ts). This function never
 *  decides that itself; it only renders the fixed contact block. */
export function humanHandoverTemplate(): string {
  return formatMessage({
    body: [
      `I've noted your request — our team will take it from here.`,
    ],
    includeHandover: true, // the block itself carries the "Need Personal Assistance?" heading
  })
}
