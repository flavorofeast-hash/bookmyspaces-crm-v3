// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/social/social-account-routing.ts
// Multi-tenant Instagram/Facebook DM routing — the piece that was entirely
// missing before this pass. dm-capture-service.ts used to call
// unified-conversation-service.ts's ensureChannel('instagram'), which keys
// on channel_type alone: exactly ONE 'instagram' channels row ever exists,
// shared by every connected Instagram account. A real inbound event's
// recipient (which client/hotel's account it was actually sent to) was
// never checked against `social_accounts` at all -- any Instagram webhook
// event, for any account, would have been silently filed into that one
// shared bucket, with no way to tell afterward which business/property it
// belonged to, and no way to reject an event for an account the CRM never
// connected.
//
// This makes account identity a first-class part of the routing key:
// - findConnectedSocialAccount() is the "do we even know this account"
//   gate -- an event for an unrecognized/inactive account is rejected
//   rather than captured into an undifferentiated default.
// - ensureSocialAccountChannel() gives each CONNECTED ACCOUNT its own
//   `channels` row (not one shared row per platform), keyed via the
//   already-existing `channels.config` JSONB column -- no migration
//   needed, no schema change, additive only.
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabaseAdmin } from '@/lib/supabase'
import { logger } from '@/lib/logger'

export interface ConnectedSocialAccount {
  id: string
  displayName: string
  externalAccountId: string
}

/**
 * The connected, active social_accounts row for this platform + Meta
 * account id, or null when nothing matches. Callers must treat null as
 * "don't capture this event" -- not "fall back to some default account."
 */
export async function findConnectedSocialAccount(
  platform: 'facebook' | 'instagram',
  externalAccountId: string
): Promise<ConnectedSocialAccount | null> {
  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('social_accounts')
    .select('id, display_name, external_account_id')
    .eq('platform', platform)
    .eq('external_account_id', externalAccountId)
    .eq('is_active', true)
    .maybeSingle()

  if (error) {
    logger.error('social', 'findConnectedSocialAccount query failed', error, { platform, externalAccountId })
    return null
  }
  if (!data) return null
  return { id: data.id, displayName: data.display_name, externalAccountId: data.external_account_id }
}

/**
 * Get-or-create a `channels` row scoped to this ONE connected account
 * (not a single shared row per platform). Keyed on
 * config->>'external_account_id' so multiple Instagram accounts
 * (Client A, Client B, ...) each get their own row and their own
 * conversation/message history, without a schema migration.
 */
export async function ensureSocialAccountChannel(
  platform: 'facebook' | 'instagram',
  account: ConnectedSocialAccount
): Promise<string> {
  const db = getSupabaseAdmin()

  const { data: existing } = await db
    .from('channels')
    .select('id')
    .eq('channel_type', platform)
    .contains('config', { external_account_id: account.externalAccountId })
    .limit(1)
    .maybeSingle()

  if (existing?.id) return existing.id

  const { data: created, error } = await db
    .from('channels')
    .insert({
      channel_type: platform,
      display_name: account.displayName,
      is_active: true,
      config: { external_account_id: account.externalAccountId, social_account_id: account.id },
    })
    .select('id')
    .single()

  if (error || !created?.id) {
    throw new Error(`ensureSocialAccountChannel: failed to create channel row: ${error?.message ?? 'no id returned'}`)
  }
  return created.id
}
