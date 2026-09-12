# Phase 3: Gate term and spawn overrides

Backfilled from the implementer thread report after verification. Phase 3 of
`04-plan-full-auto-mode.md` was implemented by a child thread, verified by the orchestrator
(full suite 351/351 pass at the time), and committed as `c02b3e9`.

## What shipped

- `advance.ts` (3.1): `AdvanceOptions` with an optional `e2e` accessor; `onCompletedTurn`
  forwards it; `advanceSession` takes it as a trailing parameter. The `auto_advance` block is
  now the conjunction `(e2e_mode AND e2eTransition row AND guards clean) OR (master AND flag)`,
  e2e term first. Phase-chain rows read `target_phase` from
  `phaseHandoffForSession`; `implementation + describe-pr` redirects to `review-code`;
  the phase model comes from `phaseModelFor` on the target skill's label; the e2e permission
  mode is forwarded to `launchPhase` as `e2ePermissionMode`.
- `launch.ts` (3.2): `launchPhase` accepts `e2ePermissionMode`; `e2eHop` is decided from
  `task.e2eMode && input.launchedBy === "auto_advance"` so flag-path hops and retries get the
  same treatment (refinement 2). `taskExecutionSeeds` has an explicit return type so the seeded
  permission mode can be deleted and replaced; `taskLaunchContext` appends
  `E2E_LAUNCH_CONTEXT` on e2e hops; `resolveLaunchAttempt` accepts and forwards the override.
- `server.ts` (3.3): `onCompletedTurn` wired with `{ e2e: () => e2ePrefs }`; both
  `resolveLaunchAttempt` call paths (RPC and CLI) pass the e2e permission mode.
- Tests (3.4): six full-auto gate/hop tests in `tests/advance.test.ts` (e2e rows advance with
  the master off, human gates decline, terminal receipt declines the chain, caps decline, exact
  flag behavior with the box off, bypass/phase-model/context-line on hops), plus a retry-keeps
  override test in `tests/launch.test.ts`.

## Deviation from the plan

`listLaunchAttempts` returns newest-first (`ORDER BY created_at DESC`) while the plan assumed
oldest-first for `e2eGuardState`. The gate reverses at the call site instead of flipping the
shared query (which would change the RPC/CLI attempt panel display order). Phase 4's
`autoRetryFailedAttempt` applies the same reversal.

## Verification

- `npm test -- tests/advance.test.ts tests/launch.test.ts tests/sessions.test.ts`: 101 pass.
- `npm test` (pretest `tsc --noEmit`): 351 pass, 0 fail.

## Reviewer checks

- Gate block: e2e term evaluated first, flag path as fallback, `target_phase` only from a valid
  receipt, no suppression row on decline.
- Spawn override: `permissionMode` and `executionInputSources.permissionMode` for e2e hops;
  `default` removes the seeded mode.
- Both Execution Strategy refinements: the gate ignores retry depth; bypass plus the context
  line apply to every auto-advance hop on an e2e task.
