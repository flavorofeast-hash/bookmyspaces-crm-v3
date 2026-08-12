// src/middleware.ts
// ─────────────────────────────────────────────────────────────────────────────
// ISS-001 (audit/MASTER_ISSUE_REGISTER.csv): real session enforcement.
// Previously this function unconditionally returned NextResponse.next() for
// every request ("TEMP: allow everything while stabilizing app").
//
// Scope: this middleware only gates PAGE navigation with a redirect. API
// routes are individually protected via requireAuth()/requireRole()
// (src/lib/auth-guard.ts) per ISS-002 — this matches TEST_PLAN.md's two
// separate scenarios ("logged-out page sweep" expects a redirect;
// "logged-out API sweep" expects a 401 JSON body, not a redirect).
//
// Public pages (no session required): the landing page, the auth flow itself,
// the proposal share-token page (customers reach this via a link with no
// login — same intentionally-public design as the RLS "public share-token
// read" policy already on `proposals`, see LIVE_SCHEMA_AUDIT.md), and the
// Legal & Compliance pages (Meta App Review requires the Privacy Policy,
// Terms of Service, and Data Deletion Instructions URLs to return HTTP 200
// with no login redirect — see src/lib/legal.ts).
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createMiddlewareAuthClient } from '@/lib/supabase-middleware'

const PUBLIC_PAGE_PREFIXES = [
  '/auth',            // /auth/login, /auth/callback, /auth/auth-code-error
  '/proposals/share',  // public, share-token-gated proposal view
  '/privacy',          // Legal & Compliance — Meta App Review
  '/terms',            // Legal & Compliance — Meta App Review
  '/data-deletion',    // Legal & Compliance — Meta App Review
]

function isPublicPage(pathname: string): boolean {
  if (pathname === '/') return true
  return PUBLIC_PAGE_PREFIXES.some((p) => pathname.startsWith(p))
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname

  // Next.js internals and static files have no concept of a "session" —
  // truly skip these, no Supabase client needed at all.
  if (pathname.startsWith('/_next') || pathname.includes('.')) {
    return NextResponse.next()
  }

  // BUGFIX (found via live testing, 2026-07-12): API routes used to be
  // excluded from this whole function, on the theory that "API auth is
  // enforced per-route (ISS-002) so middleware doesn't need to do anything
  // here." That's true for the *authorization* check, but it accidentally
  // skipped *session refresh* too. Supabase's short-lived access token is
  // normally refreshed automatically whenever supabase.auth.getUser() runs
  // in middleware, which rewrites a fresh cookie onto the response. Page
  // navigations go through this middleware and got refreshed; direct API
  // calls (e.g. clicking "Create Proposal") never did, so once the access
  // token quietly expired, pages kept working (middleware refreshed them)
  // while any API POST/PATCH suddenly started failing with 401 — exactly
  // what surfaced when the user tried to create a proposal.
  //
  // Fix: still run the Supabase client (which refreshes + re-sets cookies
  // when needed) for API requests too — just never redirect them. The
  // actual "is this request allowed" decision stays with requireAuth() /
  // requireRole() per-route, unchanged from ISS-002.
  const response = NextResponse.next()
  const supabase = createMiddlewareAuthClient(request, response)
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (pathname.startsWith('/api')) {
    return response
  }

  if (isPublicPage(pathname)) {
    return response
  }

  // Every other page requires a valid Supabase session.
  if (!user) {
    const loginUrl = new URL('/auth/login', request.url)
    loginUrl.searchParams.set('redirect', pathname)
    return NextResponse.redirect(loginUrl)
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
