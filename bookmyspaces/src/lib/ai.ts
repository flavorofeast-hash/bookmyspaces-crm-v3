import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { getSupabaseAdmin } from './supabase'
import { logger } from './logger'
import { getActivePrompt } from '@/lib/ai/prompt-service'
import { getSettingsSection } from '@/lib/settings/settings-service'

// Lazy initialization — prevents build-time crashes
let _anthropic: Anthropic | null = null
let _openai: OpenAI | null = null

function getAnthropic(): Anthropic {
  if (!_anthropic) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set')
    _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  }
  return _anthropic
}

function getOpenAI(): OpenAI {
  if (!_openai) {
    if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not set')
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  }
  return _openai
}

export const SYSTEM_PROMPT = `You are Aria, a warm hospitality sales executive for BookMySpaces in Kolkata, India.

PROPERTIES:
SKYLINE SERENITY (Near Kolkata Airport)
- Deluxe & Premium AC Rooms from Rs999/night
- AC, attached washroom, geyser, wardrobe, smart TV, WiFi, couple-friendly, in-house dining
- Phone: 9830509991 / 9123005489 | www.bookmyspaces.in

MONURAMA HOMESTAY (Mukundapur, Near EM Bypass)
- Rooms for stay, Open-Air Cafe "Under the Mango Tree" from Rs249
- Rooftop events, Private Dining from Rs4999, Open-Air Banquet
- Phone: 8017035546 / 7003853624

ROOFTOP EVENT PACKAGES:
- SILVER Rs42000 (60 guests, 4hrs): venue, basic decor, buffet, sound, lighting, staff
- GOLD Rs50000 (60 guests, 4hrs): premium decor, expanded buffet, mic, party lights, cake table, staff [MOST POPULAR]
- PLATINUM Rs59500 (60 guests, 5hrs): theme decor, full buffet, DJ, welcome drink, stage, coordination
- Add-ons: Music Rs6000, Photography Rs8000, Extra guest Rs750/person, Theme decor Rs5000-12000

STYLE: You are a premium hospitality concierge, not a call-center bot. Warm, professional, Indian English, use emojis naturally and sparingly — never robotic, never a wall of text.
- Short paragraphs. 2-3 sentences per paragraph, blank line between paragraphs.
- Ask ONE question per reply — never stack several questions in a list. Pick the single most useful next question and ask only that.
- Keep the whole reply under about 150 words — a concierge is concise, not chatty.
- Do NOT add your own header, brand name banner, or divider lines (━━━ or similar) — that presentation layer is added automatically after your reply. Just write the natural message content.
GOALS: Understand needs, collect details conversationally (one question at a time), suggest the right package, handle objections warmly
COLLECT: name, phone (say "so I can share catalog"), event type, date, guest count, budget — one at a time, not all in one message
TRUST: Mention Google reviews, Justdial, website if asked. Manager: 8017035546
PRICING: Never reduce without authorization. Price objection: explain value, offer lower package.
ESCALATE: "Let me connect you with our manager. WhatsApp: 8017035546"

DATA EXTRACTION — MANDATORY — DO THIS EVERY SINGLE RESPONSE:
After your natural reply, append this EXACTLY (one line, valid JSON):
<<LEAD:{"name":"","phone":"","email":"","event_type":"","event_date":"","guest_count":"","budget":"","venue":""}>>

RULES FOR THE TAG:
- Include ALL 8 fields every single time, even if empty string
- phone: 10-digit Indian mobile only (e.g. "8017035546") — empty string if uncertain
- guest_count: digits only as string (e.g. "50") — empty string if uncertain
- venue: "skyline" or "monurama" or empty string
- Only put what customer EXPLICITLY said — never guess
- This tag is INVISIBLE to the customer — it is backend metadata only`

export function isValidIndianPhone(phone: string): boolean {
  const c = phone.replace(/[\s\-\(\)\+]/g, '')
  return /^[6-9]\d{9}$/.test(c) || /^91[6-9]\d{9}$/.test(c)
}

export function normalizePhone(phone: string): string | null {
  if (!phone || !phone.trim()) return null
  const c = phone.replace(/[\s\-\(\)\+]/g, '')
  if (/^91[6-9]\d{9}$/.test(c)) return c.slice(2)
  if (/^[6-9]\d{9}$/.test(c)) return c
  return null
}

export function sanitizeString(val: unknown, maxLen = 255): string | null {
  if (!val || typeof val !== 'string') return null
  const JUNK = ['unknown', 'null', 'undefined', 'n/a', 'na', 'none', 'not provided', 'not given']
  const c = val.replace(/[\x00-\x1F\x7F]/g, '').trim()
  if (!c || JUNK.includes(c.toLowerCase())) return null
  return c.slice(0, maxLen)
}

export function parseEventDate(val: unknown): string | null {
  if (!val || typeof val !== 'string') return null
  const s = val.trim()
  if (!s) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  try {
    const d = new Date(s)
    if (!isNaN(d.getTime()) && d.getFullYear() > 2020 && d.getFullYear() < 2030) {
      return d.toISOString().split('T')[0]
    }
  } catch {}
  return null
}

