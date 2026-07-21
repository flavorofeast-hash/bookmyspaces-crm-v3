// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/ai/prompt-service.ts
// V3 Phase 2c — versioned, DB-driven AI prompts (the `ai_prompts` table from
// migration 012).
//
// The architecture review's core AI finding: SYSTEM_PROMPT in src/lib/ai.ts
// hardcodes property facts and package pricing into a TypeScript constant.
// This service is the replacement path: prompts live in the database,
// versioned, with exactly one active version per name. getActivePrompt()
// falls back to a caller-supplied default when the table is missing/empty,
// so nothing breaks before migration 012 is applied — the hardcoded
// constant becomes the fallback, not the source of truth.
//
// Versioning model: rows are immutable once created. "Editing" a prompt
// creates a new row with version = max+1 and moves is_active. History is
// never destroyed — a bad prompt change is rolled back by re-activating the
// previous version.
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabaseAdmin } from '@/lib/supabase'

export interface AIPrompt {
  id: string
  name: string
  prompt_template: string
  version: number
  is_active: boolean
  created_at: string
}

type Result<T> = { ok: true; value: T } | { ok: false; error: string }

// Small in-process cache: prompts are read on every AI call but change
// rarely. 60s TTL keeps edits near-instant without a per-message DB read.
const cache = new Map<string, { value: string; expires: number }>()
const CACHE_TTL_MS = 60_000

export function clearPromptCache(): void {
  cache.clear()
}

/**
 * The active template for `name`, or `fallback` when the table is missing,
 * empty, or errors. Never throws.
 */
export async function getActivePrompt(name: string, fallback: string): Promise<string> {
  const cached = cache.get(name)
  if (cached && cached.expires > Date.now()) return cached.value

  try {
    const supabase = getSupabaseAdmin()
    const { data, error } = await supabase
      .from('ai_prompts')
      .select('prompt_template')
      .eq('name', name)
      .eq('is_active', true)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle()

    const value = !error && data?.prompt_template ? String(data.prompt_template) : fallback
    cache.set(name, { value, expires: Date.now() + CACHE_TTL_MS })
    return value
  } catch {
    return fallback
  }
}

export async function listPrompts(): Promise<Result<AIPrompt[]>> {
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('ai_prompts')
    .select('*')
    .order('name', { ascending: true })
    .order('version', { ascending: false })

  if (error) return { ok: false, error: error.message }
  return { ok: true, value: (data ?? []) as AIPrompt[] }
}

/**
 * Creates the next version of `name` (version = current max + 1) and makes
 * it the single active version. Previous versions stay, deactivated.
 */
export async function createPromptVersion(input: {
  name: string
  prompt_template: string
}): Promise<Result<AIPrompt>> {
  const supabase = getSupabaseAdmin()

  const { data: latest } = await supabase
    .from('ai_prompts')
    .select('version')
    .eq('name', input.name)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()

  const nextVersion = (latest?.version ?? 0) + 1

  const { error: deactivateError } = await supabase
    .from('ai_prompts')
    .update({ is_active: false })
    .eq('name', input.name)
    .eq('is_active', true)
  if (deactivateError) return { ok: false, error: deactivateError.message }

  const { data, error } = await supabase
    .from('ai_prompts')
    .insert({
      name: input.name,
      prompt_template: input.prompt_template,
      version: nextVersion,
      is_active: true,
    })
    .select('*')
    .single()

  if (error || !data) return { ok: false, error: error?.message ?? 'insert returned no row' }
  clearPromptCache()
  return { ok: true, value: data as AIPrompt }
}

/** Re-activates a specific historical version (rollback path). */
export async function activatePromptVersion(id: string): Promise<Result<AIPrompt>> {
  const supabase = getSupabaseAdmin()

  const { data: target, error: findError } = await supabase
    .from('ai_prompts')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (findError || !target) return { ok: false, error: findError?.message ?? 'prompt version not found' }

  const { error: deactivateError } = await supabase
    .from('ai_prompts')
    .update({ is_active: false })
    .eq('name', target.name)
    .eq('is_active', true)
  if (deactivateError) return { ok: false, error: deactivateError.message }

  const { data, error } = await supabase
    .from('ai_prompts')
    .update({ is_active: true })
    .eq('id', id)
    .select('*')
    .single()

  if (error || !data) return { ok: false, error: error?.message ?? 'activation returned no row' }
  clearPromptCache()
  return { ok: true, value: data as AIPrompt }
}
