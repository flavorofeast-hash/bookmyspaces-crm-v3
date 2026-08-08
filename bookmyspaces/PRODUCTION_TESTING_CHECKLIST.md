# BookMySpaces CRM — Production Integration & Validation Checklist

Grounded directly in the current codebase (routes, env var names, and cron config below are copied from the actual source, not generic templates). No code was changed to produce this document.

**Read this first — one structural fact that affects every social platform below:**
Connecting a platform via the in-app OAuth flow (Content Studio → Connect) exchanges a code, stores an encrypted token in the `social_accounts` table, and shows "Connected" in the UI. **But the actual publish/adapter code for Facebook, Instagram, Google Business, and LinkedIn does NOT read that stored token.** It reads a separate, static long-lived access token from an environment variable (`META_PAGE_ACCESS_TOKEN`, `GOOGLE_BUSINESS_ACCESS_TOKEN`, `LINKEDIN_ACCESS_TOKEN`). So "Connect" succeeding is necessary but **not sufficient** for "Publish" to work — you must separately obtain and set the long-lived token env var for each platform, independent of the OAuth UI flow. This is called out again under each platform's "Common mistakes."

---

## 0. Master environment variable list

Set these in Vercel → Project → Settings → Environment Variables (Production + Preview), then redeploy.

| Variable | Used for |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase client (browser + server) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase client (browser, RLS-scoped) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side admin client (bypasses RLS) |
| `NEXT_PUBLIC_APP_URL` | Base URL used to build OAuth redirect URIs and email links (falls back to `https://bookmyspaces.in` if unset) |
| `ANTHROPIC_API_KEY` | AI reply, content generator, campaign brief, opportunity score |
| `CRON_SECRET` | Bearer-token auth for every `/api/cron/*` route — **if unset, all cron routes run unauthenticated** |
| `WHATSAPP_ACCESS_TOKEN` | Outbound WhatsApp Cloud API sends |
| `WHATSAPP_PHONE_NUMBER_ID` | WhatsApp Cloud API sender number |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | WhatsApp webhook GET handshake (`hub.verify_token`) |
| `WHATSAPP_APP_SECRET` | WhatsApp webhook POST signature verification (`X-Hub-Signature-256`) — **if unset, signatures are not verified, only logged as a warning** |
| `META_APP_ID` / `META_APP_SECRET` | Facebook + Instagram OAuth (shared — Instagram rides Facebook Login) |
| `META_VERIFY_TOKEN` | Facebook/Instagram webhook GET handshake |
| `META_PAGE_ID` / `META_IG_ID` | Which Page/IG account to publish to |
| `META_PAGE_ACCESS_TOKEN` | **Actual publish/read token** used by the adapter (separate from OAuth-stored token — see note above) |
| `GOOGLE_BUSINESS_CLIENT_ID` / `GOOGLE_BUSINESS_CLIENT_SECRET` | Google Business OAuth |
| `GOOGLE_BUSINESS_ACCESS_TOKEN` | **Actual publish/read token** used by the adapter |
| `GOOGLE_BUSINESS_LOCATION_ID` | Which Business Profile location to post/reply as |
| `LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET` | LinkedIn OAuth |
| `LINKEDIN_ACCESS_TOKEN` | **Actual publish token** used by the adapter |
| `LINKEDIN_ORGANIZATION_URN` | Which LinkedIn Company Page to post as |
| `RESEND_API_KEY` | Email sending (Resend) |
| `EMAIL_FROM` | From-address for outgoing email (defaults to `BookMySpaces <onboarding@resend.dev>` if unset) |

---

## 1. Facebook

