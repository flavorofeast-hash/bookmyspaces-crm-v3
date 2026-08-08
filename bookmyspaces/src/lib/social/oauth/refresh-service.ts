// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/social/oauth/refresh-service.ts
// Social Connectivity Priority 1 — Token refresh rotation + Connection
// health. Two responsibilities, one file (both are "keep social_accounts.
// status honest" concerns):
//
//   1. refreshExpiringAccounts() — proactively renews a token BEFORE it
//      expires (checked by /api/cron/social-token-refresh, daily). LinkedIn/
//      Google Business/X use the standard refresh_token grant; Facebook/
//      Instagram (no refresh_token grant exists) renew by re-running the
//      long-lived-token exchange against the still-valid current token.
//   2. markAccountUnhealthy() — REACTIVE health signal: called by
//      publish-service.ts (and any other adapter call site) when a live API
//      call fails with an auth-shaped error, so status reflects reality
//      immediately rather than waiting for the next scheduled refresh.
//
// Social OAuth -> Publishing credential fix (Production Stabilization):
// added resolvePublishCredentials() — the single place publish-service.ts
// resolves a post's SELECTED social_accounts row into a usable
// {accessToken, externalAccountId}, decrypting via the existing
// token-cipher.ts and reactively refreshing via the SAME renew logic
// refreshExpiringAccounts() already uses (extracted into
// renewAndPersistAccountToken() below so there is exactly one renewal
// implementation, not two). No new token-storage mechanism — this only
// reads/decrypts the existing social_accounts.access_token_encrypted column.
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabaseAdmin } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { encryptToken, decryptToken } from '@/lib/social/token-cipher'
import { isOAuthCapablePlatform, OAUTH_CONFIGS, type OAuthCapablePlatform } from './oauth-config'
import { refreshAccessToken, renewMetaLongLivedToken } from './oauth-service'

// Refresh when the token expires within this window — generous enough that
// a once-daily cron always catches it before it actually lapses.
const REFRESH_BUFFER_MS = 3 * 24 * 60 * 60 * 1000

interface SocialAccountRow {
  id: string
  platform: string
  access_token_encrypted: string | null
  refresh_token_encrypted: string | null
  token_expires_at: string | null
}

export interface RefreshRunResult {
  checked: number
  renewed: number
  failed: number
  errors: string[]
}

type RenewAndPersistResult =
  | { ok: true; accessToken: string; persisted: boolean }
  | { ok: false; error: string }

/**
 * Renews ONE account's token (via renewOne() below) and persists it,
 * guarded by the same optimistic-concurrency check (condition the UPDATE on
 * token_expires_at still matching what was just read) already proven in
 * refreshExpiringAccounts(). Extracted so refreshExpiringAccounts()'s cron
 * loop and resolvePublishCredentials()'s on-demand publish-time refresh
 * share exactly one renewal implementation — not two.
 */
async function renewAndPersistAccountToken(row: SocialAccountRow): Promise<RenewAndPersistResult> {
  if (!isOAuthCapablePlatform(row.platform)) return { ok: false, error: `platform_${row.platform}_not_oauth_capable` }

  const renewed = await renewOne(row.platform, row)
  if (!renewed.ok) {
    await markAccountUnhealthy(row.id, renewed.error)
    return { ok: false, error: renewed.error }
  }

  const db = getSupabaseAdmin()
  const { data: updatedRow, error } = await db
    .from('social_accounts')
    .update({
      access_token_encrypted: encryptToken(renewed.accessToken),
      refresh_token_encrypted: renewed.refreshToken ? encryptToken(renewed.refreshToken) : row.refresh_token_encrypted,
      token_expires_at: renewed.expiresAt,
      status: 'connected',
    })
    .eq('id', row.id)
    .eq('token_expires_at', row.token_expires_at)
    .select('id')
    .maybeSingle()

  if (error) return { ok: false, error: error.message }
  if (updatedRow) return { ok: true, accessToken: renewed.accessToken, persisted: true }

  // Lost the optimistic-concurrency race — a concurrent renewal already won
  // and persisted a fresh token; use that instead of treating this as a
  // failure (a good token exists, just not the one minted by this call).
  const { data: current } = await db.from('social_accounts').select('access_token_encrypted').eq('id', row.id).maybeSingle()
  if (current?.access_token_encrypted) {
    try {
      return { ok: true, accessToken: decryptToken(current.access_token_encrypted), persisted: false }
    } catch {
      // fall through — the token this call itself minted is still valid
    }
  }
  return { ok: true, accessToken: renewed.accessToken, persisted: false }
}

