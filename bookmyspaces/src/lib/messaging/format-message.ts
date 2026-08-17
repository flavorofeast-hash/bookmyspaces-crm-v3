// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/messaging/format-message.ts
// The single reusable formatter every outgoing customer-facing message
// (WhatsApp AI, WhatsApp templates, website chat) is routed through.
// Presentation only -- does not decide whether/when to send, or what a
// reply says; callers still own that. WhatsApp Markdown subset only
// (*bold*, _italic_) -- no #headers, no []() links, no tables, since
// WhatsApp doesn't render those and the website widget renders this same
// text verbatim as its canonical source.
// ─────────────────────────────────────────────────────────────────────────────

const BRAND_HEADER = '🏨 *BookMySpaces*'
const DIVIDER = '━━━━━━━━━━━━━━'
const WORD_LIMIT = 180

// Exact copy from spec -- shown only when the caller explicitly asks for it
// (see includeHandover), never invented or triggered by this file itself.
export const HUMAN_HANDOVER_BLOCK =
  `👨‍💼 *Need Personal Assistance?*

📞 WhatsApp & Bookings
+91 80170 35546

📞 Team
+91 90514 59463
+91 98305 09991
+91 70038 53624

🌐 www.bookmyspaces.in`

export interface FormattedMessage {
  /** Bold section heading, e.g. "Welcome" -- optional, brand header already covers the top. */
  heading?: string
  /** One or more paragraphs. Rendered with a blank line between each. */
  body: string | string[]
  /** Appended only if the body doesn't already end in "?" (never double-asks). */
  closingQuestion?: string
  /** Appends the fixed Human Handover contact block before the closing question. */
  includeHandover?: boolean
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

/** Truncates at the last full sentence under the limit; never mid-word. */
function truncateToWordLimit(text: string, limit: number): string {
  const words = text.trim().split(/\s+/)
  if (words.length <= limit) return text.trim()

  const truncated = words.slice(0, limit).join(' ')
  const lastSentenceEnd = Math.max(
    truncated.lastIndexOf('. '),
    truncated.lastIndexOf('! '),
    truncated.lastIndexOf('? '),
  )
  // Only back off to a sentence boundary if it doesn't throw away most of the content.
  if (lastSentenceEnd > truncated.length * 0.4) {
    return truncated.slice(0, lastSentenceEnd + 1).trim()
  }
  return `${truncated}…`
}

// Last line of defense: no caller-facing message should ever carry raw
// backend metadata (the AI's own <<LEAD:...>> extraction tag), even if a
// caller forgot to run cleanAIResponse() or the model emitted a malformed
// closing delimiter that a narrower regex upstream didn't catch.
function stripBackendTags(text: string): string {
  return text
    .replace(/<<LEAD:[\s\S]*?>>/g, '')
    .replace(/<<LEAD:[\s\S]*$/g, '')
    .replace(/<<EXTRACTED_DATA:[\s\S]*?>>/g, '')
    .replace(/<<EXTRACTED_DATA:[\s\S]*$/g, '')
}

export function formatMessage(input: FormattedMessage): string {
  const bodyParagraphs = (Array.isArray(input.body) ? input.body : [input.body])
    .map((p) => stripBackendTags(p).trim())
    .filter(Boolean)
  const bodyText = bodyParagraphs.join('\n\n')

  // Never append a second question if the body (usually AI-generated) already asks one.
  const closing = /\?\s*$/.test(bodyText) ? undefined : input.closingQuestion?.trim()

  const headingLine = input.heading ? `*${input.heading}*` : null

  let content: string
  const wordCount =
    countWords(bodyText) +
    (headingLine ? countWords(headingLine) : 0) +
    (closing ? countWords(closing) : 0) +
    (input.includeHandover ? countWords(HUMAN_HANDOVER_BLOCK) : 0)

  if (wordCount <= WORD_LIMIT) {
    content = [headingLine, bodyText, input.includeHandover ? HUMAN_HANDOVER_BLOCK : null, closing]
      .filter(Boolean)
      .join('\n\n')
  } else {
    // Trim the body first -- heading, handover block, and closing question are
    // fixed-size and structurally important, so they're preserved intact.
    const reserved =
      (headingLine ? countWords(headingLine) : 0) +
      (input.includeHandover ? countWords(HUMAN_HANDOVER_BLOCK) : 0) +
      (closing ? countWords(closing) : 0)
    const bodyBudget = Math.max(20, WORD_LIMIT - reserved)
    const trimmedBody = truncateToWordLimit(bodyText, bodyBudget)

    content = [headingLine, trimmedBody, input.includeHandover ? HUMAN_HANDOVER_BLOCK : null, closing]
      .filter(Boolean)
      .join('\n\n')
  }

  return `${BRAND_HEADER}\n\n${DIVIDER}\n\n${content}\n\n${DIVIDER}`
}
