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

## Review fixes

Implemented in:

- `f37dd91 fix artifacts mirror safety`
- `dea5bf4 fix artifact prompt and preview handling`
- `3c0fcc6 fix task mirror root bootstrap`

Finding mapping:

1. Blocking hydrate preservation: `f37dd91` added `mirror_state`, stable two-read ingest, last-written SHA checks, and CAS retry logic so disk edits are ingested before hydrate writes. Covered by `hydrate ingests untracked disk edits instead of clobbering them`.
2. Blocking rootPath and entry confinement: `f37dd91` confines artifact reads, writes, moves, and scans to `.humanlayer/tasks/<slug>` and validates slugs; `3c0fcc6` adds the required parent-root bootstrap because the SDK lstat-checks `rootPath` before creating it. The installed SDK exposes `listPaths` entries as `kind: "file" | "directory"`, `name`, `path`, `positions`, and `score`; no symlink field is declared, so the code honors `isSymbolicLink` if present and otherwise only accepts direct `kind: "file"` entries. Covered by `hydrate writes task artifacts through .humanlayer rootPath with CAS` and `ingest only accepts direct child files under the task root`.
3. Blocking file-name validation: `f37dd91` rejects empty, absolute, backslash, NUL/control, dot-segment, unpaired-surrogate, `.trash*`, over-255-byte names, and live case collisions before ingesting direct children. Covered by `artifact size cap and path confinement reject unsafe writes` and `file validation rejects case-insensitive live collisions`.
4. Blocking tombstones: `f37dd91` prevents ingest from resurrecting soft-deleted artifacts, moves exact tombstone matches to collision-safe `.trash/<name>.<version>.<ts>`, leaves edited tombstones in place, and adds restore/delete mirror outcomes. Covered by `tombstoned artifacts are not resurrected by ingest`.
5. Blocking launch first action: `dea5bf4` adds the required `hl_task_context` first-action line after the launch marker and at the start of contributed instructions. Covered by `launchPhase prompts start with marker then task context first-action line` and `contributed task instructions start with task context first-action line`.
6. Blocking artifact route safety: `dea5bf4` forces unsafe text, HTML, SVG, XHTML, and unknown route responses to attachment unless explicitly safe inline types are requested, adds `nosniff`, `no-store`, and sandbox CSP headers, and switches HTML/SVG previews to sandboxed `srcDoc`. Covered by `artifact route forces attachment for html and sets security headers`.
7. Should-fix MIME and size: `f37dd91` uses SDK `sizeBytes` when available before reads, keeps decoded-byte enforcement, and routes task seed, ingest, RPC, CLI, and HTTP through `mimeFor(fileName)`.
8. Should-fix linked worktrees: `f37dd91` resolves `.git` file `gitdir:`, honors `commondir`, verifies the metadata root is under the host home and has `HEAD`, then CAS-writes `info/exclude` under that metadata root.
9. Should-fix frontmatter/type: `f37dd91` accepts EOF closing fences, preserves quoted scalar strings, and matches known artifact type prefixes longest-first. Covered by `frontmatter and type inference handle eof fences, quoted scalars, and longest prefixes`.
10. Should-fix UI refresh/deleted group: `dea5bf4` resets selected versions on artifact changes, refetches previews on `hl:artifacts`, renders deleted artifacts under `DELETED`, and uses Restore there.
11. Should-fix manifest/version content: `dea5bf4` caps `hl_task_context` artifacts at 200 `name/type/version` entries with a truncation marker; version-list RPC remains metadata-only and content stays on `getArtifact`.

Verification after review fixes:

`npm test`

```text
tests 45
pass 45
fail 0
```

`npx tsc --noEmit`

```text
passed
```

`bb plugin build`

```text
dist/server.js
dist/server.js.map
dist/server.meta.json
dist/app.js
dist/app.css
dist/app.meta.json
```

Live check:

