// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/app/api/admin/catalog/[entity]/route.ts
// V3 Phase 2b — Admin CRUD for the hospitality catalog (VERSION1_1 Tier 1 #1).
//
// GET  /api/admin/catalog/properties?includeInactive=1  → list
// POST /api/admin/catalog/inventory-items               → create
//
// admin/manager only. Entity names are validated against the fixed
// CATALOG_ENTITIES registry — an unknown entity is a 404, and the registry's
// per-table column allow-list (catalog-service.ts) plus per-entity zod
// schemas (validation.ts) mean nothing outside the declared shape reaches
// the database.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { requireRole } from '@/lib/auth-guard'
import { parseBody, catalogCreateSchemas } from '@/lib/validation'
import { isCatalogEntity, listCatalogRows, createCatalogRow } from '@/lib/admin/catalog-service'
import { auditLog } from '@/lib/audit-log'

export async function GET(req: Request, { params }: { params: { entity: string } }) {
  const auth = await requireRole(['admin', 'manager'])
  if (!auth.ok) return auth.response

  if (!isCatalogEntity(params.entity)) {
    return NextResponse.json({ error: 'Unknown catalog entity' }, { status: 404 })
  }

  const includeInactive = new URL(req.url).searchParams.get('includeInactive') === '1'
  const result = await listCatalogRows(params.entity, { includeInactive })

  if (!result.ok) {
    logger.error('admin-catalog', `GET ${params.entity} failed`, result.error)
    return NextResponse.json({ error: 'Failed to list rows' }, { status: 500 })
  }
  return NextResponse.json({ rows: result.rows })
}

export async function POST(req: Request, { params }: { params: { entity: string } }) {
  const auth = await requireRole(['admin', 'manager'])
  if (!auth.ok) return auth.response

  if (!isCatalogEntity(params.entity)) {
    return NextResponse.json({ error: 'Unknown catalog entity' }, { status: 404 })
  }

  const parsed = await parseBody(req, catalogCreateSchemas[params.entity])
  if (!parsed.ok) return parsed.response

  const result = await createCatalogRow(params.entity, parsed.data as Record<string, unknown>)
  if (!result.ok) {
    logger.error('admin-catalog', `POST ${params.entity} failed`, result.error)
    return NextResponse.json({ error: result.error }, { status: 500 })
  }
  auditLog({
    actor: auth.user.email ?? auth.user.id,
    action: 'catalog.create',
    entityType: params.entity,
    entityId: String(result.row.id ?? ''),
  })
  return NextResponse.json({ row: result.row }, { status: 201 })
}
