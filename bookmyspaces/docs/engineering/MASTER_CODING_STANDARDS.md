# MASTER_CODING_STANDARDS.md — BookMySpaces Engineering OS

**Version:** v1.0 — READY FOR FREEZE

No prior root-level document consolidated this — it existed only as convention, observable by reading the codebase. This document makes those conventions explicit so they survive personnel/tooling changes over the next 3–5 years instead of eroding.

## Stack baseline

TypeScript, `strict: true` (see `tsconfig.json`), Next.js 14 App Router, ESLint via `next/core-web-vitals`, Vitest for tests, path alias `@/*` → `src/*`. No additional custom lint rules exist today — the `next/core-web-vitals` preset is the entire enforced rule set. Any proposal to add stricter lint rules (e.g., `no-explicit-any`, import-order) is a reasonable future improvement but is not current policy — do not assume rules that aren't actually configured.

## The layering discipline (from `MASTER_ARCHITECTURE.md`, restated as an enforceable coding rule)

- `route.ts` files: auth guard → zod validation → call one service function → shape the HTTP response. If a `route.ts` file contains a loop, a multi-step conditional, or a direct Supabase query beyond a service call, that logic belongs in `src/lib`.
- Every service function should be plain, importable, and unit-testable without Next.js request/response objects.
- Colocate tests: `foo.ts` gets `foo.test.ts` in the same directory, following every existing example (`reservation-workflow.test.ts`, `catalog-service.test.ts`, `pricing-service.test.ts`, etc.).

## Result-shaped returns (the dominant pattern in this codebase — follow it, don't reinvent)

Services return discriminated unions, not thrown exceptions, for expected failure modes:

```ts
type CreateXResult =
  | { ok: true; row: X }
  | { ok: false; error: 'validation_error' | 'db_error' | 'not_found'; message?: string }
```

Seen throughout: `CreateReservationResult`, `TransitionResult`, catalog-service's `{ ok, row }`/`{ ok, error }` returns. **Use this pattern for new services.** Reserve thrown exceptions for genuinely unexpected/programmer-error conditions, not for "the record wasn't found" or "the dates conflict."

## Validation convention

- One zod schema per create/update operation, named `createXSchema`/`updateXSchema` (update schemas are typically `createXSchema.partial()` unless a field needs different rules for update, e.g. `rate-plans`' cross-field `end_date >= start_date` refine, which only applies to create).
- `.strict()` on every schema whose input reaches a database write directly (mass-assignment protection) — this is why admin/catalog schemas use it even though not every schema in the codebase does.
- Route handlers call `parseBody(req, schema)` (`src/lib/validation.ts`), never hand-roll `await req.json()` + manual checks.

## Mass-assignment protection — the double-layer pattern

Admin-facing write services (see `catalog-service.ts`) use **two independent layers**: a zod schema (rejects unknown fields via `.strict()`) *and* an explicit column allow-list (`pickAllowed()`) applied again at the service layer before the database write. This is deliberate redundancy, not an oversight — replicate both layers for any new admin-mutable entity, don't rely on zod alone.

## Degrade-gracefully convention

Every service reading from a migration-012-or-later table returns a safe default (empty array, `DEFAULT_SETTINGS`, `null`) rather than throwing when the underlying table doesn't exist yet — see `property-service.ts`, `pricing-service.ts`, `settings-service.ts` for the reference pattern. **Apply this to any new service reading from a not-yet-confirmed-live table.** This is what lets a page "legitimately show empty/zero rather than crash" — a design choice, not a bug, and one every new growth-platform module should replicate per its own doc's "Required Database Changes" section.

## Naming & file organization

- Services: `src/lib/<domain>/<name>-service.ts`. Workflow orchestration (multi-step operations spanning services): `<domain>-workflow.ts` (see `reservation-workflow.ts`).
- Providers/adapters: `src/lib/providers/*` (swappable, one interface, e.g. `ai-provider.ts`) and `src/lib/social/adapters/*` (per-platform, one contract, e.g. `meta-adapter.ts`). New external integrations follow one of these two shapes — a provider (swap the whole implementation) or an adapter (one of several simultaneously-active implementations of a shared contract) — depending on whether the integration is "pick one" or "support many."
- Types: colocated with the domain they describe (`src/types/reservation.ts`) or inline in the service file when narrow enough to not warrant a separate file.

## Logging

`src/lib/logger.ts`, structured calls (`logger.info/warn/error(scope, message, data)`), never bare `console.*` in feature code (existing `console.*` calls found during the RC pass were converted as a cleanup item, not left as an accepted pattern). PII (phone/email/name) goes in the `data` object, never interpolated into the message string — see `MASTER_SECURITY.md`.

## Comments — a real, observable house style worth naming

This codebase's existing comments consistently do three things future contributors should keep doing: (1) name *why* a design choice was made, often citing a specific audit finding or prior session's discovery, not just *what* the code does; (2) explicitly flag when something is NOT yet done or NOT yet safe to assume, rather than staying silent; (3) cross-reference the specific file/table/migration a claim depends on. This is genuinely useful, low-ceremony documentation-in-code and is worth explicitly preserving as a norm, not just an incidental style.

## Testing

`vitest run` (colocated `.test.ts`). Mocks follow the `vi.mock()` + `vi.hoisted()` pattern seen in `reservation-workflow.test.ts` — mock at the module boundary (Supabase client, sibling services), exercise the real function under test. Prefer this over integration tests against a real database in this sandbox environment (no reliable live DB access has existed in any session on this project), while recording clearly that DB constraint behavior (FKs, RLS, CHECK constraints, generated columns) remains unproven against a real Postgres instance until run somewhere with that access — see `MASTER_ROADMAP.md`.

## Git / commit discipline

Every phase/release should exit with `npm run build`, `tsc --noEmit`, `npm run lint`, and `npm test` (`vitest run`) all green, `CHANGELOG.md` updated, and — a real, previously-recurring gap worth stating as a permanent rule — **actual git commits**, not just edited files on disk. Multiple prior sessions on this project produced real work that existed only as uncommitted file edits. Nothing in this Engineering OS should be considered "shipped" until it is committed (and, per the deployment checklist, pushed) from an environment with real git access.

## Assumptions recorded

- This document describes conventions observed in existing code, not a separately-documented style guide that existed before this pass — there is no prior "coding standards" doc to reconcile against or contradict.
