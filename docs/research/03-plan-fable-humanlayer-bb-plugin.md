---
type: plan
author: fable
topic: HumanLayer replica as a bb plugin (bb-plugin-humanlayer)
status: proposed
date: 2026-09-05
bb_version: 0.41.0
bb_plugin_sdk: 0.4.34
inputs:
  - research/01-research-humanlayer-system.md (ground truth)
  - research/hl-api-schema.md (command shapes for artifacts/comments)
  - research/shots/01,13,22,41,42,43,45,47,48,52,53 (viewed; 42 is the Changes tab, 43 is the Workspace tab, 13 is the Tips tab)
  - bb-plugin-authoring SKILL.md + quickstart, backend-foundation, backend-sdk, backend-events, backend-cli-agents, backend-ui-lifecycle, frontend-registration, frontend-core-slots, frontend-components, frontend-hooks-and-ui, frontend-renderer-slots, testing
  - bundled-types/bb-plugin-sdk.d.ts and bb-plugin-sdk-app.d.ts (0.4.34) at ~/PersonalDevelopment/bb-plugin-simulator/node_modules/@get-bb/plugin-sdk
  - ~/PersonalDevelopment/bb-plugin-simulator (package.json, server.ts, app.tsx, plugin.test.ts)
  - ~/.humanlayer/riptide/plugins/riptide-rpi-terminal/0.30.34 (22 skills, 7 agents, hooks.json) + riptide-humanlayer/0.1.3 (show-me)
---

# Plan: HumanLayer inside bb

One plugin, package `bb-plugin-humanlayer`, plugin id `humanlayer`. The plugin DB owns tasks, sessions-to-threads mapping, phase state, artifacts, versions, comments, notification receipts, scratch pads, and preferences. Everything else (threads, environments/worktrees, providers/models, permissions, skills tier, diff viewer, terminals, queue) is bb's and is only referenced.

Design rule used throughout: a HumanLayer **session is a bb thread**, a HumanLayer **task is a plugin row that groups threads**, a HumanLayer **artifact is a plugin DB row mirrored to `<workspace>/.humanlayer/tasks/<slug>/`**. No second runtime, no cloud, no daemon.

## 0. Findings that shape the design

Verified against the 0.4.34 declarations (not the prose docs):

