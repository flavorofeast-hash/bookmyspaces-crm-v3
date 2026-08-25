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

// Bearer-token gated via CRON_SECRET (same pattern as src/app/api/cron/*) --
// deliberately not requireRole()'d, since this needs to be callable from a
// script without an interactive browser session, for exactly one debugging
// pass. Fails closed if CRON_SECRET is unset.
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return NextResponse.json({ error: 'not configured' }, { status: 500 })
  const token = request.headers.get('authorization')?.replace('Bearer ', '').trim()
  if (token !== cronSecret) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const val = process.env.META_APP_SECRET ?? ''
  const isHex32 = /^[0-9a-f]{32}$/.test(val)
  const fingerprint = val ? crypto.createHash('sha256').update(val).digest('hex') : null

  return NextResponse.json({
    length: val.length,
    isHex32,
    fingerprint,
  })
}
