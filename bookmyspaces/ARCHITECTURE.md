# ARCHITECTURE.md

This is a pointer, not a duplicate — the detailed system architecture already lives in `BOOKMYSPACES_V3_MASTER_ARCHITECTURE.md` and its companion documents. Splitting it into a second file with overlapping content would just create two places that can drift out of sync, so this file stays short.

## Where to look

| Topic | Document |
|---|---|
| Overall stack, layering, cross-cutting rules, principles | `BOOKMYSPACES_V3_MASTER_ARCHITECTURE.md` |
| AI provider layer, grounding, orchestration, safety rules, Direct Event Sales Engine AI | `AI_ARCHITECTURE.md` |
| Database schema, migration inventory, RLS/index posture | `DATABASE_ARCHITECTURE.md` |
| Social media module (adapters, unified inbox extension) | `SOCIAL_MEDIA_ARCHITECTURE.md` |
| API route inventory and conventions | `API_SPECIFICATION.md` |
| Security posture (auth, rate limiting, webhook verification, etc.) | `SECURITY_REVIEW.md` |
| Performance characteristics and known scaling considerations | `PERFORMANCE_REVIEW.md` |

## One-paragraph summary

Next.js 14 App Router + TypeScript, Supabase Postgres (Auth, Storage, RLS) as the single source of record, Tailwind + Radix UI, Anthropic Claude as the primary AI provider with OpenAI as fallback and for embeddings, Meta WhatsApp Cloud API for messaging, Resend for email, deployed on Vercel with cron-driven background jobs. The core recurring pattern across every channel (WhatsApp, website chat, social DMs) is: adapter normalizes the inbound message → identity resolution matches it to a CRM record → AI orchestrator responds (grounded in CRM-editable knowledge, confidence-scored, logged) → human can take over at any point → everything lands on one customer timeline. See `BOOKMYSPACES_V3_MASTER_ARCHITECTURE.md` for the full picture, including which parts of that pattern are fully live versus still mid-cutover for a given channel.
