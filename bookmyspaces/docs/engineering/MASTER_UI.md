# MASTER_UI.md — BookMySpaces Engineering OS

**Version:** v1.0 — READY FOR FREEZE

Canonical UI reference. No prior root-level doc fully covers this ground (`UI_UX_REVIEW.md` is a point-in-time audit, not a standing reference) — this document is the first durable one, built from that audit plus the actual page/component inventory.

## Stack & conventions

Tailwind CSS + Radix UI primitives (`@radix-ui/react-*`: avatar, dialog, dropdown-menu, label, scroll-area, select, separator, tabs, tooltip) + `lucide-react` icons + `framer-motion` for animation + `recharts` for charts + `react-hook-form` + `@hookform/resolvers` (zod) for forms + `sonner` for toasts + `class-variance-authority`/`tailwind-merge`/`clsx` for conditional styling.

**Convention to preserve**: forms validate with the same zod schemas the API layer uses where practical (client-side UX validation should not diverge from server-side truth) — `@hookform/resolvers` exists specifically to wire a zod schema into `react-hook-form`.

## Page inventory (`src/app/(crm)/*/page.tsx`, 24 route pages as of this audit)

`campaigns`, `catalog`, `content-studio`, `customers` (+`[id]`), `dashboard` (root, `intelligence`, `leads` list/`[id]`/`import`, `operations`, `revenue`), `inbox`, `kanban`, `knowledge-base`, `proposals` (list, `new`, `share/[token]`), `reservations` (list, `[id]`, `calendar`), `settings`, `social`, `whatsapp`.

## Required page-level states (the standard every new page must meet)

Per `UI_UX_REVIEW.md`'s direct audit: 23 of 24 existing pages already implement loading/empty/error states (spinner/skeleton pattern + explicit empty-state copy + error banner). **Every new page must match this bar as a floor, not an aspiration** — it is already the repository's norm, not a stretch goal.

- **Loading**: use Next.js App Router's `loading.tsx` convention next to `page.tsx` for server-rendered initial loads, or an in-component spinner/skeleton for client-fetched data — whichever fits the page's data-fetching shape. **Known gap, fix when touching that page**: the codebase has zero `loading.tsx` files anywhere except `proposals/share/[token]/loading.tsx` (added during the RC pass specifically because that's the one unauthenticated, customer-first-impression page). Every other page relies on in-component loading state, which is acceptable for authenticated operator pages (they already see a warmed-up shell/sidebar) but should be reconsidered if any future customer-facing page is added.
- **Empty state**: explicit copy, not a blank table — follow the Catalog page's pattern ("Nothing here yet. Use 'New X' to add the first one.").
- **Error state**: a visible banner, not a silent console error — follow the existing `bg-red-50 border-red-200 text-red-700` pattern used consistently across pages (Catalog, Reservations, etc.).

## Accessibility — a known, real, repo-wide gap

`aria-label` appears in only 4 of 37 page/component files despite pervasive icon-only buttons (`lucide-react` icons with no visible text, used for refresh/close/delete actions throughout Kanban, Inbox, Proposals, and more). This was found, not assumed, during the RC pass, and only partially fixed (2 buttons in `kanban/page.tsx` as a demonstrated pattern).

**Standing requirement from this point forward**: every new icon-only interactive element must have an `aria-label` describing the action. This is not optional for new code, even though the existing backlog of ~35 files with the gap is not being swept retroactively as part of this OS. See `MASTER_BACKLOG.md` for the tracked follow-up item to sweep the existing gap.

No `<img>`-without-`alt` gap exists (the codebase doesn't use raw `<img>` tags), so that specific class of a11y issue doesn't need a standing rule here.

## Navigation

`CRMLayout.tsx` is the shell every `(crm)` page renders inside; `UserMenu` (session-aware account display + sign-out) is mounted there — every new top-level page should assume this shell, not build its own layout chrome. A previously-built-but-unmounted `UserMenu` was a real, already-fixed gap; the lesson for this OS is: **a component existing in the codebase does not mean it's wired in** — verify mounting, not just presence, when auditing UI completeness (the same lesson `MASTER_DATABASE.md`/`MASTER_ARCHITECTURE.md` state for migrations and code respectively).

## Responsive layout

Tailwind responsive breakpoints (`md:`, `lg:`, `grid-cols-*`) are used consistently across existing pages. Follow the same breakpoint conventions for new pages rather than introducing a different responsive strategy (e.g., container queries or a different breakpoint scale) without a documented reason.

## What has not been verified (recorded, not guessed)

- Real-viewport responsive QA (as opposed to reading Tailwind class usage in source) has never been performed in any sandboxed session on this project — no reliable browser access has existed. **Do not treat "uses `md:`/`lg:` classes" as equivalent to "confirmed to render correctly at real breakpoints."** This needs a real browser/device pass at some point in this product's life; it is not done today.
- Exact visual details (spacing, color contrast ratios, pixel alignment) have never been independently confirmed against WCAG contrast requirements. `aria-label` coverage is the one accessibility dimension actually audited; contrast/keyboard-navigation have not been.

## Development priority for closing known gaps

1. Icon-only button `aria-label` sweep — mechanical, low-risk, real accessibility value. Prioritize `inbox`, `proposals`, `reservations` pages first (busiest operator screens after `kanban`, which already has the fix pattern demonstrated).
2. A real color-contrast/keyboard-navigation audit, ideally with actual browser access — not achievable in a sandboxed, no-browser session, flagged for whenever that access exists.
3. `loading.tsx` for any new customer-facing (unauthenticated) page — not retroactive for existing authenticated pages, which already have adequate in-component loading state.
