# Phase 5: Auto-advance and Worktree

## Shipped

- Added `extraction.ts` for deterministic next-step extraction from the last fenced `text` or bare command block, including `/rpi:x` legacy normalization, alias resolution, argument preservation, live artifact validation, task slug references, and HumanLayer-shaped `next_step_suggestions`.
- Persisted `sessions.next_step_json` on completed idle turns and added `structured_summary.relevantRPIDocuments` from live `.humanlayer/tasks/<slug>/<file>` mentions.
- Added `advance.ts` with completed-turn auto-advance gating, human-gate skips, master and per-transition flags, double-fire `advanced_at` CAS protection, launch attempt checks, notification suppression rows, `proceed`, manual `launchSkill`, and fresh-session iteration.
- Extended `launchPhase` to select environments by `worktree_timing`, create managed worktrees through `threads.spawn`, read `environmentId` back through `threads.get({ include: "environment" })`, persist `worktree_environment_id`, launch first workflow skills from drafts, and use the required prompt shape.
- Added `workspace.ts` for `.humanlayer/workspace.json` plus root `.local.json` parsing, local overrides, repo delete patches, additive deduped `copyGlobs`, sourceRef-to-baseBranch mapping, workspace view data, provisioning event capture, and setup rerun prompting through the worktree thread.
- Added UI for Auto-advance toggles, Proceed, Iterate in fresh session, Workspace tab status/config/provisioning data, session next-step hints, and the RPI workflow strip.
- Added CLI support for `launch-skill`, `launch-attempts`, `suppressions`, and `workspace` live verification.

## Verification

`npm run typecheck`

```text
> tsc --noEmit
```

`npm test`

```text
tests 81
pass 81
fail 0
```

Covered cases:

- extraction aliases, legacy colon commands, argument preservation, unknown artifacts, no block, multiple blocks with last wins, block inside longer answer, and unknown skills
- every auto-advance table row with master on/off, per-flag on/off, blocked sessions, missing next steps, human gates, mismatched extracted targets, and double-fire protection
- environment selection across `never`, `now`, and `later`, before and at the worktree phase
- sourceRef default/named-branch mapping, SHA/ref rejection, branch names with slashes
- workspace merge rules, root `.local.json`, provisioning event kind capture
- `waiting_for_workspace` status derivation while an environment is provisioning

`bb plugin build`

```text
dist/server.js
dist/server.js.map
dist/server.meta.json
dist/app.js
dist/app.css
dist/app.meta.json
```

`bb plugin install . --yes`

```text
Installed:
humanlayer@0.1.0  running
service launch-attempt-sweep: running
```

`bb plugin reload humanlayer`

```text
humanlayer@0.1.0  running
```

Live task:

```text
bb humanlayer tasks create --name Phase 5 live auto advance --project proj_v36xq75qse --prompt Phase 5 live auto advance check --workflow outline_only --worktree later --auto true --provider codex --model gpt-5.4-mini --json
```

Observed task:

```json
{"taskId":"a0f93340-84f2-4174-83d3-e4fa4a4dd355","slug":"phase","workflowType":"outline_only","worktreeTiming":"later","autoAdvance":true}
```

Launched the first RPI skill with the requested override:

```text
bb humanlayer launch-skill --task a0f93340-84f2-4174-83d3-e4fa4a4dd355 --skill create-research-questions --provider codex --model gpt-5.4-mini --prompt "write .humanlayer/tasks/phase/01-research-questions-live.md with frontmatter type: research-questions and two questions, call hl_artifact_save, then end your reply with a fenced text block containing exactly: /rpi-create-research" --json
{"threadId":"thr_rzwrdxcsxa"}
```

The first assistant completion saved `01-research-questions-live.md` and ended with:

````text
```text
/rpi-create-research
```
````

At that completed turn, `next_step_json` parsed as `next_step_found` for `create-research`, and auto-advance launched a successor:

```json
{"skillId":"create-research","status":"spawned","threadId":"thr_jm7q5ty7ri","fromThreadId":"thr_rzwrdxcsxa"}
```

The sessions list showed the successor labelled `research`:

```json
{"threadId":"thr_jm7q5ty7ri","label":"research","skillId":"create-research","launchedBy":"auto_advance","forkedFromThreadId":"thr_rzwrdxcsxa"}
```

The suppression row was recorded:

```json
{"threadId":"thr_rzwrdxcsxa","reason":"auto_advance"}
```

Then launched implementation to trigger the `later` managed-worktree path:

```text
bb humanlayer launch-skill --task a0f93340-84f2-4174-83d3-e4fa4a4dd355 --skill implement-outline --provider codex --model gpt-5.4-mini --prompt "Phase 5 live worktree check. Call hl_task_context first, report the current workspace path and branch, then stop." --json
{"threadId":"thr_pbtdsi8szc"}
```

Workspace state:

```json
{
  "environment": {
    "id": "env_9bmwsv535h",
    "status": "ready",
    "path": "/Users/marktripoli/.bb/worktrees/env_9bmwsv535h/bb-plugin-humanlayer",
    "branch": "bb/implementation-phase-thr_pbtdsi8szc",
    "baseBranch": null,
    "kind": "managed-worktree"
  },
  "worktreeThreadId": "thr_pbtdsi8szc"
}
```

The environment detail confirmed `workspaceProvisionType: managed-worktree`, `defaultBranch: main`, and `isWorktree: true`. No workspace config existed in this repo, so `sourceRef` was absent and resolved through the default branch path; bb reports that default branch selection as `baseBranch: null` with `defaultBranch: main`.

Observed provisioning event kinds:

```text
system/thread-provisioning
step:workspace-started:started
step:git-worktree-started:started
output:git-worktree-output-1
output:git-worktree-output-2
step:git-worktree-completed:completed
step:workspace-target:completed
step:workspace-branch:completed
```

Cleanup:

```text
bb thread archive thr_rzwrdxcsxa
Thread thr_rzwrdxcsxa archived (1 related thread also archived)

bb thread archive thr_jm7q5ty7ri
Thread thr_jm7q5ty7ri archived

bb thread archive thr_pbtdsi8szc
Thread thr_pbtdsi8szc archived
```

## Deviations

- The live task create command left the name and prompt unquoted, so bb stored the task name and slug as `Phase` / `phase`. The workflow, auto-advance, launch, artifact, and worktree behavior under test were unaffected.
- The repository had no `.humanlayer/workspace.json`, so the live sourceRef case used the default branch path. Unit tests cover named `origin/<branch>`, plain `<branch>`, branch names with slashes, `HEAD`/absent default, SHA rejection, and unsupported `refs/...` rejection.
- The auto-advanced child completion caused bb to post a system follow-up into the parent thread. That produced a later parent assistant turn with no command block, so the current `next_step_json` on the parent became `no_next_step`; the first completed turn had already been advanced and stamped with `advanced_at`.

## Open Items

- UI was typechecked and bundled, but not screenshot-tested in a browser session.
- Workspace setup execution still depends on the Phase 6 `setup-worktree` skill text; Phase 5 only stores config and sends the rerun prompt to the worktree thread.
- `notification_suppressions` is recorded for Phase 7 consumption; current bb child-completion posting is not suppressed by this phase.
