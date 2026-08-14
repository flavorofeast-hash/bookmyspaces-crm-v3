# WhatsApp Go-Live Checklist

For when Meta lifts the "Verification code limit exceeded" block. Everything
below was inspected/hardened in this pass — once the env vars are set
correctly in Vercel, no further code changes should be needed.

## 1. Set these environment variables in Vercel (Project → Settings → Environment Variables)

Required for the app to boot at all (unrelated to WhatsApp, listed for
completeness — `src/instrumentation.ts` calls `assertEnv()` at server start
and the app will refuse to serve any request if these are missing):
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ANTHROPIC_API_KEY`

Required for WhatsApp send/receive specifically (checked by
`isMetaConfigured()`, `src/lib/whatsapp/meta-configured.ts` — without these,
sends are skipped in "mock mode" and no error is thrown, so a missing var
here fails silently unless you check logs):
- `WHATSAPP_ACCESS_TOKEN` — Meta Cloud API access token (System User token, not a temporary one — temporary tokens expire in 24h).
- `WHATSAPP_PHONE_NUMBER_ID` — the numeric Phone Number ID (not the display phone number) from Meta Business Manager → WhatsApp → API Setup.

Required for webhook verification (`GET /api/whatsapp/webhook`, Meta's
subscription handshake):
- `WHATSAPP_WEBHOOK_VERIFY_TOKEN` — any secret string you choose; must be entered identically in the Meta App dashboard's webhook subscription screen. (`WHATSAPP_VERIFY_TOKEN` is now also accepted as a fallback name if that's what's set — but `WHATSAPP_WEBHOOK_VERIFY_TOKEN` is the primary, documented name; use it going forward.)

Strongly recommended, not hard-required (`POST /api/whatsapp/webhook`
accepts unsigned requests with a logged warning if unset — see
`src/lib/whatsapp/verify-signature.ts`):
- `WHATSAPP_APP_SECRET` — Meta App dashboard → Settings → Basic → App Secret. Enables `X-Hub-Signature-256` verification, rejecting forged webhook traffic.

## 2. Configure the webhook in the Meta App dashboard

- Callback URL: `https://<your-production-domain>/api/whatsapp/webhook`
- Verify token: exactly the value you set for `WHATSAPP_WEBHOOK_VERIFY_TOKEN`
- Subscribe to the `messages` field on the WhatsApp product
- Click "Verify and Save" — this triggers `GET /api/whatsapp/webhook`. As of this pass, both success and every failure mode (missing env var, mode mismatch, token mismatch, missing challenge) now log a clear line tagged `[BMS:whatsapp-webhook]` — check Vercel's function logs immediately if verification fails.

## 3. What was inspected and confirmed already correct (no change needed)

- **Outbound sends use the real Phone Number ID from env, everywhere**: `src/lib/whatsapp/send-message.ts`'s `callWhatsAppAPI()` reads `process.env.WHATSAPP_PHONE_NUMBER_ID`/`WHATSAPP_ACCESS_TOKEN` directly — this is the single call site every send path (`sendWhatsAppText`, `sendWhatsAppTemplate`, `sendBroadcastCampaign`, `smartSend`/`src/lib/queue.ts`, `/api/whatsapp/send`) funnels through. No hardcoded phone number ID or test number found anywhere in production code (only in `*.test.ts` fixtures, which is correct and expected).
- **Inbound message processing**: `POST /api/whatsapp/webhook` parses Meta's payload, handles both `messages` and `statuses` webhook events, and replies via the existing auto-responder/AI pipeline (`runLegacyReplyPath`, active by default; an opt-in orchestration pipeline exists behind `settings.orchestration.enabled`, default off, with automatic fallback to the legacy path on any internal error). Both outbound sends and inbound writes already retry/log correctly (retry-with-backoff on send failures was added earlier this pass — see commit history).
- **Vercel deployment config**: `vercel.json` doesn't need a WhatsApp-specific entry — the route already declares `export const runtime = 'nodejs'` (required: signature verification uses Node's `crypto.timingSafeEqual`, not available on Edge) and `export const maxDuration = 30`, which Next.js honors directly as App Router route segment config.
- **Startup validation**: `src/lib/env.ts`'s `assertEnv()` runs once at boot (wired via `src/instrumentation.ts`) and logs which WhatsApp env vars are missing, grouped under "WhatsApp (Meta Cloud API)" — check Vercel's build/runtime logs after deploy for a `[env]` line confirming everything is set.

## 4. What was changed in this pass

- `src/app/api/whatsapp/webhook/route.ts`: `WHATSAPP_VERIFY_TOKEN` accepted as a fallback alias for `WHATSAPP_WEBHOOK_VERIFY_TOKEN` in the GET handshake (purely additive — no behavior change if the primary name is set). Added logging for every verification outcome (success, missing env var, mode/token mismatch, missing challenge) and a receipt-level log line on every POST (entry/message/status counts) so webhook delivery is confirmable from logs alone, before any downstream side effect.
- `.env.example`: clarified the verify-token alias; removed a stale reference to `src/lib/transcription.ts` (deleted earlier in this session's dead-code cleanup).

## 5. Quick post-verification smoke test

1. Send a WhatsApp message to the business number from a personal phone.
2. Check Vercel logs for `[BMS:whatsapp-webhook] Webhook payload received` followed by the message being processed and a reply send.
3. Confirm the reply arrives on the personal phone.
4. Check the CRM's Inbox/Leads for the new conversation/lead.
