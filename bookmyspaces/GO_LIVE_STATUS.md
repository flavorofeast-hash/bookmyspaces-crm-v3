# GO_LIVE_STATUS.md — DEPLOYMENT_CHECKLIST.md Worked Through, Go-Live Prep Phase 8

Date: 2026-07-27. Every item in `DEPLOYMENT_CHECKLIST.md` below, marked **PASS**, **FAIL**, or **NOT VERIFIED**, with the evidence behind each mark. "NOT VERIFIED" here means exactly that — not "assumed fine," not "probably OK" — it means this sandbox had no way to check it (no live DB, no Vercel dashboard access, no deployed app, no browser), and it needs a human with real access to check it before go-live.

## Environment Variables

| Item | Status | Evidence |
|---|---|---|
| Every var reviewed & set in Vercel | NOT VERIFIED | No Vercel dashboard access; partial evidence from a 2026-07-15 `vercel env pull` snapshot only (see `ENVIRONMENT_VALIDATION.md`) |
| `WHATSAPP_APP_SECRET` set | **FAIL** | Confirmed absent from both `.env.local` and the production snapshot — two independent sources agree |
| `CRON_SECRET` set | **FAIL** | Present in `.env.local`, confirmed **absent** from the production snapshot |
| `NEXT_PUBLIC_APP_URL` set to real domain | NOT VERIFIED | Local value is `http://localhost:3000` (correct for local dev); production value is redacted in the snapshot, can't confirm it's the real domain |
| `SUPABASE_SERVICE_ROLE_KEY` server-side only | **PASS** | Grepped all `NEXT_PUBLIC_*` vars in `.env.local` — only 4 exist, none are service-role-key-shaped or reference it |

## Supabase

| Item | Status | Evidence |
|---|---|---|
| Production project created | NOT VERIFIED | No dashboard access |
| `vector` extension enabled | NOT VERIFIED | No live DB access |
| Automatic backups enabled | NOT VERIFIED | No dashboard access |
| Manual backup before migration | NOT VERIFIED | Future action, hasn't happened yet |
| Storage bucket `documents` | **PASS (N/A)** | Corrected this pass — not a real requirement, no Storage usage exists in `src` (verified by grep) |

## Database Migrations

| Item | Status | Evidence |
|---|---|---|
| Migration 004 live-state verified | **NOT VERIFIED — highest-priority open item** | No DB access; historical evidence (`audit/VERSION1_RELEASE_READINESS_REPORT.md`, `audit/SCHEMA_DRIFT_REPORT.md`) suggests it may be missing. **New supporting detail found this phase**: migration 004 has its own `_ROLLBACK.sql` file (confirmed via `ls`), meaning it was written with the same production-safety discipline as 012-024 — it's ready to apply if the live check confirms it's missing |
| 001-011 vs 012-024 state confirmed | NOT VERIFIED | No DB access |
| `db:migrate:v3` run | NOT VERIFIED | Not yet run — future action |
| `db:smoke-test:v3` run | NOT VERIFIED | Not yet run — future action |
| Migration 020 spot-check | NOT VERIFIED | Future action, requires live DB |
| Migration 024 spot-check | NOT VERIFIED | Future action, requires live DB |
| `packages` fields exist | **PASS (static only)** | Migration 023 file confirmed to add `addon_service_ids`/`hall`/`seasonal_pricing` correctly; live presence NOT VERIFIED |

## GitHub

| Item | Status | Evidence |
|---|---|---|
| Repository integrity | **FAIL** | No `.git` directory anywhere in this working folder, reconfirmed directly this session (`REPOSITORY_VALIDATION.md`) |
| All changes committed and pushed | **FAIL** | Cannot be true — there is no git to commit to from this environment. Every fix from the RC pass and this Go-Live pass exists only as edited files |
| Vercel connected to correct repo/branch | NOT VERIFIED | No dashboard access |

## Vercel

| Item | Status | Evidence |
|---|---|---|
| Project imported, Next.js detected | NOT VERIFIED | No dashboard access |
| `vercel.json` crons array well-formed | **PASS** | File read directly, confirmed syntactically valid and complete (4 cron entries, all 4 routes exist) |
| Region (`bom1`) appropriate | **PASS (reasonable default)** | Business is Kolkata-based per every customer-facing document; Mumbai (`bom1`) is a sound low-latency choice for an India-based audience — a judgment call, not something to block on |
| First deploy succeeds | **FAIL / NOT VERIFIED** | No deploy has happened; and the build itself could not be confirmed to pass in this sandbox (`PRODUCTION_BUILD_VALIDATION.md` — `tsc`/`lint`/`vitest` all timed out with the same environmental signature) |

## Cron Jobs

| Item | Status | Evidence |
|---|---|---|
| All 4 routes firing on schedule | NOT VERIFIED | Not deployed |
| `CRON_SECRET` matches | **FAIL** | Can't match what doesn't exist — confirmed absent from production env (see above) |

