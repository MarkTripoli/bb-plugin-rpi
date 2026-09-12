# Phase 6 report: UI surfaces

Plan: `.rpi/tasks/i-want-to-create-some-kind-of-option-or-maybe-it-is-an-option-i-want-to-create-a-checkbox-that-we-can-check-before-we-2/04-plan-full-auto-mode.md`, Phase 6 only (edits 6.1 to 6.6). Phases 1 to 5 were already committed.

## What shipped

- `task-create.ts`: `TaskCreateExtras` and `TaskCreateRequestInput` gained `e2eMode: boolean`; `composerRequestToTaskCreate` copies `e2eMode: extras.e2eMode`.
- `ui/rpi.tsx`, four places:
  - `NewTaskPage` (6.1): `e2eMode` state beside `autoAdvance`; passed in `composerRequestToTaskCreate` and in `saveDraft`'s createTask request. `Full auto` checkbox with `aria-describedby` hint (`Full auto` / "Runs to an open pull request with permission prompts bypassed. You approve the design and the plan.") sits after the Auto-advance row; `e2eHintId = `${hintId}-full-auto``.
  - `TaskActionsMenu` (6.2): prop widened to `Pick<TaskRecord, "id" | "name" | "completed" | "e2eMode">`; `run` gained an `"e2e"` branch calling `updateTask({ taskId, patch: { e2eMode } })` with the plan's toast copy. First menu item is the `Full auto` checkbox item, before `New chat`.
  - `AutoAdvancePanel` (6.3): props are now `{ task, launchAttempts, onUpdated }`. The panel fetches prefs once and refreshes on the `prefs` realtime channel. A second master row (`Full auto`, with the plan's description) sits under Auto-advance. When `task.e2eMode` and `e2ePausedText(e2eGuardState(launchAttempts, prefs.e2e))` is non-null, a `text-warning` line names the paused reason and points at Proceed. A `Phase models` section after the human-gate grid renders one card per `AUTO_ADVANCE` key (13 cards, `lg:grid-cols-2`), each an `RpiModelPicker` with `hostId={task.hostId}`, `allowDefault`, and `defaultLabel` of `Class default: reasoning|fast` when `e2eMode` is on, `Task model` otherwise. Picking a model writes `updateTask({ phaseModels: ... })`; picking the default omits that label's key (empty record is valid).
  - Task header meta line (6.4): when `task.e2eMode`, a `full auto on` `TaskMetaTerm` with the plan's hint follows the auto-advance term.
  - Settings Defaults page (6.5): a `Full auto` subsection after the per-workflow table with the fast and reasoning `RpiModelPicker` cards (`hostId={null}`, `allowDefault`, `defaultLabel="Task model"`), a permission-mode `ComposerToolbarSelect`, `Hop cap` / `Review cycle cap` (min 1) / `Retry cap` (min 0) number inputs, and the section hint. Each field writes through `setPrefs({ e2e: { ... } })`.
  - `RpiThreadPanel` passes its attempts: it now fetches `listLaunchAttempts` alongside `getTask` (initial load and `refetchTask`) and passes them to the panel; `TaskDetailPage` passes `workspace.launchAttempts`.
  - The sidebar group entry now carries `e2eMode` (from `taskMeta`) so the widened `TaskActionsMenu` prop type-checks in the sidebar row.
- `tests/task-create.test.ts`: `extras` gained `e2eMode: false`; the extras-flow test asserts `e2eMode: true` maps through; new test "default extras keep e2e mode off".
- `tests/ui-conventions.test.ts`: `Full auto` added to the manual-actions label list.

## Deviations from the plan

- Menu checkmark slot: the plan's snippet renders `ItemIndicator` plus a spacer "when ItemIndicator renders nothing". Radix renders the indicator only when checked, so a permanent spacer would misalign the checked state (icon + spacer). Replaced with a fixed `size-4` slot that conditionally renders the `Check` icon, keeping alignment in both states. Same icon, same class.
- The plan's `size-4 spacer` wording is satisfied by that slot rather than a second element after the indicator.

## Verification

- `npm test -- tests/task-create.test.ts tests/ui-conventions.test.ts`: 25 tests, 25 pass, 0 fail.
- `npm test` (pretest runs `tsc --noEmit`): 357 tests, 357 pass, 0 fail.
- `bb plugin build`: builds `dist/app.js`, `dist/app.css`, `dist/server.js` cleanly.

## Manual Verification (deferred human evidence; not executed)

- [ ] `bb plugin install . && bb plugin reload rpi`; open New task: `Full auto` sits beside `Auto-advance` with its hint; create a task with it on and confirm the task header shows `full auto on`.
- [ ] Open the task actions menu on that task: the first item is `Full auto` with a check; toggling it flips the header term without reload.
- [ ] Task Settings tab: `Full auto` row beside `Auto-advance`; the `Phase models` grid shows 13 cards; picking a model for `code-review` and reopening the tab shows it persisted.
- [ ] Settings > Defaults: the `Full auto` block saves each field and survives reload.
- [ ] With a task whose latest session is waiting and 30 or more auto-advance attempts (or a lowered `Hop cap`), the panel shows `Full auto paused: hop cap reached`.

## Open items for the reviewer

- The paused-reason line is only rendered when `task.e2eMode` is on, per plan. Confirm that is right when the task also shows the failed attempt row with Retry.
- Phase 7 (ledger, version, phase doc) not started, per instruction.

Pre-change backups: `.backups/rpi.tsx.pre-phase6`, `.backups/task-create.ts.pre-phase6`.
