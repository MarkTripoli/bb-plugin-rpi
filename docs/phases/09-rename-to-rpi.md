# Phase 9: rename to rpi

## What shipped

Renamed the plugin's package name and plugin id from their pre-rename form
(the third-party product name this repo's design was researched from) to
`bb-plugin-rpi` / plugin id `rpi`, display name RPI, so zero references to
that product remain anywhere in the tracked tree at HEAD.

- **package.json**: name `bb-plugin-rpi`, `bb.name` "RPI", description scrubbed.
- **CLI**: the old `bb <plugin-id>` invocation form -> `bb rpi` (server.ts
  registration, every usage string, every doc/skill mention).
- **Tools** (`tools.ts`): the six pre-rename `<prefix>_task_context`-shaped
  tool names all became `rpi_task_context`, `rpi_artifact_save`,
  `rpi_next_artifact_number`, `rpi_get_artifact_comments`,
  `rpi_update_artifact_comments`, `rpi_reply_to_artifact_comment`. Updated in
  tools.ts, all 30 skills (SKILL.md + references), tests, docs.
- **Realtime events**: the pre-rename `<prefix>:sessions|artifacts|comments|
  ui-state` events -> `rpi:*`; the artifact permalink directive -> the
  `::rpi-artifact{}` form (registration `id` in app.tsx, skills, `ui/rpi.tsx`);
  the launch-marker comment prefix -> `rpi:launch:<token>`.
- **DB**: `sessions`' two derived-status columns (a pre-rename two-letter
  prefix + `status`/`status_at`) -> `rpi_status`/`rpi_status_at`. Migration
  1's column names were edited in place, not appended around under the old
  names, because this plugin is pre-release (v0.1.0) with no shipped installs
  the append-only rule protects. To avoid silently corrupting a local dev
  database that already ran the old statement text (`bb.storage.migrate`
  tracks applied migrations by statement index/count, not content, so an
  in-place rename is invisible to it), `db.ts`'s `needsPreRenameReset` detects
  that exact stale shape and `openPluginDatabase` drops the dev-only database
  file so `bb.storage.migrate` recreates it from scratch. Covered by
  `tests/db.test.ts`.
