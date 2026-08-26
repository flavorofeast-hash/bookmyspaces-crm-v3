# Social & Google Business Profile Integrations

Operational reference for WhatsApp, Instagram, Facebook Messenger, and Google Business Profile. Kept concise and current — see inline code comments for full rationale.

## 1. Architecture

```
Customer message (any channel)
  -> channel webhook (verifies signature)
  -> channel-specific parser (extracts sender/recipient/text)
  -> social-account-routing.ts: resolveConnectedAccount() / findConnectedSocialAccount()
  -> unified-conversation-service.ts: getOrCreateConversation() + recordMessage()
  -> social-ai-reply.ts: triggerSocialAIReply() (Instagram + Facebook)
     OR inline in the WhatsApp webhook route (same AI functions, different composition)
  -> chatWithAI() / cleanAIResponse() / evaluateHandoff() / formatMessage()  <- ONE AI layer, channel-blind
  -> outbound-dispatcher.ts: dispatchOutbound()
  -> channel-specific send function (sendWhatsAppText / sendInstagramMessage / sendFacebookMessage)
  -> customer
```

One AI brain, one Unified Conversation Platform (`unified_conversations` / `unified_messages` / `unified_conversation_channels` / `channels`). No per-channel AI logic exists or should be added.

## 2. Environment variables (names only)

| Variable | Used by |
|---|---|
| `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET` | WhatsApp |
| `META_APP_ID`, `META_APP_SECRET`, `META_VERIFY_TOKEN` | Meta webhook (Facebook + Instagram signature/verification) |
| `META_IG_LOGIN_APP_ID`, `META_IG_LOGIN_APP_SECRET` | Instagram native-login OAuth + webhook signing |
| `META_PAGE_ID`, `META_PAGE_ACCESS_TOKEN` | Facebook Messenger send (single-Page global-credential model), and classic Facebook publishing |
| `SOCIAL_TOKEN_ENCRYPTION_KEY` | Encrypts Instagram OAuth tokens (`social_accounts`) and GBP OAuth tokens (`settings`) |
| `SOCIAL_OAUTH_STATE_SECRET` | Signs stateless OAuth CSRF state for Instagram native login and GBP |
| `GOOGLE_GBP_CLIENT_ID`, `GOOGLE_GBP_CLIENT_SECRET`, `GOOGLE_GBP_REDIRECT_URI` | Google Business Profile OAuth |
| `CRON_SECRET` | Authenticates scheduled/automated calls (e.g. `/api/google/gbp/sync-locations`) without a staff session |

## 3. Facebook Messenger setup

1. Meta App Dashboard → connect the intended Facebook Page → add the Messenger use case.
2. Request/confirm the `pages_messaging` permission (App Review).
3. Messenger → Settings → generate a Page Access Token for that Page → store as `META_PAGE_ACCESS_TOKEN`.
4. Store the Page's numeric ID as `META_PAGE_ID`.
5. Subscribe the Page's webhook to the `messages` field, callback URL below.
6. No Facebook Page OAuth exists in this codebase by design — this phase uses the same single-Page global-credential model as WhatsApp, not a multi-tenant OAuth connect flow.

## 4. Instagram setup

Already live in production. Native Instagram Login OAuth (`/api/social/oauth/instagram-native/start` → `/callback`), per-account encrypted token in `social_accounts`, webhook signed with `META_IG_LOGIN_APP_SECRET`. See `src/lib/social/oauth/instagram-native-config.ts` for the full flow.

## 5. Google Business Profile setup

1. `/api/google/gbp/connect` (admin/manager session) → Google consent screen → `/api/google/gbp/callback` exchanges the code, discovers accounts/locations, stores everything encrypted in `settings` (category `integration`, key `google_gbp_oauth`).
2. If `locations` comes back empty after connecting: either the connected Google account has no Business Profile, or the Business Information API isn't enabled in Google Cloud Console for this OAuth client — both require checking directly in Google's dashboards, not something the API response alone disambiguates further than what's already logged.
3. `GET /api/google/gbp/sync-locations` re-runs discovery using a guaranteed-fresh access token (auto-refreshes via the stored refresh token) — use this instead of disconnecting/reconnecting when locations look stale or empty.

## 6. Webhook endpoints

- WhatsApp: `POST /api/whatsapp/webhook`
- Facebook + Instagram (shared, platform-parameterized): `POST /api/social/webhook/[platform]` (`platform` = `facebook` or `instagram`)
- Google Business Profile has no inbound webhook in this integration (pull-based via `sync-locations`, not push).

## 7. OAuth redirect URLs

- Instagram native login: `https://crm.bookmyspaces.in/api/social/oauth/instagram-native/callback`
- Google Business Profile: value of `GOOGLE_GBP_REDIRECT_URI` (must exactly match what's registered in Google Cloud Console)
- Facebook: none in this phase (no Facebook Page OAuth built)

## 8. Required Meta permissions

- WhatsApp: Cloud API access (existing)
- Instagram: `instagram_business_basic`, `instagram_business_manage_messages`
- Facebook Messenger: `pages_messaging`

## 9. Required Google scopes

- `https://www.googleapis.com/auth/business.manage`

## 10. Database changes this pass

None. Everything reuses existing tables (`channels`, `unified_conversations`, `unified_conversation_channels`, `unified_messages`, `social_accounts`, `settings`). Facebook Messenger's single-Page model deliberately does not create a `social_accounts` row — see `social-account-routing.ts`'s `resolveConnectedAccount()`.

## 11. Deployment

Standard flow for this repo: `npm run build && npx vitest run` locally, then `git push origin main` — Vercel auto-deploys from `main`. Always verify the resulting production deployment's `gitSource.sha` matches the pushed commit before considering a change live (a broken intermediate build fails and is never served, but confirm anyway).

## 12. Remaining manual actions

- Facebook: confirm `pages_messaging` App Review outcome; confirm the exact Page to connect; generate and store a fresh `META_PAGE_ID`/`META_PAGE_ACCESS_TOKEN`; confirm the `messages` webhook subscription is active for that Page.
- Google: diagnose why `locations` is empty for the already-connected account (Business Profile existence / API enablement — Google Cloud Console + business.google.com, not fixable from this codebase alone); after resolving, call `/api/google/gbp/sync-locations` once to confirm real locations populate.

## 13. Testing procedure

`npx vitest run` (full suite), `npx tsc --noEmit`, `npm run lint`, `npm run build`. For a live channel: send a real inbound message, confirm an inbound `unified_messages` row, confirm an outbound row with `sender_type: 'ai'`, confirm the customer actually receives the reply on that channel.

## 14. Troubleshooting

- **Webhook signature always fails**: confirm which secret the channel actually signs with — Instagram native login uses `META_IG_LOGIN_APP_SECRET`, not `META_APP_SECRET` (a real, previously-diagnosed gap in this project).
- **`vercel env pull` / `vercel env ls` looks wrong**: known CLI reliability issue observed multiple times this project — cross-check via a live runtime probe before trusting a CLI-reported env value, especially right after an edit.
- **AI reply recorded but not delivered**: check `dispatchOutbound()`'s `detail` field in logs — it's channel-specific (missing Page config, expired/invalid token, Graph API error) and never silently swallowed.

## 15. Current integration status

- WhatsApp: **READY** (production, untouched this pass)
- Instagram: **READY** (production, proven end-to-end with a real customer reply)
- Facebook Messenger: **CODE READY, BLOCKED EXTERNALLY** (App Review pending, real Page ID/token not yet supplied)
- Google Business Profile: **PARTIAL** (OAuth + token refresh + re-sync working; zero locations discovered — needs Google-side diagnosis)
