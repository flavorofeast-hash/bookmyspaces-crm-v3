// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/app/(crm)/content-studio/social-post-form-helpers.ts
// Content Studio — Account Selection fix.
//
// Pure, framework-free helpers extracted out of page.tsx's New Post form so
// the platform->account filtering, the account_id submit-field derivation,
// and the (future) edit-load rule can be unit-tested with this codebase's
// existing node-environment vitest setup (vitest.config.ts has no jsdom/
// React Testing Library configured — no other page component in this repo
// is rendering-tested, so these stay plain functions the page imports,
// rather than introducing a new test harness for one page).
// ─────────────────────────────────────────────────────────────────────────────

export interface SocialAccountForSelection {
  id: string
  platform: string
  status: 'disconnected' | 'connected' | 'token_expired' | 'error'
  is_active: boolean
}

/**
 * Accounts an operator may pick to publish AS, for one platform. Only
 * actively connected accounts are offered — a token_expired/error/inactive
 * account would just fail at publish time, so it's excluded here rather than
 * letting the operator select a target that can't actually publish.
 */
export function filterConnectedAccountsForPlatform<T extends SocialAccountForSelection>(
  accounts: T[],
  platform: string
): T[] {
  return accounts.filter((a) => a.platform === platform && a.is_active && a.status === 'connected')
}

/**
 * The exact expression the New Post form submits as `account_id` — an empty
 * selection becomes `null` (never an empty string), matching
 * createSocialPostSchema's `account_id: uuid.nullish()`.
 */
export function toAccountIdField(selectedAccountId: string): string | null {
  return selectedAccountId || null
}

/**
 * Content Studio is currently create-only (no post-editing UI exists yet —
 * see page.tsx's own header comment). This is the rule a future edit surface
 * would use to preload the form's account selector from an existing post
 * without losing its account_id, kept here (and tested) so that wiring is a
 * one-line call rather than a rule invented from scratch later.
 */
export function resolveAccountIdForEdit(post: { account_id: string | null } | null | undefined): string {
  return post?.account_id ?? ''
}
