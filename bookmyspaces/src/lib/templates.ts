// ═══════════════════════════════════════════════════════════
// WHATSAPP MESSAGE TEMPLATES
// ═══════════════════════════════════════════════════════════
// These are session messages (free-form) used within 24h window
// For template messages (outside 24h), each needs WhatsApp approval
// Submit templates at: business.facebook.com → WhatsApp Manager

// ─────────────────────────────────────────
// SESSION MESSAGE TEMPLATES (use within 24h window)
// ─────────────────────────────────────────

export const WHATSAPP_MESSAGES = {
  // ── GREETING ──────────────────────────────────────────
  greeting: (name?: string) =>
    `👋 Hello${name ? ` ${name}` : ''}! Welcome to *BookMySpaces* 🌟

We manage two beautiful properties in Kolkata:

🏨 *Skyline Serenity* – Near Airport
✨ *Monurama Homestay* – Mukundapur

Please tell me what you're looking for:
1️⃣ Rooftop Event / Party
2️⃣ Private Dining
3️⃣ Room Stay
4️⃣ Café Experience
5️⃣ Banquet Hall

Just reply with a number or describe what you need! 😊`,

  // ── PACKAGE INFO ──────────────────────────────────────
  packagesOverview: () =>
    `🎉 *Rooftop Event Packages 2026*
📍 Mukundapur, Near EM Bypass

⚪ *SILVER – ₹42,000* (Up to 60 Guests)
Venue 4hrs | Decor | Buffet | Sound | Lighting | Staff

🥇 *GOLD – ₹50,000* ⭐ Most Popular (Up to 60 Guests)
Venue 4hrs | Premium Decor | Full Buffet | Mic | Party Lights | Cake Table | Staff

💎 *PLATINUM – ₹59,500* (Up to 60 Guests)
Venue 5hrs | Theme Decor | Full Buffet | DJ | Lights | Welcome Drink | Stage | Coordination

➕ *Add-ons:*
Music ₹6,000 | Photography ₹8,000 | Extra Guest ₹750/person | Theme Decor ₹5,000–12,000

📲 To book: Share your date, guest count & occasion!`,

  // ── ROOFTOP DETAILS ───────────────────────────────────
  rooftopInfo: () =>
    `🌆 *Monurama Rooftop – BookMySpaces*

Perfect for:
• 🎂 Birthday parties
• 💍 Engagements & anniversaries
• 🏢 Corporate gatherings
• 🌙 Private evening events

Capacity: 30–70 guests
Location: Mukundapur, Near EM Bypass

Available setups:
1️⃣ Day Setup
2️⃣ Premium Evening Setup

Please share:
📅 Date
👥 Guest count
🎉 Occasion`,

  // ── PRIVATE DINING ────────────────────────────────────
  privateDining: () =>
    `🍽️ *Private Dining – Monurama*

Ideal for:
• ❤️ Couple dinners
• 🎂 Mini birthday surprises
• 🎊 Small celebrations

Package starts from *₹4,999*

Please share:
📅 Date & time
👥 Number of guests
🎉 Occasion`,

  // ── SKYLINE ROOMS ─────────────────────────────────────
  skylineRooms: () =>
    `🏨 *Skyline Serenity – Near Kolkata Airport*

• Deluxe & Premium AC Rooms
• All rooms: Attached washroom, Geyser, Smart TV, WiFi
• Couple-friendly ✅
• In-house dining available
• Starting from *₹999/night*

Please share:
📅 Check-in date
⏰ Approximate check-in time
👥 Number of guests
🛏️ Deluxe or Premium?`,

  // ── CONFIRMATION PROMPT ───────────────────────────────
  confirmBooking: (name?: string, date?: string, venue?: string) =>
    `✅ Great${name ? `, ${name}` : ''}! Let me confirm your booking:

${venue ? `📍 Venue: ${venue}` : ''}
${date ? `📅 Date: ${date}` : ''}

To *block your slot*, a small advance is required.

Shall I proceed? 😊`,

  // ── PAYMENT INFO ──────────────────────────────────────
  paymentInfo: () =>
    `💳 *Payment Details*

Please make the advance via UPI:

📲 UPI ID: *9051459463@paytm* (or scan QR)
📱 PhonePe / GPay / Paytm accepted

Kindly share the payment screenshot once done. Your slot will be confirmed immediately! 🎉`,

  // ── BOOKING CONFIRMED ─────────────────────────────────
  bookingConfirmed: (params: {
    name?: string
    venue?: string
    date?: string
    time?: string
    guests?: string
    package?: string
  }) =>
    `🎉 *Booking Confirmed!*

${params.name ? `Guest: ${params.name}` : ''}
${params.venue ? `Venue: ${params.venue}` : ''}
${params.date ? `Date: ${params.date}` : ''}
${params.time ? `Time: ${params.time}` : ''}
${params.guests ? `Guests: ${params.guests}` : ''}
${params.package ? `Package: ${params.package}` : ''}

Thank you for choosing *BookMySpaces* 🙏
We look forward to making your celebration unforgettable! ✨

Any questions? We're here. 😊`,

  // ── FOLLOW-UP ─────────────────────────────────────────
  // ── PROPOSAL DELIVERY ────────────────────────────────
  proposalReady: (name: string | undefined, proposalNumber: string, eventType: string | undefined, totalPrice: number | undefined, shareUrl: string) =>
    `✨ Hello${name ? ` *${name}*` : ''}! Your event proposal is ready! 🎉

📋 *Proposal ${proposalNumber}*
${eventType ? `🎪 Event: ${eventType}
` : ''}${totalPrice ? `💰 Package Value: *₹${totalPrice.toLocaleString('en-IN')}*
` : ''}
Please review your personalised proposal here:
👉 ${shareUrl}

To confirm your booking, simply reply *YES* or call us directly.

📞 9051459463 | 9830509991
🌐 www.bookmyspaces.in

_This proposal is valid for 7 days. Weekend slots fill fast!_ 🗓`,

  proposalFollowUp: (name: string | undefined, proposalNumber: string, shareUrl: string) =>
    `Hi${name ? ` *${name}*` : ''}! 👋

Just checking in on your proposal *${proposalNumber}* — have you had a chance to review it?

👉 ${shareUrl}

Happy to answer any questions or customise the package for you!

📞 Call/WhatsApp: 9051459463`,

  followUp: (name?: string) =>
    `Hi${name ? ` ${name}` : ''}! 😊 

Just checking in on your event inquiry at *BookMySpaces*. Have you had a chance to think about it?

We'd love to help you plan the perfect celebration! 🎉

Feel free to ask any questions — I'm here to help.`,

  // ── PRICE OBJECTION ───────────────────────────────────
  priceObjection: () =>
    `I completely understand 😊 Let me help you find the best value option!

Our *Silver Package at ₹42,000* includes everything essential for a great celebration — venue, decor, buffet, sound, and staff.

We can also customize based on your specific needs. Could you share:
💰 Your approximate budget?
👥 Guest count?

I'll suggest the best option for you! ✨`,

  // ── TRUST ─────────────────────────────────────────────
  trustMessage: () =>
    `We completely understand your concern 😊

✅ BookMySpaces is a verified hospitality platform
✅ Listed on Google Business, JustDial & VenueLook
✅ 100+ events successfully hosted
✅ Real guest reviews available
🌐 Website: www.bookmyspaces.in

You're welcome to visit the venue before booking — just let us know! 

Or connect with our manager: 📞 9051459463`,

  // ── ESCALATION TO HUMAN ───────────────────────────────
  escalateToHuman: () =>
    `Let me connect you with our team for better assistance! 😊

📞 Call / WhatsApp: *9051459463*
📞 Alternate: *7003853624*
🌐 www.bookmyspaces.in

Our team is available 9 AM – 9 PM daily.`,

  // ── URGENCY / PEAK ────────────────────────────────────
  urgency: () =>
    `⚠️ Just a heads up — *weekend slots fill very fast* at our venue!

We recommend securing your date with a small advance to avoid missing out. 

Would you like me to check availability for your preferred date? 📅`,

  // ── CAFÉ INFO ─────────────────────────────────────────
  cafeInfo: () =>
    `☕ *Monurama Café – "Under the Mango Tree"*

A cozy open-air café experience starting from *₹249*

Perfect for:
• Dates & hangouts
• Evening gatherings
• Small birthday surprises
• Quiet conversations

📍 Mukundapur, Near EM Bypass
📲 Reserve your spot: share preferred date & time!`,

  // ── CLOSING / THANKS ──────────────────────────────────
  thankYou: (name?: string) =>
    `Thank you${name ? ` ${name}` : ''} for contacting *BookMySpaces* 🙏

Feel free to reach us anytime for rooms, events, or celebrations!

📲 9051459463 | 🌐 www.bookmyspaces.in

Have a wonderful day! ✨`,

  // ── CUSTOMER JOURNEY: PRE-ARRIVAL ─────────────────────
  // Priority 3 (Marketing Intelligence) — Customer Journey Automation.
  preArrivalReminder: (params: { name?: string; checkInDate?: string; venue?: string }) =>
    `👋 Hi${params.name ? ` ${params.name}` : ''}! Just a friendly reminder —

Your stay at *BookMySpaces*${params.venue ? ` (${params.venue})` : ''} is coming up${params.checkInDate ? ` on *${params.checkInDate}*` : ' soon'}! 🎉

We're looking forward to hosting you. Any special requests before you arrive?

📞 9051459463 | 🌐 www.bookmyspaces.in`,

  // ── CUSTOMER JOURNEY: CHECK-IN ────────────────────────
  // Fires immediately when the front desk marks a reservation checked-in
  // (reservation-workflow.ts's checkInReservation()) — distinct from
  // preArrivalReminder (fires the day before, unattended) and from
  // bookingConfirmed (fires at booking time, days/weeks earlier).
  checkInMessage: (params: { name?: string; venue?: string; checkOutDate?: string }) =>
    `🏨 Welcome${params.name ? `, ${params.name}` : ''}! You're checked in at *BookMySpaces*${params.venue ? ` (${params.venue})` : ''}. 🎉

We hope you have a wonderful stay!${params.checkOutDate ? ` Your check-out date is *${params.checkOutDate}*.` : ''}

Need anything during your stay? Just message us here. 😊

📞 9051459463`,

  // ── CUSTOMER JOURNEY: CHECK-OUT ───────────────────────
  // Fires immediately when the front desk marks a reservation checked-out
  // (checkOutReservation()) — an immediate farewell, distinct from
  // postStayThankYou which fires the following day via the stay-lifecycle
  // cron once the stay has had time to settle.
  checkOutMessage: (params: { name?: string; venue?: string }) =>
    `👋 Thank you for staying with us${params.name ? `, ${params.name}` : ''}! You've been checked out of *BookMySpaces*${params.venue ? ` (${params.venue})` : ''}.

Safe travels, and we hope to host you again soon! 🙏`,

  // ── CUSTOMER JOURNEY: WIN-BACK ────────────────────────
  winBack: (name?: string) =>
    `👋 Hi${name ? ` ${name}` : ''}! It's been a while since we last connected at *BookMySpaces* 🌟

We've added new packages and offers since your last visit — we'd love to host you again!

Reply here or call us to check availability for your next celebration or stay. 🎉

📞 9051459463 | 🌐 www.bookmyspaces.in`,

  // ── CUSTOMER JOURNEY: POST-STAY ───────────────────────
  // Customer Loyalty & Referral Experience — loyaltyPoints/loyaltyTier are
  // this lead's CURRENT standing (fetched via getLoyaltyAccount() before
  // this stay's own points are awarded), so the thank-you message can
  // "include loyalty information" without waiting on the separate
  // loyaltyPointsUpdate notification awardPoints() sends moments later
  // with the freshly-updated balance. Omitted entirely (no loyalty line)
  // when the lead has no loyalty account yet.
  postStayThankYou: (params: { name?: string; venue?: string; loyaltyPoints?: number | null; loyaltyTier?: string | null }) =>
    `🙏 Thank you${params.name ? ` ${params.name}` : ''} for staying with *BookMySpaces*${params.venue ? ` at ${params.venue}` : ''}!

We hope you had a wonderful experience. It was a pleasure hosting you. 🎉
${params.loyaltyPoints != null ? `\n💰 You have *${params.loyaltyPoints.toLocaleString('en-IN')}* loyalty points (*${params.loyaltyTier ?? 'Bronze'}* tier).\n` : ''}
Come back and see us again soon! 😊`,

  // ── EVENT POST-EXPERIENCE LIFECYCLE: THANK YOU ────────
  // Fires the day after an accepted proposal's event_date (weddings,
  // birthdays, corporate, rooftop events — no linked reservation) via
  // src/lib/customers/event-lifecycle.ts. Distinct wording from
  // postStayThankYou (which says "staying with") since these guests didn't
  // stay overnight — they celebrated an event. Same loyaltyPoints/
  // loyaltyTier convention as postStayThankYou above.
  eventThankYou: (params: { name?: string; venue?: string; eventType?: string; loyaltyPoints?: number | null; loyaltyTier?: string | null }) =>
    `🙏 Thank you${params.name ? ` ${params.name}` : ''} for celebrating your ${params.eventType ? params.eventType.toLowerCase() : 'event'} with *BookMySpaces*${params.venue ? ` at ${params.venue}` : ''}!

We hope it was everything you dreamed of. It was a pleasure hosting you. 🎉
${params.loyaltyPoints != null ? `\n💰 You have *${params.loyaltyPoints.toLocaleString('en-IN')}* loyalty points (*${params.loyaltyTier ?? 'Bronze'}* tier).\n` : ''}
Come celebrate with us again soon! 😊`,

  // ── CUSTOMER JOURNEY: REVIEW REQUEST ──────────────────
  reviewRequestMessage: (params: { name?: string; reviewLink?: string }) =>
    `⭐ Hi${params.name ? ` ${params.name}` : ''}! We hope you loved your time with *BookMySpaces*.

Would you mind sharing a quick review? It really helps us out! 🙏

${params.reviewLink ? `👉 ${params.reviewLink}` : 'Just reply here or search "BookMySpaces" on Google.'}

Thank you for your support! 💛`,

  // ── REVIEW ENGINE: REMINDER (Growth Engine Epic 1) ────
  // Sent once, via /api/cron/review-reminders, to guests whose
  // review_requests row is still 'requested' 7+ days after the original ask.
  reviewReminderMessage: (params: { name?: string; reviewLink?: string }) =>
    `⭐ Hi${params.name ? ` ${params.name}` : ''}, just a gentle nudge — if you have a moment, we'd really appreciate a quick review of your stay with *BookMySpaces*. 🙏

${params.reviewLink ? `👉 ${params.reviewLink}` : 'Just reply here or search "BookMySpaces" on Google.'}

No worries if you're busy — thank you either way! 💛`,

  // ── PHASE 2 (SOCIAL + WHATSAPP GROWTH): MARKETING AUTOMATIONS ──────────
  // Sent via /api/cron/marketing-automations. Session messages (24h-window
  // free-form), same style/footer convention as the templates above.
  birthdayWish: (name?: string) =>
    `🎂 Happy Birthday${name ? `, ${name}` : ''}! 🎉

The whole team at *BookMySpaces* wishes you a wonderful year ahead!

Celebrating your birthday with us? Reply here and we'll help you plan something special. 🥳

📞 9051459463 | 🌐 www.bookmyspaces.in`,

  anniversaryWish: (name?: string) =>
    `💐 Happy Anniversary${name ? `, ${name}` : ''}! 🥂

Wishing you many more wonderful years together — from all of us at *BookMySpaces*.

Want to celebrate with us this year? Reply here and we'll put together something memorable. 🎉

📞 9051459463 | 🌐 www.bookmyspaces.in`,

  // ── PHASE 2: repeat-booking invite (previous guest, dormant a while) ──
  repeatBookingInvite: (params: { name?: string; venue?: string }) =>
    `👋 Hi${params.name ? ` ${params.name}` : ''}! It's been a while since your last visit${params.venue ? ` to *${params.venue}*` : ' with *BookMySpaces*'}.

We've missed hosting you! Ready to plan your next celebration or stay? We'd love to welcome you back. 🎉

📞 9051459463 | 🌐 www.bookmyspaces.in`,

  // ── PHASE 2: referral request, sent with a real ref link (see
  // src/lib/customers/referrals.ts's buildReferralLink) ─────────────────
  referralRequestMessage: (params: { name?: string; referralLink: string }) =>
    `🙏 Hi${params.name ? ` ${params.name}` : ''}! We're so glad you enjoyed your time with *BookMySpaces*.

Know someone planning an event, a stay, or a celebration? Share your link — you'll both get a reward when they book! 🎁

👉 ${params.referralLink}

Thank you for spreading the word! 💛`,

  // ── CUSTOMER LOYALTY & REFERRAL EXPERIENCE ────────────
  // Sent by awardPoints() (src/lib/customers/loyalty.ts) after EVERY
  // eligible booking/event that earns points — reservations (via
  // syncLoyaltyPointsFromBookings), events (via event-lifecycle.ts), and
  // manual admin adjustments alike, one template for all three so there is
  // no per-source duplicate. `upgradedTo` is set only when this award
  // pushed the account into a new (higher) tier — folds "notify on tier
  // upgrade" into the same message rather than sending a second one for
  // the same event, since a tier change can only happen alongside an
  // actual points award.
  loyaltyPointsUpdate: (params: {
    name?: string
    pointsEarned: number
    balance: number
    tier: string
    upgradedTo?: string | null
    nextTierName?: string | null
    pointsToNextTier?: number | null
  }) =>
    `🎁 Hi${params.name ? ` ${params.name}` : ''}! You just earned *${params.pointsEarned.toLocaleString('en-IN')} points* with *BookMySpaces*.${
      params.upgradedTo ? `\n\n🎉 Congratulations — you've been upgraded to *${params.upgradedTo}* tier!` : ''
    }

