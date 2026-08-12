// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/lib/legal.ts
// Legal & Compliance module — single source of truth for the public
// Privacy Policy / Terms of Service / Data Deletion Instructions pages
// (required for Meta App Review on the Facebook/Instagram/WhatsApp
// integrations already implemented under src/lib/social/** and
// src/lib/whatsapp/**).
//
// Every legal page reads from LEGAL rather than hardcoding the company
// name/domain/support address, so a domain or contact change is a one-line
// edit here instead of a find-and-replace across three pages.
// ─────────────────────────────────────────────────────────────────────────────

import type { Metadata } from 'next'

export const LEGAL = {
  companyName: 'BookMySpaces',
  website: 'https://crm.bookmyspaces.in',
  supportEmail: 'support@bookmyspaces.in',
  privacyUrl: '/privacy',
  termsUrl: '/terms',
  dataDeletionUrl: '/data-deletion',
  lastUpdated: 'August 2026',
} as const

/**
 * Shared SEO metadata builder for the legal pages — title, description,
 * robots, openGraph, and canonical all derive from LEGAL plus the one-line
 * per-page description passed in, so the three page.tsx files never repeat
 * the boilerplate Metadata shape (only their own title/description/path).
 */
export function buildLegalMetadata(opts: { title: string; description: string; path: string }): Metadata {
  const url = `${LEGAL.website}${opts.path}`
  const fullTitle = `${opts.title} | ${LEGAL.companyName}`

  return {
    title: fullTitle,
    description: opts.description,
    robots: {
      index: true,
      follow: true,
    },
    alternates: {
      canonical: url,
    },
    openGraph: {
      title: fullTitle,
      description: opts.description,
      url,
      siteName: LEGAL.companyName,
      type: 'website',
      locale: 'en_IN',
    },
  }
}

/** Cross-links rendered in LegalLayout's header/footer nav — one list, reused by every legal page. */
export const LEGAL_NAV_LINKS: { href: string; label: string }[] = [
  { href: LEGAL.privacyUrl, label: 'Privacy Policy' },
  { href: LEGAL.termsUrl, label: 'Terms of Service' },
  { href: LEGAL.dataDeletionUrl, label: 'Data Deletion' },
]
