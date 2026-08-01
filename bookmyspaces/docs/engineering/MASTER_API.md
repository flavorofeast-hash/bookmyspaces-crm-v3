# MASTER_API.md — BookMySpaces Engineering OS

**Version:** v1.0 — READY FOR FREEZE

Canonical API reference. Consolidates `API_SPECIFICATION.md`. Full route-by-route security posture lives in `MASTER_SECURITY.md`; this document stays focused on inventory and conventions.

## Mandatory conventions for every route, present and future

1. **Auth**: `requireAuth()` or `requireRole([...])` from `src/lib/auth-guard.ts`, unless the route is on the Public Allowlist below — and if you're adding a new public route, it must be added to that allowlist here, with its protection mechanism stated, not left implicit.
2. **Validation**: a zod schema + `parseBody()` (`src/lib/validation.ts`) on every route accepting a body. `.strict()` on admin-facing schemas (mass-assignment protection — this is why `catalog-service.ts`'s column allow-lists exist alongside zod schemas: two independent layers, not redundant).
3. **Thin handlers**: business logic lives in `src/lib`/`src/modules` services, never inline in `route.ts`.
4. **Client selection**: session-scoped Supabase client for user-facing CRUD; `getSupabaseAdmin()` (service-role) only in cron/AI/import/admin paths.
5. **Errors**: structured `{ error }` JSON + correct HTTP status; log via `src/lib/logger.ts`; never leak internal error detail (stack traces, raw DB error messages) to the client response.
6. **Breaking changes require explicit approval.** Version via additive fields/params instead wherever possible — this is how `catalog-service.ts`, `campaign-scheduler.ts`, and others have extended existing routes without breaking callers, and is the expected pattern for every module in `docs/growth/`.

## Public Allowlist (the complete, deliberate list — keep this list exhaustive)

| Route | Why public | Protection |
|---|---|---|
| `POST /api/chat` | Public website chat widget | Rate-limited (20 msg/min/IP), input capped at 2000 chars |
| `GET /api/proposal/share/[token]`, `/api/proposals/share/[token]` | Customer-facing proposal view | `share_token` UUID capability token; read-only |
| `GET /api/proposals/[id]/pdf`, `/preview` | Read by both operators and anonymous customers via share link | UUID `id` is the de facto capability token (documented, accepted — see `MASTER_SECURITY.md` finding #7) |
| `POST /api/proposals/track-view` | View-tracking beacon from the share page | No sensitive data returned |
| `GET/POST /api/whatsapp/webhook` | Meta Cloud API delivery | HMAC (`WHATSAPP_APP_SECRET`) — **fails open if unset, see `MASTER_SECURITY.md`** — rate-limited |
| `POST /api/social/webhook/[platform]` | Per-platform delivery | Per-adapter HMAC (`verifyWebhook()`) — fails closed if unset; rate-limited |
| `GET /api/health` | Uptime/monitoring check | No sensitive data |
| `/api/cron/*` | Vercel Cron invocation | `CRON_SECRET` bearer token — **fails open with zero auth if unset, see `MASTER_SECURITY.md`** |

Anything not on this list requires `requireAuth()`/`requireRole()`. `GET/PATCH /api/notifications` is confirmed to require auth despite sometimes being omitted from older route-group notes — restated here so it's never assumed public by omission.

## Route inventory (by group)

- **CRM**: `/api/leads` (+`[id]/stage`, `hot`, `import`, `summary`, `follow-up-email`), `/api/customers/[id]` (+`ai`, `timeline`), `/api/followups`, `/api/notifications`, `/api/admin/users`.
- **Catalog admin**: `/api/admin/catalog/[entity]` (+`[id]`), `/api/admin/ai-prompts` (+`[id]`), `/api/admin/knowledge-sources` (+`[id]`).
- **Proposals**: `/api/proposals` (+`[id]/pdf|preview|invoice|invoice/email|payment|payment-reminder|receipt|booking-confirmation`, `email`, `intelligence`, `track-view`), `/api/proposal/share/[token]`.
- **Reservations**: `/api/reservations` (+`[id]`, `[id]/status`, `[id]/proposal`, `availability`, `block`), `/api/properties`.
- **Conversations/AI**: `/api/chat`, `/api/conversations`, `/api/knowledge`, `/api/inbox` (+`[id]`, `[id]/ai`, `[id]/reply`).
- **WhatsApp**: `/api/whatsapp/webhook|send|campaigns`.
- **Social**: `/api/social/webhook/[platform]`, `/api/social/interactions` (+`[id]`), `/api/social/posts`.
- **Campaigns**: `/api/campaigns`.
- **Dashboards**: `/api/dashboard/stats|operations|revenue|intelligence`, `/api/analytics`.
- **System**: `/api/health`, `/api/cron/followups|escalations|campaign-queue|stay-lifecycle`, `/api/auth/callback|logout`, `/api/settings`.

**Known dead stub**: `POST/GET /api/ai-summary` returns `{ ok: true }` with no AI call or DB access — harmless, a confirmed cleanup candidate, not a functioning feature. Do not build against it assuming it does something.

## Planned surface (from the growth-platform and existing roadmap docs — not yet built, listed here so future work doesn't collide with a name already reserved)

- `/api/marketing/segments` (+`[id]/preview`), `/api/marketing/attribution` — `docs/growth/05_MARKETING_PLATFORM.md`.
- `/api/social/posts/[id]/publish`, `/api/social/posts/[id]/caption` — `docs/growth/10_SOCIAL_MEDIA.md`.
- `/api/social/webhook/google` — `docs/growth/11_GOOGLE_BUSINESS.md`.
- `/api/email/unsubscribe` — `docs/growth/13_EMAIL_MARKETING.md`.
- `/api/referrals/code`, `/api/referrals/credits` — `docs/growth/14_REFERRAL_SYSTEM.md`.
- `/api/customers/[id]/loyalty` — `docs/growth/15_LOYALTY_PROGRAM.md`.
- `/api/reviews` (+`[id]/respond`) — `docs/growth/16_REVIEW_MANAGEMENT.md`.
- `/api/ai/recommendations` — `docs/growth/19_AI_RECOMMENDATIONS.md`.
- `/api/channels/[channel]/webhook` (generalized adapter entry point) — original V3 roadmap Phase 2.

## Assumptions recorded

- This inventory reflects `route.ts` files present in the repository at audit time. It has not been independently re-verified that every listed route is actually deployed/reachable in production (the same "migration applied ≠ code exists" caution from `MASTER_DATABASE.md` applies symmetrically here: code existing in the repo doesn't confirm what's live).
