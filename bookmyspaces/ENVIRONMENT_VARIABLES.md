# ENVIRONMENT_VARIABLES.md

Last updated: 2026-07-27 (Release Candidate hardening pass). The source of truth for every variable is `.env.example` at the repo root — copy it to `.env.local` for local development, and set the same names in Vercel → Project → Settings → Environment Variables for production. This file is the categorized, annotated reference; if the two ever disagree, `.env.example` wins (it's what the running app actually reads).

## Required for the app to start at all

| Variable | Used for |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon/public key (browser-safe, RLS-scoped) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role key — **server-only, bypasses RLS**. Never expose to the browser; only read via `getSupabaseAdmin()` in cron/AI/import/admin code paths. |
| `ANTHROPIC_API_KEY` | Claude API key (primary AI provider — chat, lead extraction, Event Sales Advisor, etc.) |

## Required for AI grounding / embeddings

| Variable | Used for |
|---|---|
| `OPENAI_API_KEY` | Embeddings (RAG knowledge base) and AI fallback provider |

## WhatsApp — Meta Cloud API (the live integration; this is what actually sends/receives messages)

| Variable | Used for |
|---|---|
| `WHATSAPP_ACCESS_TOKEN` | Meta Cloud API access token |
| `WHATSAPP_PHONE_NUMBER_ID` | Meta phone number ID |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | Must match the verify token configured in the Meta App dashboard's webhook subscription |
| `WHATSAPP_APP_SECRET` | **Security-critical.** Enables `X-Hub-Signature-256` webhook signature verification. Without this set, the webhook logs a warning and accepts unsigned requests instead of rejecting them — see `SECURITY_REVIEW.md`. **Must be set before production launch.** |

## Social — Meta Graph API (Facebook Page + Instagram Lead Ads/Messenger/DM)

**Added to `.env.example` during Go-Live prep (2026-07-27) — these were previously used by `src/lib/social/adapters/meta-adapter.ts` but never documented in `.env.example`, found by reading the adapter's own required-env comment directly rather than trusting the prior pass's environment doc to be complete.**

| Variable | Used for |
|---|---|
| `META_APP_SECRET` | Webhook signature verification (`X-Hub-Signature-256`), same HMAC pattern as WhatsApp. Unlike WhatsApp, this one **fails closed** — `verifyWebhook()` returns `false` and the route responds 401 if unset, so leaving this blank is safe (the channel just won't work), not a security hole. |
| `META_VERIFY_TOKEN` | GET `hub.challenge` handshake token, configured in the Meta App dashboard's webhook subscription |
| `META_PAGE_ACCESS_TOKEN` | Facebook Page / Instagram Graph API calls |
| `META_PAGE_ID` | Target Facebook Page ID |
| `META_IG_ID` | Target Instagram Business Account ID |

The whole Social module is credential-gated (`isConfigured()` checks `META_PAGE_ACCESS_TOKEN` + `META_APP_SECRET`) — safe to deploy without these set; Facebook/Instagram lead capture simply stays inactive until they're added.

## WhatsApp — legacy (Wati.io)

| Variable | Used for |
|---|---|
| `WATI_BASE_URL`, `WATI_API_TOKEN` | Only used by `/api/health`'s status check and the voice-note transcription helper (`src/lib/transcription.ts`) — not the actual send/receive path, which is Meta Cloud API above. Safe to leave blank if you're not using either of those two features. |

## Google Sheets sync (optional, recommended)

| Variable | Used for |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Service account email (share your target Sheet with this address, Editor access) |
| `GOOGLE_PRIVATE_KEY` | Service account private key — keep the `\n` escapes exactly as downloaded in the JSON key |
| `GOOGLE_SHEETS_ID` | Target spreadsheet ID (from the sheet's URL) |

## Outbound email — Resend (optional but recommended)

| Variable | Used for |
|---|---|
| `RESEND_API_KEY` | Proposal/invoice/payment-reminder/follow-up/booking-confirmation emails (`src/lib/email/`). Until set, the proposal-email button falls back to a `mailto:` link and the other email routes return a clear "not configured yet" message rather than failing silently. |
| `EMAIL_FROM` | Must be an address on a domain verified in Resend, e.g. `BookMySpaces <proposals@bookmyspaces.in>`. Defaults to Resend's shared testing address if unset. |

## Cron authentication

| Variable | Used for |
|---|---|
| `CRON_SECRET` | **Security-critical.** Bearer token checked against the `Authorization` header on all 4 cron routes (`campaign-queue`, `escalations`, `followups`, `stay-lifecycle`). **Fails open with zero authentication if unset** — anyone could trigger these routes. **Must be set before production launch**, and the identical value must be configured in Vercel's Cron job settings. |

## App config

| Variable | Used for |
|---|---|
| `NEXT_PUBLIC_APP_URL` | The single base-URL variable the app reads — used for proposal share links and post-logout redirects. Set to your real production domain in Vercel. |
| `NEXT_PUBLIC_BUSINESS_WHATSAPP` | Business WhatsApp number, used in AI prompts and click-to-chat links |

## Explicitly removed / not used

`ADMIN_EMAIL`, `ADMIN_PASSWORD` (real login is Supabase Auth, not a hardcoded credential), `NEXTAUTH_SECRET` (this project doesn't use next-auth), `WATI_VERIFY_TOKEN`, `WATI_WEBHOOK_SECRET` (no matching webhook code path), `NEXT_PUBLIC_BUSINESS_PHONE` (unreferenced). Don't set these — if a future feature genuinely needs one back, document it in `.env.example` when you add it.

## Pre-launch env var checklist

Before going live, confirm these two security-critical variables specifically are set in the production environment (both fail open — silently accept unauthenticated requests — if left blank, rather than failing loudly):

- [ ] `WHATSAPP_APP_SECRET`
- [ ] `CRON_SECRET`

See `DEPLOYMENT_CHECKLIST.md` for the full go-live checklist this is one part of.
