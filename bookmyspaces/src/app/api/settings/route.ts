// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/app/api/settings/route.ts
// V3 Phase 2a — Settings backend.
//
// GET: any authenticated staff member can read app settings (the UI needs
// them to render). WhatsApp secrets are never returned in full — the page's
// own WhatsAppSettings shape only carries accessTokenSet (a boolean), and
// verifyToken/phoneNumberId are operator-visible config, not credentials.
//
// PUT: admin/manager only (requireRole, ISS-003 convention) + zod
// validation via parseBody (ISS-005 convention). Partial payloads are fine —
// only sections present in the body are written (settings-service upsert).
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { requireAuth, requireRole } from '@/lib/auth-guard'
import { parseBody, updateSettingsSchema } from '@/lib/validation'
import { getAppSettings, saveAppSettings } from '@/lib/settings/settings-service'
import { auditLog } from '@/lib/audit-log'

export async function GET() {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response

  try {
    const settings = await getAppSettings()
    return NextResponse.json({ settings })
  } catch (error) {
    logger.error('settings', 'GET failed', error)
    return NextResponse.json({ error: 'Failed to load settings' }, { status: 500 })
  }
}

export async function PUT(req: Request) {
  const auth = await requireRole(['admin', 'manager'])
  if (!auth.ok) return auth.response

  const parsed = await parseBody(req, updateSettingsSchema)
  if (!parsed.ok) return parsed.response

  try {
    const result = await saveAppSettings(parsed.data, auth.user.email ?? auth.user.id)
    if (!result.ok) {
      logger.error('settings', 'PUT upsert failed', result.error)
      return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 })
    }
    auditLog({
      actor: auth.user.email ?? auth.user.id,
      action: 'settings.update',
      entityType: 'settings',
      detail: { sections: Object.keys(parsed.data) },
    })
    const settings = await getAppSettings()
    return NextResponse.json({ settings })
  } catch (error) {
    logger.error('settings', 'PUT failed', error)
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 })
  }
}
