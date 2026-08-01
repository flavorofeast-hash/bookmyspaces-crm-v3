# docs/sprints/ — Sprint Records

Part of the permanent Engineering OS (see `docs/engineering/`). This directory holds one file per sprint/work session, named `YYYY-MM-DD_short-slug.md` (e.g. `2026-08-15_unified-inbox-cutover.md`), in chronological order. It is the durable, dated record of *what actually happened*, distinct from the MASTER docs (which describe current, standing state) and from `docs/releases/` (which records what shipped to production, potentially spanning multiple sprints).

## Why this exists

This project's own history (see `RELEASE_REPORT.md`, the `audit/` trail) shows real value in dated, specific session records — they're what let a later session (or a later engineer) catch drift between "presumed done" and "actually done" (exactly how the `packages` schema drift and the reservation-pricing bug were both found: someone checked a specific, dated claim against current reality). Sprint records are that same discipline, applied going forward, in one predictable location instead of scattered root-level files.

## Template for a new sprint record

```markdown
# [Sprint name] — YYYY-MM-DD

## Scope
What this sprint set out to do, and why (link the MASTER doc or growth-platform module doc this work implements).

## What shipped
Concrete, specific changes — files touched, features completed. Distinguish "built" from "verified live" per MASTER_DATABASE.md's standing caution.

## What was verified vs. assumed
Explicitly separate what was directly confirmed (tests run, live queries executed, screenshots taken) from what was assumed or carried forward from a prior document. Record assumptions, don't let them silently become claims of fact.

## Issues found
Any bugs, drift, or gaps discovered — assign an ID (BUG-xxx per this project's convention) and cross-reference MASTER_BACKLOG.md or docs/growth/21_BACKLOG.md if the finding belongs there.

## Remaining / follow-up
What's explicitly left for a future sprint, with enough context that someone else could pick it up cold.
```

## Rules

- Every sprint record is append-only history — never edit a past sprint's record to reflect later reality. If later work invalidates an earlier claim, note that in the *new* sprint's record and update the relevant MASTER doc; the old record stays as an honest historical artifact.
- A sprint record is not a substitute for updating `MASTER_ROADMAP.md`/`MASTER_BACKLOG.md`/the relevant `MASTER_*` file — it's the raw log; the MASTER docs are the maintained, current-state summary. Update both.