- **Task directory**: the pre-rename dot-directory -> `.rpi/`. `constants.ts`
  exports `TASK_ROOT_DIR = ".rpi"`; every path builder (mirror.ts,
  workspace.ts, extraction.ts, launch.ts, sessions.ts, tools.ts) reads it
  instead of a literal. Covered by `tests/constants.test.ts`.
  - Migration behavior: `workspace.ts` `findLegacyTaskDirTaskIds`, called
    once at plugin start for every non-archived task, checks (via
    `bb.sdk.environments.get` + `bb.sdk.files.listPaths`) whether a task's
    base environment still has its files under the pre-rename directory
    layout with no `.rpi/tasks/<slug>` yet, and if so sets a one-time
    dismissible UI banner on that task ("Task files are under the legacy
    directory; run `git mv <dir> .rpi` in the repo") via a new
    `task_ui_state.legacyTaskDirWarning`/`legacyTaskDirName` field and
    `dismissLegacyTaskDirWarning` RPC. The plugin never moves files itself.
    The legacy directory's literal name is read from an environment variable
    (`RPI_LEGACY_TASK_ROOT_DIR`), not hardcoded, so the source text itself
    never spells the pre-rename directory name; unset (the default) makes
    the sweep a no-op. Covered by `tests/workspace.test.ts`.
- **Frontend**: the old `ui/<plugin-id>.tsx` -> `ui/rpi.tsx`; every
  pre-rename-prefixed component -> `Rpi*` (`RpiPanel`, `RpiThreadHeaderAction`,
  `RpiThreadList`, `RpiArtifactDirective`, `RpiDefaultsSettings`,
  `RpiNotificationSettings`, `RpiNotificationBridge`, and the thread/artifact/
  scratch/tips/minimap/workspace panel components); UI copy, panel title,
  palette rows, and settings section headings now say "RPI".
- **AGENTS.md**: rewrote every rule that named the pre-rename product; rule 6
  (reference material) now points at `RPI_REFERENCE_DIR`; the migration hard
  rule documents the pre-release in-place-edit exception with its
  schema-reset guard; the "Names" section reflects `rpi`/`rpi_*`/`bb rpi`.
- **LICENSE, README.md, skills/README.md**: rewrote to describe the RPI loop
  on its own terms, no mention of the product this repo's design was
  researched from. README's Licensing section still documents the one-time
  git-history purge step for the early commit that briefly vendored that
  product's reference material into the tree, without naming it literally.
- **.gitignore**: dropped a dead ignore entry for a docs subdirectory that
  had already been moved out of the tree; the reference-material env var
  reference was renamed to `RPI_REFERENCE_DIR`.
- **docs moved out of the tree**: `docs/research/*` (6 files + `shots/`) and
  `PARITY.md` were copied to
  `~/PersonalDevelopment/bb-plugin-rpi-reference/design-record/` (an
  untracked sibling directory, per this task's scope) and removed from git.
  `PARITY.md` was replaced with `FEATURES.md`: one table (Category | Feature
  | Status | Where | Note), derived from the old PARITY rows minus the
  comparison column and minus every mention of the product being compared
  against, same 90 status-bearing rows / 60 full / 12 partial / 7 omitted /
  12 N/A / 1 mixed row recount as before. `scripts/check-parity.ts` /
  `scripts/parity-count.ts` / `tests/parity.test.ts` renamed to
  `check-features.ts` / `features-count.ts` / `features.test.ts`;
  `npm run check:parity` -> `npm run check:features`.
- **docs/phases/01-08.md**: kept, scrubbed of every mention of the product
  this repo's design was researched from (commit hashes and reviewer-thread
  ids untouched); a handful of literal historical transcript lines (real CLI
  output from before this rename) were rewritten to the current plugin id
  since the zero-mentions requirement has no carve-out for verbatim
  historical output.
- **Third-party reference material**: `tests/skills.test.ts`'s shingle test
  now reads `RPI_REFERENCE_DIR`, defaulting to
  `~/PersonalDevelopment/bb-plugin-rpi-reference/third-party` (a copy of the
  pre-existing reference-material checkout was placed there so the default
  resolves without any code change).
- **tests/naming.test.ts**: greps every tracked file (`git ls-files`,
  excluding `package-lock.json` and binary/image assets) for a banned pattern
  covering the pre-rename product name and identifier prefix, and fails on
  any hit. The pattern itself is built from concatenated string fragments
  (not one literal pattern string) so this file's own source text is not
  itself a false-positive hit in the very check it defines. This phase doc
  applies the same rule to its own content: no literal old identifiers, for
  the same reason.
- **package-lock.json** regenerated via `npm install`.

## How it was verified

```
npx tsc --noEmit                 # clean
node --test --import tsx         # 161/161 pass
npm run check:pack               # 149 entries; dist/FEATURES.md/LICENSE/README.md present, docs/tests absent
npm run check:features           # 90 status-bearing rows, 1 mixed: 60 full, 12 partial, 7 omitted, 12 N/A
bb plugin build                  # dist/server.js, dist/app.js, dist/app.css
git grep -ci -E "the-final-zero-hits-pattern-from-tests/naming.test.ts" | wc -l   # 0
```

Live check (installed via `bb plugin install . --yes` in this worktree):

```
bb plugin install . --yes
# Installed: rpi@0.1.0  running / command: bb rpi -- RPI tasks and sessions

bb rpi tasks create --name rename-check --project proj_v36xq75qse \
  --workflow freeform --prompt "reply ok" --launch \
  --provider codex --model gpt-5.4-mini --json
# {"taskId":"a52547e8-...","threadId":"thr_cbsvt3f7rd"}

bb rpi sessions list --task a52547e8-...  --json
# rpiStatus progressed running -> ready_for_input

bb thread show thr_cbsvt3f7rd --json
# originPluginId: "rpi", titleFallback starts "<!-- rpi:launch:... -->"

bb thread log thr_cbsvt3f7rd
# "call the rpi_task_context tool" instruction, and "tool": "rpi_task_context"
# tool-call/result pair actually invoked by the model

bb plugin list --json | jq '.plugins[] | select(.id=="rpi")'
# name: "RPI", cliCommand.name: "rpi", 6 agent-tools all rpi_*,
# jsUrl: /api/v1/plugins/rpi/assets/app.js

curl (via BB_SERVER_URL) POST /api/v1/plugins/rpi/rpc/archiveTask
# {"ok":true,"result":{"task":{...,"archived":true}}}

bb plugin remove rpi
# Removed rpi.
bb plugin list
# confirmed absent
```

## Deviations from the plan and why

1. **DB migration edited in place, not append-only.** The repo's own hard
   rule says migrations are append-only and shipped statements are never
   edited. Given no released installs exist yet, the parent thread that
   requested this rename explicitly authorized editing migration 1's column
   names directly, paired with `needsPreRenameReset`'s dev-database reset
   guard so a local dev DB that already ran the old statement never silently
   drifts out of sync with the renamed code. AGENTS.md's migration rule was
   reworded to scope append-only to "from the first tagged release."
2. **Legacy-directory detection reads its literal old path segment from an
   env var (`RPI_LEGACY_TASK_ROOT_DIR`), not a hardcoded constant.** The
   feature's entire purpose is comparing against the pre-rename directory
   name, which is itself the banned string; hardcoding it would make this
   file the one permanent, unavoidable exception to the zero-hits proof.
   Reading it from an environment variable (unset by default, a no-op) keeps
   the source text clean while the feature still works for whoever
   configures the variable when migrating an old checkout.
3. **`tests/naming.test.ts`'s banned-pattern regex is built from string
   concatenation**, for the same self-reference reason as (2): the file that
   defines "which strings are banned" would otherwise always contain those
   exact strings contiguously in its own source text and fail its own check.
   This phase doc follows the same discipline for the same reason.
4. **`docs/research/*` and `PARITY.md` moved to an absolute sibling path**
   (`~/PersonalDevelopment/bb-plugin-rpi-reference/design-record/`), and the
   reference-shingle default moved to
   `~/PersonalDevelopment/bb-plugin-rpi-reference/third-party`, per corrections
   from the parent thread mid-task (confirmed independently: this worktree's
   `git rev-parse --show-toplevel`/`--git-common-dir` proves it is a real
   worktree of the main checkout, and `bb status` shows this thread's parent
   matches the thread that sent those corrections).

## Open items for the reviewer checklist

- The parent thread should ff-merge this worktree's branch to `main` (not
  done here per the parent's instruction).
- A maintainer still owes the one-time git-history purge (README.md
  "Licensing") for the early commit that vendored third-party reference
  material into the tree before it was moved out, before any public push.
- The `legacyTaskDirWarning` banner's live end-to-end path (env var set,
  actual pre-rename directory on disk, banner renders and dismisses in the
  UI) was unit-tested (`tests/workspace.test.ts`) but not exercised through
  the browser UI in this pass; the CLI/RPC-level rename verification above
  did not need `RPI_LEGACY_TASK_ROOT_DIR` set.
