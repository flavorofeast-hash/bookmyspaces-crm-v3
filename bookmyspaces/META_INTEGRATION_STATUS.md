# Meta Integrations Status (Facebook Messenger / Instagram DM / Lead Ads)

Code-complete for all three products. Every gap is external (Meta App
Review permissions, page/business connection) — nothing left to build
until those are granted.

## 1. Set these environment variables in Vercel (Project → Settings → Environment Variables)

Same 5 vars gate all three products (`src/lib/social/adapters/meta-adapter.ts`,
`src/lib/social/meta-lead-capture.ts`); already documented in `.env.example`,
now also tracked by `src/lib/env.ts`'s startup warning under "Social (Meta
Facebook/Instagram)":
- `META_APP_SECRET` — Meta App dashboard → Settings → Basic → App Secret. Used for `X-Hub-Signature-256` webhook verification (`verifyWebhook()` fails closed — rejects with 401 if unset, unlike WhatsApp's fail-open).
- `META_VERIFY_TOKEN` — any secret string you choose; must match the Meta App dashboard's webhook subscription screen exactly.
- `META_PAGE_ACCESS_TOKEN` — Page access token (System User / long-lived, not the 1hr user token) with `pages_messaging`, `pages_read_engagement`, `leads_retrieval`, `instagram_manage_messages` scopes as applicable.
- `META_PAGE_ID` — numeric Facebook Page ID.
- `META_IG_ID` — Instagram Business Account ID linked to the Page.

## 2. Configure the webhook in the Meta App dashboard

- Callback URL: `https://<your-production-domain>/api/social/webhook/facebook` and `.../instagram` (route is `[platform]`-parameterized; both point at the same handler).
- Verify token: exactly `META_VERIFY_TOKEN`.
- Subscribe fields, per product:
  - **Messenger**: `messages` on the Facebook Page product.
  - **Instagram DM**: `messages` on the Instagram product.
  - **Lead Ads**: `leadgen` on the Facebook Page product (Instagram Lead Forms use the same field, delivered via the Page subscription).
- Click "Verify and Save" — triggers `GET /api/social/webhook/[platform]`. Every outcome (success, missing `META_VERIFY_TOKEN`, mode/token mismatch) is now logged under `[BMS:social-webhook]`.

## 3. Per-product status

| Product | Code path | Status | External blocker |
|---|---|---|---|
| Facebook Messenger | `parseMessagingEvents` → `captureSocialDirectMessage` (`dm-capture-service.ts`) | Complete | `pages_messaging` permission (Meta App Review) |
| Instagram Messaging | same code path, `platform: 'instagram'` | Complete | `instagram_manage_messages` permission + IG Business account linked to Page |
| Facebook Lead Ads | `parseLeadgenEvents` → `claimLeadgenEvent` → `fetchLeadgenDetails` → `captureLeadWithJourney` (`meta-lead-capture.ts`) | Complete | `leads_retrieval` permission |
| Instagram Lead Ads | same code path, `platform: 'instagram'` | Complete | `leads_retrieval` + IG Business account linked to Page |

Messenger and Instagram DM/Lead Ads share the same implementation, differentiated only by a `platform: 'facebook' | 'instagram'` field — there is no code-level distinction between "complete" and "prepared." The only real gap is Meta-side: each product requires its own App Review permission grant, which needs Meta login/business verification (outside this session's scope).

## 4. What was hardened in this pass

- **`src/lib/social/graph-api-client.ts`** (new): single shared `callGraphAPI()` — every Graph call in `src/lib/social` now goes through it instead of hand-rolled `fetch()`. Retries up to 2x on 5xx/network errors only (never 4xx — retrying won't fix a bad token/permission and Graph may have partially applied the request). Structured logging on every failure.
- **`meta-adapter.ts`**: `publishPost()`, `replyToInteraction()`, `verifyWebhook()` now route through `callGraphAPI()` / have logging added on every branch (success and every failure mode).
- **`meta-lead-capture.ts`**: `fetchLeadgenDetails()` now routes through `callGraphAPI()`. New `claimLeadgenEvent()` / `linkLeadgenEventToLead()` close the Lead Ads webhook replay gap (SECURITY_AUDIT_REPORT.md finding M9) via a new `social_leadgen_events` table (migration `029_social_leadgen_dedup.sql`) — a Meta redelivery or replayed payload is now skipped instead of re-creating a duplicate lead.
- **`dm-capture-service.ts`**: new dedup check against `unified_messages.external_message_id` before any processing — closes the same M9 finding for Messenger/IG DM replays.
- **`src/app/api/social/webhook/[platform]/route.ts`**: `GET` handler now logs every verification outcome distinctly (500 on missing `META_VERIFY_TOKEN` instead of a misleading 403; explicit success/mismatch logging); `POST` handler wired to `claimLeadgenEvent`/`linkLeadgenEventToLead`.
- No hardcoded test IDs found in production code (`src/lib/social`, `src/app/api/social`) — only legitimate fixtures in `*.test.ts`, left as-is.

## 5. What was inspected and confirmed already correct (no change needed)

- **Vercel deployment config**: no `vercel.json` entry needed — the route declares `export const runtime = 'nodejs'` and `export const maxDuration = 30` as App Router route segment config, same pattern as `/api/whatsapp/webhook`.
- **`SocialAdapter` interface** (`src/lib/social/types.ts`): deliberately excludes DMs/Lead Ads (Meta-specific, not shared across platforms) — `meta-lead-capture.ts` is correctly a separate file, not a forced fit into the adapter interface.
- **Startup validation**: `src/lib/env.ts`'s `assertEnv()` now includes a "Social (Meta Facebook/Instagram)" group — check Vercel logs for a `[env]` line after deploy.

## 6. Quick post-verification smoke test (once permissions are granted)

1. **Messenger**: send a message to the Page from a personal FB account. Check logs for `[BMS:social-webhook]` receipt, then confirm the conversation appears in Inbox/Leads.
2. **Instagram DM**: same, via Instagram Direct to the linked IG Business account.
3. **Lead Ads**: submit a test lead form (Meta Ads Manager → Lead Ads Testing Tool). Check logs for the leadgen event claim + `fetchLeadgenDetails` call, then confirm a new lead appears with source `facebook_lead_ads` / `instagram_lead_ads`.
4. Resubmit the same test lead ID twice — second delivery should log "already processed, skipping (replay)" and not create a duplicate lead.
