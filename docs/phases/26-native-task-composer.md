# Phase 26: native task creation box

## What shipped

The New task page's creation box is now bb's own `experimental_NewThreadComposer` (the same
compose surface as the default new-thread screen: prompt editor with mentions and attachments,
provider/model/reasoning picker, and the row beneath with project, environment, branch-from, and
permission mode), plus a plugin-owned extras row beneath it. Decisions confirmed by the user
before implementation, 2026-09-11:

- Extras row is the full set per Fable §448: workflow type select (with step-graph hint),
  worktree timing select (with the HL copy line), auto-advance toggle, and a Save as draft
  button. The separate Task name input is gone; the task name is derived from the prompt as
  before (`defaultTaskNameFromPrompt`).
- The RPI worktree-timing select is the source of truth for worktree policy. The composer's
  environment picker contributes host and directory only; a managed-worktree pick does not
  force the timing.

## Mapping (`task-create.ts`, pure, unit-tested)

`composerRequestToTaskCreate(request, extras)` maps a composer submission (validated through the
existing `manualLaunchRequestSchema`) to `createTask`:

- `text`: text inputs joined and trimmed (images and files are not part of the task prompt).
- `projectId` passes through.
- environment: `reuse` becomes the task's base environment (new optional
  `baseEnvironmentId` on `taskCreateRequestSchema`, stored into the existing
  `tasks.base_environment_id` column; no migration). `host/unmanaged{path}` becomes
  `hostId` + `defaultDirectory`; `host/managed-worktree` and `personal` contribute `hostId`
  only or nothing; `project-default` contributes nothing, so `selectEnvironment` resolves the
  project default source at launch as before.
- permission mode: bb's vocabulary (`accept-edits`/`auto`/`full`) maps onto the task record's
  (`accept_edits`/`auto`/`bypass`).
- `providerId`/`model`/`reasoningLevel`/`serviceTier` pass through as explicit task defaults.

Composer submit creates the task as a draft, launches it via the existing `launchDraft` (still
the single UI call site), and navigates to the thread. Throwing keeps the host draft, so a
failed create never loses typed text.

## Save as draft

`useComposer().text` reads the current new-thread draft (the composer owns the draft store;
`experimental_submit` cannot help because it requires a future `sendAt`). The button creates the
task in the panel's current project with null host/directory and no base environment, then
clears the composer text. Empty prompt or no current project shows a toast instead of creating.

## How it was verified

- `npm test`: 310 pass, 0 fail (includes 12 new `tests/task-create.test.ts` cases and the new
  server test "createTask stores a composer reuse environment as the task base environment and
  rejects a stale one").
- `npm run typecheck` clean; `bb plugin build` succeeds.
- Live: `bb plugin install . --yes` + `bb plugin reload rpi` completed; UI walkthrough pending
  reviewer check (see open items).

## Deviations

- The committed `forkSession` used `workspace: "reuse"`, which no longer exists in the SDK
  bundled types in node_modules (drift: plugin pins SDK 0.4.34, local bundled types are 0.4.47;
  `bb plugin build` also warns about this). Fixed to `environment: { type: "reuse",
  environmentId }` read from `threads.get({threadId, include: "environment"})`, omitting the
  field when the thread has no environment id so fork falls back to its own default. This was
  blocking `npm run typecheck` before any of this phase's changes; it is a pre-existing drift
  fix, not a behavior change.
- The Task name input was dropped (name derives from the prompt). If the reviewer wants a name
  override, it can return as an extras-row input.
- Save as draft cannot capture the composer's selected project/host/model (the SDK exposes no
  read-side for those selections outside submission; see docs/phases/21-session-launch-control.md).
  Drafts are created in the panel's current project with launch-time resolution for the rest.

## Open items for the reviewer checklist

- Open the New task panel: composer renders at document layout; submit creates and launches a
  task; navigation lands on the thread.
- Save as draft with text creates a draft task and appears under Drafts / Recent drafts.
- Save as draft with an empty composer shows the "Type a prompt" toast.
- Composer "reuse environment" pick: task Settings shows the base environment carried over.
- Workflow / worktree timing / auto-advance selects seed from Settings defaults and persist on
  create.
