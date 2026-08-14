# RELEASE_DECISION.md — BookMySpaces CRM V3, Night Shift Bundle

Range: `fe67b76` → `a601d97` (12 commits).

## Recommendation: **C — Split into two phases**

**Phase 1 (ship now): 11 of 12 commits.** `120e70a`, `b7537d1`, `6d26611`, `3d5d5a9`, `1a710d1`, `522add0`, `49e41f5`, `0eb4407`, `7640a37`, `ce36270`, `a601d97`.

**Phase 2 (ship once one condition is confirmed): 1 commit.** `94d1ca7` (cron fail-closed).

## Evidence

**Why not A (merge all, unconditionally):**
11 of the 12 commits are Low or Low-Medium risk, independent or safely-paired (`7640a37`+`ce36270`), verified clean (417/417 tests, clean build/lint/typecheck), and each has a clear, narrow, well-understood purpose. There is no reason to hold any of them back.

The 12th, `94d1ca7`, is different in kind: it's the only commit in this range whose safety depends on **external state this review cannot verify** — whether `CRON_SECRET` is currently set in the target Vercel project. If it is set, this commit is a pure security improvement with zero behavioral impact. If it is not set, this commit turns 4 scheduled jobs (follow-ups, escalations, campaign sends, stay-lifecycle messaging) from "running with a known security gap" into "failing every invocation" the moment it deploys — an availability regression, not just a risk on paper. Recommending "merge all" would mean recommending a coin-flip on production cron availability, which is not a recommendation this review can responsibly make without that one fact.

It's also worth noting this exact tradeoff was already considered once before in this codebase: `SECURITY_REVIEW.md` finding #3 explicitly weighed a fail-closed code fix against this same availability risk and chose *not* to make the code change, opting for a deployment-checklist-only mitigation instead, for precisely this reason. `94d1ca7` reverses that earlier, deliberate decision. That's not a reason to reject it — the earlier decision was made without an explicit mechanism to *ensure* the checklist item actually gets done, and "silently fail open forever" is a worse default than "fail loud once, fix the missing env var" — but it is a reason to treat it as a decision requiring the one missing fact, not a same-batch mechanical fix.

**Why not B (merge selected, i.e. drop `94d1ca7` entirely):**
Dropping it outright throws away a real security fix (documented, accepted-as-a-gap-to-close in this same review's own risk section) for a problem that has a cheap, fast resolution path: confirm one environment variable. There's no version of this codebase's stated goals ("production-ready," "prefer fixing over documenting") that's well served by permanently declining a fail-open-to-fail-closed auth fix. This should be *staged*, not abandoned.

**Why C fits:**
It ships everything that's unconditionally safe today, and gates the one commit with a real conditional risk behind the one check that resolves the condition. This is the smallest possible blocked surface — one commit, one fact needed — while not compromising on shipping the fix once that fact is known.

## Phase 1 — go/no-go

**Go**, once the two purely-procedural blockers external to this range are cleared (neither is a merge decision, both are covered in `DEPLOYMENT_PLAN.md`):
1. Commits reach GitHub (this session cannot push — see `NEXT_STEPS.md`).
2. The pre-existing Vercel deployment-pinning issue is resolved (`ROOT_CAUSE.md`) — otherwise nothing in this range reaches production regardless of merge state.

No code-level blocker exists for Phase 1.

## Phase 2 — go/no-go

**Go, as soon as `CRON_SECRET` is confirmed set** in the target Vercel environment (a 30-second dashboard check). If it's already set — plausible, since it's a long-standing documented must-set item — Phase 2 can ship in the same deploy as Phase 1 with no actual delay; this split exists to make that check happen *before* deploy rather than being discovered *by* the deploy.

If `CRON_SECRET` is confirmed **not** set: set it, verify it took effect (a cron route call with a correct bearer token succeeds), *then* ship Phase 2. Do not ship `94d1ca7` before the variable is confirmed live.

## Summary table

| Phase | Commits | Blocker | Risk once unblocked |
|---|---|---|---|
| 1 | 11 (all except `94d1ca7`) | Push access + Vercel pinning fix (both external to code review) | Low |
| 2 | `94d1ca7` only | `CRON_SECRET` confirmed set in Vercel | Low (once confirmed) |

Database migrations `026` and `027` are part of Phase 1's code (files ship with it) but are applied to the live database as a separate manual step regardless of phase, per `DEPLOYMENT_PLAN.md` Step 3 — neither phase's deploy auto-applies them.
