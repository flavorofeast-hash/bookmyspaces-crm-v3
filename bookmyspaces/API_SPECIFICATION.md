# API_SPECIFICATION.md

Last updated: 2026-07-21. All routes under `src/app/api/**/route.ts`. Machine inventory: `audit/api_inventory.json`, `audit/ROUTES.md`.

## Conventions (mandatory for every new route)

1. **Auth:** `requireAuth()` / `requireRole()` from `src/lib/auth-guard.ts` unless the route is on the documented public allowlist below.
2. **Validation:** zod schema + `parseBody()` (`src/lib/validation.ts`) on every input-accepting route.
3. **Thin handlers:** business logic in `src/lib`/`src/modules` services, not in the route.
4. **Clients:** session-scoped Supabase for user CRUD; `getSupabaseAdmin()` only in cron/AI/import/admin paths.
5. **Errors:** structured JSON `{ error }` + correct status; log via `src/lib/logger.ts`; never leak internals.

## Public Allowlist (deliberate, keep documented)

`POST /api/chat` (website widget) · `GET /api/proposal/share/[token]` · `GET /api/proposals/[id]/pdf|preview` · `POST /api/proposals/track-view` · `GET|POST /api/whatsapp/webhook` (Meta HMAC-verified) · `GET /api/health`. Cron routes (`/api/cron/*`) are Vercel-cron secured. Everything else authenticated.

## Route Groups (current)

- **CRM:** `/api/leads` (+`[id]/stage`, `hot`, `import`, `summary`, `follow-up-email`), `/api/customers/[id]` (+`ai`, `timeline`), `/api/followups`, `/api/notifications`, `/api/admin/users`
- **Proposals:** `/api/proposals` (+`[id]/pdf|preview|invoice|invoice/email|payment|payment-reminder|receipt|booking-confirmation`, `email`, `intelligence`, `track-view`), `/api/proposal/share/[token]`
- **Reservations:** `/api/reservations` (+`[id]`, `[id]/status`, `[id]/proposal`, `availability`), `/api/properties`
- **Conversations/AI:** `/api/chat`, `/api/conversations`, `/api/knowledge`, `/api/ai-summary`
- **WhatsApp:** `/api/whatsapp/webhook|send|campaigns`
- **Campaigns:** `/api/campaigns`
- **Dashboards:** `/api/dashboard/stats|operations|revenue`, `/api/analytics`
- **System:** `/api/health`, `/api/cron/followups|escalations`, `/api/auth/callback|logout`

## Planned Surface (roadmap phases; design per this spec's conventions)

- Phase 1: `/api/admin/inventory|rate-plans|meal-plans|addons|packages` (CRUD), `/api/settings`, `/api/knowledge-sources`, `/api/ai-prompts`
- Phase 2: `/api/channels/[channel]/webhook` (adapter entry), `/api/inbox` (unified conversation list/read/reply), outbound send via channel dispatcher
- Phase 4–6: `/api/social/accounts|inbox|posts|calendar|reviews|analytics`, `/api/marketing/campaigns`

Breaking changes to any existing route require explicit approval; version via additive params/fields instead where possible.
