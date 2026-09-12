# Full auto mode: all phases (plan phase 7 report)

Summarizes the seven phases of `04-plan-full-auto-mode.md` (task artifact dir
`.rpi/tasks/i-want-to-create-some-kind-of-option-or-maybe-it-is-an-option-i-want-to-create-a-checkbox-that-we-can-check-before-we-2`),
using the per-phase reports `docs/phases/28-full-auto-phase1-columns-contract-prefs.md`,
`28-full-auto-phase2-override-table-guard-counters.md`,
`28-full-auto-phase3-gate-term-spawn-overrides.md`, `28-full-auto-phase4-auto-retry.md`,
`28-full-auto-phase5-task-context-prefs.md`, and `28-full-auto-phase6-ui-surfaces.md`.

## What shipped per phase

1. **Columns, contract, prefs** - two migrations (`tasks.e2e_mode` CHECK-constrained,
   `tasks.phase_models` JSON), `phaseModelsSchema` / `E2ePrefs` / `DEFAULT_E2E_PREFS` in
   `contract.ts` (fast/reasoning model overrides, bypass permission mode, hop cap 30,
   review-cycle cap 5, retry cap 3), storage round-trips in `tasks.ts`, the in-memory
   `e2ePrefs` mirror and `setPrefs` merge in `server.ts`.
2. **Override table and guard counters** - the literal `E2E_AUTO_ADVANCE` table and
   `e2eTransition` resolver in `transitions.ts`; the new pure `e2e.ts` with
   `e2eGuardState` (anchored at the newest non-auto launch), `retryChainDepth`,
   `phaseModelFor`, and `e2ePausedText`; `E2E_LAUNCH_CONTEXT` in `instructions.ts`.
3. **Gate term and spawn overrides** - `advance.ts` gate block is
   `(e2e_mode AND table row AND guards clean) OR (master AND flag)`, e2e term first, with
   `target_phase` chaining and the implementation-to-review-code redirect; `launch.ts`
   applies the bypass permission mode, per-phase model, and the launch-context line from
   `task.e2eMode && launchedBy === "auto_advance"`; `server.ts` wires both RPC and CLI paths.
4. **Auto-retry** - `autoRetryFailedAttempt` in `launch.ts` retries the newest `failed`
   attempt up to the retry cap with the e2e permission mode kept; `notifyAdvanceFailed`
   retries before the recovery notification; the sweep service auto-retries after dismissing
   stale uncertain attempts.
5. **Task context prefs** - `rpi_task_context` reports the effective phase model
   (explicit `phase_models` entry wins everywhere; class defaults only when `e2e_mode` is on),
   overriding `prefs.researchModel` / `prefs.researchSubagentModel` for that session.
6. **UI surfaces** - `Full auto` checkbox on New task, first item in the task actions menu,
   the master row plus paused-reason line plus 13-card `Phase models` grid in
   `AutoAdvancePanel`, the `full auto on` header term, and the Settings > Defaults
   `Full auto` subsection with model pickers, permission mode, and the three caps.
7. **Ledger, version, phase doc** - three `Full auto` rows in the `Auto-advance table
   (all flags)` block of `FEATURES.md` with the recount sentence updated to the mechanical
   count, version `0.2.0` in `package.json`, and this document.

## Verification (phase 7, and suite state entering it)

- `npm run check:features`: `96 status-bearing rows, 1 mixed: 64 full, 14 partial, 7 omitted, 12 N/A`
  (matches the opening bold sentence in `FEATURES.md` and the pins in `tests/features.test.ts`).
- `npm test` (pretest `tsc --noEmit`): 357 pass, 0 fail.
- `bb plugin build`: clean.
- `git diff --check`: no whitespace errors.

Per-phase final suite counts at commit time: 329 (phase 1), 344 (phase 2), 351 (phase 3),
355 (phase 4), 356 (phase 5), 357 (phase 6).

## Deviations

The two Execution Strategy refinements, recorded in the plan and honored throughout:

1. **Retry depth bounds auto-retry only.** The advance gate checks `hops` and
   `review_cycles`; a hop that needed three retries and then spawned does not pause the
   following hop. The panel still shows `retries` as the paused reason when the newest
   attempt is `failed` at the cap. (Phase 4's test for the cap seeds four chained attempts,
   depth 3, because depth-2 would still retry at `maxRetries: 3` under these semantics.)
2. **Every auto-advance hop on an e2e task gets the e2e treatment.** The bypass permission
   mode and the launch-context line key off `task.e2eMode && launchedBy === "auto_advance"`,
   so flag-path hops and retried hops get the same treatment without persisting a flag.

Per-phase deviations (details in each phase doc):

- Phase 1: e2e prefs merge test landed in `tests/polish.test.ts` (the prefs round-trip lives
  there, not in `tests/server.test.ts`); `normalizeTaskRecord` needed an explicit
  `phaseModelsJson` destructure; three literal `TaskRecord` test fixtures gained
  `e2eMode`/`phaseModels`.
- Phase 2: `retryChainDepth` on a full `retried_from` cycle returns 3, not 0 (walk counts
  links until it revisits a node); the test helper takes `Partial<E2eAttempt>`.
- Phase 3: `listLaunchAttempts` returns newest-first, so the gate and retry paths reverse it
  at the call site rather than flipping the shared query's display order.
- Phase 4: the maxRetries test seeds depth 3 as above; the server test uses the pre-spawn
  failure path instead of a spawn throw (a spawn throw leaves the attempt `uncertain`, which
  auto-retry deliberately ignores), and clears `tasks.base_environment_id` so the hop
  exercises the pre-spawn path.
- Phase 5: the test launches sessions via the `launchSkill` RPC instead of inserting session
  rows, since the mirror is only populated through plugin launches or lifecycle events.
- Phase 6: the menu checkmark uses a fixed `size-4` slot that conditionally renders the
  `Check` icon instead of a permanent spacer after `ItemIndicator`, keeping alignment in both
  states.

## Reviewer checks (manual list from Phase 6, deferred human evidence)

- [ ] `bb plugin install . && bb plugin reload rpi`; open New task: `Full auto` sits beside
  `Auto-advance` with its hint; create a task with it on and confirm the task header shows
  `full auto on`.
- [ ] Open the task actions menu on that task: the first item is `Full auto` with a check;
  toggling it flips the header term without reload.
- [ ] Task Settings tab: `Full auto` row beside `Auto-advance`; the `Phase models` grid shows
  13 cards; picking a model for `code-review` and reopening the tab shows it persisted.
- [ ] Settings > Defaults: the `Full auto` block saves each field and survives reload.
- [ ] With a task whose latest session is waiting and 30 or more auto-advance attempts (or a
  lowered `Hop cap`), the panel shows `Full auto paused: hop cap reached`.

From the plan's Human Review section, the standing review targets: the phase 3 gate block
(e2e term first, `target_phase` only from a valid receipt, no suppression row on decline), the
spawn override shape (`default` removes the seeded mode), the phase 4 wiring order in
`notifyAdvanceFailed`, and phase 6 file ownership.

## Known limits (from the plan)

- A session that asks a question despite `E2E_LAUNCH_CONTEXT` blocks until a human answers.
- The sweep-path recovery notifies only when the failed attempt's source session is still in
  the mirror; an attempt with no `from_thread_id` (draft launch) shows only the failed row
  with Retry.
- `worktree_timing` both timings follow today's environment selection; the plan phase did not
  exercise a live `now` run.
- `resolveLaunchAttempt` keeps `launched_by` from the failed attempt on retry, so an
  auto-retried human launch stays a human anchor for the counters.
