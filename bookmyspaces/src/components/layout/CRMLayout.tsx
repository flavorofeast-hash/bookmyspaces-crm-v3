'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const links = [
  { href: '/dashboard', label: 'Dashboard' },
  // Sprint 5 fix: Revenue Dashboard and Operations Dashboard were both
  // fully built (Sprint 2 and Sprint 4 respectively) but had no path to
  // them from the persistent nav — each only linked to the *other* one
  // from its own header, so a receptionist had no way to discover either
  // screen existed unless they already knew the URL. See
  // audit/SPRINT5_GO_LIVE_REPORT.md, Priority 7 (Operator Experience).
  { href: '/dashboard/revenue', label: 'Revenue' },
  { href: '/dashboard/operations', label: 'Operations' },
  { href: '/customers', label: 'Customers' },
  { href: '/inbox', label: 'Inbox' },
  { href: '/reservations', label: 'Reservations' },
  { href: '/whatsapp', label: 'WhatsApp' },
  { href: '/proposals', label: 'Proposals' },
  { href: '/campaigns', label: 'Campaigns' },
  { href: '/social', label: 'Social' },
  { href: '/content-studio', label: 'Content Studio' },
  { href: '/kanban', label: 'Kanban' },
  { href: '/catalog', label: 'Catalog' },
  { href: '/knowledge-base', label: 'AI Knowledge' },
  { href: '/settings', label: 'Settings' },
]

export default function CRMLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()

  // Sprint 5 fix: adding /dashboard/revenue and /dashboard/operations
  // above means their href is now prefixed by the plain "/dashboard"
  // link's href, so a naive `pathname.startsWith(link.href)` check would
  // highlight "Dashboard" *and* "Revenue" (or "Operations") at the same
  // time while on either sub-page. Pick the single longest-matching href
  // instead, so only the most specific nav item is ever shown active.
  const activeHref = links
    .filter((l) => pathname === l.href || pathname.startsWith(`${l.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href

  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className="w-64 bg-black text-white p-5 flex flex-col">
        <h1 className="text-2xl font-bold mb-8">
          BookMySpaces
        </h1>

        <nav className="space-y-2 flex-1">
          {links.map((link) => {
            const active = link.href === activeHref

            return (
              <Link
                key={link.href}
                href={link.href}
                className={`block rounded-lg px-4 py-3 transition ${
                  active
                    ? 'bg-white text-black font-semibold'
                    : 'hover:bg-gray-800'
                }`}
              >
                {link.label}
              </Link>
            )
          })}
        </nav>

        {/* Sign out — previously missing entirely from this layout (the only
            layout actually wired into the app); a different, unused layout
            component (CRMShell.tsx) had a sign-out button but pointed at a
            /api/auth/signout URL that doesn't exist. This one calls the real,
            working /api/auth/logout route. */}
        <form action="/api/auth/logout" method="POST">
          <button
            type="submit"
            className="block w-full text-left rounded-lg px-4 py-3 mt-2 text-gray-300 hover:bg-gray-800 hover:text-white transition"
          >
            Sign out
          </button>
        </form>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-6 overflow-auto">
        {children}
      </main>
    </div>
  )
}