/** Cron entry point (GET /api/cron/social-token-refresh). Never throws — one account's failure never blocks the rest, same per-item isolation as processDueScheduledPosts(). */
export async function refreshExpiringAccounts(): Promise<RefreshRunResult> {
  const result: RefreshRunResult = { checked: 0, renewed: 0, failed: 0, errors: [] }
  const db = getSupabaseAdmin()

  const { data, error } = await db
    .from('social_accounts')
    .select('id, platform, access_token_encrypted, refresh_token_encrypted, token_expires_at')
    .eq('status', 'connected')
    .eq('is_active', true)
    .not('token_expires_at', 'is', null)
    .lte('token_expires_at', new Date(Date.now() + REFRESH_BUFFER_MS).toISOString())

  if (error) {
    logger.error('social-oauth', 'refreshExpiringAccounts fetch failed', error)
    result.errors.push(error.message)
    return result
  }

  const rows = (data ?? []) as SocialAccountRow[]
  result.checked = rows.length

  for (const row of rows) {
    try {
      if (!isOAuthCapablePlatform(row.platform)) continue
      // Concurrency guard note (unchanged behavior, now inside
      // renewAndPersistAccountToken): the persisting UPDATE is conditioned
      // on token_expires_at still matching what was just read, so an
      // overlapping cron invocation never double-renews or clobbers a
      // fresher token with a stale one.
      const renewed = await renewAndPersistAccountToken(row)
      if (renewed.ok) {
        if (renewed.persisted) result.renewed++
        // else: another concurrent run already renewed this account first —
        // not a failure, just a no-op skip (markAccountUnhealthy is only
        // called by renewAndPersistAccountToken on an actual renewal failure).
      } else {
        result.failed++
        result.errors.push(`${row.platform}/${row.id}: ${renewed.error}`)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      result.errors.push(`${row.platform}/${row.id}: ${message}`)
      result.failed++
    }
  }

  return result
}

async function renewOne(
  platform: OAuthCapablePlatform,
  row: SocialAccountRow
): Promise<{ ok: true; accessToken: string; refreshToken: string | null; expiresAt: string | null } | { ok: false; error: string }> {
  const cfg = OAUTH_CONFIGS[platform]

  if (!cfg.supportsRefresh) {
    // Meta path: renew via the long-lived-token re-exchange using the
    // current (still valid) access token — no refresh_token involved.
    if (!row.access_token_encrypted) return { ok: false, error: 'no_access_token_on_file' }
    const current = decryptToken(row.access_token_encrypted)
    const renewed = await renewMetaLongLivedToken(current)
    if (!renewed.ok) return { ok: false, error: renewed.error }
    return {
      ok: true,
      accessToken: renewed.value.accessToken,
      refreshToken: null,
      expiresAt: renewed.value.expiresInSeconds ? new Date(Date.now() + renewed.value.expiresInSeconds * 1000).toISOString() : null,
    }
  }

  if (!row.refresh_token_encrypted) return { ok: false, error: 'no_refresh_token_on_file' }
  const refreshToken = decryptToken(row.refresh_token_encrypted)
  const renewed = await refreshAccessToken(platform, refreshToken)
  if (!renewed.ok) return { ok: false, error: renewed.error }
  return {
    ok: true,
    accessToken: renewed.value.accessToken,
    refreshToken: renewed.value.refreshToken,
    expiresAt: renewed.value.expiresInSeconds ? new Date(Date.now() + renewed.value.expiresInSeconds * 1000).toISOString() : null,
  }
}

// Auth-error heuristic — the same handful of substrings every adapter's
// error strings and OAuth token responses realistically produce for an
// expired/revoked credential. Not exhaustive by nature (matches this
// codebase's existing "heuristic, disclosed" posture, e.g. the buying-
// signal keyword tables) — a false negative just means status stays
// 'connected' one cycle longer, never a false "everything is broken."
const AUTH_ERROR_PATTERN = /\b(token|auth|unauthorized|401|expired|invalid_grant|revoked|permission)\b/i

export function looksLikeAuthError(message: string): boolean {
  return AUTH_ERROR_PATTERN.test(message)
}

/** Connection health — call from any social API call site (publish, reply, metrics sync) when a call fails. Only actually writes when the failure looks auth-shaped; a transient network/rate-limit error should not flip status to 'error' and hide a perfectly good connection. */
export async function markAccountUnhealthy(accountId: string, errorMessage: string): Promise<void> {
  try {
    const db = getSupabaseAdmin()
    const status = looksLikeAuthError(errorMessage) ? 'token_expired' : 'error'
    await db.from('social_accounts').update({ status }).eq('id', accountId)
  } catch (err) {
    logger.error('social-oauth', 'markAccountUnhealthy failed', err)
  }
}

interface ResolvableAccountRow extends SocialAccountRow {
  external_account_id: string | null
  status: string
  is_active: boolean
}

export interface ResolvedPublishCredentials {
  accessToken: string
  externalAccountId: string | null
}

type ResolveResult =
  | { ok: true; value: ResolvedPublishCredentials }
  | { ok: false; error: string }

/**
 * Social OAuth -> Publishing credential fix — the single resolver
 * publish-service.ts calls for a post with a selected social_accounts row
 * (post.account_id). Looks up that EXACT account (never "the first connected
 * account for the platform"), decrypts its token via the existing
 * token-cipher.ts, and — only if the stored token is already past
 * token_expires_at — reactively refreshes it via the same
 * renewAndPersistAccountToken() the daily cron uses, before handing back a
 * usable {accessToken, externalAccountId}. Never returns a decrypted token
 * to a caller outside this server-side module graph; the caller
 * (publish-service.ts) only ever forwards it directly into an adapter call,
 * never into an API response.
 */
export async function resolvePublishCredentials(accountId: string, expectedPlatform: string): Promise<ResolveResult> {
  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('social_accounts')
    .select('id, platform, external_account_id, access_token_encrypted, refresh_token_encrypted, token_expires_at, status, is_active')
    .eq('id', accountId)
    .maybeSingle()

  if (error) return { ok: false, error: error.message }
  if (!data) return { ok: false, error: 'social_account_not_found' }

  const row = data as ResolvableAccountRow
  if (row.platform !== expectedPlatform) {
    return { ok: false, error: `social_account_platform_mismatch: account is ${row.platform}, post is ${expectedPlatform}` }
  }
  if (!row.is_active || row.status === 'disconnected') {
    return { ok: false, error: 'social_account_not_connected' }
  }
  if (!row.access_token_encrypted) {
    return { ok: false, error: 'no_access_token_on_file' }
  }

  let accessToken: string
  try {
    accessToken = decryptToken(row.access_token_encrypted)
  } catch (err) {
    return { ok: false, error: err instanceof Error ? `token_decrypt_failed: ${err.message}` : 'token_decrypt_failed' }
  }

  // Reactive on-demand refresh — the daily cron (refreshExpiringAccounts)
  // proactively renews within a multi-day buffer, so this should rarely
  // trigger; it's a safety net for a token that has already lapsed by the
  // time a post is actually published.
  if (row.token_expires_at && new Date(row.token_expires_at).getTime() <= Date.now()) {
    const renewed = await renewAndPersistAccountToken(row)
    if (!renewed.ok) return { ok: false, error: renewed.error }
    accessToken = renewed.accessToken
  }

  return { ok: true, value: { accessToken, externalAccountId: row.external_account_id ?? null } }
}