export function parseGuestCount(val: unknown): number | null {
  if (!val) return null
  const num = parseInt(String(val).replace(/[^\d]/g, ''))
  if (isNaN(num) || num < 1 || num > 5000) return null
  return num
}

export interface ExtractedLeadData {
  name: string | null
  phone: string | null
  email: string | null
  event_type: string | null
  event_date: string | null
  guest_count: string | null
  budget: string | null
  venue: string | null
}

export function extractLeadFromTag(aiResponse: string): ExtractedLeadData | null {
  const match = aiResponse.match(/<<LEAD:([\s\S]*?)>>/)
  if (!match) return null
  try {
    const raw = JSON.parse(match[1].trim())
    return {
      name: sanitizeString(raw.name),
      phone: normalizePhone(raw.phone || ''),
      email: sanitizeString(raw.email),
      event_type: sanitizeString(raw.event_type),
      event_date: sanitizeString(raw.event_date),
      guest_count: sanitizeString(raw.guest_count),
      budget: sanitizeString(raw.budget),
      venue: sanitizeString(raw.venue),
    }
  } catch {
    return null
  }
}

export async function extractLeadViaAI(conversationText: string): Promise<ExtractedLeadData | null> {
  try {
    const response = await getAnthropic().messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: `Extract info from this conversation. Return ONLY JSON, no explanation.\n\nConversation:\n${conversationText.slice(-2000)}\n\nJSON structure (null for unknown):\n{"name":null,"phone":null,"email":null,"event_type":null,"event_date":null,"guest_count":null,"budget":null,"venue":null}\n\nRules: phone=10-digit Indian only or null, guest_count=number string or null, venue="skyline"/"monurama"/null, only explicit info`,
      }],
    })
    const text = response.content[0].type === 'text' ? response.content[0].text : ''
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return null
    const raw = JSON.parse(jsonMatch[0])
    return {
      name: sanitizeString(raw.name),
      phone: normalizePhone(String(raw.phone || '')),
      email: sanitizeString(raw.email),
      event_type: sanitizeString(raw.event_type),
      event_date: sanitizeString(raw.event_date),
      guest_count: sanitizeString(raw.guest_count),
      budget: sanitizeString(raw.budget),
      venue: sanitizeString(raw.venue),
    }
  } catch {
    return null
  }
}

export function mergeExtracted(
  fromTag: ExtractedLeadData | null,
  fromAI: ExtractedLeadData | null
): ExtractedLeadData | null {
  if (!fromTag && !fromAI) return null
  const m: ExtractedLeadData = {
    name: fromTag?.name || fromAI?.name || null,
    phone: fromTag?.phone || fromAI?.phone || null,
    email: fromTag?.email || fromAI?.email || null,
    event_type: fromTag?.event_type || fromAI?.event_type || null,
    event_date: fromTag?.event_date || fromAI?.event_date || null,
    guest_count: fromTag?.guest_count || fromAI?.guest_count || null,
    budget: fromTag?.budget || fromAI?.budget || null,
    venue: fromTag?.venue || fromAI?.venue || null,
  }
  return Object.values(m).some(v => v !== null) ? m : null
}

export function hasMinimumLeadData(data: ExtractedLeadData | null): boolean {
  if (!data) return false
  return !!(data.name || data.phone)
}

export function cleanAIResponse(response: string): string {
  return response
    // Strip the mandatory data-extraction tag. Normally closes with a
    // literal ">>", but the model occasionally emits a malformed closing
    // delimiter -- if the well-formed pattern doesn't match, strip from
    // the tag's start to the end of the string instead of ever leaving
    // raw backend JSON visible to the customer.
    .replace(/<<LEAD:[\s\S]*?>>/g, '')
    .replace(/<<LEAD:[\s\S]*$/g, '')
    .replace(/<<EXTRACTED_DATA:[\s\S]*?>>/g, '')
    .replace(/<<EXTRACTED_DATA:[\s\S]*$/g, '')
    .trim()
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const response = await getOpenAI().embeddings.create({
    model: 'text-embedding-3-small',
    input: text.slice(0, 8000),
  })
  return response.data[0].embedding
}

// V3 Phase 4 — also search the CRM-editable `knowledge_sources` table
// (migration 012, edited on the AI Knowledge page). Additive alongside the
// existing knowledge_chunks search; returns '' on any failure, including
// the table not existing yet.
async function retrieveFromKnowledgeSources(keywords: string[], limit: number): Promise<string> {
  try {
    const supabaseAdmin = getSupabaseAdmin()
    const { data, error } = await supabaseAdmin
      .from('knowledge_sources')
      .select('title, content, category')
      .eq('is_active', true)
      .or(keywords.map(k => `content.ilike.%${k}%,title.ilike.%${k}%`).join(','))
      .limit(limit)

    if (error || !data?.length) return ''
    return data
      .map((r: { title: string; content: string; category: string }) =>
        `[${(r.category || 'INFO').toUpperCase()} — ${r.title}]\n${r.content}`)
      .join('\n\n---\n\n')
  } catch {
    return ''
  }
}

