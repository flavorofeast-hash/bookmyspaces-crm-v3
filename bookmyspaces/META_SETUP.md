# BookMySpaces CRM V3 — Meta (Facebook/Instagram) Go-Live Document

Code, routes, middleware, and tests are verified and fixed as of this document. Everything below is Meta Developer Console configuration only — no further coding required.

---

## A. Required Meta App Configuration

**App Type:** Business (not Consumer). Create/use one app in [developers.facebook.com](https://developers.facebook.com) under your Meta Business Manager account.

**Products to add:**
- Facebook Login for Business *(only if you want to generate the Page token via OAuth instead of Graph API Explorer — optional, see Section D)*
- Webhooks
- (Instagram publishing/comments ride on the same Page product — no separate "Instagram" product needed beyond linking the IG Business Account to the Page)

**Permissions (Page):**
| Permission | Used for |
|---|---|
| `pages_show_list` | Select the Page when generating a token |
| `pages_read_engagement` | Read comments/mentions (webhook `feed` field) |
| `pages_manage_posts` | Publish to `/feed` and `/photos` |
| `pages_manage_engagement` | Reply to comments (`/{comment-id}/comments`) |
| `pages_manage_metadata` | Subscribe the Page to webhooks |

**Permissions (Instagram):**
| Permission | Used for |
|---|---|
| `instagram_basic` | Read IG account/media |
| `instagram_manage_comments` | Reply to IG comments/mentions |
| `instagram_content_publish` | Two-step media publish (`/media` → `/media_publish`) |

**Webhook subscriptions:**
| Object | Field(s) | Why |
|---|---|---|
| `page` | `feed` | Facebook comments (parsed via `field:'feed', item:'comment'`) and mentions |
| `instagram` | `comments`, `mentions` | Instagram comments and @mentions |

**Callback URL (webhook endpoint — same URL for GET verification and POST delivery):**
```
https://<your-production-domain>/api/social/webhook/facebook
https://<your-production-domain>/api/social/webhook/instagram
```
Route: `src/app/api/social/webhook/[platform]/route.ts` — `[platform]` must be exactly `facebook` or `instagram` (matches `adapter-registry.ts`).

**Redirect URI:** Not applicable — this app has no OAuth login flow (by design; see Section D for the token-generation alternative). If you later add Facebook Login for Business, the redirect URI would be `https://<your-production-domain>/api/auth/callback`, but nothing in the codebase currently expects or handles a Meta OAuth `code` param there — do not configure this unless that flow is built first.

**Verify Token:** Any string you choose. Set the same value in both places:
- Meta App Dashboard → Webhooks → Edit Subscription → Verify Token
- Vercel env var `META_VERIFY_TOKEN`

**Graph API version:** `v23.0` — pinned in `src/lib/social/adapters/meta-adapter.ts` (`GRAPH = 'https://graph.facebook.com/v23.0'`). All Graph calls (publish, reply, both webhook fetch paths) use this constant.

---

## B. Required Vercel Environment Variables

Set these in Vercel → Project (`bookmyspaces-crm-v3`) → Settings → Environment Variables, then redeploy. Also documented inline in `.env.example`.

| Variable | Source | Purpose |
|---|---|---|
| `META_APP_SECRET` | Meta App Dashboard → Settings → Basic | Webhook HMAC signature verification (`X-Hub-Signature-256`) |
| `META_VERIFY_TOKEN` | You choose it | GET `hub.challenge` handshake |
| `META_PAGE_ACCESS_TOKEN` | Business Suite System User (recommended, non-expiring) or Graph API Explorer long-lived token exchange | Auth for every publish/reply Graph call |
| `META_PAGE_ID` | Page → About → Page ID, or `GET /me/accounts` | Target Facebook Page for `/feed`, `/photos` |
| `META_IG_ID` | `GET /{page-id}?fields=instagram_business_account` | Target Instagram Business Account for `/media`, `/media_publish` |

No other env vars are needed for this integration. `NEXT_PUBLIC_APP_URL` (already set) is not read by any social code path.

---

## C. Testing Checklist

Run in order after setting the 5 env vars and redeploying.

1. **Webhook verification (GET)** — In Meta App Dashboard, add the callback URL + verify token and click "Verify and Save." Confirm it succeeds (200, echoes challenge). Code: `GET /api/social/webhook/[platform]`.
2. **Webhook signature rejection** — `curl -X POST https://<domain>/api/social/webhook/facebook -d '{}'` with no `X-Hub-Signature-256` header → expect `401 {"error":"Invalid signature"}`.
3. **Live comment ingestion** — Post a comment on the connected Page/IG post → confirm a row appears in Supabase `social_interactions` and in the CRM at `/social` (Social Inbox), filtered to "New."
4. **Reply-to-comment** — From `/social`, click Reply on a live interaction, send a message → confirm `sent: true` in the response, the comment shows the reply on Facebook/Instagram itself, and the CRM row flips to `replied`.
5. **Facebook text post** — `POST /api/social/posts` with `{"platform":"facebook","post_type":"text","content":"test"}` (creates a draft — publishing is not wired to any trigger yet, see caveat below). To test the Graph call directly, call `MetaAdapter('facebook').publishPost({postType:'text', content:'test', media:[]})` from a one-off script/route and confirm a real post appears on the Page via `/{pageId}/feed`.
6. **Facebook image post** — Same as above with a `media` URL → confirm it posts via `/{pageId}/photos`, not `/feed` (verify the post has an attached image, not just link text).
7. **Instagram post** — Confirm the two-step flow completes: container created (`/media`), then published (`/media_publish`), and the post appears on the IG Business Account.
8. **Instagram text-only rejection** — Call `publishPost` with no media on the Instagram adapter → expect `{ok:false, error:'instagram_requires_media...'}`, not a Graph error.
9. **Rate limiting** — Send >120 requests/min to the webhook POST endpoint from one IP → expect `429` with `Retry-After` header.
10. **Unit tests** — `npm run test -- src/lib/social` → all 15 tests pass (webhook parsing, sentiment, publish branching, unconfigured-refusal).
11. **Build** — `npm run build` → clean, no type errors, `/api/social/*` routes listed as dynamic (ƒ).

---

## D. Remaining Manual Tasks — Meta Developer Console Only

Everything below requires your Meta Business/Developer account access; none of it is code.

1. Create (or select) the Meta App under your Business Manager, set App Type = Business.
2. Add the Webhooks product; add the Facebook Login for Business product only if you want OAuth-based token generation (optional).
3. In Business Settings, assign the BookMySpaces Page (and its linked Instagram Business Account) to the app.
4. Generate a **long-lived, non-expiring Page Access Token**: Business Settings → System Users → create a system user → assign the Page → generate token with the permissions listed in Section A. (Preferred over Graph API Explorer's 60-day tokens — no renewal needed.)
5. Retrieve `META_PAGE_ID` and `META_IG_ID` via Graph API Explorer (`GET /me/accounts`, then `GET /{page-id}?fields=instagram_business_account`).
6. Copy the App Secret from Settings → Basic.
7. Choose a `META_VERIFY_TOKEN` string.
8. Set all 5 values in Vercel (Section B) and redeploy.
9. In the App Dashboard → Webhooks, add the callback URL, verify token, subscribe `page`→`feed` and `instagram`→`comments,mentions` (Section A).
10. Submit the app for **App Review** for any permission beyond what your own Page/IG roles already grant in dev mode (`pages_manage_posts`, `instagram_content_publish`, etc. typically require review before the integration works for real, non-admin-role content — Meta enforces this, not this codebase).
11. **Apply `supabase/migrations/026_leads_source_add_meta_capture.sql` to the production database** (Supabase SQL Editor or CLI) — required before Lead Ads/Messenger/Instagram DM capture will work at all (see Known Limitation below). Not yet applied anywhere; this session has no live DB access.
12. Run through the Testing Checklist (Section C) end-to-end.

---

## Known Limitation — Meta lead capture requires migration 026 (fixed in code, not yet applied to any live DB)

Lead Ads submissions, Messenger messages, and Instagram DMs are parsed correctly and passed to `captureLeadWithJourney()`, but until migration 026 is applied, every resulting insert into `leads` fails a Postgres CHECK constraint (`leads_source_check` only allowed 7 values; Meta capture uses 4 more: `facebook_lead_ads`, `instagram_lead_ads`, `facebook_messenger`, `instagram_dm`). The failure is caught and logged, not surfaced — the webhook still returns 200. Run migration 026 (Section D, item 11) before relying on Meta lead capture; see the migration file for pre/post-flight verification queries.

---

## Known Limitation (not a Meta Console task — flagging for visibility)

`publishPost()` is correct and callable, but **no code path currently invokes it automatically.** Content Studio (`/content-studio`) only creates `draft`/`scheduled` rows in `social_posts` — by original design (`post-service.ts`: *"no publishing... a later step adds the scheduler"*). There is no "Publish Now" button and no cron/queue that moves `scheduled` → `published`.

This means: after Section A–D setup, **replying to comments and webhook ingestion will work immediately**; **actually publishing a post from the CRM UI will not**, until a small trigger (a manual publish action or a scheduler) is built to call `adapter.publishPost()`. That was intentionally left out of this pass per your "no new features unless absolutely necessary" instruction — let me know if you want it added; it's a small, contained change (no new tables, reuses the existing adapter).