## Webhooks

| Item | Status | Evidence |
|---|---|---|
| WhatsApp webhook URL registered with Meta | NOT VERIFIED | No dashboard access |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` matches | NOT VERIFIED | Present as a key in both env snapshots; can't confirm the value matches the Meta dashboard |
| Social webhook URLs registered | NOT VERIFIED | No dashboard access |
| Real test message per channel | NOT VERIFIED | Requires live deployment |

## WhatsApp / Meta

| Item | Status | Evidence |
|---|---|---|
| Meta Business/App verified, no test-mode limits | NOT VERIFIED | No dashboard access |
| Access token / phone number ID are production values | NOT VERIFIED | Keys present in both env files; can't distinguish test vs. production credential from key presence alone |
| Business WhatsApp number correct | **PASS** | `NEXT_PUBLIC_BUSINESS_WHATSAPP=9051459463` (a public, non-secret var — safely inspected directly) matches the number used consistently across every customer-facing document and template in this codebase |

## Google (Sheets sync)

| Item | Status | Evidence |
|---|---|---|
| Service account / sheet sharing configured | NOT VERIFIED | External dashboard action |
| `GOOGLE_PRIVATE_KEY` escapes intact | **Likely NOT CONFIGURED locally** | All three Google-related keys in `.env.local` matched the "placeholder-looking" heuristic this phase (`ENVIRONMENT_VALIDATION.md`) — Sheets sync is probably not active in local dev; production value redacted, can't assess |

## Resend (email)

| Item | Status | Evidence |
|---|---|---|
| `RESEND_API_KEY` set + domain verified | **FAIL** | Confirmed absent from the production env snapshot |
| `EMAIL_FROM` set | **FAIL** | Confirmed absent from the production env snapshot |
| Test email sent | NOT VERIFIED | Blocked by the above; no live deployment to test from anyway |

## AI Keys

| Item | Status | Evidence |
|---|---|---|
| `ANTHROPIC_API_KEY` production-ready | **PASS (local)** / NOT VERIFIED (production) | Real-length value present locally; production value redacted |
| `OPENAI_API_KEY` production-ready | **PASS (local)** / NOT VERIFIED (production) | Same |
| `/api/health` checked post-deploy | NOT VERIFIED | No live deployment to check |

## Smoke Tests (post-deploy)

All 7 items: **NOT VERIFIED at runtime** — no live deployment exists to click through. However, `SMOKE_TEST_VALIDATION.md` (this pass, Phase 5) traced the underlying code path for most of these and found them correctly wired:

| Item | Runtime status | Code-path status (weaker evidence, see `SMOKE_TEST_VALIDATION.md`) |
|---|---|---|
| `/api/health` all green | NOT VERIFIED | — |
| `UserMenu` shows correct account | NOT VERIFIED | Component confirmed mounted in `CRMLayout.tsx` (RC pass) |
| Website chat lead → Kanban | NOT VERIFIED | Code path confirmed wired |
| WhatsApp message → Inbox + AI reply | NOT VERIFIED | Code path confirmed wired |
| AI Event Sales Advisor → draft proposal | NOT VERIFIED | Code path confirmed wired |
| Proposal share link loads (incognito) | NOT VERIFIED | Code + new `loading.tsx` confirmed present |
| Proposal PDF renders names correctly | NOT VERIFIED | `escapeHtml()` fix confirmed still present in code |
| Revenue Dashboard loads | NOT VERIFIED | Query logic confirmed unchanged and correct in code |

## Rollback Procedure

| Item | Status | Evidence |
|---|---|---|
| Vercel promote-to-production practiced | NOT VERIFIED | No dashboard access |
| `db:rollback:v3` tested | **PASS (static only)** | 14 `_ROLLBACK.sql` files confirmed present (004 + 012-024, matching every structural migration) — the tooling and files exist; an actual rollback run against a real copy was not performed (no DB access) |

## Monitoring

| Item | Status | Evidence |
|---|---|---|
| `/api/health` wired to uptime check | NOT VERIFIED | External/organizational action |
| Team knows log locations | NOT VERIFIED | Organizational, not a code check |

## Backups

| Item | Status | Evidence |
|---|---|---|
| Automatic backup active | NOT VERIFIED | No dashboard access |
| Manual pre-migration backup taken | NOT VERIFIED | Future action, hasn't happened |

## Score

**5 PASS · 9 FAIL · ~30 NOT VERIFIED**, out of roughly 44 checklist lines. The FAIL count is concentrated almost entirely in two places: (1) three genuinely missing production secrets/keys (`WHATSAPP_APP_SECRET`, `CRON_SECRET`, `RESEND_API_KEY`+`EMAIL_FROM`) and (2) the absence of a git repository to commit and deploy from. Both are precisely bounded, known-fix problems, not open-ended investigations — see `RELEASE_REPORT_GLP.md` for what that means for go-live timing.
