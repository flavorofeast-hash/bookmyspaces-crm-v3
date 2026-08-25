// TEMPORARY diagnostic route — not part of the app's real surface.
// Reports process.env.META_APP_SECRET's length/format/SHA256 fingerprint
// as actually seen by the running Lambda, never the value itself. Exists
// only to determine whether the Vercel CLI/API reporting layer (env ls /
// env pull) reflects the true runtime value, since five separate writes
// have shown identical CLI-reported content despite fresh writes.
// Admin/manager only. Delete this file once the investigation concludes.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'

// Gated with a value hardcoded directly in source (deliberately NOT read
// from a Vercel env var) -- discovered that `vercel env pull`/CLI-reported
// env values do not match what the deployed Lambda actually receives
// (CRON_SECRET: 11 chars via CLI, 4 chars at runtime), so comparing against
// another env var here would just repeat the same unreliable comparison.
// This constant never touches any env var read/write path.
const DIAG_TOKEN = 'bms-diag-9f3a7c21-temporary'

export async function GET(request: NextRequest) {
  const token = request.headers.get('authorization')?.replace('Bearer ', '').trim()
  if (token !== DIAG_TOKEN) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const val = process.env.META_APP_SECRET ?? ''
  const isHex32 = /^[0-9a-f]{32}$/.test(val)
  const fingerprint = val ? crypto.createHash('sha256').update(val).digest('hex') : null

  return NextResponse.json({
    length: val.length,
    isHex32,
    fingerprint,
  })
}
