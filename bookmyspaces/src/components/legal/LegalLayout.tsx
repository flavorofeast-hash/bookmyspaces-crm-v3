// ─────────────────────────────────────────────────────────────────────────────
// FILE: src/components/legal/LegalLayout.tsx
// Legal & Compliance module — shared chrome (header/nav/title/last-updated/
// footer) for the Privacy Policy, Terms of Service, and Data Deletion
// Instructions pages, so each page.tsx only supplies a title + its own
// content instead of re-declaring the surrounding layout three times.
//
// Server component (no client interactivity needed) — same brand tokens
// already defined in src/app/globals.css (--gold/--charcoal/--font-display/
// etc.) that the public homepage (src/app/page.tsx) uses, so this reads as
// the same site rather than a bolted-on legal template.
// ─────────────────────────────────────────────────────────────────────────────

import Link from 'next/link'
import { LEGAL, LEGAL_NAV_LINKS } from '@/lib/legal'

export function LegalLayout({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <main className="min-h-screen" style={{ background: 'var(--warm-white)' }}>
      <header className="border-b" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
        <div className="max-w-3xl mx-auto px-6 py-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <Link
            href="/"
            className="text-xl font-light"
            style={{ fontFamily: 'var(--font-display)', color: 'var(--charcoal)' }}
          >
            {LEGAL.companyName}
          </Link>
          <nav className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm" style={{ color: 'var(--muted)' }}>
            {LEGAL_NAV_LINKS.map((link) => (
              <Link key={link.href} href={link.href} className="hover:underline" style={{ color: 'var(--slate)' }}>
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <article className="max-w-3xl mx-auto px-6 py-12 md:py-16">
        <p
          className="gold-line text-xs tracking-widest uppercase mb-2"
          style={{ color: 'var(--gold)', fontFamily: 'var(--font-body)' }}
        >
          {LEGAL.companyName}
        </p>
        <h1
          className="text-3xl md:text-4xl font-light mb-2"
          style={{ fontFamily: 'var(--font-display)', color: 'var(--charcoal)' }}
        >
          {title}
        </h1>
        <p className="text-sm mb-10" style={{ color: 'var(--muted)' }}>
          Last updated: {LEGAL.lastUpdated}
        </p>

        {children}
      </article>

      <footer
        className="border-t py-10 px-6 text-center text-sm"
        style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
      >
        <p>
          Questions?{' '}
          <a href={`mailto:${LEGAL.supportEmail}`} className="underline" style={{ color: 'var(--gold-dark)' }}>
            {LEGAL.supportEmail}
          </a>
        </p>
        <p className="mt-2">
          © {new Date().getFullYear()} {LEGAL.companyName}
        </p>
      </footer>
    </main>
  )
}
