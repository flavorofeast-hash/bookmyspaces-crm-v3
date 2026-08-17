// ═══════════════════════════════════════════════════════════
// WHATSAPP MESSAGE TEMPLATES
// ═══════════════════════════════════════════════════════════
// These are session messages (free-form) used within 24h window
// For template messages (outside 24h), each needs WhatsApp approval
// Submit templates at: business.facebook.com → WhatsApp Manager
//
// Every function here is a thin wrapper over formatMessage()
// (src/lib/messaging/format-message.ts) -- content/facts unchanged from
// before, only the visual layout is now unified (brand header, dividers,
// WhatsApp Markdown, one closing question, 180-word cap). Function names
// and signatures are unchanged so every existing call site keeps working.

import { formatMessage } from './messaging/format-message'

// ─────────────────────────────────────────
// SESSION MESSAGE TEMPLATES (use within 24h window)
// ─────────────────────────────────────────

export const WHATSAPP_MESSAGES = {
  // ── GREETING ──────────────────────────────────────────
  greeting: (name?: string) =>
    formatMessage({
      body: [
        `Hello${name ? ` ${name}` : ''}! Welcome to BookMySpaces — we manage two properties in Kolkata:\n\n🏨 Skyline Serenity, near the airport\n✨ Monurama Homestay, in Mukundapur`,
      ],
      closingQuestion: 'Are you looking for a rooftop event, private dining, a room stay, or our café?',
    }),

  // ── PACKAGE INFO ──────────────────────────────────────
  packagesOverview: () =>
    formatMessage({
      heading: 'Rooftop Event Packages 2026',
      body: [
        `Silver — ₹42,000, up to 60 guests: venue (4hrs), décor, buffet, sound, lighting, staff.`,
        `Gold — ₹50,000, up to 60 guests, most popular: premium décor, expanded buffet, mic, party lights, cake table.`,
        `Platinum — ₹59,500, up to 60 guests: theme décor, full buffet, DJ, welcome drink, stage, coordination.`,
        `Add-ons: music ₹6,000, photography ₹8,000, extra guest ₹750/person, theme décor ₹5,000–12,000.`,
      ],
      closingQuestion: 'Could you share your date, guest count, and occasion so I can suggest the right package?',
    }),

  // ── ROOFTOP DETAILS ───────────────────────────────────
  rooftopInfo: () =>
    formatMessage({
      heading: 'Monurama Rooftop',
      body: [
        `Perfect for birthdays, engagements, anniversaries, corporate gatherings, and private evening events — 30 to 70 guests, in Mukundapur near EM Bypass.`,
        `Day and Premium Evening setups are both available.`,
      ],
      closingQuestion: 'Could you share your date, guest count, and occasion?',
    }),

  // ── PRIVATE DINING ────────────────────────────────────
  privateDining: () =>
    formatMessage({
      heading: 'Private Dining — Monurama',
      body: [
        `Ideal for couple dinners, mini birthday surprises, or small celebrations. Packages start from ₹4,999.`,
      ],
      closingQuestion: 'Could you share the date, time, and number of guests?',
    }),

  // ── SKYLINE ROOMS ─────────────────────────────────────
  skylineRooms: () =>
    formatMessage({
      heading: 'Skyline Serenity — Near Kolkata Airport',
      body: [
        `Deluxe and Premium AC rooms, all with attached washroom, geyser, smart TV, and WiFi. Couple-friendly, with in-house dining, starting from ₹999/night.`,
      ],
      closingQuestion: 'What check-in date and guest count should I check availability for?',
    }),

  // ── CONFIRMATION PROMPT ───────────────────────────────
  confirmBooking: (name?: string, date?: string, venue?: string) =>
    formatMessage({
      heading: 'Booking Confirmation',
      body: [
        [
          `Great${name ? `, ${name}` : ''}!`,
          venue ? `Venue: ${venue}` : null,
          date ? `Date: ${date}` : null,
          `A small advance will block your slot.`,
        ].filter(Boolean).join('\n'),
      ],
      closingQuestion: 'Shall I go ahead and share the payment details?',
    }),

  // ── PAYMENT INFO ──────────────────────────────────────
  paymentInfo: () =>
    formatMessage({
      heading: 'Payment Details',
      body: [
        `Please make the advance via UPI — UPI ID: 9051459463@paytm (or scan the QR). PhonePe, GPay, and Paytm are all accepted.`,
      ],
      closingQuestion: 'Could you share the payment screenshot once done, so I can confirm your slot right away?',
    }),

  // ── BOOKING CONFIRMED ─────────────────────────────────
  bookingConfirmed: (params: {
    name?: string
    venue?: string
    date?: string
    time?: string
    guests?: string
    package?: string
  }) =>
    formatMessage({
      heading: 'Booking Confirmed!',
      body: [
        [
          params.name ? `Guest: ${params.name}` : null,
          params.venue ? `Venue: ${params.venue}` : null,
          params.date ? `Date: ${params.date}` : null,
          params.time ? `Time: ${params.time}` : null,
          params.guests ? `Guests: ${params.guests}` : null,
          params.package ? `Package: ${params.package}` : null,
        ].filter(Boolean).join('\n'),
        `Thank you for choosing BookMySpaces — we look forward to making your celebration unforgettable.`,
      ],
      closingQuestion: 'Any special requests before your event?',
    }),

  // ── PROPOSAL DELIVERY ────────────────────────────────
  proposalReady: (name: string | undefined, proposalNumber: string, eventType: string | undefined, totalPrice: number | undefined, shareUrl: string) =>
    formatMessage({
      heading: `Proposal ${proposalNumber}`,
      body: [
        [
          `Hello${name ? ` ${name}` : ''}! Your event proposal is ready.`,
          eventType ? `Event: ${eventType}` : null,
          totalPrice ? `Package value: ₹${totalPrice.toLocaleString('en-IN')}` : null,
        ].filter(Boolean).join('\n'),
        `Review your personalised proposal here:\n${shareUrl}\n\nThis proposal is valid for 7 days — weekend slots fill fast.`,
      ],
      closingQuestion: 'Would you like to confirm — just reply YES or call us directly.',
    }),

  proposalFollowUp: (name: string | undefined, proposalNumber: string, shareUrl: string) =>
    formatMessage({
      body: [
        `Hi${name ? ` ${name}` : ''}! Just checking in on your proposal ${proposalNumber}.`,
        `Here it is again:\n${shareUrl}\n\nHappy to answer any questions or customise the package for you.`,
      ],
      closingQuestion: 'Have you had a chance to review it?',
    }),

  followUp: (name?: string) =>
    formatMessage({
      body: [
        `Hi${name ? ` ${name}` : ''}! Just checking in on your event inquiry at BookMySpaces — we'd love to help you plan the perfect celebration.`,
      ],
      closingQuestion: 'Have you had a chance to think it over?',
    }),

  // ── PRICE OBJECTION ───────────────────────────────────
  priceObjection: () =>
    formatMessage({
      body: [
        `I completely understand — let me help you find the best value option. Our Silver Package at ₹42,000 includes everything essential: venue, décor, buffet, sound, and staff. We can also customise based on your needs.`,
      ],
      closingQuestion: 'Could you share your approximate budget and guest count?',
    }),

  // ── TRUST ─────────────────────────────────────────────
  trustMessage: () =>
    formatMessage({
      heading: 'About Us',
      body: [
        `BookMySpaces is a verified hospitality platform, listed on Google Business, JustDial, and VenueLook, with 100+ events successfully hosted and real guest reviews available.`,
        `You're welcome to visit the venue before booking.`,
      ],
      closingQuestion: 'Would you like to schedule a visit, or shall I help you book directly?',
    }),

  // ── ESCALATION TO HUMAN ───────────────────────────────
  escalateToHuman: () =>
    formatMessage({
      body: [`I've noted your request — our team will take it from here.`],
      includeHandover: true,
    }),

  // ── URGENCY / PEAK ────────────────────────────────────
  urgency: () =>
    formatMessage({
      body: [
        `Just a heads up — weekend slots fill very fast at our venue. We recommend securing your date with a small advance to avoid missing out.`,
      ],
      closingQuestion: 'Would you like me to check availability for your preferred date?',
    }),

  // ── CAFÉ INFO ─────────────────────────────────────────
  cafeInfo: () =>
    formatMessage({
      heading: 'Monurama Café — "Under the Mango Tree"',
      body: [
        `A cozy open-air café experience starting from ₹249 — perfect for dates, hangouts, evening gatherings, or small birthday surprises.`,
      ],
      closingQuestion: 'What date and time would you like to reserve?',
    }),

  // ── CLOSING / THANKS ──────────────────────────────────
  thankYou: (name?: string) =>
    formatMessage({
      body: [
        `Thank you${name ? ` ${name}` : ''} for contacting BookMySpaces — feel free to reach us anytime for rooms, events, or celebrations.`,
      ],
      closingQuestion: 'Is there anything else I can help you with?',
    }),

  // ── CUSTOMER JOURNEY: PRE-ARRIVAL ─────────────────────
  preArrivalReminder: (params: { name?: string; checkInDate?: string; venue?: string }) =>
    formatMessage({
      body: [
        `Hi${params.name ? ` ${params.name}` : ''}! Just a friendly reminder — your stay at BookMySpaces${params.venue ? ` (${params.venue})` : ''} is coming up${params.checkInDate ? ` on ${params.checkInDate}` : ' soon'}. We're looking forward to hosting you.`,
      ],
      closingQuestion: 'Any special requests before you arrive?',
    }),

  // ── CUSTOMER JOURNEY: CHECK-IN ────────────────────────
  checkInMessage: (params: { name?: string; venue?: string; checkOutDate?: string }) =>
    formatMessage({
      body: [
        `Welcome${params.name ? `, ${params.name}` : ''}! You're checked in at BookMySpaces${params.venue ? ` (${params.venue})` : ''}. We hope you have a wonderful stay!${params.checkOutDate ? ` Your check-out date is ${params.checkOutDate}.` : ''}`,
      ],
      closingQuestion: 'Need anything during your stay? Just message us here.',
    }),

  // ── CUSTOMER JOURNEY: CHECK-OUT ───────────────────────
  checkOutMessage: (params: { name?: string; venue?: string }) =>
    formatMessage({
      body: [
        `Thank you for staying with us${params.name ? `, ${params.name}` : ''}! You've been checked out of BookMySpaces${params.venue ? ` (${params.venue})` : ''}. Safe travels, and we hope to host you again soon.`,
      ],
    }),

  // ── CUSTOMER JOURNEY: WIN-BACK ────────────────────────
  winBack: (name?: string) =>
    formatMessage({
      body: [
        `Hi${name ? ` ${name}` : ''}! It's been a while since we last connected at BookMySpaces — we've added new packages and offers since your last visit and would love to host you again.`,
      ],
      closingQuestion: 'Would you like to check availability for your next celebration or stay?',
    }),

  // ── CUSTOMER JOURNEY: POST-STAY ───────────────────────
  postStayThankYou: (params: { name?: string; venue?: string }) =>
    formatMessage({
      body: [
        `Thank you${params.name ? ` ${params.name}` : ''} for staying with BookMySpaces${params.venue ? ` at ${params.venue}` : ''}! We hope you had a wonderful experience — come back and see us again soon.`,
      ],
    }),

  // ── CUSTOMER JOURNEY: REVIEW REQUEST ──────────────────
  reviewRequestMessage: (params: { name?: string; reviewLink?: string }) =>
    formatMessage({
      body: [
        `Hi${params.name ? ` ${params.name}` : ''}! We hope you loved your time with BookMySpaces.`,
        params.reviewLink ? `Please share a quick review here:\n${params.reviewLink}` : `Please share a quick review — just reply here or search "BookMySpaces" on Google.`,
      ],
      closingQuestion: 'Would you mind sharing a quick review? It really helps us out.',
    }),
}