export async function retrieveRelevantKnowledge(query: string, limit = 4): Promise<string> {
  try {
    const supabaseAdmin = getSupabaseAdmin()

    // SECURITY (RC hardening): these keywords are built directly from raw
    // customer chat text (this function is reachable from the public,
    // unauthenticated /api/chat route) and get interpolated into a
    // PostgREST .or() filter string below and in retrieveFromKnowledgeSources().
    // Comma/paren are that filter language's clause-separator/grouping
    // syntax, so an unescaped keyword could inject extra clauses (e.g. widen
    // the match to the whole table). Stripping them keeps every keyword a
    // plain ILIKE term. Blast radius was already low — knowledge_chunks /
    // knowledge_sources hold public FAQ-style content, not PII — but this is
    // the correct fix regardless of severity.
    const keywords = query
      .toLowerCase()
      .split(' ')
      .filter(w => w.length > 3)
      .map(w => w.replace(/[,()]/g, ''))
      .filter(w => w.length > 3)
      .slice(0, 3)

    if (!keywords.length) return ''

    // Simple text search instead of vector search
    const { data, error } = await supabaseAdmin
      .from('knowledge_chunks')
      .select('content, source_file, category')
      .or(
        keywords
          .map(k => `content.ilike.%${k}%`)
          .join(',')
      )
      .limit(limit)

    const chunksContext = (!error && data?.length)
      ? data
          .map(
            (c: {
              content: string
              source_file: string
              category: string
            }) =>
              `[${(c.category || 'INFO').toUpperCase()} — ${c.source_file}]\n${c.content}`
          )
          .join('\n\n---\n\n')
      : ''

    // Curated CRM-edited entries rank first — they are operator-maintained
    // truth (pricing, policies), ahead of document-derived chunks.
    const sourcesContext = await retrieveFromKnowledgeSources(keywords, limit)
    return [sourcesContext, chunksContext].filter(Boolean).join('\n\n---\n\n')
  } catch {
    return ''
  }
}
export interface Message {
  role: 'user' | 'assistant'
  content: string
}

const FALLBACK_MESSAGE =
  "I'm having a brief connectivity issue 🙏 Please WhatsApp us at *8017035546* and we'll respond immediately!"

export async function chatWithAI(messages: Message[], userQuery: string): Promise<string> {
  const cappedMessages = messages.slice(-20)

  // V3 Phase 4 — DB-driven prompt + model settings. Both degrade to the
  // exact previous hardcoded behavior when migration 012 isn't applied:
  // getActivePrompt falls back to SYSTEM_PROMPT, getSettingsSection falls
  // back to defaults matching the previous literals (haiku-4.5, 800).
  const [knowledgeContext, systemPrompt, aiSettings] = await Promise.all([
    retrieveRelevantKnowledge(userQuery),
    getActivePrompt('system.customer_chat', SYSTEM_PROMPT),
    getSettingsSection('ai'),
  ])

  const systemWithContext = knowledgeContext
    ? `${systemPrompt}\n\n=== KNOWLEDGE BASE ===\n${knowledgeContext}\n=====================\nUse above context when relevant. Prioritize it over general knowledge. Never invent pricing or availability — if the knowledge base does not cover it, say you will check and offer a callback.`
    : systemPrompt

  try {
    const response = await getAnthropic().messages.create({
      model: aiSettings.model,
      max_tokens: aiSettings.maxTokens,
      system: systemWithContext,
      messages: cappedMessages.map(m => ({ role: m.role, content: m.content })),
    })
    const content = response.content[0]
    return content.type === 'text' ? content.text : FALLBACK_MESSAGE
  } catch (error) {
    logger.error('ai', 'Claude API error — falling back to OpenAI', error)
    try {
      const completion = await getOpenAI().chat.completions.create({
        model: 'gpt-4o-mini',
        max_tokens: aiSettings.maxTokens,
        messages: [
          { role: 'system', content: systemWithContext },
          ...cappedMessages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
        ],
      })
      return completion.choices[0]?.message?.content || FALLBACK_MESSAGE
    } catch {
      return FALLBACK_MESSAGE
    }
  }
}

export async function generateConversationSummary(messages: Message[]): Promise<string> {
  try {
    const convo = messages
      .slice(-16)
      .map(m => `${m.role === 'user' ? 'Customer' : 'Aria'}: ${m.content}`)
      .join('\n')

    const response = await getAnthropic().messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 150,
      messages: [{
        role: 'user',
        content: `Summarize this hospitality inquiry in 2 sentences: what they want, key requirements, current status.\n\n${convo}`,
      }],
    })
    const content = response.content[0]
    return content.type === 'text' ? content.text : 'Summary unavailable.'
  } catch {
    return 'Summary generation failed.'
  }
}

export function chunkText(text: string, chunkSize = 800, overlap = 100): string[] {
  const chunks: string[] = []
  let start = 0
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length)
    const chunk = text.slice(start, end).trim()
    if (chunk.length > 50) chunks.push(chunk)
    start = end - overlap
    if (start >= text.length) break
  }
  return chunks
}
