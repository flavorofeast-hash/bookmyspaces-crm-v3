# SECURITY_BACKLOG.md

Created: 2026-07-29, at the start of Implementation Mode Sprint 1. Per the user's explicit Sprint 1 scope decision: these items are tracked here, not fixed here. None of them blocked Sprint 1 (Availability & Escalation) — the affected routes/features are independent of everything Sprint 1 touched.

This document does not duplicate `RELEASE_BLOCKERS.md` — it cross-references it and adds one item that document doesn't track as a discrete, actionable line.

## 1. Missing `WHATSAPP_APP_SECRET`

Tracked as CRITICAL in `RELEASE_BLOCKERS.md`. Confirmed absent from both `.env.local` and a real `vercel env pull --environment=production` snapshot (see `GO_LIVE_STATUS.md`, Environment Variables). Effect: the WhatsApp webhook's signature check fails open — it accepts unsigned/forged requests instead of rejecting them. Fix: obtain the App Secret from Meta's Business/App dashboard and set it in Vercel production env. No code change needed; the verification code already reads this variable and already fails open by explicit, documented design when it's unset (matches this project's established "never silently claim security that isn't configured" convention).

## 2. Missing `CRON_SECRET`

Tracked as CRITICAL in `RELEASE_BLOCKERS.md`. Present in `.env.local`, confirmed absent from the production snapshot. Effect: all 4 cron routes (`campaign-queue`, `escalations`, `followups`, `stay-lifecycle`) — including the escalation-rescan cron this sprint's work sits next to — execute with zero authentication in production; anyone who finds the route URL can trigger them. Fix: generate a real secret and set it in Vercel production env. No code change needed; every cron route already guards on this variable when present (confirmed directly in `src/app/api/cron/escalations/route.ts` while investigating the existing escalation system this sprint).

## 3. No `.git` directory in this working copy

New item — not previously tracked as a discrete backlog line, only mentioned in a session addendum (`audit/CURRENT_STATUS.md`, 2026-07-12 addendum) and reconfirmed in `GO_LIVE_STATUS.md`'s GitHub section (both marked **FAIL**). Independently reconfirmed again this session (`ls -la .git` → no such directory). Effect: every change made in every AI-sandbox session on this working copy — including this sprint's — has no version-control safety net. There is no way to diff against a known-good baseline, no way to revert a bad change, and no branch/PR review step. Fix: from a machine with real access to the actual GitHub remote, confirm which commit this working copy's file contents currently correspond to (if any), reconcile any drift, and re-establish this folder as a proper git working copy (`git init` + set remote + reconcile, or re-clone and re-apply the sandbox-made changes as a real commit/PR). This is a repository-hygiene action only Raju can take — no sandbox has push credentials or, in most sessions including this one, any git binary state to rebuild from.

## Explicitly out of scope for Sprint 1

Per the user's Sprint 1 directive: none of the above blocks Availability & Escalation work unless it directly prevents development, and none of them did. They remain open for a future, dedicated security-hardening pass.
