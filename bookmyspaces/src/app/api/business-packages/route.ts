export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { requireAuth } from '@/lib/auth-guard'
import { parseBody, createBusinessPackageSchema } from '@/lib/validation'
import { listBusinessPackages, createBusinessPackage, type BusinessPackageStatus } from '@/lib/business-packages/business-package-service'

export async function GET(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  try {
    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status') as BusinessPackageStatus | null
    const category = searchParams.get('category')

    const packages = await listBusinessPackages({
      status: status ?? undefined,
      category: category ?? undefined,
    })
    return NextResponse.json({ packages })
  } catch (err) {
    logger.error('business-packages', 'GET /api/business-packages failed', err)
    return NextResponse.json({ error: 'Failed to fetch business packages' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response

  const parsed = await parseBody(req, createBusinessPackageSchema)
  if (!parsed.ok) return parsed.response

  try {
    const result = await createBusinessPackage(parsed.data)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
    return NextResponse.json({ package: result.value }, { status: 201 })
  } catch (err) {
    logger.error('business-packages', 'POST /api/business-packages failed', err)
    return NextResponse.json({ error: 'Failed to create business package' }, { status: 500 })
  }
}
