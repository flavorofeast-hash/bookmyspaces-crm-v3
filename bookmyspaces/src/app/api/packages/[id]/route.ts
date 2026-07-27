export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { requireAuth } from '@/lib/auth-guard'
import { getPackageById, updatePackage, deactivatePackage } from '@/lib/packages/package-service'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  try {
    const pkg = await getPackageById(params.id)
    if (!pkg) return NextResponse.json({ error: 'Package not found' }, { status: 404 })
    return NextResponse.json({ package: pkg })
  } catch (err) {
    logger.error('packages', `GET /api/packages/${params.id} failed`, err)
    return NextResponse.json({ error: 'Failed to fetch package' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  try {
    const body = await req.json()
    const updated = await updatePackage(params.id, body)
    if (!updated) return NextResponse.json({ error: 'Failed to update package' }, { status: 500 })
    return NextResponse.json({ package: updated })
  } catch (err) {
    logger.error('packages', `PATCH /api/packages/${params.id} failed`, err)
    return NextResponse.json({ error: 'Failed to update package' }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  try {
    const ok = await deactivatePackage(params.id)
    if (!ok) return NextResponse.json({ error: 'Failed to deactivate package' }, { status: 500 })
    return NextResponse.json({ success: true })
  } catch (err) {
    logger.error('packages', `DELETE /api/packages/${params.id} failed`, err)
    return NextResponse.json({ error: 'Failed to deactivate package' }, { status: 500 })
  }
}
