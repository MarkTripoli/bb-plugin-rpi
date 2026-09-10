# Phase 21: Session launch control

## Phase 1: Structured request preservation

Phase 1 extends the existing launch engine without changing UI launch behavior. Manual composer routing, preparation RPCs, and submit-time authority remain for Phases 2 and 3.

### Shipped behavior

- `manualLaunchRequestSchema` strictly mirrors the BB SDK 0.4.34 request shapes used by the new-thread composer. Identifiers, paths, arrays, mention offsets, editable text, attachment metadata, and serialized request size are bounded.
- `launch_attempts.request_json` is an append-only nullable migration. Attempts created before this migration continue through the legacy command and task-default path.
- `launchPhase()` validates structured requests before attempt insertion, preserves user text, mentions, attachments, execution selections, provenance, and scheduling, and replaces project and environment with task-owned values.
- Server-owned task context and the launch marker are separate agent-only text entries around user input, so mention offsets are unchanged.
- Retry parses and reuses the stored request with a new attempt marker. Corrupt stored requests fail instead of falling back to current task defaults.
- `listLaunchAttempts()` does not expose stored request JSON.

### Automated verification

`rtk npm test -- --test-name-pattern="launch|migration"` passed:

```text
tests 43
pass 43
fail 0
```

`rtk npm run typecheck` passed.

`rtk npm test` passed:

```text
tests 255
pass 255
fail 0
```

`rtk bb plugin build` passed and produced the server and app bundles.

### Manual verification

Phase 1 defines no live plugin check. Human confirmation of the Phase 1 diff and automated evidence is required before Phase 2. The composer, cancellation, stale-submit, concurrency, retry, and auto-advance live checklist remains assigned to Phase 3.

### Deviations and open items

No Phase 1 plan deviations. The installed `rpi-implement-plan` skill references a shared `WRITING.md` file that is absent from its installed directory; this receipt follows the repository phase-report convention instead.

## Phase 2: Read-only preparation and submit-time authority

### Shipped behavior

- `ManualLaunchIntent` strictly represents draft, skill, Proceed, and Iterate intents. The RPC contract now exposes bounded preparation, submission, and typed stale, project, or workspace rejection results.
- `prepareManualLaunch()` shares the current draft, skill, Proceed, and Iterate resolvers, returns canonical prompt and composer seeds, and performs no database write, advancement claim, attempt insertion, realtime publication, or spawn.
- Draft preparation exposes only editable text, including a valid 10,000-character freeform draft. The linked-ticket instruction remains server-owned in an agent-only launch block and is reconstructed on Retry from durable attempt command metadata.
- Preparation returns an opaque state token derived from the durable task, source session, intent, and latest launch attempt. `submitManualLaunch()` validates the structured request, resolves the task before locking, re-resolves the intent under the existing task mutex, completes awaited interaction and environment checks, then synchronously reloads the task for the final authority and token check. The same final task snapshot owns attempt creation and launch.
- Draft and skill submissions whose task was deleted after preparation return the typed `stale_intent` RPC result. Task archive or project/workspace mutations that land during awaited preflight work cannot create an attempt or spawn.
- Proceed keeps its existing compare-and-set claim. Concurrent submissions from one prepared state produce one successor, while a newly prepared same-skill action can launch again.
- Iterate rejects any source session that already has a durable spawned successor, regardless of which task attempt is most recent.
- The task project, host, workspace kind, environment id, branch, and managed-worktree base branch stay authoritative. A normalized `null` unmanaged path is accepted only for the same host and workspace kind, then `launchPhase()` restores the canonical task path.
- Edited structured input and one-session execution settings reach the existing launch owner without changing task defaults. Failed spawns retain the validated request on the uncertain attempt for Retry.
- Direct CLI launch commands and lifecycle auto-advance remain on their immediate paths.

### Automated verification

`npm test -- --test-name-pattern="manual launch|auto-advance|RPC"` passed:

```text
tests 41
pass 41
fail 0
```

The review-specific selection, including the 10,000-character draft, Retry instruction, concurrent stale state, fresh same-skill, stale Iterate, mid-await task mutation, and deleted-task regressions, passed 47/47.

`npm run typecheck` passed.

`npm test` passed:

```text
tests 265
pass 265
fail 0
```

`bb plugin build` passed and produced the server and app bundles. It emitted only Node's existing `module.register()` deprecation warning.

### Manual verification

No live plugin check was run, as requested. Phase 2 ends at its human review gate. The prepared composer route and UI action rewiring do not exist until Phase 3, so the plan's live composer, Back, draft-retention, two-tab, fixed-workspace, and action-inventory checks remain for that phase.

### Deviations and open items

Phase 2 adds `stateToken` to the prepared output and requires it on submit. The approved plan described fresh submit-time re-resolution but did not define a client-visible concurrency token; the token is required to distinguish a legitimate newly prepared same-skill launch from an old or concurrent submission without relying on skill history heuristics. No migration was needed.

