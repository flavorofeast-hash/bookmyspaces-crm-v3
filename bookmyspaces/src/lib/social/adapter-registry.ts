// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/social/adapter-registry.ts
// V3 Phase 5 — one lookup for platform adapters. Adding a platform =
// implement SocialAdapter + register here. Platforms without adapters yet
// (linkedin, google_business, x, youtube, threads) return null — routes
// respond with a clear "adapter not implemented" rather than a crash, and
// their data models are already in place (migration 014).
// ─────────────────────────────────────────────────────────────────────────────

import type { SocialAdapter, SocialPlatform } from '@/lib/social/types'
import { MetaAdapter } from '@/lib/social/adapters/meta-adapter'

const adapters: Partial<Record<SocialPlatform, SocialAdapter>> = {
  facebook: new MetaAdapter('facebook'),
  instagram: new MetaAdapter('instagram'),
}

export function getSocialAdapter(platform: string): SocialAdapter | null {
  return (adapters as Record<string, SocialAdapter | undefined>)[platform] ?? null
}

export function isSocialPlatform(value: string): value is SocialPlatform {
  return ['facebook', 'instagram', 'linkedin', 'google_business', 'x', 'youtube', 'threads'].includes(value)
}