| Need | SDK surface | Verdict |
|---|---|---|
| Thread status | `ThreadResponse.status` = `pending, starting, active, stopping, idle, error`; `runtime.displayStatus` adds `provisioning, waiting-for-host, host-reconnecting` | Enough to derive all 12 HL statuses except `draft` (task level) and `resuming` (derived, see 5.1) |
| Pending approvals | `bb.sdk.threads.interactions.list` → `PendingInteraction` with `payload.kind: "approval"` (request kinds `command`, `tool_use`, `plan`, fileSystem/network grants), `"user_question"`, `"plugin"`, `"<x>/<y>"` | Enough for `needs_approval` and the approval toast text (`tool_name`, `tool_input`) |
| Change notifications | `bb.sdk.subscribe({event:"thread:changed", callback})` with `changes` incl. `status-changed`, `interactions-changed`, `queue-changed`, `environment-changed`; plus `bb.events.on(thread.idle)` giving `lastAssistantText` | Enough. `thread.idle` is the only place the final answer arrives without a timeline read |
| Spawn phase sessions | `threads.spawn({projectId, environment: reuse\|host(managed-worktree\|unmanaged\|personal)\|project-default, prompt, title, providerId, model, reasoningLevel, permissionMode, parentThreadId, visibility, sendAt})` | Enough for fresh-session-per-phase and worktree timing |
| Worktree without a thread | none (`environments` has no `create`) | **Gap.** The worktree is created by spawning the worktree-setup (or implementation) thread with `environment.workspace.type = "managed-worktree"`. Acceptable: HL also runs a session there |
| Setup command / copy globs | `.bb-env-setup.sh` (repo hook) runs at worktree creation; no per-step retry/skip API | **Gap.** Workspace tab shows setup outcome from `system/thread-provisioning` events; "retry" = send a prompt to the setup thread. `copyGlobs` handled by the ported `setup-worktree` skill (agent copies files) |
| Intercept agent file writes (HL PostToolUse hook) | none. Only `experimental_hooks.on("message.dispatch")` exists | **Gap.** Two-part workaround: native tool `hl_artifact_save` that skills call after writing, plus an idle-time directory ingest (6.3) |
| Inject task context into the system prompt | `bb.agents.contributeInstructions` (sync, 4096 chars) and `bb.agents.configure` (select this plugin's tools/skills per thread) | Enough |
| Fresh context | spawn new thread; `threads.fork` for the fork button; `threads.compact` exists but HL never compacts | Enough |
| Context gauge | `threads.timeline(...).contextWindowUsage { usedTokens, modelContextWindow, estimated }` | Enough. No pricing → `$cost` is omitted |
| Files in the repo (hydrate/mirror) | `bb.sdk.files.read/write(CAS expectedSha256, rootPath)/list/listPaths/mkdir/remove` with `hostId` | Enough. Workspace path and host come from `threads.get({include:"environment"})` or `environments.get` |
| Agent tools | `bb.agents.registerTool` (zod params, `{threadId, projectId, signal}` context) | Enough; replaces the 3 MCP tools |
| Skills | manifest `bb.skills` dir, injected as the plugin skills tier and exposed as `/name` | Enough; HL `/rpi:x` becomes `/rpi-x` |
| Subagents | `bb thread spawn --parent-self`, `bb thread wait`, `bb thread output` (CLI, verified in `bb guide threads`) | Enough; Claude-only `agents/*.md` become skills used by child threads |
| Sound | `bb.http.route("GET","/sound")` serving the mp3; frontend `new Audio(url)` in a content script | Enough |
| Toast + hotkey | `sonner` `toast()` (shimmed), `contentScripts.register` for `keydown` | Enough |
| "Is the user viewing this thread" | `useBbContext()` inside a slot; content scripts have no route snapshot | Workaround: `experimental_threadHeaderAction` component registers its `threadId` in a module set while mounted |
| Right-panel tabs | `threadPanelAction` (per thread) and `navPanel.fixedTabs` (task pages) | Enough |
| Sidebar like HL (tasks grouping) | `experimental_threadList` (exclusive, user can pin bb's) | Enough, optional (phase 7) |
| Diffs / Changes | bb owns environment diff panel and `experimental_Diff` | Reuse; do not rebuild Changes. Diff comments are dropped (see 13) |
| Settings | `bb.settings.define` (string/select/boolean/project) + `settingsSection` for a custom form | Enough; provider/model default uses `experimental_ProviderModelPicker` writing to kv |

## 1. Package layout

```
bb-plugin-humanlayer/
  package.json                 bb.name "HumanLayer", branding.icon "Layers", server ./server.ts, app ./app.tsx, skills ["skills"]
  server.ts                    factory: wiring only (settings, migrate, rpc, tools, events, http, realtime, dispose)
  contract.ts                  defineRpcContract + shared zod schemas (imported type-only by app.tsx)
  db.ts                        migrations array + typed query helpers (better-sqlite3 via bb.storage.database())
  tasks.ts                     task CRUD, slug, board column derivation, drafts
  sessions.ts                  thread<->session mapping, HL status derivation, labels, summaries
  transitions.ts               skill table (label, button text), workflow graphs, auto-advance table (pure)
  extraction.ts                next-step parser for final answers (pure)
  advance.ts                   auto-advance executor + proceed(): spawn next phase thread, worktree timing
  artifacts.ts                 upsert/versions/soft-delete, NN-type-slug helpers, frontmatter parser (pure parts split out)
  mirror.ts                    hydrate task dir into workspace, ingest workspace dir back (CAS, sha256)
  comments.ts                  block-anchored comments, re-anchoring, threaded XML for agents
  notify.ts                    transition -> notification decisions (pure) + publisher
  workspace.ts                 worktree/setup state view for a task (reads env + provisioning events)
  http.ts                      GET /sound, GET /artifact (binary bytes by version id)
  tools.ts                     bb.agents.registerTool x6 + contributeInstructions + configure
  assets/notification.mp3      copied from research/notification.mp3
  app.tsx                      definePluginApp: navPanel, threadPanelActions, header action, composer, directive, palette, settings, content script
  ui/                          React: board.tsx, task-list.tsx, sessions-table.tsx, task-detail.tsx, new-task.tsx,
                               artifacts-panel.tsx, artifact-viewer.tsx, comments.tsx, workspace-panel.tsx, scratch-pad.tsx,
                               tips-panel.tsx, auto-advance-panel.tsx, workflow-strip.tsx, session-status.tsx, notifications.ts
  components/ui/               vendored shadcn (button, card, input, checkbox, dialog, select, tabs, dropdown-menu, badge, slider, table, switch, textarea)
  skills/                      23 SKILL.md dirs (22 rpi-* + show-me) + 7 rpi-agent-* skills, each with references/
  *.test.ts, ui/*.test.tsx     node:test for pure modules, vitest+jsdom for slots (see 12)
```

`zod` in `dependencies`; SDK, shimmed radix/sonner/vaul, better-sqlite3 types in `devDependencies` exactly as the simulator plugin does. No other runtime dependency. Frontmatter parsing is a 30-line `key: value` reader (`ponytail:` ceiling: scalars and flat string lists only; swap to `yaml` if templates grow).

## 2. Database schema (bb.storage.migrate, append-only)

```sql
-- 0
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,                 -- uuid
  project_id TEXT NOT NULL,            -- bb project
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,           -- kebab, suffixed -2/-3 on collision
  workflow_type TEXT NOT NULL DEFAULT 'rpi',      -- rpi|outline_only|prd_tdd|oneshot|freeform
  worktree_timing TEXT NOT NULL DEFAULT 'later',  -- now|later|never
  is_draft INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  provider_id TEXT, model TEXT, reasoning_level TEXT, permission_mode TEXT, service_tier TEXT,
  host_id TEXT,                        -- machine chosen at creation
  base_environment_id TEXT,            -- env used before the worktree exists (project checkout)
  worktree_environment_id TEXT,        -- managed worktree once created
  auto_advance INTEGER NOT NULL DEFAULT 0,        -- task master toggle (fast-forward)
  aa_questions_to_research INTEGER NOT NULL DEFAULT 1,
  aa_research_to_design INTEGER NOT NULL DEFAULT 1,
  aa_plan_to_worktree INTEGER NOT NULL DEFAULT 1,
  aa_worktree_to_implementation INTEGER NOT NULL DEFAULT 1,
  aa_implementation_to_pr INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
-- 1
CREATE TABLE sessions (
  thread_id TEXT PRIMARY KEY,          -- bb thread id = HL session id
  task_id TEXT NOT NULL REFERENCES tasks(id),
  label TEXT,                          -- rpi:research etc, NULL for oneshot/freeform
  skill_id TEXT,                       -- create-research etc, NULL if user prompt
  launched_by TEXT NOT NULL,           -- user|auto_advance|proceed|fork
  forked_from_thread_id TEXT,
  hl_status TEXT NOT NULL DEFAULT 'launching',    -- derived, section 5.1
  hl_status_at INTEGER NOT NULL,
  had_turn INTEGER NOT NULL DEFAULT 0, -- set on first thread.active; used for resuming vs launching
  interrupted INTEGER NOT NULL DEFAULT 0,          -- last stop was a user interrupt
  next_step_json TEXT,                 -- extraction result, section 7
  summary_json TEXT,                   -- { summaryHistory: string[] }
  advanced_at INTEGER,                 -- set once when auto-advance/proceed spawned a successor (idempotency)
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX sessions_task ON sessions(task_id, created_at);
-- 2
CREATE TABLE artifacts (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  file_name TEXT NOT NULL,             -- relative path inside the task dir
  frontmatter_json TEXT NOT NULL DEFAULT '{}',
  content_type TEXT NOT NULL DEFAULT 'text/markdown',
  is_deleted INTEGER NOT NULL DEFAULT 0,
  current_version INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  UNIQUE(task_id, file_name)
);
CREATE TABLE artifact_versions (
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL REFERENCES artifacts(id),
  version INTEGER NOT NULL,
  content BLOB NOT NULL,               -- utf8 text or binary
  sha256 TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_by TEXT NOT NULL,            -- 'user' | thread_id
  operation TEXT,                      -- Write|Edit|ingest|ui
  created_at INTEGER NOT NULL,
  UNIQUE(artifact_id, version)
);
-- 3
CREATE TABLE comments (
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL REFERENCES artifacts(id),
  version_id TEXT NOT NULL,            -- version the anchor was made against
  reply_to_id TEXT,
  content_text TEXT NOT NULL,
  block_text TEXT, prev_block_text TEXT, next_block_text TEXT,
  anchor_json TEXT,                    -- {v:1, blockIndex, start, end, selectedText}
  kind TEXT NOT NULL DEFAULT 'comment',
  is_resolved INTEGER NOT NULL DEFAULT 0,
  is_deleted INTEGER NOT NULL DEFAULT 0,
  created_by_agent INTEGER NOT NULL DEFAULT 0,
  created_by_thread_id TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX comments_artifact ON comments(artifact_id, created_at);
-- 4
CREATE TABLE notified (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL);  -- "<threadId>:<status>:<hl_status_at>" or "comment:<id>"
CREATE TABLE scratch_pads (task_id TEXT PRIMARY KEY, text TEXT NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE task_ui_state (task_id TEXT PRIMARY KEY, json TEXT NOT NULL);  -- selected artifact, dismissed tips, context-warning dismissed per thread
```

Preferences that are not `bb.settings` descriptors (structured defaults: provider/model/effort/serviceTier, dismissed tips) live in `bb.storage.kv` under `prefs:*`.

Mirror on disk: `<workspace>/.humanlayer/tasks/<slug>/<file_name>`; soft-deleted files move to `.humanlayer/tasks/<slug>/.trash/`. `.humanlayer/` is added to `<workspace>/.git/info/exclude` on first hydration (never to tracked `.gitignore`).

## 3. Transition tables (transitions.ts, pure)

Copied verbatim from the study; the only edit is the command prefix.

```ts
export const SKILLS = [ // command, skillId, label, button
  ["/rpi-create-research-questions","create-research-questions","research-questions","proceed to research questions"],
  ["/rpi-iterate-research-questions","iterate-research-questions","research-questions","iterate research questions"],
  ["/rpi-create-research","create-research","research","proceed to research"],
  ["/rpi-iterate-research","iterate-research","research","iterate research"],
  ["/rpi-create-design-discussion","create-design-discussion","design","proceed to design"],
  ["/rpi-iterate-design-discussion","iterate-design-discussion","design","iterate design"],
  ["/rpi-create-prd","create-prd","design-prd","proceed to PRD"],
  ["/rpi-iterate-prd","iterate-prd","design-prd","iterate PRD"],
  ["/rpi-create-tdd","create-tdd","design-tdd","proceed to TDD"],
  ["/rpi-iterate-tdd","iterate-tdd","design-tdd","iterate TDD"],
  ["/rpi-create-structure-outline","create-structure-outline","structure","proceed to outline"],
  ["/rpi-iterate-structure-outline","iterate-structure-outline","structure","iterate outline"],
  ["/rpi-create-plan","create-plan","plan","write plan"],
  ["/rpi-iterate-plan","iterate-plan","plan","iterate plan"],
  ["/rpi-configure-workspaces","configure-workspaces","worktree-setup","configure workspaces"],
  ["/rpi-setup-worktree","setup-worktree","worktree-setup","setup worktree"],
  ["/rpi-implement-plan","implement-plan","implementation","implement"],
  ["/rpi-implement-outline","implement-outline","implementation","implement from outline"],
  ["/rpi-iterate-implementation","iterate-implementation","implementation","iterate implementation"],
  ["/rpi-describe-pr","describe-pr","describe-pr","create pull request"],
  ["/rpi-ci-commit","ci-commit","implementation","commit changes"],
  ["/rpi-review-artifact-comments","review-artifact-comments","review","review comments"],
] as const;
export const ALIASES = { "create-worktree":"setup-worktree", "configure-workspace":"configure-workspaces",
  "create-research-plan":"create-research-questions", "create-outline":"create-structure-outline", "iterate-outline":"iterate-structure-outline" };
export const AUTO_ADVANCE = { // from label -> {flag | null (human gate), nextSkill, toLabel}
  "research-questions": { flag:"aa_questions_to_research", next:"create-research", to:"research" },
  "research":           { flag:"aa_research_to_design",    next:"create-design-discussion", to:"design" },
  "design":             { flag:null, next:"create-structure-outline", to:"structure" },
  "design-prd":         { flag:null, next:"create-tdd", to:"design-tdd" },
  "design-tdd":         { flag:null, next:"create-structure-outline", to:"structure" },
  "structure":          { flag:null, next:"create-plan", to:"plan" },
  "plan":               { flag:"aa_plan_to_worktree", next:"setup-worktree", to:"worktree-setup" },
  "worktree-setup":     { flag:"aa_worktree_to_implementation", next:"implement-plan", to:"implementation" },
  "implementation":     { flag:"aa_implementation_to_pr", next:"describe-pr", to:"describe-pr" },
};
export const WORKFLOWS = {
  rpi:          ["worktree?","research-questions","research","design","structure","implementation","describe-pr"],
  outline_only: ["research-questions","research","design","structure","implementation","describe-pr"],
  prd_tdd:      ["research","design-prd","design-tdd","structure","implementation","describe-pr"],
  oneshot: [], freeform: [],
};
export const FIRST_SKILL = { rpi:"create-research-questions", outline_only:"create-research-questions", prd_tdd:"create-research", oneshot:null, freeform:null };
export const BOARD_COLUMN = (label) => !label ? "todo"
  : ["research-questions","research","design","design-prd","design-tdd"].includes(label) ? "research_design"
  : ["structure","plan","worktree-setup"].includes(label) ? "planning" : "implementation";
```

Note: the extracted next step decides the actual successor (the skill's final-answer template names it), so `outline_only` skipping `plan` and `implement-outline` vs `implement-plan` fall out of the templates, not the table. The table is only consulted for the flag and the fallback when no extraction exists.

## 4. RPC contract (contract.ts)

All inputs `.strict()`, outputs typed; realtime signals tell the frontend to refetch.

| Method | Input → Output | Notes |
|---|---|---|
| `listTasks` | `{projectId?, archived?}` → `{tasks: TaskRow[]}` | TaskRow includes `latestLabel`, `column`, `sessionCount`, `updatedAt`, `isDraft` |
| `getTask` | `{taskId}` → `{task, sessions: SessionRow[], workspace: WorkspaceState}` | |
| `createTask` | `{request: NewThreadRequest, name?, workflowType, worktreeTiming, autoAdvance, draft: boolean}` → `{taskId, threadId?}` | Writes `task.md` artifact from `request.input` text; spawns first thread unless draft or `oneshot/freeform` with empty prompt |
| `updateTask` | `{taskId, patch: {name?, workflowType?, worktreeTiming?, autoAdvance?, aa_*?, archived?}}` → `{task}` | |
| `launchDraft` | `{taskId, request: NewThreadRequest}` → `{threadId}` | draft → task |
| `deleteDraft` | `{taskId}` → ok | only when `is_draft` |
| `listSessions` | `{projectId?}` → `{sessions: SessionRow[]}` | Sessions tab: status, title, label, task, working dir, updated |
| `getSession` | `{threadId}` → `{session, contextWindow: {used, limit, estimated} \| null, nextStep, workflow}` | timeline read for the gauge |
| `newSession` | `{taskId, skillId \| null, request: NewThreadRequest}` → `{threadId}` | "New session in task" from task detail |
| `proceed` | `{threadId}` → `{threadId}` | proceed-to-next-step button; uses extraction |
| `iterateInFreshSession` | `{threadId}` → `{threadId}` | context warning action: spawns `iterate-<phase>` |
| `forkSession` | `{threadId}` → `{threadId}` | `threads.fork({sourceThreadId, workspace:"reuse"})`, same task and label |
| `interrupt` | `{threadId}` → ok | `threads.stop` + `interrupted=1` |
| `listArtifacts` | `{taskId}` → `{artifacts: ArtifactRow[]}` | includes `commentCount` (unresolved, not deleted), `type` from frontmatter |
| `getArtifact` | `{taskId, fileName, version?}` → `{artifact, version, content: string \| null, isBinary, url}` | binary → `url` to `GET /artifact?v=<versionId>` |
| `listVersions` | `{artifactId}` → `{versions}` | |
| `saveArtifact` | `{taskId, fileName, content, expectedVersion?}` → `{version}` | UI edits; `expectedVersion` mismatch → `conflict` |
| `deleteArtifact` / `restoreArtifact` | `{artifactId}` → ok | soft, moves mirror to `.trash/` |
| `listComments` | `{artifactId, includeResolved}` → `{comments}` | |
| `createComment` | `{artifactId, versionId, contentText, anchor, blockText, prev, next, replyToId?}` → `{comment}` | |
| `updateComment` | `{commentId, resolved?, deleted?, contentText?}` → `{comment}` | |
| `sendCommentsToSession` | `{artifactId, threadId, resolve: boolean}` → ok | `threads.send({mode:"auto"})` with the threaded comments text; optional auto-resolve (HL `send-and-resolve`) |
| `getScratchPad` / `setScratchPad` | `{taskId}` / `{taskId, text}` | |
| `getPrefs` / `setPrefs` | kv-backed structured prefs (default provider/model/effort/tier, dismissed tips) | |
| `getWorkspaceState` | `{taskId}` → `WorkspaceState` | env status, path, branch, isWorktree, setupOutcome, error |
| `rerunWorkspaceSetup` | `{taskId}` → `{threadId}` | sends "re-run .bb-env-setup.sh and report" to the setup thread, or spawns one |
| `hydrateNow` | `{threadId}` → `{written, skipped}` | manual re-sync button |
| `openInEditor` | not a plugin RPC: frontend uses `useBbNavigate().experimental_openFileExternally({target:{kind:"workspace", environmentId, path:"."}})` | bb owns the editor preference |

Realtime channels: `tasks`, `sessions`, `artifacts:<taskId>`, `comments:<taskId>`, `notify` (payload in 8). Frontend always refetches by id after a signal.

## 5. Sessions: status derivation and lifecycle

### 5.1 HL status from bb state (sessions.ts, pure `deriveStatus(thread, interactions, row)`)

Evaluated in order; first match wins.

| Condition (bb) | HL status |
|---|---|
| `runtime.displayStatus` in `waiting-for-host, host-reconnecting` | `lost` |
| `runtime.displayStatus === "provisioning"` or environment status `provisioning` | `waiting_for_workspace` |
| `status === "pending"` (created, first dispatch not started, e.g. `sendAt` or plugin `wait`) | `ready_for_launch` |
| `status === "starting"` and `row.had_turn === 0` | `launching` |
| `status === "starting"` and `row.had_turn === 1` | `resuming` |
| `status === "active"` and a pending interaction with `payload.kind === "approval"` | `needs_approval` |
| `status === "active"` and a pending interaction with `payload.kind === "user_question"` or `"plugin"` | `ready_for_input` |
| `status === "active"` | `running` |
| `status === "stopping"` | `interrupt_requested` |
| `status === "error"` | `failed` |
| `status === "idle"` and `row.interrupted === 1` | `interrupted` |
| `status === "idle"` | `ready_for_input` |

`draft` is not a session status here (HL drafts are tasks without sessions). A `user_question` maps to `ready_for_input` because the agent is waiting for the human; HL never had a distinct status for it. This is a documented deviation.

### 5.2 Inputs that trigger re-derivation

- `bb.sdk.subscribe({event:"thread:changed"})` (one subscription, filter `id ∈ sessions`, changes ∩ {`status-changed`,`interactions-changed`,`environment-changed`,`title-changed`,`thread-deleted`,`archived-changed`}). On a hit: `threads.get({threadId, include:"environment"})` + `interactions.list` → derive → if changed, `UPDATE sessions SET hl_status, hl_status_at` → `notify.onTransition(prev, next, ...)` → publish `sessions`.
- `bb.events.on("thread.active")`: set `had_turn=1`, `interrupted=0`.
- `bb.events.on("thread.idle", {thread, lastAssistantText})`: run extraction (7), append summary, ingest the task dir (6.3), then re-derive (ensures `ready_for_input` fires after `next_step_json` is stored so auto-advance has its input).
- `bb.events.on("thread.failed")`: derive → `failed`.
- `bb.events.on("thread.archived" | "thread.deleted")`: mark session row `archived`/remove.
- `bb.experimental_hooks.on("message.dispatch")`: always `proceed`; used observe-only to label threads a user created inside a task with a `/rpi-<skill>` first message (sets `label`, `skill_id` when the session row exists and has no label). Never rejects, never waits.
- Startup reconciliation: `bb.background.service("reconcile")` walks `sessions` once on load and re-derives (plugin was down during changes), then idles until abort.

`interrupt` RPC sets `interrupted=1` before `threads.stop`; `thread.active` clears it.

### 5.3 Titles and labels

Title convention `<label-title>: <task name>` written with `threads.update({title})` at spawn. Label pill colors follow HL: research-questions blue, research green, design purple, structure pink, plan amber, worktree-setup gray, implementation green, describe-pr teal, review orange; rendered by `ui/session-status.tsx` (bell-slash + "idle" for `ready_for_input`, spinner for running, warning for needs_approval, dashed for lost).

### 5.4 Fork and queue

Fork: `threads.fork({sourceThreadId, workspace:"reuse", title})`, insert `sessions` row with same task/label, `launched_by:"fork"`. Queue is bb's (`queuedMessages` UI exists natively). Batch delivery (setting `preferBatchQueueDelivery`): on `thread.idle` if enabled and `queuedMessages.list` has ≥2 user rows without plugin waits, concatenate their texts into one `threads.send({mode:"auto"})` and delete the rows. Risk: races bb's own drain; ship last (phase 7) behind the setting default `false`, and drop if the drain wins the race in testing.

## 6. Artifacts

### 6.1 Identity and naming
Identity is `(task_id, file_name)`; every save is a new version. Free names allowed (`task.md`, `handoff.md`, `pr-description.md`, screenshots). Convention `NN-<type>-<slug>.md` is produced by the skills (`ls -la` the dir, max+1). `artifacts.ts` exposes `parseArtifactName(fileName) → {nn, type, slug} | null` and `frontmatter(content).type` for grouping: `research-questions, research, design-discussion, structure-outline, plan, prd, tdd, pr-description`, else OTHER.

### 6.2 Hydration (DB → workspace)
`mirror.hydrate(taskId, threadId)` runs on `thread.active` for the first turn of every task thread (and on `hydrateNow`):
1. `threads.get({include:"environment"})` → `environment.path`, `environment.hostId`. If null (personal/unmanaged null path) skip and log.
2. `files.mkdir(<path>/.humanlayer/tasks/<slug>)`, ensure `.git/info/exclude` contains `.humanlayer/` (read, append, CAS write).
3. For each live artifact: `files.read` (may 404) → if sha differs from current version, `files.write({rootPath: <path>/.humanlayer, expectedSha256: <onDisk or null>})`. On `conflict` (agent wrote concurrently) run ingest for that file first, then retry once.
4. Soft-deleted artifacts: move to `.trash/` if present.

### 6.3 Ingest (workspace → DB)
`mirror.ingest(taskId, threadId, fileName?)` runs on `thread.idle` for task threads and inside `hl_artifact_save`:
`files.listPaths(<taskdir>, includeFiles)` (skip `.trash/`) → `files.read` each → if sha ≠ current version sha → insert version `created_by = threadId, operation = "ingest"|"Write"`, update frontmatter, publish `artifacts:<taskId>`. New files become new artifacts. Files present in DB but missing on disk are left alone (deletion is explicit in the UI or via `.trash/`). Size cap 25 MB (files API cap); binaries stored as BLOB with `content_type` from extension.

### 6.4 Agent-facing tools (tools.ts, `bb.agents.registerTool`)
Scoping: `threadId → sessions.task_id`; a thread outside any task gets a tool error "not a HumanLayer task session".

| Tool | Params | Behavior |
|---|---|---|
| `hl_task_context` | `{}` | returns task name, slug, artifact dir, workflow, current label, artifact list (names + types). Cheap alternative to `ls` when the dir is missing |
| `hl_artifact_save` | `{file_name}` | ingest that one file now; returns `{version, permalink}` where permalink is the directive text ``::hl-artifact{task="<id>" file="<name>"}`` and the panel path `/plugins/humanlayer/tasks/<id>/artifacts/<name>` |
| `hl_get_artifact_comments` | `{artifact_filename, include_resolved?, limit?, offset?}` | threaded XML exactly like HL (truncated 8-char ids, `<comment id= author= resolved= block="...">`) |
| `hl_update_artifact_comments` | `{artifact_filename, comment_ids: string[], resolved?, deleted?}` | prefix-match truncated ids; ambiguous → error |
| `hl_reply_to_artifact_comment` | `{artifact_filename, comment_id, content}` | reply `created_by_agent=1` |
| `hl_next_artifact_number` | `{}` | max NN + 1 over live artifacts, zero-padded; optional convenience so skills stop relying on `ls -La` |

`bb.agents.configure` selects these six tools plus the `rpi-*` skills only for threads that are task sessions (others get none, keeping non-HL threads clean). `bb.agents.contributeInstructions` returns for task sessions (≤4096 chars):

```
HumanLayer task: <name> (slug <slug>). Task artifact directory: .humanlayer/tasks/<slug> (relative to the workspace root; a real directory, not a symlink).
Current phase: <label or none>. Workflow: <type>.
After writing or editing any file in the task artifact directory, call hl_artifact_save with its file name and include the returned permalink line in your final answer.
Research subagent model preference: <haiku model id | none>.
```

### 6.5 Permalinks
bb has no artifact viewer; the plugin's is `/plugins/humanlayer/tasks/<taskId>/artifacts/<fileName>` (navPanel deep link via `useBbNavigate().toPluginPanel("tasks", {subPath})`). In assistant messages the skills emit the `::hl-artifact{...}` directive (registered with `app.slots.messageDirective`), rendered as a chip that opens the Artifacts panel tab on that file (`useBbNavigate().openThreadPanel({actionId:"artifacts", params:{taskId, fileName}})`), falling back to `toPluginPanel`. Attributes are validated (uuid, safe relative file name).

### 6.6 Viewer
`ui/artifact-viewer.tsx`: Preview (host `Markdown`, split into blocks for comment anchoring, see 9) / Raw (host `experimental_SourceCode`); version selector; comments rail; "..." menu: rename (new file_name = move mirror), delete (confirm unless `confirmBeforeDeletingArtifacts` off), download, copy directive. Images via `GET /artifact?v=`; HTML artifacts render in a sandboxed iframe from the same route (`sandbox=""`, no scripts unless user clicks "Run scripts", mirroring HL's HTML escape hatch).

## 7. Next-step extraction (extraction.ts, pure)

Every ported final-answer template ends with a fenced block:

````
```text
/rpi-create-design-discussion
```
````

`extract(lastAssistantText)`:
1. Find the last fenced block whose body matches `^/rpi[-:]([a-z-]+)(\s+.*)?$`. Resolve aliases. Unknown skill → `{type:"no_next_step", reason:"unknown skill <x>"}`.
2. Result `{type:"next_step_found", nextStepPrompt:"/rpi-<skill>", nextStepSummary:<button text>, nextStepType:<skillId>, suggestedDirectory: null}`. `plan_final_answer_in_worktree.md` variants mention "in the worktree"; the executor decides directory from task state, not the text.
3. No block → `{type:"no_next_step", reason:"no command block"}`.

Stored in `sessions.next_step_json` with `parsedAt`. No model call: HL used AI because Claude free-texts; our templates are deterministic. If a skill final answer drifts, the proceed button simply does not light up. One `node:test` covers each template file in `skills/*/references/*final_answer*.md` (parse the sample block → expected skill).

Structured summary: `summary_json.summaryHistory.push(firstNChars(lastAssistantText, 600))` per idle. Used by the sessions table and the auto-advance prompt suffix.

## 8. Auto-advance executor (advance.ts)

```ts
async function onReadyForInput(row) {                    // called by sessions.ts after status commit
  const ns = parse(row.next_step_json); if (ns?.type !== "next_step_found") return;
  const t = AUTO_ADVANCE[row.label]; if (!t) return;      // unknown label, freeform
  const task = getTask(row.task_id);
  const on = t.flag !== null && task.auto_advance && task[t.flag];   // human gate when flag === null
  if (!on) return;
  // idempotency: exactly one successor per session
  if (db.run(`UPDATE sessions SET advanced_at=? WHERE thread_id=? AND advanced_at IS NULL`, now, row.thread_id).changes !== 1) return;
  await launchPhase(task, ns.nextStepType, { launchedBy: "auto_advance", fromThreadId: row.thread_id });
  notify.suppressReadyToast(row.thread_id, row.hl_status_at);   // rule 3 in section 10
}
```

`launchPhase(task, skillId, opts)` (shared by auto-advance, `proceed`, `iterateInFreshSession`, `newSession`, `launchDraft`):
1. Environment selection by worktree timing:
   - `never`: `{type:"reuse", environmentId: task.base_environment_id}` (set on first spawn from `project-default` → read back `thread.environmentId`).
   - `now`: first spawn uses `{type:"host", hostId, workspace:{type:"managed-worktree", baseBranch:{kind:"default"}}}`; store `worktree_environment_id`; all later phases `reuse` it.
   - `later`: pre-implementation phases `reuse base_environment_id`; the first spawn of a skill whose label is `worktree-setup` or `implementation` (when no worktree exists) uses `managed-worktree`, stores `worktree_environment_id`; everything after reuses it. This matches "Worktree later: create before implementation".
2. Prompt: `"/rpi-<skill>\n\nTask artifact directory: .humanlayer/tasks/<slug>"` (plain text; the skill is in the skills tier so the slash line is enough for every provider). For `oneshot/freeform` the prompt is the user text.
3. `threads.spawn({projectId, environment, prompt, title: "<label-title>: <name>", providerId/model/reasoningLevel/serviceTier from task (fallback prefs), permissionMode: task.permission_mode, executionInputSources: explicit})`; insert `sessions` row (`hl_status:"launching"`); `hydrate` runs on `thread.active`.
4. Publish `sessions`, `tasks`.

Manual controls: composer action "proceed" (green when `next_step_found`) → `proceed` RPC (same path, `launchedBy:"proceed"`, also stamps `advanced_at`). Fast-forward action toggles `task.auto_advance`. Per-transition toggles live in the Auto-advance tab. Design, structure and plan are never auto-advanced (flag `null`).

SDK gap flagged: `suggestedDirectory` (HL lets the extraction pick a directory) is dropped; directory is always the task environment.

## 9. Comments

Anchor model = HL's text-block anchor. Preview splits markdown into blocks on blank lines (code fences kept whole). Creating a comment on block `i` stores `{blockIndex:i, selectedText, start, end}` plus `block_text/prev/next`. Re-anchoring against a newer version: exact `block_text` match → else match `prev+next` → else "orphaned" (shown at the top of the rail). `ponytail:` no fuzzy matching; add Levenshtein if orphaning is common.

UI: hover a block → "+" → textarea → Save; rail lists threads with resolve/reply/delete; counter on the Artifacts list. "Send to session" picker (task sessions, default the latest) posts:

```
Comments on .humanlayer/tasks/<slug>/<file>:
<comment id=1a2b3c4d resolved=false block="...">text</comment> ...
Please address them (use hl_get_artifact_comments for the full thread and hl_update_artifact_comments when done).
```

via `threads.send({threadId, mode:"auto", input:[{type:"text", text}]})`; with `send-and-resolve` mode also sets `is_resolved=1`. Inbound comment notification (rule 3 in 10) fires when `created_by_agent=1` (agent replied).

## 10. Notification engine (notify.ts)

Server decides, frontend renders. `notify.onTransition(threadId, prev, next, at)` and `notify.onAgentComment(comment)`:

Triggers (exactly HL's):
1. `prev !== "ready_for_input" && next === "ready_for_input"` → kind `ready_for_input`.
2. `next === "needs_approval"` with a newly pending approval interaction id → kind `needs_approval` (id = interaction id, so a second approval in the same running turn notifies again, matching "approval row inserted").
3. agent comment inserted → kind `comment`.

Suppression, in order:
1. `notified` table already has the id → skip everything.
2. (HL: not `created_by`) single user → n/a.
3. Auto-advance covers this label's transition and fired (`advanced_at` set by the executor in the same tick) → skip toast, still launch (already done). Sound is still played for `needs_approval` only (HL keeps approvals unsuppressed).
4. User is viewing the thread → play sound, skip toast, and any pending toast for that thread is dismissed when the user navigates to it.

Publish `bb.realtime.publish("notify", {id, kind, threadId, taskId, title, description, toolName?, toolInput?, suppressToast})`. `title` is the raw status word (`ready_for_input` bold / `needs_approval` warning color); `description` = thread title or summary truncated to 40/50 chars, else `Session <id8>`; approval adds `` `tool` using `input(47)...` `` with `mcp__a__b` → `a:b`.

Frontend (`ui/notifications.ts`, mounted by `app.contentScripts.register`):
- `useRealtime` is a React hook, so the content script opens nothing itself; instead a zero-UI component `<NotificationBridge/>` is mounted from the `experimental_threadHeaderAction` slot (present on every thread page) and from the nav panel; the module-level singleton dedupes by `id` so several mounted bridges cause one toast. Viewing detection: the header action component adds/removes its `threadId` in `viewing: Set<string>`; the bridge reports `viewing` back through RPC? No: the server does not need it; rule 4 is applied client-side (sound yes, toast no) because only the client knows what is on screen. Rule 3 stays server-side. Both documented.
- Sound: `new Audio("/api/v1/plugins/humanlayer/http/sound")`, `volume = settings.notificationVolume/100`, gated by `notificationSoundsEnabled`. Autoplay policy: first play may be blocked until a user gesture; log once, do not retry loop.
- Toast: `toast(title, {description, duration: 8000, action:{label:"Jump to Session ⌘⇧J", onClick: () => navigate.toThread(threadId)}})`; pending toasts kept in a stack; keydown `Meta+Shift+J` (Ctrl on non-mac) jumps to the most recent and pops it. `toast.dismiss(id)` when `useBbContext().threadId` becomes that thread.
- Reconnect: on `useRealtimeConnectionState()` → `connected` (not first), refetch `listSessions` and show nothing (signals are ephemeral; missed notifications are not replayed, documented).

## 11. Frontend surfaces (app.tsx)

| Surface | Slot | Content |
|---|---|---|
| Tasks page | `navPanel {id:"tasks", path:"tasks", icon:"Layers", headerContent: CreateTaskButton}` | subPath router: `""` Tasks (LIST/BOARD toggle, EVERYTHING/MINE hidden since single user), `sessions` table, `drafts`, `new`, `<taskId>` detail, `<taskId>/artifacts/<file>` viewer. Board columns TODO / DRAFT, RESEARCH & DESIGN, PLANNING, IMPLEMENTATION with cards (name, age, label pill). List columns Name, Step, Sessions, Created, Updated. Sessions columns Status, Title, Labels, Task, Working directory, Updated (row click → `toThread`) |
| Create task | `new` subPath, `experimental_NewThreadComposer` seeded from prefs, plus a plugin row beneath: workflow type select (RPI / PRD-TDD / Freeform; `outline_only` selectable in settings as default), worktree timing select with the three HL copy lines, auto-advance toggle, "Save as draft". `onSubmit(request)` → `createTask`. Workflow strip (`workflow-strip.tsx`) under it. "Recent drafts" list |
| Task detail | tabs via `fixedTabs` (`panelId:"tasks"`): Artifacts, Workspace, Scratch pad, Auto-advance, Tips. Main body: task header (name edit, workflow, timing, archive), sessions list, "New session" composer (`NewThreadComposer` + phase picker), and `ThreadChat` for the selected session (`variant:"full"`, `layout:"contained"`) so the HL layout (task → session → right tabs) exists inside the plugin page too |
| Thread right panel | `threadPanelAction` x5: `artifacts` (layout flush), `workspace`, `scratch-pad`, `auto-advance`, `tips`. Each component resolves `threadId → task` via `getSession`; a non-task thread shows "Not a HumanLayer task session" with a "Create task from this thread" action (adopts the thread as a `freeform` task) |
| Thread header | `experimental_threadHeaderAction`: label pill + HL status glyph + context gauge `used/limit (pct)` + proceed button + fast-forward toggle + fork. Also hosts the viewing-set registration and the notification bridge |
| Composer | `app.composer.customize({scopes:["thread"], actions:[Proceed, AutoAdvance], banners:[ContextWarning]})`; banner appears at ≥70% context with "Iterate in a fresh session" (calls `iterateInFreshSession`) and "Dismiss" (per thread, in `task_ui_state`), gated by tips setting `showIterateConfirmation`. Bypass toggle is not duplicated: bb's permission picker owns it |
| Message directive | `messageDirective {id:"hl-artifact"}` → chip opening the artifact |
| Palette | `commandPaletteAction`: "HumanLayer: create task" (T), "HumanLayer: tasks" (g t), "HumanLayer: jump to notified session" |
| Sidebar | `experimental_threadList` (phase 7, opt-in by installing; user can pin bb's): DRAFTS n / TASKS n headers, task rows with label pill and age, child session rows with `<label>: <title>`, bell-slash idle glyph from `indicator`/our status map, LABELS toggle at the bottom (`showTaskPhaseLabels`). Rows carry `data-sidebar-thread-shortcut-target` and `data-sidebar-thread-id`; actions from `experimental_useSidebarThreadActions` |
| Settings | declarative descriptors (below) + `settingsSection` with `experimental_ProviderModelPicker` and `experimental_PermissionModePicker` bound to prefs, volume `Slider`, and the Tips toggles |

Settings descriptors (`bb.settings.define`):
`notificationSoundsEnabled` bool(true), `notificationVolume` select 0..100 step 10 (default "20"), `defaultWorkflowType` select rpi|outline_only|prd_tdd|oneshot|freeform (default `outline_only`, HL's), `defaultWorktreeTiming` select (later), `defaultAutoAdvance` bool(false), `preferBatchQueueDelivery` bool(false), `diffStyle` select unified|split (used by any `experimental_Diff` the plugin renders; bb's own diff panel has its own preference, flagged), `showTaskPhaseLabels` bool(true), `workflowGraphEnabled` bool(true), `scratchPadEnabled` bool(true), `haikuResearchSubagents` bool(false), `confirmBeforeDeletingArtifacts` bool(true), `sendCommentsMode` select send|send-and-resolve, tips: `showPhaseTips`, `showIterateConfirmation`, `showBypassNudge`(unused, kept for parity? no: dropped, bb owns permissions). Default editor: dropped, bb's external-open preference owns it. Zoom, theme, streaming, keybinding remaps: bb owns; dropped.

Styling: host token classes only; label colors via a small palette map of Tailwind default-theme utilities (`text-blue-400 border-blue-400/40`), which the build emits.

## 12. Skills and agents porting (skills/)

Copy all 22 `riptide-rpi-terminal/0.30.34/skills/*` and `riptide-humanlayer/0.1.3/skills/show-me` to `skills/rpi-<name>/` (show-me keeps `show-me`), references directories intact. Frontmatter `name: rpi-<name>`; keep `description: Only use when the user explicitly invokes this skill by name.` Mechanical edits applied to every SKILL.md and reference:

| Original | Replacement | Why |
|---|---|---|
| `/rpi:<skill>` (incl. in `text` fences) | `/rpi-<skill>` | bb slash names; extraction parser accepts both |
| `{SKILLBASE}/references/...` | `references/...` relative to the skill dir | bb skills are directories; agent reads relative path (bb resolves skill file paths; verify with `bb skill files` in phase 3) |
| "task artifact directory from your system prompt" | unchanged wording; provided by `contributeInstructions` | |
| `ls -La` + "may be a symlink, do NOT use ls/grep/glob" | `ls -la` (real directory; Glob allowed) | no symlink |
| `.humanlayer/tasks/<slug>` | unchanged | same path |
| `mcp__humanlayer__get_artifact_comments` etc. | `hl_get_artifact_comments`, `hl_update_artifact_comments`, `hl_reply_to_artifact_comment` | native tools |
| "cloud permalink from the hook" | "the permalink returned by `hl_artifact_save`" + directive line | 6.5 |
| "Use the Task tool with `subagent_type=<agent>`" | `bb thread spawn --parent-self --project $BB_PROJECT_ID --environment $BB_ENVIRONMENT_ID --title "<agent>: <short>" --prompt "Use the rpi-agent-<agent> skill. <instructions>"` then `bb thread wait <id>` and `bb thread output <id>`; parallel agents = spawn all, then wait each | bb subagents |
| `haiku` research subagents experiment | append `--model <id>` when the instructions block names a research-subagent model | setting `haikuResearchSubagents` |
| `setup-worktree`/`configure-workspaces`: `.humanlayer/workspace.json` templates, `setupCommand`, `copyGlobs` | keep the JSON schema; text now says: the worktree already exists (bb managed worktree, `git worktree list`), `setupCommand` maps to `.bb-env-setup.sh` (create it if missing, tracked), `copyGlobs` copied by the skill with `cp` from `repos[].localPath` | SDK gap |
| `describe-pr`: PR creation | keep template; use `gh`/`glab` as before or `bb env pr` when available (`bb.sdk.environments.pullRequest` exists read-side; creation stays CLI) | |
| `ci-commit` | unchanged apart from paths | |
| Final answers "You can view the full artifact in the right sidebar" | "...in the Artifacts tab" | |

Agents → skills `skills/rpi-agent-<name>/SKILL.md` for `codebase-locator, codebase-analyzer, codebase-pattern-finder, web-search-researcher, implementer-agent, implementation-reviewer, outline-implementer-agent`. Body = agent prompt verbatim; frontmatter `tools`/`model` lines dropped (bb child threads get the provider's tools; model via `--model`). `implement-plan`/`implement-outline` keep the orchestrator loop (implementer child → reviewer child → pause for "commit and proceed"), which is the context strategy.

Fidelity checks (reviewer): research skills still forbid reading `task.md`; research-questions still forbids leaking intent; every `create-*` template still ends with the `text` command block; no `/rpi:` left (`grep -r "rpi:" skills/` must be empty except the label strings in transitions.ts).

## 13. Deliberate omissions (bb owns it or no local equivalent)

Changes tab and Diffs tab (bb environment diff panel), Minimap (bb timeline/outline), terminal (bb), permissions/bypass toggle (bb picker), editor choice (bb open-externally), theme/zoom/keybindings (bb), multiplayer prompting, Slack mute, Linear/Jira/GitHub ticket import, billing/PAT/daemons/sync pages, context shards (cross-session AI facts; bb memory plugin covers the need), cloud sharing (`share_enabled`), `$cost` (no pricing table), AI title generation (bb titles threads itself), diff comments (would need bb's diff panel to expose anchors; not available). Each is listed in the README as "provided by bb" or "not replicated".

## 14. Test plan

Pure modules (`node --test`, no bb): `transitions` (table equals the study), `extraction` (every shipped final-answer template resolves to the expected skill; alias; no-block; unknown skill), `deriveStatus` (one case per row of 5.1 incl. `resuming` vs `launching`, `interrupted`, `lost`), `advance` decision (flag on/off, human gate, task master off, idempotent `advanced_at`), `artifacts` naming/frontmatter/grouping, `comments` re-anchoring (exact, neighbors, orphan), `notify` (three triggers, suppression order, description truncation 40/50, `mcp__a__b` → `a:b`, duplicate id).

Backend harness (`createFakePluginHost`, vitest): `createTask` → recorded `threads.spawn` with correct environment for each worktree timing; `thread.idle` with a templated final answer → `next_step_json`, ingest via stubbed `files.listPaths/read`, `ready_for_input` transition, auto-advance spawn recorded once even if `thread.idle` is emitted twice; approval interaction → `needs_approval` signal with tool text; `hl_*` tools via `callAgentTool` incl. out-of-task error and truncated-id ambiguity; hydrate writes with `rootPath` confinement and handles `conflict`; `lifecycle.dispose` then stale use throws nothing unhandled (guards like the simulator's `disposed` flag).

Frontend (`renderSlot`, jsdom): board groups by column; create-task submits `createTask` with the row values; artifacts panel groups by frontmatter type and shows counts; directive chip opens the panel (`navigateCalls`); notification bridge shows one toast for duplicate signals and dismisses on route change.

Live loop (bb 0.41 + a scratch repo): create RPI task with worktree later → questions → auto-advance to research → design gate shows proceed → structure → plan → auto-advance creates a managed worktree → implementation runs the orchestrator with child threads → describe-pr; verify `.humanlayer/tasks/<slug>/` contents equal the Artifacts tab, comment round trip through `hl_get_artifact_comments`, toast + sound + ⌘⇧J, `bb plugin reload` mid-run leaves no orphan state (reconcile service).

## 15. Phased delivery (each phase ships)

| # | Scope | Model | Reviewer checks |
|---|---|---|---|
| 1 Scaffold + tasks | package, DB migrations 0..4, `tasks.ts`, `listTasks/createTask(draft only)/updateTask`, nav panel with board/list/drafts, create-task page (composer row, workflow strip), settings descriptors | Haiku 4.5 / gpt-5.4-mini | manifest fields, migrations append-only, RPC schemas strict, no host component misuse |
| 2 Sessions | spawn first thread from `createTask`, `sessions.ts` derivation + subscription + reconcile, sessions table, header action (pill, status, fork, interrupt), `contributeInstructions/configure`, `message.dispatch` labeling | Sonnet 5 | 5.1 table exhaustive; event idempotency; `had_turn`/`interrupted` semantics; stale-`bb` guards |
| 3 Artifacts | `artifacts.ts`, `mirror.ts` hydrate/ingest, `hl_artifact_save`, `hl_task_context`, `hl_next_artifact_number`, Artifacts tabs (thread + task), viewer Preview/Raw/versions/delete/restore, `/artifact` route, directive | logic Sonnet 5, UI Haiku | CAS conflict path, `rootPath` confinement, `.git/info/exclude` append, binary caps, soft delete + `.trash/` |
| 4 Skills + extraction + proceed | port 23 skills + 7 agent skills, `extraction.ts`, summary, proceed button, workflow strip live state, tips tab | porting: gpt-5.4-mini with a checklist; extraction: Sonnet 5 | grep-level fidelity (12), every template parses, no intent leakage edits, child-thread commands correct |
| 5 Auto-advance + worktree | `advance.ts`, worktree timing environments, Auto-advance tab, Workspace tab, `rerunWorkspaceSetup`, `hydrateNow` | Sonnet 5 | double-fire guard, human gates never auto-advance, environment choice per timing, provisioning → `waiting_for_workspace` |
| 6 Notifications | `notify.ts`, `/sound`, bridge, toasts, ⌘⇧J, viewing detection | Sonnet 5 (rules) + Haiku (UI) | suppression order, approval text format, 8s, dedupe across mounted bridges, autoplay failure handling |
| 7 Comments | schema use, viewer blocks + rail, three `hl_*` comment tools, send-to-session, agent-comment notification | Sonnet 5 | anchor re-attachment, truncated-id prefix ambiguity, XML escaping |
| 8 Polish | scratch pad, context gauge + iterate banner, prefs section with pickers, `experimental_threadList`, palette actions, batch queue delivery (behind setting), README of omissions | Haiku / gpt-5.4-mini; threadList: Sonnet 5 | DOM shortcut attributes on rows, fallback to `Original`, batch-delivery race evidence or removal |

Expensive reviewers (Opus 4.1 / GPT-5.4 high) review phases 2, 5, 6, 7 only, with these questions: does the derivation/transition code match the study's tables literally; where can two events produce two spawns or two toasts; can any `files.write` escape the task dir; what happens on reload mid-turn; does any ported skill instruct reading `task.md` during research; are secrets or absolute host paths leaking to the frontend.

## 16. Risks

1. **No file-write hook.** Ingest happens at `hl_artifact_save` and `thread.idle`; an artifact edited mid-turn is not visible in the panel until then. Mitigation: skills call the tool right after writing; the panel shows "syncing at end of turn" while `running`.
2. **Skill slash invocation across providers.** `/rpi-x` in a prompt is understood because the skill body is in the skills tier; if a provider strips unknown slash commands, fall back to the mention input `{kind:"command", source:"skill", name}` in `threads.spawn.input` (schema exists). Verify in phase 4 on codex and claude-code.
3. **Worktree only via thread spawn.** Worktree creation cost lands on the first worktree-phase thread; if provisioning fails the session is `failed` and the Workspace tab shows the hook log. No retry-step API.
4. **Sidebar replacement is exclusive.** Ship it last and keep the plugin fully usable with bb's own list (the nav panel is the primary surface).
5. **Realtime signals are ephemeral.** Missed notifications after a disconnect are not replayed; the notified table prevents duplicates but not misses. Acceptable for a local single-user app.
6. **`contributeInstructions` is sync and 4096 chars.** A synchronous better-sqlite3 point read by `threadId` is fast enough; keep the text short and return `null` for non-task threads.
7. **Batch queue delivery races bb's drain.** Behind a default-off setting; remove if the phase 8 test shows lost or duplicated messages.
8. **Extraction fragility.** Deterministic parser depends on templates staying intact; the test in 14 fails the build when a template loses its command block.
9. **Cross-plugin tool name collisions.** `hl_` prefix; registration failure surfaces in `bb plugin list` detail.
10. **Frontmatter parser ceiling.** Flat scalars only; nested YAML in a template would misgroup as OTHER (visible, not destructive).
