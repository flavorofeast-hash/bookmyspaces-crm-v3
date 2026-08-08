export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { requireAuth } from '@/lib/auth-guard'
import { parseBody, updateBusinessPackageSchema } from '@/lib/validation'
import { getBusinessPackageById, updateBusinessPackage, setBusinessPackageStatus } from '@/lib/business-packages/business-package-service'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  try {
    const pkg = await getBusinessPackageById(params.id)
    if (!pkg) return NextResponse.json({ error: 'Package not found' }, { status: 404 })
    return NextResponse.json({ package: pkg })
  } catch (err) {
    logger.error('business-packages', `GET /api/business-packages/${params.id} failed`, err)
    return NextResponse.json({ error: 'Failed to fetch business package' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response

  const parsed = await parseBody(req, updateBusinessPackageSchema)
  if (!parsed.ok) return parsed.response

  try {
    const result = await updateBusinessPackage(params.id, parsed.data)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
    return NextResponse.json({ package: result.value })
  } catch (err) {
    logger.error('business-packages', `PATCH /api/business-packages/${params.id} failed`, err)
    return NextResponse.json({ error: 'Failed to update business package' }, { status: 500 })
  }
}

// Retire — soft-delete convention (same as DELETE /api/packages/[id]'s
// deactivatePackage): a business package is never hard-deleted since
// historical social_posts/proposals may reference it via business_package_id.
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  try {
    const result = await setBusinessPackageStatus(params.id, 'retired')
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
    return NextResponse.json({ package: result.value })
  } catch (err) {
    logger.error('business-packages', `DELETE /api/business-packages/${params.id} failed`, err)
    return NextResponse.json({ error: 'Failed to retire business package' }, { status: 500 })
  }
}
