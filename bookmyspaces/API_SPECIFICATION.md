# API_SPECIFICATION.md

Last updated: 2026-07-27 (Release Candidate hardening pass). This is the project's API reference — all routes under `src/app/api/**/route.ts`. Machine inventory: `audit/api_inventory.json`, `audit/ROUTES.md`. Full security posture (auth, rate limiting, webhook verification per route) is in `SECURITY_REVIEW.md`; this file stays focused on route inventory and conventions.

## Conventions (mandatory for every new route)

1. **Auth:** `requireAuth()` / `requireRole()` from `src/lib/auth-guard.ts` unless the route is on the documented public allowlist below.
2. **Validation:** zod schema + `parseBody()` (`src/lib/validation.ts`) on every input-accepting route.
3. **Thin handlers:** business logic in `src/lib`/`src/modules` services, not in the route.
4. **Clients:** session-scoped Supabase for user CRUD; `getSupabaseAdmin()` only in cron/AI/import/admin paths.
5. **Errors:** structured JSON `{ error }` + correct status; log via `src/lib/logger.ts`; never leak internals.

## Public Allowlist (deliberate, keep documented)

`POST /api/chat` (website widget — rate-limited, 20 msg/min/IP) · `GET /api/proposal/share/[token]` and `/api/proposals/share/[token]` page (read-only, `share_token` UUID is the capability token) · `GET /api/proposals/[id]/pdf|preview` (called by both authenticated operators and anonymous customers via the share link — UUID `id` is the de facto capability token, documented in `SECURITY_REVIEW.md` finding #7) · `POST /api/proposals/track-view` · `GET|POST /api/whatsapp/webhook` (Meta HMAC-verified, rate-limited as of this RC pass) · `POST /api/social/webhook/[platform]` (per-platform HMAC-verified, rate-limited) · `GET /api/health`. Cron routes (`/api/cron/*`) are `CRON_SECRET` bearer-token secured — **fails open with zero auth if that env var is unset in production**, see `SECURITY_REVIEW.md` and `DEPLOYMENT_CHECKLIST.md`. Everything else authenticated via `requireAuth()`/`requireRole()`.

`GET /api/notifications` and `PATCH /api/notifications` require auth (verified this pass) despite not appearing in earlier route-group notes below. `POST/GET /api/ai-summary` is a dead stub (returns `{ ok: true }`, no AI call, no DB access) — harmless either way, candidate for a future cleanup pass, not a security or cost concern.

## Route Groups (current)

- **CRM:** `/api/leads` (+`[id]/stage`, `hot`, `import`, `summary`, `follow-up-email`), `/api/customers/[id]` (+`ai`, `timeline`), `/api/followups`, `/api/notifications`, `/api/admin/users`
- **Proposals:** `/api/proposals` (+`[id]/pdf|preview|invoice|invoice/email|payment|payment-reminder|receipt|booking-confirmation`, `email`, `intelligence`, `track-view`), `/api/proposal/share/[token]`
- **Reservations:** `/api/reservations` (+`[id]`, `[id]/status`, `[id]/proposal`, `availability`), `/api/properties`
- **Conversations/AI:** `/api/chat`, `/api/conversations`, `/api/knowledge`, `/api/ai-summary` (dead stub, see above)
- **WhatsApp:** `/api/whatsapp/webhook|send|campaigns`
- **Social:** `/api/social/webhook/[platform]` (Direct Event Sales Engine — Facebook/Instagram Lead Ads, Messenger, IG DM capture)
- **Campaigns:** `/api/campaigns`
- **Dashboards:** `/api/dashboard/stats|operations|revenue`, `/api/analytics`
- **System:** `/api/health`, `/api/cron/followups|escalations|campaign-queue|stay-lifecycle`, `/api/auth/callback|logout`

## Planned Surface (roadmap phases; design per this spec's conventions)

- Phase 1: `/api/admin/inventory|rate-plans|meal-plans|addons|packages` (CRUD), `/api/settings`, `/api/knowledge-sources`, `/api/ai-prompts`
- Phase 2: `/api/channels/[channel]/webhook` (adapter entry), `/api/inbox` (unified conversation list/read/reply), outbound send via channel dispatcher

The Social module (Phase 4-6 in the original roadmap) has since shipped as `/api/social/webhook/[platform]` — see the Social route group above and `SOCIAL_MEDIA_ARCHITECTURE.md`.

Breaking changes to any existing route require explicit approval; version via additive params/fields instead where possible.
