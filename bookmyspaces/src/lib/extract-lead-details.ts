// src/lib/extract-lead-details.ts
// ─────────────────────────────────────────────────────────────────────────────
// Lightweight structured extraction from free-text WhatsApp messages.
// Regex-only — zero external API calls, zero latency overhead.
// Called BEFORE scoreLead() so extracted values populate lead fields first.
//
// Supported languages: English, Bengali (script + romanised), Hindi
//
// Returns:
//   event_type  : normalised uppercase string matching leads.event_type  | null
//   occasion    : normalised uppercase string matching leads.occasion     | null
//   guest_count : integer                                                 | null
//   budget      : formatted string  e.g. "150000" or "3 lakh"            | null
//                 (leads.budget is TEXT — we return a string, not a number)
//
// NEVER throws — all errors produce null fields and a logged warning.
// ─────────────────────────────────────────────────────────────────────────────

export interface ExtractedLeadDetails {
  event_type  : string | null;
  occasion    : string | null;
  guest_count : number | null;
  budget      : string | null;   // TEXT column in leads — keep as string
  /**
   * AI Sales Executive (Priority 1) — "Buying signals": explicit
   * booking-intent phrases in the message, e.g. "how do I book", "is it
   * available on <date>", "send me the price", "I want to confirm". Distinct
   * from event_type/budget/guest_count (which describe WHAT the customer
   * wants) — this describes HOW READY they are to act right now. Same
   * regex-only, zero-latency, never-throws approach as the rest of this
   * file, not a new LLM call.
   */
  buying_signals: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Keyword tables
// Each entry is [canonicalValue, [...matchPatterns]]
// Patterns are matched case-insensitively against the normalised input.
// ─────────────────────────────────────────────────────────────────────────────

// event_type keywords  →  stored in leads.event_type
const EVENT_TYPE_KEYWORDS: Array<[string, string[]]> = [
  ["WEDDING", [
    "wedding", "marriage", "reception", "sangeet", "mehendi", "haldi",
    // Bengali script
    "বিয়ে", "বিবাহ", "বিবাহবার্ষিকী",
    // Bengali romanised
    "biye", "bibaho", "anusthan",
    // Hindi script
    "शादी", "विवाह", "शादी की",
    // Hindi romanised
    "shaadi", "vivah",
  ]],
  ["CORPORATE", [
    "corporate", "office", "seminar", "conference", "workshop",
    "product launch", "team outing", "team building", "business event",
    "official", "company event", "annual day", "agm", "townhall",
    // Bengali
    "কর্পোরেট", "অফিস", "সেমিনার", "কনফারেন্স",
    // Hindi
    "कॉर्पोरेट", "ऑफिस", "सेमिनार",
  ]],
  ["BIRTHDAY", [
    "birthday", "bday", "b-day",
    // Bengali script
    "জন্মদিন",
    // Bengali romanised
    "janmadin", "jonmodin",
    // Hindi script
    "जन्मदिन", "जन्मदिवस",
    // Hindi romanised
    "janmadin",
  ]],
  ["ANNIVERSARY", [
    "anniversary", "anniv",
    // Bengali script
    "বর্ষপূর্তি", "বিবাহবার্ষিকী",
    // Bengali romanised
    "borshoporti", "anniversary",
    // Hindi script
    "सालगिरह", "वर्षगांठ",
    // Hindi romanised
    "saalgirah", "varshagaanth",
  ]],
  ["ENGAGEMENT", [
    "engagement", "engaged", "roka",
    // Bengali
    "আকদ", "পাকা দেখা",
    // Hindi
    "सगाई", "roka",
  ]],
  ["FAREWELL", [
    "farewell", "going away", "retirement",
    "বিদায়", "विदाई",
  ]],
  ["GET_TOGETHER", [
    "get together", "get-together", "gathering", "reunion",
    "family function", "family get together",
    "পারিবারিক অনুষ্ঠান", "মিলনমেলা",
    "पारिवारिक", "मिलन",
  ]],
  ["BABY_SHOWER", [
    "baby shower", "baby-shower",
    "বেবি শাওয়ার",
    "बेबी शॉवर",
  ]],
  ["PRIVATE_DINNER", [
    "private dinner", "dinner party", "kitty party",
    "ডিনার পার্টি",
    "डिनर पार्टी",
  ]],
  ["PHOTOSHOOT", [
    "photoshoot", "photo shoot", "photography",
    "ফটোশুট",
    "फोटोशूट",
  ]],
];

// occasion keywords  →  stored in leads.occasion
// We map birthday/anniversary as occasions, not event_type, when no venue booking intent is clear
const OCCASION_KEYWORDS: Array<[string, string[]]> = [
  ["WEDDING",     ["wedding", "biye", "বিয়ে", "বিবাহ", "shaadi", "शादी", "vivah"]],
  ["BIRTHDAY",    ["birthday", "bday", "জন্মদিন", "janmadin", "jonmodin", "जन्मदिन"]],
  ["ANNIVERSARY", ["anniversary", "বর্ষপূর্তি", "বিবাহবার্ষিকী", "saalgirah", "सालगिरह"]],
  ["CORPORATE",   ["corporate", "seminar", "conference", "কর্পোরেট", "कॉर्पोरेट"]],
  ["ENGAGEMENT",  ["engagement", "সগাই", "sagai", "সগাই", "सगाई"]],
  ["FAREWELL",    ["farewell", "বিদায়", "विदाई"]],
];

// ─────────────────────────────────────────────────────────────────────────────
// Bengali/Devanagari numeral normaliser
// ─────────────────────────────────────────────────────────────────────────────
function normaliseNumerals(text: string): string {
  const BENGALI: Record<string, string> = {
    "০":"0","১":"1","২":"2","৩":"3","৪":"4",
    "৫":"5","৬":"6","৭":"7","৮":"8","৯":"9",
  };
  const DEVANAGARI: Record<string, string> = {
    "०":"0","१":"1","२":"2","३":"3","४":"4",
    "५":"5","६":"6","७":"7","८":"8","९":"9",
  };
  let out = text;
  for (const [k, v] of Object.entries(BENGALI))     out = out.split(k).join(v);
  for (const [k, v] of Object.entries(DEVANAGARI))  out = out.split(k).join(v);
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Guest count extractor
// Returns the highest plausible guest count found (> 1, ≤ 9999).
// ─────────────────────────────────────────────────────────────────────────────
function extractGuestCount(text: string): number | null {
  const t = normaliseNumerals(text);

  const patterns: RegExp[] = [
    // English — number before/after guest words
    /(\d[\d,]*)\s*(?:guests?|peoples?|persons?|pax|heads?|attendees?|members?)\b/i,
    // Bengali script — "N জন" / "N মানুষ" / "N লোক"
    /(\d[\d,]*)\s*(?:জন|মানুষ|লোক)/,
    // Hindi script — "N लोग" / "N व्यक्ति"
    /(\d[\d,]*)\s*(?:লোग|लोग|व्यक्ति)/,
    // Bengali/Hindi romanised
    /(\d[\d,]*)\s*(?:jon\b|jono\b|manush\b|log\b|logo\b|vyakti\b)/i,
    // English — "for/of N guests"
    /(?:for|of|around|approx\.?|about)\s+(\d[\d,]*)\s*(?:guests?|peoples?|persons?|pax)?/i,
    // English — "gathering/party of N"
    /(?:gathering|party|event|function|wedding|reception|ceremony)\s+of\s+(\d[\d,]*)/i,
  ];

  let highest: number | null = null;

  for (const pattern of patterns) {
    const all = Array.from(t.matchAll(new RegExp(pattern.source, pattern.flags.replace(/g/g, "") + "g")));
    for (const m of all) {
      const n = parseInt((m[1] ?? "").replace(/,/g, ""), 10);
      if (!isNaN(n) && n > 1 && n <= 9_999) {
        if (highest === null || n > highest) highest = n;
      }
    }
    if (highest !== null) break;  // stop at first matching pattern tier
  }

  return highest;
}

// ─────────────────────────────────────────────────────────────────────────────
// Budget extractor
// Returns a normalised string suitable for leads.budget (TEXT column).
// e.g. "150000", "300000", "3 lakh"
// ─────────────────────────────────────────────────────────────────────────────
function extractBudget(text: string): string | null {
  const t = normaliseNumerals(text.toLowerCase().replace(/,/g, ""));

  // "X lakh" / "X lac" / "X লাখ" / "X lak"
  const lakhMatch = t.match(/(\d+(?:\.\d+)?)\s*(?:lakh|lac|লাখ|লক্ষ|lak\b)/);
  if (lakhMatch) {
    const n = Math.round(parseFloat(lakhMatch[1]) * 100_000);
    return String(n);
  }

  // "₹N" or "rs N" or "inr N"
  const currencyMatch = t.match(/(?:₹|rs\.?\s*|inr\s*)(\d+(?:\.\d+)?)/);
  if (currencyMatch) {
    const n = Math.round(parseFloat(currencyMatch[1]));
    return n > 0 ? String(n) : null;
  }

  // "X k" or "X thousand"
  const kMatch = t.match(/(\d+(?:\.\d+)?)\s*(?:k\b|thousand\b)/);
  if (kMatch) {
    const n = Math.round(parseFloat(kMatch[1]) * 1_000);
    return String(n);
  }

  // Bare large number next to budget/price keywords
  const budgetKeywordMatch = t.match(
    /(?:budget|cost|price|spend|খরচ|বাজেট|बजट)\D{0,10}(\d{4,7})/
  );
  if (budgetKeywordMatch) {
    const n = parseInt(budgetKeywordMatch[1], 10);
    return n > 0 ? String(n) : null;
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Event type extractor
// Returns canonical uppercase value e.g. "WEDDING", or null.
// ─────────────────────────────────────────────────────────────────────────────
function extractEventType(text: string): string | null {
  // Check longer/more specific patterns first to avoid "birthday" matching "day"
  for (const [canonical, keywords] of EVENT_TYPE_KEYWORDS) {
    for (const kw of keywords) {
      if (text.toLowerCase().includes(kw.toLowerCase())) {
        return canonical;
      }
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Occasion extractor (same logic, different keyword table)
// ─────────────────────────────────────────────────────────────────────────────
function extractOccasion(text: string): string | null {
  for (const [canonical, keywords] of OCCASION_KEYWORDS) {
    for (const kw of keywords) {
      if (text.toLowerCase().includes(kw.toLowerCase())) {
        return canonical;
      }
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Buying-signal detector
// Each entry is [canonicalSignal, [...matchPatterns]] — same table shape as
// EVENT_TYPE_KEYWORDS above. A message can carry multiple signals at once
// (e.g. "is it available on 12 Dec, how do I book?" → AVAILABILITY_CHECK +
// READY_TO_BOOK), so this returns every match, not just the first.
// ─────────────────────────────────────────────────────────────────────────────
const BUYING_SIGNAL_KEYWORDS: Array<[string, string[]]> = [
  ["READY_TO_BOOK", [
    "how do i book", "want to book", "book now", "confirm the booking",
    "want to confirm", "i'll confirm", "ready to book", "let's finalize",
    "let's finalise", "go ahead and book", "please book",
    "বুক করব", "কনফার্ম করব", "बुक करना है", "कन्फर्म करना है",
  ]],
  ["AVAILABILITY_CHECK", [
    "is it available", "is this available", "any availability", "do you have availability",
    "is the date available", "available on", "vacant on",
    "খালি আছে", "उपलब्ध है",
  ]],
  ["PRICE_REQUEST", [
    "send me the price", "what is the price", "what's the price", "how much",
    "send quotation", "send the quote", "send me a quote", "pricing details",
    "cost details", "price list", "send rate", "what are the rates",
    "দাম কত", "কত টাকা", "कितना पैसा", "कीमत क्या है", "रेट भेजो",
  ]],
  ["SITE_VISIT_REQUEST", [
    "can i visit", "want to visit", "site visit", "come and see", "see the venue",
    "venue visit", "want to see the place", "can we come see",
    "দেখতে যাব", "দেখতে আসব", "देखने आना है",
  ]],
  ["COMPARISON_SHOPPING", [
    "comparing", "also looking at", "other options", "checking other venues",
    "getting quotes from", "best price", "any discount", "can you reduce",
    "better rate", "final price",
  ]],
  ["HESITATION", [
    "let me think", "will get back to you", "will confirm later", "not sure yet",
    "need to discuss", "checking with family", "checking with my", "will decide",
  ]],
];

function extractBuyingSignals(text: string): string[] {
  const lower = text.toLowerCase();
  const found: string[] = [];
  for (const [canonical, keywords] of BUYING_SIGNAL_KEYWORDS) {
    for (const kw of keywords) {
      if (lower.includes(kw.toLowerCase())) {
        found.push(canonical);
        break; // one hit per category is enough
      }
    }
  }
  return found;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────────────────────
export function extractLeadDetails(message: string): ExtractedLeadDetails {
  // Safety wrapper — must never throw; any error returns all-null
  try {
    if (!message || typeof message !== "string") {
      return { event_type: null, occasion: null, guest_count: null, budget: null, buying_signals: [] };
    }

    const event_type      = extractEventType(message);
    const occasion        = extractOccasion(message);
    const guest_count     = extractGuestCount(message);
    const budget          = extractBudget(message);
    const buying_signals  = extractBuyingSignals(message);

    return { event_type, occasion, guest_count, budget, buying_signals };

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[extractLeadDetails] Non-fatal extraction error:", msg);
    return { event_type: null, occasion: null, guest_count: null, budget: null, buying_signals: [] };
  }
}
