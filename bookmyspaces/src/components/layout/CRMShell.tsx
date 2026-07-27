// ─────────────────────────────────────────────────────────────────────────────
// DEPRECATED — NOT MOUNTED ANYWHERE. Do not wire this back in.
//
// RC Phase 1 audit (production-readiness pass): confirmed via full-repo grep
// that no file imports CRMShell — CRMLayout.tsx (the only layout actually
// used by the app root) has its own comment explaining why: this component's
// sign-out button posted to /api/auth/logout... wait, to a nonexistent
// /api/auth/signout URL, which is why CRMLayout.tsx was written as its
// replacement with the correct route. Left in the tree (not deleted) only
// because this sandbox's tooling couldn't get delete permission for this
// specific file during the audit — safe to delete manually. See
// PRODUCTION_CHECKLIST.md / the RC audit findings for the full list.
// ─────────────────────────────────────────────────────────────────────────────

'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import {
  LayoutDashboard,
  MessageSquare,
  FileText,
  Megaphone,
  Kanban,
  Settings,
  ChevronLeft,
  ChevronRight,
  Bell,
  Search,
  User,
  LogOut,
} from 'lucide-react'

const navItems = [
  {
    href: '/dashboard',
    label: 'Dashboard',
    icon: LayoutDashboard,
  },
  {
    href: '/whatsapp',
    label: 'WhatsApp',
    icon: MessageSquare,
  },
  {
    href: '/proposals',
    label: 'Proposals',
    icon: FileText,
  },
  {
    href: '/campaigns',
    label: 'Campaigns',
    icon: Megaphone,
  },
  {
    href: '/kanban',
    label: 'Kanban',
    icon: Kanban,
  },
  {
    href: '/settings',
    label: 'Settings',
    icon: Settings,
  },
]

export default function CRMShell({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)

  return (
    <div className="flex h-screen bg-gray-100 overflow-hidden">

      {/* ── SIDEBAR ────────────────────────────────────────────────── */}
      <aside
        className={`
          flex flex-col bg-gray-900 text-white transition-all duration-200 ease-in-out
          ${collapsed ? 'w-16' : 'w-60'}
        `}
      >
        {/* Logo */}
        <div className="flex items-center justify-between px-4 py-5 border-b border-gray-700">
          {!collapsed && (
            <div>
              <div className="text-base font-bold text-white leading-tight">
                BookMySpaces
              </div>
              <div className="text-xs text-gray-400 font-normal mt-0.5">
                CRM
              </div>
            </div>
          )}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="p-1.5 rounded-md hover:bg-gray-700 text-gray-400 hover:text-white transition ml-auto"
            aria-label="Toggle sidebar"
          >
            {collapsed ? (
              <ChevronRight className="w-4 h-4" />
            ) : (
              <ChevronLeft className="w-4 h-4" />
            )}
          </button>
        </div>

        {/* Nav links */}
        <nav className="flex-1 py-4 space-y-1 px-2 overflow-y-auto">
          {navItems.map(({ href, label, icon: Icon }) => {
            const active =
              pathname === href || pathname.startsWith(href + '/')

            return (
              <Link
                key={href}
                href={href}
                title={collapsed ? label : undefined}
                className={`
                  flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm
                  transition-colors duration-150
                  ${
                    active
                      ? 'bg-white text-gray-900 font-semibold'
                      : 'text-gray-300 hover:bg-gray-700 hover:text-white'
                  }
                `}
              >
                <Icon
                  className={`w-4 h-4 shrink-0 ${
                    active ? 'text-gray-900' : 'text-gray-400'
                  }`}
                />
                {!collapsed && <span>{label}</span>}
              </Link>
            )
          })}
        </nav>

        {/* Bottom: sign out */}
        <div className="px-2 py-4 border-t border-gray-700">
          <form action="/api/auth/signout" method="POST">
            <button
              type="submit"
              className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg
                         text-sm text-gray-400 hover:bg-gray-700 hover:text-white
                         transition-colors duration-150"
              title={collapsed ? 'Sign out' : undefined}
            >
              <LogOut className="w-4 h-4 shrink-0" />
              {!collapsed && <span>Sign out</span>}
            </button>
          </form>
        </div>
      </aside>

      {/* ── MAIN AREA ──────────────────────────────────────────────── */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">

        {/* Top header */}
        <header className="h-14 bg-white border-b border-gray-200 flex items-center
                           justify-between px-6 shrink-0">

          {/* Left: page title derived from pathname */}
          <h2 className="text-sm font-semibold text-gray-700 capitalize">
            {pathname.split('/').filter(Boolean).pop()?.replace(/-/g, ' ') ??
              'Dashboard'}
          </h2>

          {/* Right: search + notifications + user */}
          <div className="flex items-center gap-3">
            <button
              className="p-2 rounded-md hover:bg-gray-100 text-gray-500
                         hover:text-gray-700 transition"
              aria-label="Search"
            >
              <Search className="w-4 h-4" />
            </button>
            <button
              className="p-2 rounded-md hover:bg-gray-100 text-gray-500
                         hover:text-gray-700 transition relative"
              aria-label="Notifications"
            >
              <Bell className="w-4 h-4" />
              {/* notification dot */}
              <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5
                               bg-red-500 rounded-full" />
            </button>
            <div
              className="w-8 h-8 rounded-full bg-gray-900 text-white
                          flex items-center justify-center text-xs font-semibold"
            >
              <User className="w-4 h-4" />
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto bg-gray-50">
          {children}
        </main>

      </div>
    </div>
  )
}
