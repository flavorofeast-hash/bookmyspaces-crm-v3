# Investigation: Lead Management page shows "No leads" despite GET /api/leads returning records

**Date:** 2026-08-02
**Mode:** Investigation only. No code changed. No commits.

---

## Trace

Page: `src/app/(crm)/dashboard/leads/page.tsx` (`LeadManagementPage`, the screen just restored to nav).

Fetch call (line 82): `fetch(`/api/leads?${params.toString()}`)`, where `params` is `limit=25&offset=0` (plus `search` only if the search box is non-empty — empty on initial load). Calls `GET /api/leads` — no other endpoint.

Parsing (lines 83–86):
```ts
if (!res.ok) throw new Error('Failed to load leads')
const json = await res.json()
setLeads(json.leads ?? [])
setTotal(json.total ?? 0)
```

`GET /api/leads` handler (`src/app/api/leads/route.ts`, lines 16–52) returns:
```ts
return NextResponse.json({ leads: normalized, total: count, limit, offset })
```

**The JSON shape the page expects and the shape the API actually returns are identical: `{ leads: Lead[], total: number, limit, offset }`, keyed by `leads`.** No wrapper mismatch (not `data`/`results`/`items` vs `leads` — it's `leads` on both sides).

Type check: `Lead` (`src/modules/leads/types.ts`) declares `name`, `phone`, `email`, `company`, `city`, `state`, `source`, `preferred_channel`, `created_at`, `lead_stage`, `status`, etc. — every field the table (`COLUMNS` + the row-rendering JSX, lines 28–38 and 214–227) reads. These are all real columns on the `leads` table (base columns from migration 001, plus the Migration 018 bulk-import fields) — the route does `select('*')`, so nothing is excluded server-side. No field-name mismatch found (e.g., no `full_name` vs `name`, no `phone_number` vs `phone`).

Empty-state logic (lines 195–206): `loading ? <spinner> : sortedLeads.length === 0 ? "No leads found..." : <rows>`. This is a plain length check on the `leads` state array — it fires whenever `leads` ends up `[]`, regardless of why.

## Where "No leads" actually comes from

Given the fetch/parse/render chain matches the API's real shape exactly, `leads` can only end up `[]` in three ways:

1. **The `leads` table genuinely has 0 rows matching this query** (unlikely per the mission's own Fact 1, unless that fact was checked against a different environment/database than the one the running page is pointed at).
2. **`res.ok` is `false`** — the `fetch` gets a non-2xx response (most plausibly a `401` from `requireAuth()` in `GET /api/leads`, or a `500`), the code throws inside the `try`, `setLeads` is never reached, and `leads` stays at its initial `[]`. This path also sets `error`, which renders a small red banner (lines 167–171) directly above the table — easy to miss at a glance if the reviewer's attention went straight to the empty table.
3. **A stale cached empty/error response is served** without a fresh request reaching the server at all — plausible in principle (this `fetch` call doesn't set `cache: 'no-store'`), but this is the *same, unmodified pattern* used by nearly every other GET fetch in this CRM (`/customers`, `/inbox`, `/social`, `/content-studio`, `/catalog`, `/knowledge-base` all fetch without a cache option too — only `/dashboard/revenue` and `/dashboard/intelligence` explicitly opt out of caching). Since this isn't unique to the Leads page, it's a weak differentiator for *this specific* report, not a strong lead.

**Most likely explanation, given everything above:** the "GET /api/leads returns valid JSON with multiple lead records" check (Fact 1) and the browser session actually loading `/dashboard/leads` are not using the same authentication context. `requireAuth()` (`src/lib/auth-guard.ts`) requires a live Supabase session (`getCurrentUser()` → `supabase.auth.getUser()`); if Fact 1 was confirmed via a tool or tab with a different/valid session than the one the Lead Management page's own client-side `fetch()` is actually sending (e.g., an expired/missing cookie in that specific browser tab, a different port/origin, or a private/incognito context with no session at all), the page's request would get a `401 {"error":"Unauthorized — please log in"}`, `res.ok` would be `false`, and the table would render exactly as described — "No leads" — with only a small, easy-to-miss red banner as the tell.

This has not been confirmed against a live browser session (no reachable dev server / no connected browser tool in this sandbox) — it is the most likely explanation supported by the code, not an observed fact.

## Conclusion

**The API contract does not differ.** `dashboard/leads/page.tsx` and `GET /api/leads` agree exactly on response shape (`{ leads, total, limit, offset }`) and on every field name the table renders. There is no JSON-shape bug to fix in this pair of files.

## Root cause

Most likely: an authentication/session state difference between however Fact 1 was verified and the actual browser session loading the Lead Management page, causing the page's own `fetch('/api/leads?...')` to receive a `401` — which the page currently displays as an easy-to-overlook small error banner *plus* an indistinguishable "No leads found" table, rather than a clearly diagnostic message. Not confirmed live (no browser access from this sandbox); this is the leading hypothesis, not an observed fact, and should be confirmed via the browser's Network tab (check the actual status code/body of the page's own `/api/leads` request) before any fix is made.

No genuine UI/API shape mismatch exists in the current source.

## Files involved

- `src/app/(crm)/dashboard/leads/page.tsx` — fetch call, response parsing, empty-state rendering (all verified correct against the API's real shape)
- `src/app/api/leads/route.ts` — `GET` handler, response shape, `requireAuth()` gate (the most likely actual point of failure, via a `401`)
- `src/modules/leads/types.ts` — `Lead` interface (verified to match real `leads` columns, not a mismatch source)
- `src/lib/auth-guard.ts` — `requireAuth()` (the auth check most likely to be silently failing)
- `src/lib/supabase-server.ts` — `getCurrentUser()` (session resolution underlying `requireAuth()`)
- `src/middleware.ts` — confirmed it does not interfere with API responses (it refreshes the session cookie for API routes but explicitly never redirects or alters `/api/*` responses)

## Smallest possible fix

There is no contract to fix. If, after confirming via the browser Network tab that the page's request is genuinely getting a `401` (or any non-2xx), the smallest fix would be **surfacing the real failure reason instead of masking it as an empty table** — change one line in `dashboard/leads/page.tsx`'s `catch` block to include the response status/body when `!res.ok` (e.g., read and include `json.error` from the failed response, or at minimum include `res.status`, in the thrown `Error`), so a future 401/500 shows as an actual visible error message rather than being indistinguishable from "zero leads exist." This is a one-line diagnostic improvement, not a contract change — and it is **not being implemented now**, per this mission's investigation-only scope; it's offered only as the smallest next step once the real cause (most likely a `401`) is confirmed live.

No files were changed. No commits were made.
