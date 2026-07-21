// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/admin/catalog-service.ts
// V3 Phase 2b — Admin CRUD for the hospitality catalog.
//
// VERSION1_1_ROADMAP.md Tier 1 #1: "Currently there is no in-app way to add
// properties/rooms/rate plans/meal plans/add-ons — it's raw Supabase Table
// Editor or SQL." This service is the single write path for the five catalog
// tables from migration 012. Column allow-lists per table (same
// mass-assignment reasoning as src/lib/validation.ts's updateLeadSchema):
// anything not listed never reaches the database.
//
// Deletes are soft (is_active = false) — catalog rows are referenced by
// rate_plans/reservations FKs; hard deletes would either cascade into
// booking history or fail. Deliberate product decision, not a shortcut.
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabaseAdmin } from '@/lib/supabase'

export const CATALOG_ENTITIES = {
  'properties': {
    table: 'properties',
    columns: [
      'name', 'slug', 'address', 'city', 'gst_number', 'google_maps_url',
      'contact_phone', 'contact_email', 'amenities', 'images', 'policies',
      'business_hours', 'is_active',
    ],
    orderBy: 'name',
  },
  'inventory-items': {
    table: 'inventory_items',
    columns: [
      'property_id', 'inventory_type', 'name', 'description',
      'max_occupancy', 'base_capacity', 'is_active',
    ],
    orderBy: 'name',
  },
  'meal-plans': {
    table: 'meal_plans',
    columns: ['property_id', 'code', 'name', 'description', 'price', 'is_active'],
    orderBy: 'name',
  },
  'rate-plans': {
    table: 'rate_plans',
    columns: [
      'inventory_item_id', 'rate_type', 'start_date', 'end_date',
      'price', 'priority', 'is_active',
    ],
    orderBy: 'created_at',
  },
  'addon-services': {
    table: 'addon_services',
    columns: ['property_id', 'name', 'category', 'price', 'is_active'],
    orderBy: 'name',
  },
} as const

export type CatalogEntity = keyof typeof CATALOG_ENTITIES

export function isCatalogEntity(value: string): value is CatalogEntity {
  // Object.hasOwn, not `in`: `in` walks the prototype chain, so strings like
  // '__proto__' or 'toString' would pass and reach the table lookup.
  return Object.hasOwn(CATALOG_ENTITIES, value)
}

type Row = Record<string, unknown>

function pickAllowed(entity: CatalogEntity, input: Row): Row {
  const allowed = CATALOG_ENTITIES[entity].columns as readonly string[]
  const out: Row = {}
  for (const key of Object.keys(input)) {
    if (allowed.includes(key)) out[key] = input[key]
  }
  return out
}

export async function listCatalogRows(
  entity: CatalogEntity,
  opts: { includeInactive?: boolean } = {}
): Promise<{ ok: true; rows: Row[] } | { ok: false; error: string }> {
  const cfg = CATALOG_ENTITIES[entity]
  const supabase = getSupabaseAdmin()

  let query = supabase.from(cfg.table).select('*').order(cfg.orderBy, { ascending: true })
  if (!opts.includeInactive) query = query.eq('is_active', true)

  const { data, error } = await query
  if (error) return { ok: false, error: error.message }
  return { ok: true, rows: data ?? [] }
}

export async function createCatalogRow(
  entity: CatalogEntity,
  input: Row
): Promise<{ ok: true; row: Row } | { ok: false; error: string }> {
  const supabase = getSupabaseAdmin()
  const values = pickAllowed(entity, input)

  const { data, error } = await supabase
    .from(CATALOG_ENTITIES[entity].table)
    .insert(values)
    .select('*')
    .single()

  if (error || !data) return { ok: false, error: error?.message ?? 'insert returned no row' }
  return { ok: true, row: data }
}

export async function updateCatalogRow(
  entity: CatalogEntity,
  id: string,
  input: Row
): Promise<{ ok: true; row: Row } | { ok: false; error: string }> {
  const supabase = getSupabaseAdmin()
  const values = pickAllowed(entity, input)

  if (Object.keys(values).length === 0) {
    return { ok: false, error: 'No updatable fields provided' }
  }

  const { data, error } = await supabase
    .from(CATALOG_ENTITIES[entity].table)
    .update(values)
    .eq('id', id)
    .select('*')
    .single()

  if (error || !data) return { ok: false, error: error?.message ?? 'update returned no row' }
  return { ok: true, row: data }
}

/** Soft delete: is_active = false. See file header for why hard deletes are not offered. */
export async function deactivateCatalogRow(
  entity: CatalogEntity,
  id: string
): Promise<{ ok: true; row: Row } | { ok: false; error: string }> {
  return updateCatalogRow(entity, id, { is_active: false })
}