// ─────────────────────────────────────────
// APPROVED TEMPLATE NAMES
// (Must match exactly what's approved in WhatsApp Business Manager)
// Submit these templates before using sendTemplateMessage()
// ─────────────────────────────────────────
export const APPROVED_TEMPLATES = {
  // Triggered when a new lead comes in after 24h
  INQUIRY_FOLLOWUP: 'bookmyspaces_followup_v1',

  // Campaign template for festival/seasonal promotions
  FESTIVAL_PROMO: 'bookmyspaces_festival_promo_v1',

  // Re-engage cold leads
  REENGAGEMENT: 'bookmyspaces_reengagement_v1',

  // Booking confirmation (for records)
  BOOKING_CONFIRMATION: 'bookmyspaces_booking_confirm_v1',

  // Post-event review request
  REVIEW_REQUEST: 'bookmyspaces_review_request_v1',
}

// Template parameter builders
export const TEMPLATE_PARAMS = {
  followup: (name: string, venue: string) => [
    { name: 'name', value: name },
    { name: 'venue', value: venue },
  ],

  festivalPromo: (name: string, offerDetails: string, expiryDate: string) => [
    { name: 'name', value: name },
    { name: 'offer_details', value: offerDetails },
    { name: 'expiry_date', value: expiryDate },
  ],

  bookingConfirmation: (name: string, date: string, venue: string) => [
    { name: 'name', value: name },
    { name: 'date', value: date },
    { name: 'venue', value: venue },
  ],

  reviewRequest: (name: string, eventDate: string) => [
    { name: 'name', value: name },
    { name: 'event_date', value: eventDate },
  ],
}
