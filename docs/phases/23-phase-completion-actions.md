---
task: rpi-phase-fixes-2
type: phase
summary: "Phases 1 and 2 add a pure completion-action catalog, a source-bound manual-launch intent, and a composer-owned completion surface. Catalog fallbacks claim the completed source session through the existing launch-attempt and prepared-composer path, while duplicate header and side-panel continuation controls are removed. Automated verification passes; live BB UI verification remains unavailable in this session."
repo: bb-plugin-rpi
---

# Phases 1 and 2: Completion actions and source-bound launches

Phase 1 and Phase 2 are implemented. The completion catalog derives bounded actions from a ready, unblocked session with a processed completed turn. It covers workflow-specific continuation, review and pull-request branches, Iterate, matching Proceed extraction, bounded Agent suggestion extraction, active-attempt blocking, and spawned-successor replacement.

Catalog fallbacks use the new `completion` manual-launch intent with the source thread and server-validated skill identifier. Preparation remains read-only. Submission re-resolves the source, validates the live interaction and attempt state, checks the catalog again, claims `advanced_at` and a `launch_attempts` row under the existing task lock, and calls `launchPhase`.

No migration, new RPC, direct spawn path, or auto-advance change was added. The composer now renders the completion group and routes actions through the prepared composer; the header and side panel no longer duplicate phase-continuation actions. The composer back action recognizes the new source-bound route so the existing prepared-composer page can return to its source session.

## Automated verification

- `node --test --import tsx tests/transitions.test.ts tests/manual-launch.test.ts tests/advance.test.ts` -> exit 0, 45 tests passed.
- `npm test` -> exit 0, 277 tests passed.
- `bb plugin build` -> exit 0. The build reported the existing SDK pin notice for `0.4.34` versus the runtime `0.4.47`.
- `git diff --check` -> exit 0.

## Phase 2 verification

- `node --test --import tsx tests/ui-conventions.test.ts tests/thread-panel.test.ts tests/transitions.test.ts tests/manual-launch.test.ts tests/advance.test.ts` -> exit 0, 47 tests passed.
- `npm test` -> exit 0, 277 tests passed.
- `bb plugin build` -> exit 0. The build reported the existing SDK pin notice for `0.4.34` versus runtime `0.4.47`.
- `bb plugin install . --yes && bb plugin reload rpi` -> exit 0. The plugin was running from this worktree.
- `git diff --check` -> exit 0.

## Manual verification

- Phase 1 required no manual checks.
- Phase 2 install and reload completed. Wide/narrow layout, prepared-composer submission, successor replacement, extraction variants, recovery state, header/panel ownership, and auto-advance behavior remain unverified. `cua.getApp("dev.bb.desktop").getAXState({disableDiffing:true})` timed out after 38 seconds, and the follow-up screenshot reported no available BB windows.

## Open items

- Remaining live Phase 2 checks must be completed in the BB UI before treating the feature as fully verified. The current review-fixes session could not observe them because the BB desktop surface was unavailable.
- This record reflects the current automated evidence; a later phase should append live evidence after those checks are observed.