💰 Points balance: *${params.balance.toLocaleString('en-IN')}*
🏆 Current tier: *${params.tier}*
${params.nextTierName && params.pointsToNextTier != null
  ? `📈 ${params.pointsToNextTier.toLocaleString('en-IN')} points to *${params.nextTierName}* tier`
  : '🌟 You\'re at our top tier — thank you for being a loyal guest!'}

Thank you for choosing us! 💛`,

  // Sent whenever a referral_rewards row is created as 'earned' or changes
  // status (syncReferralRewards()/PATCH /api/referrals — see referrals.ts's
  // notifyReferralRewardStatusChange()). One template for every status so
  // the referrer always hears about their reward, not just when it's paid.
  referralRewardUpdate: (params: {
    name?: string
    status: 'pending' | 'earned' | 'redeemed' | 'cancelled'
    rewardType?: string | null
    rewardValue?: number | null
    totalReferrals?: number
  }) => {
    const statusLine: Record<typeof params.status, string> = {
      pending: 'is *pending* — it\'ll be confirmed once your referral completes their first booking.',
      earned: 'has been *earned*! 🎉',
      redeemed: 'has been *redeemed*. Thank you!',
      cancelled: 'was cancelled.',
    }
    const rewardDetail = params.rewardType && params.rewardType !== 'unspecified' && params.rewardValue
      ? `\n🎁 Reward: ${params.rewardType.replace(/_/g, ' ')} — ${params.rewardValue}`
      : ''
    const statsLine = params.totalReferrals != null && params.totalReferrals > 0
      ? `\n👥 You've referred ${params.totalReferrals} ${params.totalReferrals === 1 ? 'customer' : 'customers'} to us so far — thank you!`
      : ''
    return `🙌 Hi${params.name ? ` ${params.name}` : ''}! Your referral reward ${statusLine[params.status]}${rewardDetail}${statsLine}

Keep sharing — every friend you refer earns you more! 💛`
  },
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
