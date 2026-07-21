// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/knowledge/knowledge-sources-service.ts
// V3 Phase 2c — CRM-editable knowledge base (the `knowledge_sources` table
// from migration 012).
//
// This is the curated store the AI Orchestrator grounds its answers in —
// distinct from `knowledge_chunks` (document-derived, managed via
// /api/knowledge). Embeddings are generated best-effort on write via the
// existing generateEmbedding() (src/lib/ai.ts, OpenAI text-embedding-3-small
// — same model/dimension as the 012 VECTOR(1536) column). If embedding
// fails (no OPENAI_API_KEY in this environment), the row is still saved
// with embedding NULL: keyword retrieval still finds it, and a later save
// re-attempts the embedding. Content is never lost to a missing API key.
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabaseAdmin } from '@/lib/supabase'
import { generateEmbedding } from '@/lib/ai'
import { logger } from '@/lib/logger'

export interface KnowledgeSource {
  id: string
  category: string
  title: string
  content: string
  is_active: boolean
  updated_at: string
  has_embedding: boolean
}

type Result<T> = { ok: true; value: T } | { ok: false; error: string }

function mapRow(row: Record<string, unknown>): KnowledgeSource {
  return {
    id: String(row.id),
    category: String(row.category),
    title: String(row.title),
    content: String(row.content),
    is_active: row.is_active !== false,
    updated_at: String(row.updated_at ?? ''),
    has_embedding: row.embedding !== null && row.embedding !== undefined,
  }
}

async function tryEmbed(title: string, content: string): Promise<number[] | null> {
  try {
    return await generateEmbedding(`${title}\n\n${content}`)
  } catch (error) {
    logger.warn('knowledge-sources', 'embedding generation failed; saving without embedding', { error: String(error) })
    return null
  }
}

export async function listKnowledgeSources(
  opts: { includeInactive?: boolean } = {}
): Promise<Result<KnowledgeSource[]>> {
  const supabase = getSupabaseAdmin()
  let query = supabase
    .from('knowledge_sources')
    .select('id, category, title, content, is_active, updated_at, embedding')
    .order('category', { ascending: true })
    .order('title', { ascending: true })
  if (!opts.includeInactive) query = query.eq('is_active', true)

  const { data, error } = await query
  if (error) return { ok: false, error: error.message }
  return { ok: true, value: (data ?? []).map(mapRow) }
}

export async function createKnowledgeSource(input: {
  category: string
  title: string
  content: string
}): Promise<Result<KnowledgeSource>> {
  const supabase = getSupabaseAdmin()
  const embedding = await tryEmbed(input.title, input.content)

  const { data, error } = await supabase
    .from('knowledge_sources')
    .insert({ ...input, embedding, is_active: true })
    .select('id, category, title, content, is_active, updated_at, embedding')
    .single()

  if (error || !data) return { ok: false, error: error?.message ?? 'insert returned no row' }
  return { ok: true, value: mapRow(data) }
}

export async function updateKnowledgeSource(
  id: string,
  input: Partial<{ category: string; title: string; content: string; is_active: boolean }>
): Promise<Result<KnowledgeSource>> {
  const supabase = getSupabaseAdmin()

  const values: Record<string, unknown> = { ...input }

  // Re-embed when the text changes (title or content). Fetch current row so
  // the embedding always reflects the final title+content pair.
  if (input.title !== undefined || input.content !== undefined) {
    const { data: current } = await supabase
      .from('knowledge_sources')
      .select('title, content')
      .eq('id', id)
      .maybeSingle()
    const title = input.title ?? String(current?.title ?? '')
    const content = input.content ?? String(current?.content ?? '')
    values.embedding = await tryEmbed(title, content)
  }

  const { data, error } = await supabase
    .from('knowledge_sources')
    .update(values)
    .eq('id', id)
    .select('id, category, title, content, is_active, updated_at, embedding')
    .single()

  if (error || !data) return { ok: false, error: error?.message ?? 'update returned no row' }
  return { ok: true, value: mapRow(data) }
}
