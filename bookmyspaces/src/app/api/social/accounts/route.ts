// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/app/api/social/accounts/route.ts
// Phase 2 (Social Growth) — Multi-account management for social_accounts
// (migration 014: facebook/instagram/linkedin/google_business/x/youtube/
// threads). GET/POST/PATCH.
//
// Gated behind requireRole(['admin','manager']), NOT the plain
// requireAuth() used by /api/social/posts or /api/social/media-library —
// this table holds OAuth credentials (access_token_encrypted), a higher
// blast radius than content, matching the precedent set by
// /api/admin/knowledge-sources for other credential-adjacent settings data.
//
// access_token is ENCRYPTED before it touches the DB (token-cipher.ts,
// AES-256-GCM) and is NEVER returned by GET — the encrypted column is
// stripped from every response.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { requireRole } from '@/lib/auth-guard'
import { getSupabaseAdmin } from '@/lib/supabase'
import { parseBody, createSocialAccountSchema, updateSocialAccountSchema } from '@/lib/validation'
import { encryptToken, isTokenCipherConfigured } from '@/lib/social/token-cipher'

// access_token_encrypted is write-only from this route's perspective —
// every read strips it so a token never round-trips back to the browser.
function stripSecret<T extends { access_token_encrypted?: unknown }>(row: T): Omit<T, 'access_token_encrypted'> {
  const { access_token_encrypted: _omit, ...rest } = row
  return rest
}

export async function GET() {
  const auth = await requireRole(['admin', 'manager'])
  if (!auth.ok) return auth.response
  const db = getSupabaseAdmin()

  try {
    const { data, error } = await db.from('social_accounts').select('*').order('platform', { ascending: true })
    if (error) throw error
    return NextResponse.json({ accounts: (data ?? []).map(stripSecret) })
  } catch (err) {
    logger.error('social-accounts', 'GET failed', err)
    return NextResponse.json({ error: 'Failed to fetch accounts' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireRole(['admin', 'manager'])
  if (!auth.ok) return auth.response

  const parsed = await parseBody(req, createSocialAccountSchema)
  if (!parsed.ok) return parsed.response
  const { access_token, ...fields } = parsed.data

  if (access_token && !isTokenCipherConfigured()) {
    return NextResponse.json(
      { error: 'encryption_not_configured: SOCIAL_TOKEN_ENCRYPTION_KEY is not set — cannot safely store an access token. Save the account without a token, or configure the key first.' },
      { status: 400 }
    )
  }

  const db = getSupabaseAdmin()
  try {
    const { data, error } = await db
      .from('social_accounts')
      .insert({
        platform: fields.platform,
        display_name: fields.display_name,
        external_account_id: fields.external_account_id ?? null,
        access_token_encrypted: access_token ? encryptToken(access_token) : null,
        token_expires_at: fields.token_expires_at ?? null,
        scopes: fields.scopes ?? [],
        config: fields.config ?? {},
        status: access_token ? 'connected' : 'disconnected',
      })
      .select('*')
      .single()

    if (error) {
      // UNIQUE(platform, external_account_id)
      if (error.code === '23505') {
        return NextResponse.json({ error: 'An account for this platform + external_account_id already exists' }, { status: 409 })
      }
      throw error
    }
    return NextResponse.json({ account: stripSecret(data) }, { status: 201 })
  } catch (err) {
    logger.error('social-accounts', 'POST failed', err)
    return NextResponse.json({ error: 'Failed to create account' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  const auth = await requireRole(['admin', 'manager'])
  if (!auth.ok) return auth.response

  const parsed = await parseBody(req, updateSocialAccountSchema)
  if (!parsed.ok) return parsed.response
  const { id, access_token, ...fields } = parsed.data

  if (access_token && !isTokenCipherConfigured()) {
    return NextResponse.json(
      { error: 'encryption_not_configured: SOCIAL_TOKEN_ENCRYPTION_KEY is not set — cannot safely store an access token.' },
      { status: 400 }
    )
  }

  const db = getSupabaseAdmin()
  try {
    const updates: Record<string, unknown> = { ...fields }
    if (access_token) {
      updates.access_token_encrypted = encryptToken(access_token)
      // A freshly-supplied token implies the account is (re)connected,
      // unless the caller explicitly set a different status in the same call.
      if (!fields.status) updates.status = 'connected'
    }
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No updatable fields provided' }, { status: 400 })
    }

    const { data, error } = await db.from('social_accounts').update(updates).eq('id', id).select('*').maybeSingle()
    if (error) throw error
    if (!data) return NextResponse.json({ error: 'account_not_found' }, { status: 404 })
    return NextResponse.json({ account: stripSecret(data) })
  } catch (err) {
    logger.error('social-accounts', 'PATCH failed', err)
    return NextResponse.json({ error: 'Failed to update account' }, { status: 500 })
  }
}
