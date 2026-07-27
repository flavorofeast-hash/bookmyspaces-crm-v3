# PRODUCTION_BUILD_VALIDATION.md — Go-Live Prep, Phase 4

Date: 2026-07-27. Every command below was actually run this session, fresh — none of this is copy-forwarded from the RC pass's build report. Full commands, exit codes, and timings included so the results are checkable, not just asserted.

## TypeScript (`tsc --noEmit`)

```
$ time timeout 42 npx tsc --noEmit
(no output)
real 0m42.0s   user 0.6s   sys 0.1s
exit: 124 (timeout)
```

Hung for the full 42s budget with near-zero CPU consumed (0.6s user time over 42 wall-clock seconds) — the exact signature documented across every prior session on this project. Retried after removing the stale `tsconfig.tsbuildinfo` (383KB, dated 2026-07-19) in case incremental-cache I/O was the cause: identical hang, identical near-zero-CPU signature. **This rules out stale build cache as the cause**, narrowing it further than any prior session had.

**Positive control, run immediately after to confirm the tool isn't universally broken:**

```
$ time timeout 40 npx tsc --noEmit -p <scoped-config: next-env.d.ts + src/lib/rate-limit.ts>
real 0m21.5s   user 6.4s   sys 0.9s
exit: 0, zero errors
```

Real CPU time consumed (6.4s), completed well under budget, zero type errors. **This confirms `tsc` itself works correctly in this environment — it's specifically large/full-project invocations that stall**, consistent with an I/O or scheduling bottleneck that scales with file count, not a tool failure or a code defect.

**Verdict: NOT VERIFIED at full-project scope in this sandbox.** Scoped checks (this session and the prior RC pass, dozens of files across both) have never found a real type error. Full-repo `tsc --noEmit` needs to run on real hardware/CI before this is a genuine PASS.

## Build (`next build`)

Not re-attempted this session as a bare `npm run build` — `next build` invokes `tsc` internally as one of its steps, and since bare `tsc --noEmit` already reproduced the hang above, running the full build would very likely hang identically (this matches every prior session's direct experience running `next build` itself, not just an inference). Re-running it would consume the remaining time budget without new information. **Verdict: NOT VERIFIED, same root cause as TypeScript above.**

## Lint (`next lint`)

```
$ timeout 40 npx next lint
(no output)
exit: 124 (timeout)
```

Same hang signature. **Verdict: NOT VERIFIED.**

## Tests (`vitest run`)

```
$ time timeout 40 npx vitest run src/lib/rate-limit.test.ts
 RUN  v1.6.0 /sessions/.../bookmyspaces
(stalls here)
real 0m40.0s   user 1.0s   sys 0.2s
exit: 124 (timeout)
```

Vitest starts, prints its banner, then stalls with the same near-zero-CPU signature — even for a single, small test file. **Verdict: NOT VERIFIED.** The prior RC pass's report of "164-202 passing tests" is a real historical result from whenever it was actually confirmed (a session with a working environment), not something reproduced fresh this session.

## Independent verification actually achieved this session

Since none of the standard tools completed at full scope, the same fallback method the RC pass established was used again, and re-confirmed:

```
$ npx esbuild <202 non-test .ts/.tsx files under src/> --bundle=false --format=esm --jsx=automatic
real 0m2.2s, 0 errors
```

Every `.ts`/`.tsx` file in `src` (excluding test files) parses and transpiles without error — this catches syntax errors, invalid JSX, and import/export shape mismatches across the entire codebase, though it does **not** type-check (esbuild strips types, it doesn't verify them). Combined with the scoped `tsc` batches (this session's and the RC pass's, covering several dozen files with zero errors across both), this is meaningful evidence of code health, but it is explicitly **not equivalent to a real `npm run build` pass** and should not be treated as one.

## Root cause assessment

Unchanged from the RC pass's conclusion, now with one additional data point: this is an environmental I/O or process-scheduling stall specific to this sandbox, not a repository code defect. New evidence this session: ruled out stale `.tsbuildinfo` cache as a contributing factor (removed it, hang persisted identically). The RC pass's evidence (memory/CPU profiling showing ~83MB resident, ~2% CPU during a hang) plus this session's independent reproduction (0.6-1.0s user CPU over 40+ wall-clock seconds, across three different tools — tsc, next lint, vitest, all showing the identical pattern) makes environmental cause the far more likely explanation than a code-level one.

## Action required before go-live

**Get one real, logged, successful run of each of `tsc --noEmit`, `npm run build`, `npm run lint`, and `npm run test` from a machine or CI runner outside this sandbox family.** This is the single most repeated recommendation across every session's build report on this project (RC1 through this one) — and the fact that it keeps being repeated, rather than resolved, is itself worth noting: **treat "the build has never been confirmed to pass" as an open, unverified risk, not a formality**, until that log exists.
