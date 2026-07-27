# INSTALL.md — Local Development Setup

Last updated: 2026-07-27 (Release Candidate hardening pass). For production deployment (Vercel), see `DEPLOYMENT.md`. For the full environment variable reference, see `ENVIRONMENT_VARIABLES.md`.

## Prerequisites

- Node.js (a recent LTS version — the project targets Next.js 14 / React 18)
- npm
- A Supabase project (free tier is fine to start)
- API keys for Anthropic (Claude) and OpenAI at minimum — see `ENVIRONMENT_VARIABLES.md` for what's required vs. optional

## 1. Install dependencies

```bash
npm install
```

## 2. Create your environment file

```bash
cp .env.example .env.local
```

Fill in `.env.local` with your own values. At minimum you need: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`. Everything else can stay blank while you get the app running locally — see `ENVIRONMENT_VARIABLES.md` for what each optional integration unlocks.

## 3. Set up the Supabase database

1. Create a project at [supabase.com](https://supabase.com) and copy the Project URL, anon key, and service role key into `.env.local`.
2. Enable the `vector` extension: Database → Extensions → enable `vector` (powers the RAG knowledge base).
3. Apply migrations in order. Migrations 001-011 are foundational; 012-024 are the V3 additive set (Reservation Platform, Direct Event Sales Engine, Campaign Scheduler, etc.):
   - Either run each file in `supabase/migrations/` through the Supabase SQL Editor in numeric order, or
   - Use the provided script for the 012+ set: `npm run db:migrate:v3` (see `PRODUCTION_MIGRATION_CHECKLIST.md` for the full apply-order table and what each migration does).
4. ~~Create a Storage bucket named `documents`~~ — **correction, Go-Live pass (2026-07-27): checked and this is stale advice, carried over from an older README without verification.** Knowledge base content (`src/lib/documents.ts`) is stored in a `documents` Postgres *table*, not a Supabase Storage bucket — no bucket setup is needed. Grepped `src` for any `.storage.from(...)` call to confirm: zero matches, Supabase Storage isn't used anywhere in the current codebase.

## 4. (Optional) Google Sheets sync

See `ENVIRONMENT_VARIABLES.md`'s Google Sheets section for the three variables needed and how to obtain them.

## 5. Run the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) for the public site, or go straight to the CRM at `/dashboard` (requires a Supabase Auth user — create one via the Supabase dashboard's Authentication tab, or your own sign-up flow if one exists in this build).

## 6. Seed the AI knowledge base

The chatbot ("Aria") and the AI Event Sales Advisor answer from CRM-editable content in `knowledge_sources` / `knowledge_chunks`, not from hardcoded facts. Seed it via the admin/knowledge tooling in the app, or check `/api/health` first to confirm all required services (Supabase, Anthropic, OpenAI) are reachable.

## 7. Run tests

```bash
npm run test
```

Runs the Vitest suite. Note: this sandbox environment (used to build/harden this release) experienced intermittent hangs running the full test suite and `next build`/`tsc --noEmit` — diagnosed as environmental, not a repository defect (see `PRODUCTION_MIGRATION_CHECKLIST.md`'s sibling report on the build investigation, and `ARCHITECTURE.md`). Run these commands in your own local environment or CI, where they're expected to behave normally.

## Troubleshooting

**Chat/AI not responding:** check `ANTHROPIC_API_KEY` is set; check `/api/health`.

**Knowledge base empty:** confirm `OPENAI_API_KEY` is set (used for embeddings) and that you've run the seeding step.

**Supabase errors:** confirm migrations were applied in order and the `vector` extension is enabled.

**Google Sheets not syncing:** confirm the service account has Editor access to the sheet, and that `GOOGLE_PRIVATE_KEY`'s `\n` escapes weren't mangled when copied into `.env.local`.

**WhatsApp webhook not verifying:** `WHATSAPP_WEBHOOK_VERIFY_TOKEN` in `.env.local` must exactly match what you configured in the Meta App dashboard's webhook subscription.