```text
bb plugin install . --yes
Installed humanlayer@0.1.0 ... running

bb plugin reload humanlayer
humanlayer@0.1.0 running

bb humanlayer tasks create --project proj_v36xq75qse --host host_bsbj4cminc --directory /Users/marktripoli/.bb/worktrees/env_339kec2ijw/bb-plugin-humanlayer --name "Phase 3 review fix live check 2" --prompt "Call hl_task_context first, then reply with exactly: first turn complete" --launch --provider codex --model gpt-5.4-mini --json
{"taskId":"7bfe0493-13ba-46ea-a09d-fa9f278cbdd3","threadId":"thr_wqwmwptb97"}

bb thread wait thr_wqwmwptb97 --status idle --timeout 180000
Thread thr_wqwmwptb97 reached status idle.

ls -la .humanlayer/tasks/phase-3-review-fix-live-check-2
task.md

bb humanlayer artifacts versions --task 7bfe0493-13ba-46ea-a09d-fa9f278cbdd3 --file task.md --json
version 1, createdBy task:create, operation create

Edited .humanlayer/tasks/phase-3-review-fix-live-check-2/task.md on disk between turns.

bb thread tell thr_wqwmwptb97 "Reply with exactly: second turn complete. Do not edit files."
Thread thr_wqwmwptb97 steered

bb thread wait thr_wqwmwptb97 --status idle --timeout 180000
Thread thr_wqwmwptb97 reached status idle.

bb humanlayer artifacts versions --task 7bfe0493-13ba-46ea-a09d-fa9f278cbdd3 --file task.md --json
version 1, createdBy task:create, operation create
version 2, createdBy thr_wqwmwptb97, operation ingest

bb humanlayer artifacts get --task 7bfe0493-13ba-46ea-a09d-fa9f278cbdd3 --file task.md --json
currentVersion 2 includes "Live between-turn edit for Phase 3 review fix verification."

bb thread output thr_wqwmwptb97
second turn complete
```

The live-check threads `thr_wqwmwptb97` and `thr_qnsbsvcp9k` were archived after verification, and the path-installed `humanlayer` plugin was removed.

## Deviations

- The original Phase 3 implementation did not add a migration because Phase 1 already included the artifact columns it needed. Review fixes added `mirror_state` to track hydrate writes and observed disk SHAs.
- `bb.sdk.files.write` accepted string content, not `Buffer`; hydrate writes text as UTF-8 strings and binary as base64 strings with `contentEncoding: "base64"`.
- In bb managed worktrees `.git` is a file. Review fixes now resolve `gitdir:` and `commondir` before updating `info/exclude`, after checking the metadata root is under the host home and has `HEAD`.
- Project-default managed-worktree launches can still have a null environment at the first dispatch. The requested wait branch is enabled and verified when the thread has an environment; `thread.active` and `hl_task_context` cover the null-environment first-dispatch case without blocking forever.

## Reviewer Open Items

- Exercise the Artifacts panel manually in bb after the next plugin install to validate visual fit beyond typecheck/build coverage.

## Review fixes round 2

Shipped:

- Hydration now retries unstable two-read checks up to two more times, skips without writing if still unstable, and logs the skip.
- Hydrate and ingest per-file checks now run with a concurrency cap of 8.
- Trash restore sorts `.trash/<name>.<version>.<ts>` numerically by version then timestamp.
- Restore now applies the same case-insensitive live-name collision check as save and returns `conflict` without untombstoning.
- Artifact viewer realtime follows latest unless the user explicitly selects a version.
- Concurrent `hl_task_context` calls for a task share the same in-flight hydration promise.

Verification:

`npm test`

```text
tests 48
pass 48
fail 0
```

`npx tsc --noEmit`

```text
passed
```

`bb plugin build`

```text
dist/server.js
dist/server.js.map
dist/server.meta.json
dist/app.js
dist/app.css
dist/app.meta.json
```