The installed `rpi-implement-plan` skill still references a missing shared `WRITING.md`; the available implementation templates and repository phase-report rules were used.

## Phase 3: Reviewable manual launch composer

### Shipped behavior

- `manual-launch.ts` owns the fixed draft, skill, Proceed, and Iterate route grammar. It bounds identifiers and route length, accepts only canonical skills, keeps prompts out of URLs, and rejects malformed encoding, separators, and extra segments.
- `ManualLaunchComposerPage` loads the read-only preparation result and renders BB's `experimental_NewThreadComposer` at full panel width with the stable draft key, focus request, visible prompt, canonical project and environment seed, and one-session execution seeds.
- Back returns draft and skill intents to their task and Proceed and Iterate intents to their source thread without a submission call.
- Submit calls only `submitManualLaunch`. A launched result opens the task-bound thread. Typed rejections and thrown failures are displayed and rethrown so the host retains the draft.
- Draft Launch, task New chat, Start fresh, Iterate, Proceed, Suggested next, workflow, code-review, pull-request, and pull-request-review actions now navigate through the prepared composer route.
- New task Create and start remains the only direct UI `launchDraft` call. Native Fork, interrupt, launch-attempt Retry, CLI launches, and lifecycle auto-advance keep their existing behavior.
- `README.md` and `FEATURES.md` document review-before-run, one-session execution choices, the fixed task workspace, Retry fidelity, unmanaged-path normalization, and the immediate CLI and lifecycle paths.

### Automated verification

`npm test -- --test-name-pattern="manual launch route|manual quick actions|thread panel"` passed:

```text
tests 31
pass 31
fail 0
```

`npm test` passed, including its typecheck pretest:

```text
tests 269
pass 269
fail 0
```

`bb plugin types --check` passed with the project pin and host both on SDK 0.4.34.

`bb plugin build` passed and produced the server and app bundles. It emitted only Node's existing `module.register()` deprecation warning.

`npm run check:features` passed:

```text
93 status-bearing rows, 1 mixed: 61 full, 14 partial, 7 omitted, 12 N/A
```

`git diff --check` passed.

### Manual verification

- Installed and reloaded the current worktree plugin. The existing RPI task remained at 7 sessions and 7 launch attempts during cancellation and rejection checks.
- Task New chat opened a focused `compose/iterate/<threadId>` page with `/rpi-iterate-implementation`, the task project and worktree, GPT-5.6-Sol, High reasoning, and Full Access.
- Edited prompt text survived Back and reopen. Model and reasoning changed to GPT-5.6-Terra and Medium did not survive; they reseeded to GPT-5.6-Sol and High.
- A projectless submission was rejected with `This task must stay in its original project.` A local-workspace submission was rejected with `This task must stay in its original workspace.` Both retained the edited prompt and created no session or attempt.
- Review code opened `compose/skill/<taskId>/review-code`; Create pull request opened `compose/skill/<taskId>/describe-pr`; confirmed Iterate opened `compose/iterate/<threadId>`. New chat reopened the same Iterate composer without spawning.
- The thread action menu continued to expose native Fork and Interrupt separately from the prepared manual actions.
- A disposable auto-advance-off task opened Draft Launch without a session or attempt. Its prompt was edited, a workspace `README.md` mention was inserted, and its execution settings were changed to GPT-5.6-Luna, Medium reasoning, Fast service tier, and Full Access before submission.
- One Enter submission created exactly one spawned attempt (`2ec5f5ea-cd17-4e95-9347-0d9f742e4867`) and one task-bound thread (`thr_a5sjmcrvqz`). The first `client/turn/requested` event recorded the edited text and structured mention, the selected execution settings, the canonical task project and unmanaged workspace, separate agent-only first-action and continuation context, and the matching launch marker.
- A second task New chat opened a focused composer seeded with `/rpi-iterate-research-questions`; abandoning it left the attempt ledger at exactly one. The disposable task and its session were then archived.
- The previously installed plugin source was restored to `/Users/marktripoli/PersonalDevelopment/bb-plugin-rpi/.worktrees/feature/context-management` and reloaded successfully.
- Attachment upload, two-tab concurrent Proceed, recovery Start fresh, Suggested next, workflow and pull-request-review actions, New task Create and start, attempt Retry, and a newly triggered lifecycle auto-advance were not exercised live. Their focused automated coverage passed, but that is not equivalent to live evidence.

### Deviations and open items

The implementation follows the Phase 3 code plan except for persistence of edited execution and environment selections across Back and reopen. SDK 0.4.34 documents `default*` values as seeds and `draftKey` as prompt-draft persistence only. The host implementation passes plugin composers `selectionScope="component-local"`, and the public `NewThreadComposerProps` exposes no selection-change callback. The plugin cannot preserve those choices before submission without reaching around the SDK; prompt text, mentions, and attachments remain owned by the host draft store.

The remaining live checks listed above require targeted fixtures or an attachment upload confirmation. No plugin-side workaround was added.
