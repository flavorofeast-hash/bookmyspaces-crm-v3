# docs/releases/ — Release Records

Part of the permanent Engineering OS (see `docs/engineering/`). This directory holds one file per release/deployment, named `YYYY-MM-DD_vX.Y.Z.md` or `YYYY-MM-DD_release-candidate-N.md`, in chronological order. It records what actually shipped to a real environment — distinct from `docs/sprints/` (which records development-session activity that may never have been deployed) and from the MASTER docs (which describe current standing state, not a point-in-time event).

## Why this exists

This project's existing `RELEASE_REPORT.md` and `RELEASE_REPORT_GLP.md` already demonstrate the right shape for this kind of document — including the discipline of one report explicitly superseding another's verdict while preserving its analysis, rather than silently overwriting history. This directory generalizes that pattern into a standing convention instead of a one-off pair of files at the repo root, so every future release gets the same rigor by default.

## Template for a new release record

```markdown
# Release — YYYY-MM-DD (vX.Y.Z or "RC-N")

**Supersedes**: [prior release file], if this release changes a prior verdict — state what changed and why, don't just overwrite.

## What shipped
Specific, verifiable changes. Cross-reference the sprint record(s) (`docs/sprints/`) this release packages.

## Verification performed
Build/typecheck/lint/test status (green or not — state plainly). Live-database verification performed, if any (per MASTER_DATABASE.md's standing caution about presumed-vs-confirmed state). Anything NOT verified should be stated as such, not left silent.

## Known issues at release time
Carried-forward or newly-found issues that are known but not blocking this release — cross-reference `docs/engineering/MASTER_BACKLOG.md`/`docs/growth/21_BACKLOG.md` ticket IDs where applicable.

## Risk assessment
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|

## Rollback plan
How to revert this release if it causes a production issue — reference the paired `_ROLLBACK.sql` for any migration included, and the deployment mechanism's own rollback capability (e.g., Vercel's previous-deployment promotion).
```

## Rules

- A release record is written at the time of release, describing what is actually being deployed — not aspirationally, and not backfilled from memory later.
- If a later release record's findings contradict an earlier one (e.g., "migration X was believed live but wasn't"), say so explicitly in the new record and update the relevant `MASTER_*` file — the same non-silent-overwrite discipline `RELEASE_REPORT_GLP.md` already modeled for this project.
- Every release record should state plainly whether `npm run build`, `tsc --noEmit`, `npm run lint`, and `vitest run` were all confirmed green **in an environment with real execution guarantees** — this project's history includes multiple sessions where that could not be confirmed in a sandboxed environment; don't let that ambiguity carry into a release record silently.
