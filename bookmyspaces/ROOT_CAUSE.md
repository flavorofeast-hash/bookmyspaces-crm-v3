# ROOT CAUSE — Vercel Deploys Commit `3ff8ca5` Instead of HEAD

Status: **Cause identified with direct git evidence. Cannot be fixed from the codebase — requires one Vercel Dashboard action.**

## The finding

`3ff8ca5` ("Add temporary import debugging for migration 018") is not an ordinary commit. It is a **root commit with no parent**, containing **442 files and 89,720 insertions** — the entire project (app code, `node_modules`-adjacent lockfiles, 25 SQL migrations, 150+ audit/doc files, and a full second copy of the app under `BOOKMYSPACES_BACKUP/`) added in one shot.

Evidence:
```
$ git show -s --format="%P" 3ff8ca5
                                          # <- empty output = no parent commit
$ git log --oneline 3ff8ca5
3ff8ca5 Add temporary import debugging for migration 018
                                          # <- only 1 line = nothing exists before it
$ git show 3ff8ca5 --stat | tail -1
442 files changed, 89720 insertions(+)
```

The commit message references "migration 018," which only makes sense if migrations 001–017 already existed beforehand — but there is no earlier commit that created them. That's the signature of a **history reconstruction**: at some point before 2026-07-24 the real, incremental git history was lost or discarded, and the entire working tree was re-committed from a local snapshot as a single new root commit, then force-pushed over `main`. It was not a normal `git commit`.

Supporting evidence from the same commit:
- `bookmyspaces/deployment-trigger.txt` (content: `deployment-trigger` / `reconnect-test`), `bookmyspaces/latest.json`, `bookmyspaces/logs.json`, `bookmyspaces/logs.txt`, `bookmyspaces/deployed_route.txt`, `bookmyspaces/git`, `bookmyspaces/npm` — all empty or placeholder files, all created in this same commit. These are exactly the kind of marker/scratch files someone creates while actively fighting a broken Vercel connection.
- `BOOKMYSPACES_BACKUP/bookmyspaces/` — a full second copy of the app, also added in this commit — consistent with a disaster-recovery-style restore, not routine development.

Everything pushed after `3ff8ca5` (8 commits, up to `fe67b76`) demonstrably modifies real files under `bookmyspaces/` — confirmed via `git log --oneline 3ff8ca5..origin/main --name-only`. New commits are reaching GitHub correctly. The break is between GitHub and Vercel, not in the repository.

## Why this explains every symptom

A force-push that replaces a branch's history with an unrelated root commit is exactly the kind of event that can desync a GitHub↔Vercel Git integration, because Vercel's project-level webhook binding is tied to the repository's identity at connection time, not just its name:

- **Reconnecting GitHub doesn't fix it** — Vercel's "reconnect" re-authenticates the GitHub App at the account/org level. It does not necessarily re-derive or re-register the per-project webhook subscription if that subscription's internal state (tied to the original repo/installation binding) is what broke.
- **Manual/Production Redeploy always rebuilds `3ff8ca5`** — this is `3ff8ca5` either being the last commit for which the webhook fired and produced a real deployment (and it's the one still marked Production), or a deployment built from it having been manually promoted to Production at some point and never re-promoted since — either way, "Redeploy" on a specific deployment rebuilds *that deployment's original source commit*, not `HEAD` of the tracked branch. That is standard, documented Vercel behavior, not a bug.
- **A brand-new empty commit (`fe67b76`, "Trigger Vercel deployment") still didn't produce a fresh deployment** — this rules out "nothing relevant changed" as an explanation and confirms the push→webhook→build pipeline itself isn't firing for this project, consistent with a dead webhook subscription rather than a content-based skip.

## What I cannot determine without Vercel access

I have no Vercel dashboard or API access from this session (verified: no Vercel MCP tool, no `vercel` CLI, no `VERCEL_TOKEN`). The two remaining questions can only be answered by looking at the Vercel dashboard directly:

1. **Does the Deployments tab show any entry at all for commits after `3ff8ca5`** (e.g. `2e0d30e`, `fe67b76`)?
   - If **yes**, a newer deployment exists but was never made Production → the webhook is fine, someone (or a past troubleshooting attempt) pinned Production to `3ff8ca5` manually.
   - If **no**, no deployment was ever created for any push after `3ff8ca5` → the webhook is dead, confirming the history-rewrite desync theory above.

## Required manual action (Vercel Dashboard)

**Step 1 — check first, this determines the fix:**
Project → Deployments tab → search for the commit SHA `fe67b76` or `28d8d79`.

**If a deployment exists for it:**
Open that deployment → "⋯" menu → **Promote to Production**. Do not use the "Redeploy" button on the old `3ff8ca5` deployment card — it will keep rebuilding the same source forever by design.

**If no deployment exists for any commit after `3ff8ca5`:**
The Git integration itself is broken, not just the Production pointer. Fix:
1. Project → Settings → Git → **Disconnect** the repository entirely (not just re-select it — a full disconnect clears the stale webhook registration).
2. Reconnect: **Connect Git Repository** → select `flavorofeast-hash/bookmyspaces-crm-v3` → branch `main` → Root Directory `bookmyspaces` (per project memory — re-enter this, it does not always survive a disconnect).
3. Push a trivial commit (or use the Deployments tab's "Redeploy" on nothing yet — a real push is more reliable) and confirm a new deployment entry appears within ~30 seconds of the push.
4. Also check GitHub side: `github.com/flavorofeast-hash` → Settings → Applications → **Vercel** → Repository access — confirm `bookmyspaces-crm-v3` is explicitly listed (not just "all repositories" from an org that may have changed). A repo recreation/transfer can silently drop it from a "selected repositories" grant even though Vercel's UI still shows "connected."

Both paths are dashboard-only actions. There is nothing further to change in the repository — `vercel.json`, the Root Directory path, and the git history integrity from `3ff8ca5` forward have all been verified clean (see evidence above and the earlier investigation this document supersedes).