**1. Prerequisites** — a Facebook Page you administer; a verified Meta Business Manager account (required for API access at any real volume).
**2. Accounts required** — Facebook personal account with admin role on the Page; Meta Business Manager; Meta Developer account.
**3. Developer Console setup** — developers.facebook.com → Create App → type "Business" → add the "Facebook Login for Business" and "Pages" products.
**4. Environment variables** — `META_APP_ID`, `META_APP_SECRET`, `META_VERIFY_TOKEN` (any string you choose — must match what you type into Meta's webhook config), `META_PAGE_ID`, `META_PAGE_ACCESS_TOKEN` (see step 9).
**5. OAuth configuration** — In the Meta App dashboard, add `NEXT_PUBLIC_APP_URL` as an "App Domain" and add the redirect URL below under Facebook Login → Settings → Valid OAuth Redirect URIs.
**6. Redirect URLs** — `{NEXT_PUBLIC_APP_URL}/api/social/oauth/facebook/callback` (built by `getRedirectUri()` in `src/lib/social/oauth/oauth-config.ts:110`).
**7. Webhook URLs** — `{NEXT_PUBLIC_APP_URL}/api/social/webhook/facebook`. Meta → App → Webhooks → Page → Callback URL = above, Verify Token = `META_VERIFY_TOKEN`. Subscribe to `feed`, `messages`, `leadgen`.
**8. Required permissions/scopes** — `pages_show_list`, `pages_manage_posts`, `pages_read_engagement`, `pages_messaging`, `leads_retrieval` (exact list in `oauth-config.ts:51`). Scopes beyond basic ones require Meta App Review before they work for non-admin test users.
**9. Verification steps** —
   a. In Content Studio (`/content-studio`), click Connect Facebook → complete the Meta login popup → confirm it redirects back with a success banner (not `?error=`).
   b. Separately, generate a long-lived Page Access Token (Graph API Explorer → select your Page → generate token → exchange for long-lived via `/oauth/access_token`) and set it as `META_PAGE_ACCESS_TOKEN`. This is the token actually used to publish — the OAuth step in (a) alone will not let you publish.
   c. Confirm `isConfigured()` returns true by checking that both `META_PAGE_ACCESS_TOKEN` and `META_APP_SECRET` are set (`meta-adapter.ts:37`).
**10. Common mistakes** — assuming step (a) alone enables publishing (it does not — see the note at the top of this document); forgetting the webhook GET handshake fails silently with a generic 403 if `META_VERIFY_TOKEN` doesn't exactly match (no trim in this route, unlike the WhatsApp one); short-lived tokens expiring in ~1-2 hours if you skip the long-lived exchange.
**11. Recovery steps if auth fails** — re-run the long-lived token exchange (short-lived tokens are the #1 cause of a mid-week failure); check Meta App Dashboard → App Review for any scope stuck in "Needs Submission"; re-connect via Content Studio to refresh the stored `social_accounts` row (used for the connection-health badge, even though it's not what publish reads).

## 2. Instagram

Same Meta app/OAuth as Facebook (Instagram Business accounts authenticate via Facebook Login — there's no separate Instagram OAuth flow; `oauth-config.ts:39-43`).

**1-8.** Same app/console/env as Facebook, except: redirect URL is `{NEXT_PUBLIC_APP_URL}/api/social/oauth/instagram/callback`; webhook URL is `{NEXT_PUBLIC_APP_URL}/api/social/webhook/instagram`; scopes are `instagram_basic`, `instagram_content_publish`, `instagram_manage_comments`, `instagram_manage_messages`, `pages_show_list`; env var `META_IG_ID` (Instagram Business Account ID, not the Page ID) is used instead of `META_PAGE_ID` for publishing.
**9. Verification steps** — same Connect flow as Facebook; confirm your Instagram account is a **Business** or **Creator** account linked to the Facebook Page (a personal IG account cannot be connected via Graph API at all — this is a Meta requirement, not a code limitation).
**10. Common mistakes** — using a personal Instagram account (will fail with no useful error); confusing `META_PAGE_ID` and `META_IG_ID` (they are different IDs even though both come from the same Meta app).
**11. Recovery** — same as Facebook; additionally verify the IG account is still linked to the Page in Meta Business Suite (this link can silently break).

## 3. WhatsApp Cloud API

**1. Prerequisites** — a Meta Business Account; a phone number not already registered to a personal WhatsApp/WhatsApp Business app.
**2. Accounts required** — Meta Business Manager; Meta Developer account; WhatsApp Business Platform access (via the same Meta App as Facebook, add the "WhatsApp" product).
**3. Developer Console setup** — Meta App Dashboard → Add Product → WhatsApp → note the test/production Phone Number ID and temporary access token shown there.
**4. Environment variables** — `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`.
**5. OAuth configuration** — none for sending (uses a static system-user access token, not a per-user OAuth flow).
**6. Redirect URLs** — not applicable.
**7. Webhook URLs** — `{NEXT_PUBLIC_APP_URL}/api/whatsapp/webhook`. Meta App → WhatsApp → Configuration → Callback URL = above, Verify Token = `WHATSAPP_WEBHOOK_VERIFY_TOKEN`. Subscribe to the `messages` field.
**8. Required permissions/scopes** — `whatsapp_business_messaging`, `whatsapp_business_management` on the system user token.
**9. Verification steps** —
   a. GET-verify the webhook first: Meta's dashboard button "Verify and Save" must succeed (route logic at `src/app/api/whatsapp/webhook/route.ts:38-66`) before Meta will deliver anything.
   b. Send a test WhatsApp message to your business number from your personal phone → confirm a reply arrives (this exercises `chatWithAI` in `src/lib/ai.ts`, the live default reply path — see AI section below).
   c. Confirm the message appears in `/inbox` and on the customer's Timeline (`/customers/[id]`).
**10. Common mistakes** — using the temporary (24-hour) access token from the Meta quickstart in production instead of a permanent system-user token; leaving `WHATSAPP_APP_SECRET` unset (webhook accepts unsigned requests — logged only as a warning, not rejected, per `route.ts:83-84`) — set this before going live; forgetting the number must complete Meta's display-name/business verification before sending template messages to non-test numbers.
**11. Recovery steps if auth fails** — regenerate the system-user permanent token (Business Settings → System Users); re-verify the webhook if the verify token was rotated; check Vercel function logs for `WHATSAPP_APP_SECRET not set` warnings if messages seem to process but you're unsure signatures are enforced.

### WhatsApp smoke tests (extended, per your list)
- **Connect Cloud API** — webhook GET-verifies (green check in Meta dashboard).
- **Receive webhook** — send a message from a real phone → check Vercel logs for a POST to `/api/whatsapp/webhook` with 200 response.
- **AI reply** — confirm an automatic reply arrives. Note: the default live path is the legacy `buildAIReply`/`chatWithAI` pipeline (`route.ts:218`), **not** the newer multi-file orchestration engine (intent-detector/decision-table/orchestration-executor) — that pipeline exists and is fully wired but is gated behind `orchestration.enabled` in Settings, which defaults to `false` with no UI toggle currently exposed. Don't expect intent-detection-driven behavior unless this flag is flipped directly in the `settings` table.
- **Human handoff** — send a message containing a human-handoff trigger phrase (e.g. "talk to a person") → confirm the conversation flips to a state that stops auto-replies and shows up flagged in `/inbox`.
- **Drip** — enroll a test lead in a drip sequence (`/whatsapp/drip-sequences`) → manually invoke `/api/cron/drip-sequences` (see cron table) → confirm a WhatsApp send goes out and `drip_sequence_enrollments.next_send_at` advances.
- **Follow-up** — create a lead with no activity → wait for/manually trigger `/api/cron/followups` and `/api/cron/ai-followup-assistant` → confirm a follow-up message sends and is logged.
- **Loyalty** — complete a booking (see Customer Journey section) → confirm a "points awarded" WhatsApp message sends after checkout, distinct from the thank-you message.
- **Referral** — trigger a referral ask (via marketing-automations cron or event-lifecycle) → confirm the message includes a real referral code/link (`getOrCreateReferralCode`).
- **Review Request** — manually invoke `/api/cron/stay-lifecycle` for a `checked_out` reservation 3 days in the past → confirm a review-request WhatsApp send and a `review_requests` row.
- **Timeline logging** — after each of the above, open `/customers/[id]` and confirm each send appears as a distinct Timeline entry (not just in `/inbox`).

## 4. Google Business

**1. Prerequisites** — a verified Google Business Profile listing for your venue.
**2. Accounts required** — Google Cloud Console project; Google Business Profile API access (Google gates this API — you must request access via a form, approval is not instant).
**3. Developer Console setup** — console.cloud.google.com → new project → enable "Google Business Profile API" (may require the access-request approval above first) → Credentials → OAuth 2.0 Client ID (Web application).
**4. Environment variables** — `GOOGLE_BUSINESS_CLIENT_ID`, `GOOGLE_BUSINESS_CLIENT_SECRET`, `GOOGLE_BUSINESS_ACCESS_TOKEN`, `GOOGLE_BUSINESS_LOCATION_ID`.
**5. OAuth configuration** — Cloud Console → OAuth consent screen → add your account as a test user if the app is in "Testing" publish status.
**6. Redirect URLs** — `{NEXT_PUBLIC_APP_URL}/api/social/oauth/google_business/callback` — must be added exactly under Authorized redirect URIs in the Cloud Console credential.
**7. Webhook URLs** — none (Google Business Profile has no push webhook in this integration; reviews/metrics are pulled, not pushed).
**8. Required permissions/scopes** — `https://www.googleapis.com/auth/business.manage` (`oauth-config.ts:83`).
**9. Verification steps** —
   a. Complete Connect flow in Content Studio → success banner.
   b. Separately obtain a long-lived/refreshable access token and set `GOOGLE_BUSINESS_ACCESS_TOKEN` — same disconnect as Facebook: the adapter (`google-business-adapter.ts:37`) reads this env var directly, not the OAuth-stored token.
   c. Set `GOOGLE_BUSINESS_LOCATION_ID` to your specific location resource (`accounts/{id}/locations/{id}` format, found via the API's `accounts.locations.list`).
**10. Common mistakes** — API access approval pending (Google's manual gate is the most common blocker, budget several days); wrong location ID format (must be the full resource path, not just a numeric ID); OAuth consent screen stuck in "Testing" mode blocking anyone but added test users.
**11. Recovery** — re-request API access if it was revoked for inactivity; regenerate the access token via the refresh flow (`supportsRefresh: true` in config, so `refresh-service.ts` can auto-renew if refresh token is stored — confirm the token-refresh cron is actually including this platform).

### Google Business smoke tests
- **Connect account** → success banner in Content Studio.
- **Publish post** → create a post in Content Studio targeting Google Business → confirm `POST /api/social/posts` returns success and the post appears live on your Business Profile within a few minutes.
- **Reply to review** → open `/reviews` → reply to a real review → confirm it posts back to the live Google listing.
- **Verify metrics** → check `/dashboard/marketing` for Google Business post metrics populating (may take 24-48h — Google's insights API is not real-time).

## 5. LinkedIn (if possible)

**1. Prerequisites** — a LinkedIn Company Page you administer.
**2. Accounts required** — LinkedIn Developer account; LinkedIn Company Page admin access.
**3. Developer Console setup** — developer.linkedin.com → Create App → link it to your Company Page → request the "Share on LinkedIn" and "Community Management API" products (both require LinkedIn's manual approval, which can take days and isn't guaranteed for a new app — this is the most likely integration in your list to stay blocked).
**4. Environment variables** — `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`, `LINKEDIN_ACCESS_TOKEN`, `LINKEDIN_ORGANIZATION_URN` (format `urn:li:organization:{id}`).
**5. OAuth configuration** — LinkedIn App → Auth tab → add the redirect URL below.
**6. Redirect URLs** — `{NEXT_PUBLIC_APP_URL}/api/social/oauth/linkedin/callback`.
**7. Webhook URLs** — none used by this integration.
**8. Required permissions/scopes** — `openid`, `profile`, `w_member_social`, `r_organization_social`, `w_organization_social`, `rw_organization_admin` (`oauth-config.ts:73`) — the org-posting scopes specifically require product approval, not just app creation.
**9. Verification steps** — Connect flow → success banner; then separately set `LINKEDIN_ACCESS_TOKEN` (adapter reads this directly, same pattern as the others) and `LINKEDIN_ORGANIZATION_URN`.
**10. Common mistakes** — assuming personal profile posting works the same as Company Page posting (this integration is Company-Page-only, per `LINKEDIN_ORGANIZATION_URN`); underestimating LinkedIn's product-approval turnaround — treat this as "best effort" for this week, per your own "(if possible)" framing.
**11. Recovery** — refresh via `supportsRefresh: true` (`oauth-config.ts:75`); if the app's product access is revoked/pending, publishing will fail with an auth error until LinkedIn approves it — no workaround on the CRM side.

## 6. Email (Resend)

**1. Prerequisites** — a domain you can add DNS records to (for deliverability) or use Resend's shared test domain initially.
**2. Accounts required** — Resend account.
**3. Developer Console setup** — resend.com → API Keys → create a key; Domains → add and verify your sending domain (SPF/DKIM records) if not using the test domain.
**4. Environment variables** — `RESEND_API_KEY`, `EMAIL_FROM` (must be an address on a verified domain, or leave unset to use the default `onboarding@resend.dev`).
**5-7.** Not applicable (no OAuth, no redirect, no inbound webhook consumed by this integration).
**8. Required permissions/scopes** — Resend API key with send permission (default for a new key).
**9. Verification steps** — trigger any email-sending path (invoice email: `/api/proposals/[id]/invoice/email`, payment reminder: `/api/proposals/[id]/payment-reminder`) → confirm delivery and check Resend's dashboard for a "delivered" event.
**10. Common mistakes** — sending from an unverified `EMAIL_FROM` domain (Resend will reject or land in spam); note that the email side of the **Unified Inbox reply** feature is a known gap — replying to an email conversation from `/inbox` currently has no transport wired (`outbound-dispatcher.ts` only handles WhatsApp and website chat) and will silently no-op. Test only the direct proposal/invoice email sends this week, not inbox-reply-to-email.
**11. Recovery** — regenerate the API key if sends start failing with 401; re-verify DNS records if deliverability drops (check Resend's domain health page).

## 7. Vercel Cron Jobs

**1-8.** Prerequisites/setup are just: deploy to Vercel with `vercel.json`'s `crons` array intact, and set `CRON_SECRET` in the environment (Production). Vercel automatically registers and triggers each cron on deploy — no separate console step beyond having the env var set and the plan supporting Cron Jobs (Hobby plan limits cron frequency; verify your plan supports the schedules below, especially the hourly-adjacent ones).
**9. Verification steps** — Vercel Dashboard → your project → Cron Jobs tab → confirm all 10 jobs listed below show "Success" after their first scheduled run; check for a non-2xx status which indicates the secret mismatch or a code error.
**10. Common mistakes** — deploying without `CRON_SECRET` set (routes then run unauthenticated — a security gap, not a functional one, since Vercel still triggers them correctly); assuming a cron ran because it's listed in `vercel.json` — it only actually executes after a **production** deploy (Preview deploys don't get cron triggers).
**11. Recovery** — if a cron shows a 401, `CRON_SECRET` in Vercel env doesn't match what the route expects (it's the same var for all cron routes, so a mismatch affects everything at once); redeploy after fixing the env var.

---

## 8. Cron job reference table

Manual invoke pattern for all of them: `curl -X GET https://<your-domain>/api/cron/<name> -H "Authorization: Bearer $CRON_SECRET"`

| Cron route | Purpose | Schedule | Expected output | Tables affected | Verify it worked |
|---|---|---|---|---|---|
| `/api/cron/followups` | Drains due manual follow-ups | `0 9 * * *` (9am) | `{ processed, sent }` JSON | `follow_ups`, `activity_logs`, `message_queue` | Check `follow_ups.status` flips to `sent`; message arrives on WhatsApp |
| `/api/cron/escalations` | Scans open leads, applies escalation rules | `0 18 * * *` (6pm) | Escalation counts | `leads`, `activity_logs` | Check a stale lead's `assigned_to`/priority changed |
| `/api/cron/campaign-queue` | Drains `message_queue` (campaigns) + advances recurring campaigns | `0 12 * * *` (noon) | `{ recurring_triggered, queue }` | `message_queue`, `broadcast_campaigns` | `message_queue` rows flip from `pending` to `sent`; recipient receives WhatsApp |
| `/api/cron/stay-lifecycle` | Pre-arrival reminder, post-stay thank-you, review request (reservations) + event post-experience lifecycle (proposals) | `0 8 * * *` (8am) | Per-branch counts | `reservations`, `proposals`, `review_requests`, `activity_logs`, `message_queue` | Confirm counts > 0 on a day with matching check-in/out dates; Timeline shows new entries |
| `/api/cron/review-reminders` | Sends one reminder for reviews not yet given after 7 days | `0 10 * * *` (10am) | `{ reminded }` | `review_requests`, `activity_logs` | `review_requests.reminder_count` flips to 1 |
| `/api/cron/social-publish` | Publishes due scheduled `social_posts` rows | `0 9 * * *` (9am) | Publish counts | `social_posts` | Post's `status` flips to `published`, live on the platform |
| `/api/cron/marketing-automations` | Birthday, anniversary, proposal-expiry, repeat-booking, referral-request, win-back triggers | `0 7 * * *` (7am) | Per-trigger counts | `activity_logs`, `message_queue` | Check `activity_logs` for the relevant action string on a matching test lead |
| `/api/cron/drip-sequences` | Advances due drip enrollments | `0 11 * * *` (11am) | Advance count | `drip_sequence_enrollments` | `next_send_at` advances, message sends |
| `/api/cron/ai-followup-assistant` | Drafts AI follow-ups into the follow_ups queue | `0 6 * * *` (6am) | Draft count | `follow_ups` | New `follow_ups` rows appear, drained same day by `/api/cron/followups` at 9am |
| `/api/cron/social-token-refresh` | Refreshes expiring OAuth tokens for connected social accounts | `0 5 * * *` (5am) | Refresh count | `social_accounts` | `token_expires_at` extends for accounts nearing expiry |

Note: `/api/cron/campaign-queue` runs after all the enqueuing crons (7am-11am) so same-day sends drain same-day — if you manually trigger crons out of order during testing, that's fine, just re-run `campaign-queue` last to see everything drain.

---

## 9. Campaigns end-to-end smoke test

1. Create a campaign at `/campaigns` (choose a segment, or use "Generate AI content" for the message).
2. Publish/send it (`dry_run:false`) → confirms `message_queue` rows created with `metadata.campaign_id`.
3. Manually invoke `/api/cron/campaign-queue` → confirms the queued messages actually send.
4. Click a landing-page CTA/link generated by the campaign (or visit `/{campaign}` directly) → confirms `POST /api/campaigns/track` fires and a lead row is created.
5. Convert that lead through Kanban (`/kanban`) stages → qualify → confirm a proposal can be drafted (`/proposals/new`).
6. Accept the proposal → convert to a Reservation or Event.
7. Open `/campaigns` and `/dashboard/marketing` side by side → confirm the campaign's booking/revenue/ROI numbers match on both screens (they now read the identical `computeCampaignROI()` calculation — this was a recent consistency fix, worth specifically re-verifying).

## 10. Customer Journey smoke test

1. Complete one full booking (reservation checkout, or an accepted event proposal).
2. **Thank You** — manually trigger `/api/cron/stay-lifecycle` the day after checkout → confirm a thank-you WhatsApp send + Timeline entry.
3. **Review Request** — trigger the same cron 3 days after checkout → confirm review-request send + `review_requests` row.
4. **Review** — manually mark the review completed via whatever review-capture path exists (check `/reviews`) → confirm it logs `review_completed`.
5. **Referral** — trigger `/api/cron/marketing-automations` for a lead past the repeat-booking/referral cooldown → confirm a referral invite with a real code.
6. **Loyalty** — confirm a "points awarded" message arrived after checkout, and `/customers/[id]` shows an updated points balance/tier.
7. **Repeat Customer** — create a second booking for the same lead → confirm the lead is flagged as a repeat customer in segments/analytics (`bookingCountByLead` logic).

## 11. Marketing Dashboard verification

At `/dashboard/marketing`, confirm each of the following renders non-zero/plausible data after the smoke tests above: Revenue, ROI (Campaign Performance section), Campaign (bookings/revenue per campaign), Business Package performance, Social Platform metrics (per-platform), Social Post metrics (per-post), Cost Per Lead / Cost Per Booking (requires ad spend entered manually — see Customer Acquisition note above, there is no automatic Meta/Google Ads spend ingestion), Referral Revenue, Loyalty Revenue (by tier).

---

## 12. Final production validation checklist (100 items)

**Environment (1-15)**
1. `NEXT_PUBLIC_SUPABASE_URL` set in Vercel Production
2. `NEXT_PUBLIC_SUPABASE_ANON_KEY` set
3. `SUPABASE_SERVICE_ROLE_KEY` set (server-only, never exposed client-side)
4. `NEXT_PUBLIC_APP_URL` set to the real production domain
5. `ANTHROPIC_API_KEY` set and has spend budget/limit configured
6. `CRON_SECRET` set (confirm all 10 cron routes reject requests without it)
7. `WHATSAPP_ACCESS_TOKEN` set (permanent system-user token, not temporary)
8. `WHATSAPP_PHONE_NUMBER_ID` set
9. `WHATSAPP_WEBHOOK_VERIFY_TOKEN` set
10. `WHATSAPP_APP_SECRET` set (confirm webhook logs no longer show "not set" warning)
11. `META_APP_ID` / `META_APP_SECRET` set
12. `META_PAGE_ACCESS_TOKEN` set (long-lived, confirmed via Graph API debug tool expiry check)
13. `RESEND_API_KEY` set, `EMAIL_FROM` on a verified domain
14. All env vars present in both Production and Preview (or intentionally Production-only)
15. No secrets committed to the repo (spot-check `.env*` is gitignored)

**Supabase (16-25)**
16. All migrations applied to the production database (`supabase/migrations/*` run in order)
17. RLS policies enabled on customer-facing tables
18. Service-role key rotated from any shared/dev key
19. Database backups/point-in-time-recovery enabled
20. Connection pooling configured for serverless (pgBouncer or Supabase's pooler)
21. `leads.phone` unique constraint confirmed present (dedup depends on it)
22. `reservations`/`proposals` foreign keys intact after migration
23. Storage buckets (if used for media upload) have correct public/private access rules
24. Supabase project region matches Vercel region (`bom1`) for latency
25. Auth users provisioned for all real operators (no shared logins)

**Vercel deployment (26-35)**
26. Production deploy succeeds (`next build` completes with no errors)
27. All 10 cron jobs show in Vercel's Cron Jobs tab post-deploy
28. Function `maxDuration` values match `vercel.json` (no route silently timing out)
29. Region `bom1` confirmed appropriate for your primary user base
30. Custom domain attached and SSL issued
31. Preview deployments don't leak production data (separate Supabase project if possible)
32. Environment variables scoped correctly (Production vs Preview vs Development)
33. No console errors on first production page load
34. Vercel Analytics/logging enabled to catch runtime errors post-launch
35. Rollback plan confirmed (can redeploy previous build in one click)

**Facebook (36-40)**
36. App created, Business verification started/complete
37. OAuth connect flow completes with success banner
38. Long-lived Page Access Token obtained and set
39. Webhook GET-verifies successfully
40. Test post publishes and appears live on the Page

**Instagram (41-44)**
41. IG account confirmed Business/Creator type
42. Linked correctly to the Facebook Page
43. `META_IG_ID` set correctly (distinct from `META_PAGE_ID`)
44. Test image publishes and appears live

**WhatsApp (45-55)**
45. Webhook GET-verifies
46. Test inbound message triggers an AI reply
47. Reply appears in `/inbox` and on customer Timeline
48. Human handoff phrase correctly stops auto-reply
49. Drip cron manually triggered, message sends, enrollment advances
50. Follow-up cron manually triggered, message sends
51. AI-followup-assistant drafts land in `follow_ups`, drained by followups cron
52. Loyalty points-awarded message sends post-checkout
53. Referral invite message includes a valid, unique code
54. Review-request message sends 3 days post-checkout
55. `WHATSAPP_APP_SECRET` confirmed enforcing signature checks (no "unconfigured" warning in logs)

**Google Business (56-60)**
56. API access request approved by Google
57. OAuth connect flow completes
58. `GOOGLE_BUSINESS_ACCESS_TOKEN` and `LOCATION_ID` set correctly
59. Test post publishes live
60. Review reply posts back to the live listing

**LinkedIn (61-64)**
61. Company Page product access approved (or explicitly deferred if not approved in time)
62. OAuth connect flow completes
63. `LINKEDIN_ACCESS_TOKEN` / `ORGANIZATION_URN` set
64. Test post publishes to the Company Page

**Email (65-68)**
65. Domain verified in Resend (SPF/DKIM green)
66. Test invoice email delivers and isn't flagged spam
67. Payment reminder email delivers
68. Confirmed inbox-reply-to-email is NOT expected to work this cycle (known gap)

**Campaigns / Acquisition (69-78)**
69. Campaign created and sent
70. `message_queue` rows created with `campaign_id`
71. Campaign-queue cron drains them
72. Landing page click creates a lead via `/api/campaigns/track`
73. Lead has correct `campaign`/`utm_*` attribution fields populated
74. Duplicate landing-page visits by the same person don't explode lead count unexpectedly (known soft gap — verify volume is acceptable)
75. Lead converts through Kanban stages without illegal jumps
76. Proposal created from lead
77. Proposal accepted → Reservation or Event created
78. Campaign/Dashboard numbers match (Campaigns page vs Marketing Dashboard)

**Customer Journey (79-85)**
79. Thank-you message sends post-checkout
80. Review request sends 3 days later
81. Review reminder sends if no review after 7 days
82. Loyalty points awarded and visible on customer profile
83. Referral invite sends and code is redeemable
84. Repeat booking correctly flags the lead as repeat customer
85. No duplicate/overlapping automated messages received same-day (orchestrator cooldown working)

**Omnichannel (86-92)**
86. WhatsApp, website chat, and social DM all appear in one Unified Inbox
87. Conversation assignment (PATCH) works and requires login
88. Facebook/Instagram DM messages appear on the Unified Inbox
89. Confirmed: Facebook/Instagram DM messages do NOT currently appear on the Customer Timeline (known gap) — verify this is acceptable for launch or track as a fast-follow
90. Website chat capture creates/attaches to the correct lead
91. No duplicate conversations created for the same customer across channels during testing
92. Email reply-from-inbox confirmed to no-op (expected, not a bug to chase this week)

**Operations & AI (93-100)**
93. Reservation check-in/check-out updates status correctly
94. Concurrent status-update race tested if double-staffing is realistic for your ops (two people can't both check out the same guest cleanly today — see audit note)
95. Calendar (`/reservations/calendar`) reflects live reservation data
96. Site visit → proposal conversion doesn't create duplicates on rapid double-submit
97. Opportunity Score visible on lead/customer pages
98. AI Reply pipeline confirmed to be the legacy `chatWithAI` path (orchestration flag is off by default) — acceptable for launch
99. Content Generator produces usable captions/copy in Content Studio
100. Chief-of-Staff notifications only fire when someone opens that dashboard (no cron trigger exists) — decide if that's acceptable or needs a manual daily check-in habit

---

*This checklist reflects the codebase as of this audit. No files were modified to produce it.*
