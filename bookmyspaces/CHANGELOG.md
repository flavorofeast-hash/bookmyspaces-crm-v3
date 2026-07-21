# CHANGELOG.md

Product-level changelog, maintained every phase. (Remediation-era history: `audit/CHANGELOG.md`.)

## [Unreleased]

### 2026-07-22 — Overnight autonomous build session (V3 Phases 0–5)

**Phase 0 — hygiene:** `.gitattributes` line-ending normalization (killed repo-wide CRLF diff churn); deleted audit-confirmed stray files (duplicate `007_missing_tables.sql`, stale `.git.*` backup dirs, probe file, empty API dirs).

**Phase 2 — finished the unfinished:**
- Settings backend: `settings-service` + `GET/PUT /api/settings`; Settings page now persists to the `settings` table (was localStorage-only). New AI handoff-confidence controls.
- Hospitality catalog admin: `catalog-service` (allow-listed CRUD, soft deletes) + `/api/admin/catalog/[entity]` + new **Catalog** page (properties / rooms & venues / rate plans / meal plans / add-ons). Ends the "raw SQL only" data-entry era.
- AI knowledge base: `knowledge-sources-service` (best-effort embeddings) + versioned `ai_prompts` via `prompt-service` (one active per name, rollback by re-activation) + new **AI Knowledge** page + admin APIs.

**Phase 3 — unified conversations:** WhatsApp now mirrors inbound + outbound into the unified platform (website chat already did); `outbound-dispatcher` sends channel-agnostically; new **Inbox** page + `/api/inbox*` (reply auto-pauses AI, pause/resume, escalation states).

**Phase 4 — AI orchestrator:** `chatWithAI` prompt now DB-driven (`getActivePrompt` w/ hardcoded fallback), model/tokens from Settings, retrieval extended to `knowledge_sources`, no-invented-pricing instruction. `orchestrator.ts`: handoff triggers (human request / complaint / refund / payment issue / low confidence) wired into website chat (full) and WhatsApp (text triggers).

**Phase 5 — social foundation:** migration 014 (`social_accounts`, `social_interactions`, `social_posts`, `reviews` + ROLLBACK); `SocialAdapter` contract + credential-gated `MetaAdapter` (FB/IG); signature-verified webhook route; social inbox APIs + new **Social** page. Ready for credentials, safe without them.

**Security/ops:** migration 015 (`admin_audit_log` + refund CHECK w/ NOT VALID); `audit-log.ts` wired into settings/catalog/refund writes; in-memory `rate-limit.ts` on `/api/chat` (20/min/IP) and social webhook (120/min/IP); refunds are first-class negative-amount rows via the payment API.

**Verification:** tsc clean, ESLint clean (one pre-existing img warning), vitest 202/202, production `next build` succeeds. 5 commits, not pushed (per instruction).

### 2026-07-21 — Master architecture documentation set
- Added `BOOKMYSPACES_V3_MASTER_SPECIFICATION.md`, `BOOKMYSPACES_V3_MASTER_ARCHITECTURE.md`, `IMPLEMENTATION_ROADMAP.md` (forward plan; supersedes audit-era roadmap), `DATABASE_ARCHITECTURE.md`, `API_SPECIFICATION.md`, `AI_ARCHITECTURE.md`, `SOCIAL_MEDIA_ARCHITECTURE.md`, `CHANGELOG.md`.
- Full codebase review performed first (src, 13 migrations, audit trail, docs). No code changes.
- Key findings recorded: unified conversation engine built but not cut over; vector RAG infra unused; settings/admin-CRUD gaps; repo-wide CRLF diff churn; rewritten git history awaiting push.
