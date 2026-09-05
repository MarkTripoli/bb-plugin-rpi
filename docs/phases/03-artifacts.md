# Phase 3: Artifacts

## Shipped

- Added artifact persistence in `artifacts.ts`: safe file names, 10 MB cap, SHA-256 deduped versions, list/get/version APIs, soft delete/restore, flat frontmatter parsing, type inference, next artifact numbering, and grouped panel ordering.
- Seeded `task.md` as artifact version 1 for created tasks, including drafts.
- Added `mirror.ts` with hydrate and ingest flows over `bb.sdk.files` using `.humanlayer` as `rootPath`, CAS writes, one retry after ingest on CAS conflict, `.trash/` handling for soft-deleted files, and session `hydrated_at` updates.
- Enabled real session hydration in the dispatch wait branch, plus `thread.active` hydration and `thread.idle` ingest for task threads.
- Registered task tools `hl_task_context`, `hl_artifact_save`, and `hl_next_artifact_number`, selected only for task threads, with task-session guard errors.
- Added artifact RPCs, CLI commands, local-auth HTTP artifact streaming, and the `::hl-artifact{task="..." file="..."}` message directive.
- Added the task-detail Artifacts tab and task-thread Artifacts panel with grouped/flat modes, version viewing, Preview/Raw mode, image preview URL support, delete/restore actions, and Hydrate now.

## Verification

`npm test`

```text
> bb-plugin-humanlayer@0.1.0 test
> tsc --noEmit && node --test tests/*.test.ts

1..36
# tests 36
# pass 36
# fail 0
```

`bb plugin build`

```text
✓ built dist/server.js
✓ built dist/app.js
✓ built dist/app.css
```

`bb plugin install .`

```text
Installed humanlayer@0.1.0 from path:/Users/marktripoli/.bb/worktrees/env_339kec2ijw/bb-plugin-humanlayer
humanlayer@0.1.0  running
```

Live task check used an explicit existing environment so the first dispatch could hydrate before model execution:

```text
bb humanlayer tasks create --project proj_v36xq75qse --host host_bsbj4cminc --directory /Users/marktripoli/.bb/worktrees/env_339kec2ijw/bb-plugin-humanlayer --name "Phase 3 live artifact check 5" --launch --provider codex --model gpt-5.4-mini --json
{"taskId":"255356b2-967a-450f-aea6-37f99b7dd7bc","threadId":"thr_qnh4wjxrrq"}
```

Dispatch hydration evidence:

```text
HumanLayer dispatch waiting for hydration: thr_qnh4wjxrrq
Hydrated HumanLayer session thr_qnh4wjxrrq: 1 written, 0 skipped
```

Agent final output included the permalink directive:

```text
Saved.

::hl-artifact{task="255356b2-967a-450f-aea6-37f99b7dd7bc" file="01-notes-live-check.md"}
```

CLI artifact list verified `task.md`, the new note, version 1, `type: notes`, and grouping under `other`:

```json
[
  {"fileName":"01-notes-live-check.md","currentVersion":1,"type":"notes","groupType":"other","commentCount":0},
  {"fileName":"task.md","currentVersion":1,"type":"other","groupType":"other","commentCount":0}
]
```

The hydrated files existed in the worktree:

```text
.humanlayer/tasks/phase-3-live-artifact-check-5/01-notes-live-check.md
.humanlayer/tasks/phase-3-live-artifact-check-5/task.md
```

UI-equivalent CLI save advanced the note to v2:

```text
bb humanlayer artifacts save --task 255356b2-967a-450f-aea6-37f99b7dd7bc --file 01-notes-live-check.md --content ...
{"currentVersion":2,"type":"notes","groupType":"other"}
```

Version history after the edit:

```json
[
  {"version":1,"createdBy":"thr_qnh4wjxrrq","operation":"ingest"},
  {"version":2,"createdBy":"cli","operation":"cli"}
]
```

The live-check thread was archived and the installed plugin was removed:

```text
archivedAt: 1788606816837
Removed humanlayer.
```

## Deviations

- No migration was added because the Phase 1 schema already included the artifact columns Phase 3 needed, including `content_type`.
- `bb.sdk.files.write` accepted string content, not `Buffer`; hydrate writes text as UTF-8 strings and binary as base64 strings with `contentEncoding: "base64"`.
- In bb managed worktrees `.git` is a file, so appending `.humanlayer/` to `.git/info/exclude` logs and continues with `ENOTDIR`. The source handles this as a skipped best effort because the plan explicitly said to ignore non-git cases, but resolving the common git dir would make this work for linked worktrees too.
- Project-default managed-worktree launches can still have a null environment at the first dispatch. The requested wait branch is enabled and verified when the thread has an environment; `thread.active` and `hl_task_context` cover the null-environment first-dispatch case without blocking forever.

## Reviewer Open Items

- Exercise the Artifacts panel manually in bb after the next plugin install to validate visual fit beyond typecheck/build coverage.
- Decide whether worktree `.git` file support should resolve the common git dir for `.git/info/exclude`, or whether a logged skip is sufficient for Phase 3.
