# Phase 4: Auto-retry of failed attempts

Plan: `04-plan-full-auto-mode.md` (Phase 4). Commit `9081627` on top of Phase 3 (`c02b3e9`).

## What shipped

- `launch.ts`: `autoRetryFailedAttempt(bb, db, mirror, bindings, taskId, prefs)` after `resolveLaunchAttempt`. Guards on the task row (`e2eMode`, not archived), finds the newest `failed` attempt with `retryMarker === null` from `listLaunchAttempts` (newest-first), blocks when `retryChainDepth` of that attempt reaches `prefs.maxRetries`, then retries it through `resolveLaunchAttempt(..., { type: "retry" }, { e2ePermissionMode: prefs.permissionMode })` so a retried e2e hop keeps the permission override. Errors from the retry are logged and swallowed (`return null`), which lets the caller's recovery notification fire.
- Applied the ordering correction from Phase 3: `listLaunchAttempts` returns newest-first while `retryChainDepth` is specified against oldest-first input, so `autoRetryFailedAttempt` reverses once at the call site (same pattern the Phase 3 gate uses for `e2eGuardState`).
- `server.ts` `notifyAdvanceFailed`: retry runs before the recovery notification; a truthy retry result returns early so the suppression row for the source turn stays unconsumed and no `ready_after_failed_advance` fires for a hop that continued on its own.
- `server.ts` sweep service: after `dismissStaleUncertainAttempts` publishes, each affected task is auto-retried; when nothing is retried and the task has `e2e_mode`, the newest failed attempt's source session (still in the mirror, with `from_thread_id`) gets `notifyAdvanceFailed`. Wrapped in try/catch with `bb.log.warn` so one failing task never kills the sweep loop.
- `tests/advance.test.ts`: "full auto retries a failed pre-spawn attempt once and leaves the suppression row for the continued hop" (fakeBb `projectGetFailures` option, pre-spawn failure via environment selection, retry spawns, suppression row unconsumed); "full auto stops retrying at maxRetries"; "auto retry ignores tasks without full auto".
- `tests/server.test.ts`: "advance failure on a full-auto task retries before notifying", driven through the real runtime via `emitThreadEvent("thread.idle", ...)`; scenario 1 asserts the retry row, the kept bypass permission on the retried spawn, and zero `ready_after_failed_advance` rows; scenario 2 (maxRetries 0) asserts exactly one recovery notification and no retry row.

## How it was verified

- `npm test -- tests/advance.test.ts tests/launch.test.ts tests/server.test.ts`: 83 pass, 0 fail (pretest `tsc --noEmit` clean).
- `npm test`: 355 pass, 0 fail, ~3.1s.
- `bb plugin build`: clean.

## Deviations

- The plan's "full auto stops retrying at maxRetries" test said "three chained failed attempts" with `maxRetries: 3` returning null. Under the depth semantics Phase 2 pinned (a chain a1 <- a2 <- a3 has depth 2), that would still retry. The test seeds four attempts with three `retried_from` links (depth 3), which is what makes `maxRetries: 3` block and `maxRetries: 4` retry. Consistent with the Phase 2 e2e tests and the design intent (maxRetries counts automatic retries).
- The plan's server test said "with a spawn that throws once". A spawn throw leaves the attempt `uncertain`, which `autoRetryFailedAttempt` intentionally does not retry (only `failed` rows), so the recovery notification would fire and the zero-notification assertion could never hold. The test instead uses the pre-spawn failure path (environment selection throws once), matching the advance test. One extra fixture step: the `launchSkill` launch stores `tasks.base_environment_id`, which makes the later hop reuse the environment and skip the pre-spawn path entirely, so the test clears that column before the idle event.
- The plan's advance test said to assert `recoverReadyAfterFailedAdvance` wiring order in `tests/server.test.ts`; done via the server test's notification counts rather than in `tests/advance.test.ts`.
- The server test drives the runtime through the testing harness's `emitThreadEvent` (present in the testing runtime, missing from the bundled types; a typed cast bridges it). Sessions are bound by launching through the plugin itself (`launchSkill` RPC) rather than hand-inserting rows, so the idle pipeline runs exactly as in production.

## Open items for the reviewer checklist

- Confirm the wiring order in `notifyAdvanceFailed` (retry before recovery) and that a successful retry leaves the suppression row unconsumed by design.
- Confirm the sweep recovery limitation from the plan's Known limits: only failed attempts whose source session is still mirrored (has `from_thread_id`) notify; a draft launch failure shows only the failed row with Retry.
- Confirm `autoRetryFailedAttempt` deliberately ignores `uncertain` rows (spawn-throw outcomes stay user-facing until the sweep marks them failed).
- Phase 3's per-phase doc (`docs/phases/28-full-auto-phase3-*.md`) is absent; only phase1 and phase2 docs exist.
