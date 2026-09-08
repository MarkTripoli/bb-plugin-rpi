# Phase 11: task archive cascade and artifact summaries

Two unplanned items from user feedback, not a row of merged plan section 3.

## What shipped

### Task archive that covers the whole task

`archiveTask` only flipped `tasks.archived`. The task's bb threads stayed
in the sidebar, the action was reachable only from a session's thread
header (so a draft with no session could not be archived), and there was
no CLI.

- **`sessions.ts`** `archiveTaskThreads(bb, db, taskId)`: selects every
  `sessions.thread_id` for the task with `thread_archived_at IS NULL` and
  calls `bb.sdk.threads.archive` on each via `Promise.allSettled`. Failures
  are logged with `bb.log.warn` and counted, never thrown, so one offline
  thread cannot block the rest. Returns `{ archived, failed }`. The
  existing `thread.archived` handler (`forgetThread`) stamps
  `thread_archived_at` and drops the mirror row, so nothing new writes
  session state.
- **`server.ts`** `archiveTaskEverywhere(taskId)`: flag first (so a partly
  failed cascade still leaves the task archived, which is what the
  retention sweep keys off), then cascade, then publish `tasks` and
  `rpi:sessions`. Used by the `archiveTask` RPC and the new
  `bb rpi tasks archive --task <taskId> [--json]` command.
- **`ui/rpi.tsx`**: Archive button (ghost, `Archive` icon) on the task
  detail page header next to Launch, so drafts and tasks without an open
  session can be archived. One exported `ARCHIVE_TASK_CONFIRM` string
  replaces the two confirm copies (hotkey and palette) that said "Sessions
  stay".
- **README**: hotkey table and archive paragraph updated.

Not done, by decision: no unarchive; `.rpi/tasks/<slug>/` stays on disk.

### Artifact summaries so downstream sessions stop reading everything

Traced where context goes. `contributeInstructions` is a few lines and
`rpi_task_context` returns a name/type/version manifest plus `task.md`
(capped 20KB). The cost was the skills: every downstream create/iterate
skill said "read all input files fully", so each phase re-read the full
research, design, and plan artifacts (about 100KB on the sample task)
before touching source. The reference ground truth (research doc, skill
conventions) says the opposite: read the task input and named files, do
not read other artifacts unless asked.

- **Templates** (16 files, every `references/*_template.md` with
  frontmatter): a `summary:` line after `type:` with placeholder text
  telling the agent to write two to four sentences on what the document
  establishes and what a later phase needs from it.
- **`artifacts.ts`** `artifactSummary(frontmatter)`: returns the
  `summary` string collapsed to single spaces, bounded to
  `ARTIFACT_SUMMARY_LIMIT` (400 chars, ellipsis), `null` for missing,
  non-string, blank, or unfilled `[...]` placeholder values. The value is
  agent-written, so it is treated as untrusted length.
- **`tools.ts`** `rpi_task_context`: each manifest entry gains `summary`
  (schema `z.string().nullable()`); the `[truncated]` sentinel carries
  `null`.
- **`sessions.ts` `taskInstructions`**: one added line stating the read
  rule for every session (primary input fully, everything else by manifest
  summary) and the requirement that every written artifact carries a
  `summary:`. Total instructions remain far under the 4096 limit.
- **Skills**: create and iterate skills for plan, prd, tdd, structure
  outline, and design discussion now name a primary input (for create:
  task input plus the newest design artifact in a stated preference order;
  for iterate: the artifact being iterated plus the feedback) and take
  every other artifact by manifest summary, opening a file only when the
  summary shows it bears on the step and then reading by heading.
  `create-research`, `iterate-research*`, `implement-*`, and
  `iterate-implementation` were already scoped and are unchanged.
  Artifact templates themselves were not shortened (user decision).

### Test scope fix

`tests/prose.test.ts` scanned `.rpi/` and failed on em dashes inside
agent-written artifacts of the gitignored task mirror. It now excludes
`TASK_ROOT_DIR` and `legacyTaskRootDirName()` (when configured), via the
existing constants rather than literal names, which also keeps
`tests/naming.test.ts` clean.

## Verification

```
$ npm test
ℹ tests 177
ℹ pass 177
ℹ fail 0

$ RPI_LEGACY_TASK_ROOT_DIR=.legacy-task-root npm test -- tests/prose.test.ts
ℹ pass 2
ℹ fail 0

$ bb plugin build
dist/server.js.map
dist/server.meta.json
dist/app.js
dist/app.css
dist/app.meta.json
```

New tests:

- `tests/sessions.test.ts` "archiveTaskThreads archives only the task's
  unarchived session threads and tolerates one failure": two tasks, three
  sessions on the target (one already stamped, one whose archive rejects);
  asserts exactly one `threads.archive` call, `{ archived: 1, failed: 1 }`,
  one warning naming the failed thread.
- `tests/artifacts.test.ts` "artifactSummary bounds frontmatter summary
  and drops template placeholders".

Not verified live: `bb.sdk.threads.archive` against a thread mid-turn, and
whether bb hides `--parent-self` child research threads when their parent
session is archived. Both are bb semantics the plugin does not model.

## Deviations

- Not a planned phase. Archive cascade matches HL's
  `tasks archive --cascade-to-sessions`; summaries are a plugin-side
  substitute for HL's "do not read other artifacts" convention plus
  `structured_summary`.
- `archiveTaskEverywhere` lives inside `server.ts` `activate` as a local
  helper (flag, cascade, publish) rather than a module export: it is
  wiring across `tasks.ts` and `sessions.ts` with two call sites in the
  same file.

## Open items for review

- Child research threads: confirm in a live bb that archiving the parent
  session thread removes its child threads from the sidebar. If not, the
  cascade should also archive rows from the child thread table.
- Unarchive: `listTasks({ archived: true })` already works; adding a
  filter toggle and an `unarchiveTask` RPC (flag plus `threads.unarchive`)
  is mechanical if needed.
- Summary quality depends on the agent filling `summary:` honestly. The
  Artifacts panel could show the summary under each file name so a human
  sees when one is missing or vague.
- Existing artifacts written before this change have no `summary:`; their
  manifest entries show `null` and skills fall back to opening the file.
