# Phase 25: one-click phase-complete actions

summary: "Phase-complete banner buttons launch directly through a new launchCompletion RPC, and an 'Implement Phase N' primary action continues /rpi-implement-plan at the plan's next incomplete phase."

## What shipped

- `plan-phases.ts`: pure plan-phase parser shared by server and frontend. Parses `## Phase N: Title` sections, derives completion from `- [x]` acceptance checkboxes inside each phase section, picks the newest plan artifact, and returns the next incomplete phase. Guardrails: a plan whose first incomplete phase is Phase 1 yields null (an unticked Phase 1 after a finished implementation turn is indistinguishable from a plan whose boxes were never ticked), and a fully complete plan yields null.
- `transitions.ts`: `completionActionsForSession` accepts `nextPlanPhase`. When the session label is `implementation` and the workflow is `rpi` or `prd_tdd`, the catalog prepends a primary `Implement Phase N` action (skill `implement-plan`) and demotes Review code to secondary. The action always uses the `completion` manual-launch intent even when the extracted next step matches, so it cannot be misrouted into the workflow's own suggested transition.
- New RPC `launchCompletion` (`contract.ts`, `advance.ts`, `server.ts`): validates the source session like `submitManualLaunch` (ready state, processed turn, no successor, no pending interactions, no active launch attempt, under the per-task task lock), claims the source session's `advanced_at` plus a `launch_attempts` row with `launched_by: completion`, and spawns through `launchPhase` using the task's own execution defaults instead of a composer-submitted request. Server-side validation recomputes the catalog with the task's own parsed plan phase, so the action must still exist at click time. Draft tasks are unpublished like the composer path.
- `ui/rpi.tsx` `RpiComposerBanner`: all phase-complete actions are now one-click. `proceed` intents call the existing `proceed` RPC, `iterate` intents call `iterateInFreshSession` (context-high iterate keeps its setting-gated confirm dialog first), and `completion` intents call `launchCompletion`. The prepared-composer page remains for Draft Launch, New chat, Start fresh, and the thread-header popover Iterate. Buttons disable while a launch is in flight; failures surface through the existing `reportLaunchError` toast mapping.
- `tests/ui-conventions.test.ts` convention updated deliberately: `proceed`, `launchCompletion`, and `iterateInFreshSession` are now the banner's one-click paths (exactly one call site each), while `launchDraft`, `prepareManualLaunch`, and `submitManualLaunch` stay single-site composer-owned.
- Docs: README quick-action paragraph and FEATURES.md rows 59 and 104 updated.

## Verification

- `npm test`: 293 pass, 0 fail.
- `bb plugin build`: dist/server.js, dist/app.js, dist/app.css emitted.
- New tests: `tests/plan-phases.test.ts` (parsing, completion derivation, latest-plan selection), `tests/transitions.test.ts` implement-phase catalog test (ordering, labels, forced completion intent, outline_only exclusion), `tests/advance.test.ts` launchCompletion happy path (attempt row, source claim, draft unpublish) and stale-action rejection (no spawn, no claim), `tests/server.test.ts` RPC-level launchCompletion asserting task execution defaults reach the spawn (providerId/model/permissionMode).

## Deviations from the request as first stated

- "No approval at all" was interpreted as removing the prepared-composer review page for phase-complete banner actions, not as removing workflow human gates: the per-phase pause inside `/rpi-implement-plan` stays (it is a binding design decision), but each next phase now costs one click instead of typing a command.
- Iterate in the phase-complete strip launches without its old confirm dialog; the context-high warning and thread-header popover keep the setting-gated confirm because their sessions may still be running.

## Open items for review

- The `Implement Phase N` label depends on the implementer ticking acceptance checkboxes in the plan artifact. If a plan never gets ticked, the button never appears and the strip falls back to Review code / Create pull request / Iterate.
- `bb plugin install .` + `bb plugin reload rpi` against a live task with a mid-plan implementation session has not been eyeballed in this session.
