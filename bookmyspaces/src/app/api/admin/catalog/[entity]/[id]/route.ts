// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/app/api/admin/catalog/[entity]/[id]/route.ts
// V3 Phase 2b — Admin CRUD, single-row operations.
//
// PATCH  → partial update (allow-listed columns only)
// DELETE → soft delete (is_active = false; see catalog-service.ts header for
//          why hard deletes are deliberately not offered)
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { logger } from '@/lib/logger'
import { requireRole } from '@/lib/auth-guard'
import { parseBody, catalogUpdateSchemas } from '@/lib/validation'
import { isCatalogEntity, updateCatalogRow, deactivateCatalogRow } from '@/lib/admin/catalog-service'

const idSchema = z.string().uuid()

export async function PATCH(
  req: Request,
  { params }: { params: { entity: string; id: string } }
) {
  const auth = await requireRole(['admin', 'manager'])
  if (!auth.ok) return auth.response

  if (!isCatalogEntity(params.entity) || !idSchema.safeParse(params.id).success) {
    return NextResponse.json({ error: 'Unknown catalog entity or invalid id' }, { status: 404 })
  }

  const parsed = await parseBody(req, catalogUpdateSchemas[params.entity])
  if (!parsed.ok) return parsed.response

  const result = await updateCatalogRow(params.entity, params.id, parsed.data as Record<string, unknown>)
  if (!result.ok) {
    logger.error('admin-catalog', `PATCH ${params.entity}/${params.id} failed`, result.error)
    return NextResponse.json({ error: result.error }, { status: 500 })
  }
  return NextResponse.json({ row: result.row })
}

export async function DELETE(
  _req: Request,
  { params }: { params: { entity: string; id: string } }
) {
  const auth = await requireRole(['admin', 'manager'])
  if (!auth.ok) return auth.response

  if (!isCatalogEntity(params.entity) || !idSchema.safeParse(params.id).success) {
    return NextResponse.json({ error: 'Unknown catalog entity or invalid id' }, { status: 404 })
  }

  const result = await deactivateCatalogRow(params.entity, params.id)
  if (!result.ok) {
    logger.error('admin-catalog', `DELETE ${params.entity}/${params.id} failed`, result.error)
    return NextResponse.json({ error: result.error }, { status: 500 })
  }
  return NextResponse.json({ row: result.row })
}
