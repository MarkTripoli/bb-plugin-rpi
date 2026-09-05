---
type: plan
author: astra
topic: HumanLayer system inside bb
status: proposed
date: 2026-09-05
bb_version: 0.41.0
bb_plugin_sdk: 0.4.34
---

# HumanLayer inside bb: implementation plan

## 1. Decision and evidence

Build one plugin, `bb-plugin-humanlayer`, with plugin id `humanlayer`. Its SQLite database owns tasks, artifact bytes and versions, comments, phase metadata, advancement decisions, notification receipts, and preferences. A HumanLayer session is a real bb thread. A task workspace is a set of references to bb environments. The plugin never creates a second agent runtime, conversation store, permissions engine, Git worktree manager, terminal implementation, or diff renderer.

The complete product is achievable as a bb-native adaptation. Exact HumanLayer infrastructure parity is not available from SDK 0.4.34 alone: there is no post-provision/pre-provider hook, idempotent spawn key, general provider-tool interception, environment-only creation API, or multi-repository layout manager. The implementation must expose these differences and pass the acceptance gates below. Do not declare a literal replica complete by hiding unsupported settings behind working-looking controls.

### Sources read and contract precedence

1. [HumanLayer study](01-research-humanlayer-system.md), read completely, is the behavioral authority. Its workflow table, not a redesigned RPI graph, defines automatic transitions.
2. Viewed [22-settings](shots/22-settings.png), [41-artifacts](shots/41-artifacts.png), [42-workspace](shots/42-workspace.png), [45-create-task](shots/45-create-task.png), [47-worktree-dd](shots/47-worktree-dd.png), [52-board](shots/52-board.png), [53-sessions](shots/53-sessions.png), and [01-home](shots/01-home.png). Also viewed 13-workspace, 43-scratchpad, 48-autoadvance, and 27-tips. Filenames are misleading: 42 shows Changes, 43 shows Workspace, and 13 shows Tips. Use visible content as evidence.
3. Ran `ls ~/.bb/runtime/global-skills/*/skills/bb-plugin-authoring/`. Read `SKILL.md` and all requested references under `/Users/marktripoli/.bb/runtime/global-skills/997afc84850a38263e8aceaa7efb0e036657d9553f12f90aa4a1f64507c38a28/skills/bb-plugin-authoring/`: quickstart, backend-foundation, backend-sdk, backend-events, backend-cli-agents, frontend-registration, frontend-core-slots, frontend-components, frontend-hooks-and-ui, testing.
4. Inspected exact declarations at `/Users/marktripoli/PersonalDevelopment/bb-plugin-simulator/node_modules/@get-bb/plugin-sdk/bundled-types/bb-plugin-sdk.d.ts`. `bb plugin types /Users/marktripoli/PersonalDevelopment/bb-plugin-simulator --check` confirmed installed pin and running host are both **0.4.34**. `bb --version` returned **0.41.0**. Types take precedence over illustrative reference snippets.
5. Read simulator `package.json`, `server.ts`, and `app.tsx`. Reuse its typed `defineRpcContract`, type-only frontend contract import, bounded tool results, validated persisted tab parameters, realtime invalidation/refetch, and disposal conventions. Its server-local device access is specific to that plugin; do not copy that routing for repository files.
6. Inspected the installed RPI skill/agent inventory and implementation, workspace, plan, and comment procedures. There are **22** `SKILL.md` files in `riptide-rpi-terminal/0.30.34`, plus **show-me** in `riptide-humanlayer/0.1.3`: 23 total. There are seven RPI agents. The study remains authoritative where older installed prompts differ, including requiring an implementation reviewer.
7. Spot-checked `K9n`, readiness notifications, and approval notifications in the supplied frontend bundle. This confirms that auto-advance suppression applies to readiness notifications before sound playback; approvals have their own unsuppressed sound path. No cloud service is needed to reproduce these rules.

This document is a plan only. No plugin has been built or installed, and no runtime acceptance check has passed yet.

## 2. Ownership, package layout, and SDK map

Single-user means one local owner identity, generated once in plugin storage. No organization tables, authentication service, billing, multiplayer, Slack delivery, ticket-provider synchronization, or public artifact sharing. Optional ticket identifiers/URLs and imported `ticket.md` remain supported as task metadata. “Everything” and “Mine” are equivalent locally; show one useful task filter rather than fake users.

```text
bb-plugin-humanlayer/
  package.json                  # bb.server, bb.app, bb.host, bb.skills
  package-lock.json
  tsconfig.json
  components.json               # version-pinned bb vendored UI registry
  server.ts                     # registration, RPC/CLI/tools, disposal
  contract.ts                   # Zod DTOs and defineRpcContract
  database.ts                   # append-only migrations and concrete queries
  tasks.ts                      # task/draft/session creation and association
  workflow.ts                   # skill labels, status reducer, transition policy
  executor.ts                   # durable operations, recovery, phase launch
  artifacts.ts                  # versions, CAS import/export, comments, anchors
  workspace.ts                  # config translation and bb environment references
  notifications.ts              # eligibility, receipts, formatting
  context.ts                    # extraction, usage projection, shards and handoff
  host.ts                       # artifact watch signals and explicit editor opener
  host-contract.ts              # narrow watch/open-directory host calls
  app.tsx                       # slots, hooks, native component integration
  app.css                       # scoped styles using bb theme tokens
  ui/tasks.tsx                  # board, list, drafts, session table, detail
  ui/artifacts.tsx               # DB viewer, versions, block comments
  ui/panels.tsx                  # workspace, scratch, tips, auto-advance, minimap
  ui/settings.tsx
  ui/notification-client.ts      # shell-wide sound, toast, hotkey lifecycle
  components/ui/                # only the vendored controls actually used
  lib/                          # support files required by those controls
  assets/notification.mp3
  skills/<23 names>/SKILL.md
  skills/<name>/references/      # templates, final answers, show-me guidance
  skills/<name>/scripts/         # only scripts referenced by that skill
  agents/<7 names>.md            # role prompts read by delegation commands
  tests/backend.test.ts         # SDK fake host + real SQLite
  tests/workflow.test.ts         # reducer/transition/recovery tables
  tests/artifacts.test.ts        # CAS, anchors, bytes, deletion conflicts
  tests/app.test.tsx             # SDK frontend harness
  tests/skills.test.ts           # catalog + template/command consistency
  tests/live.spec.ts             # actual bb/provider/browser acceptance
  README.md
  THIRD_PARTY_NOTICES.md
```

Keep these as ordinary functions and SQL statements, not repository interfaces, workflow classes, event buses, or an ORM. Split modules by the failure boundaries above. Runtime dependencies: Zod 4 for public contracts; a maintained YAML parser for frontmatter; a Markdown parser with source positions for block anchoring. Reuse a suitable already-installed parser if the scaffold provides one. Do not invent a Markdown/YAML parser. bb supplies React, source/diff rendering, Sonner, and SQLite at runtime. Declare SDK 0.4.34 and host-shim type packages as exact/pinned development dependencies according to `bb plugin types`; declare unshimmed build/runtime packages normally. Tests can use the SDK harness with Node's runner for pure modules and Vitest/jsdom for React.

Manifest: `type: module`, `bb.name: HumanLayer`, `bb.description`, `bb.branding.icon`, `bb.server: ./server.ts`, `bb.app: ./app.tsx`, `bb.host: ./host.ts`, `bb.skills: ["skills"]`, and tested `engines.bb`/`engines.bbPluginSdk` ranges. Start with `>=0.41.0 <0.42.0` and `>=0.4.34 <0.5.0`; expand only after testing newer experimental contracts. Copy the supplied sound only after verifying redistribution permission; otherwise a licensed replacement is an explicit audio-fidelity difference.

| Feature | Exact public surfaces | Plugin responsibility / boundary |
|---|---|---|
| Tasks, drafts, board | `bb.storage.database`, `bb.storage.migrate`, `bb.rpc.register`, `defineRpcContract`, `app.slots.navPanel`, `app.slots.homepageSection` | Task records, filters, grouping, draft persistence, routes |
| Create a session | `experimental_NewThreadComposer`, `bb.sdk.threads.spawn`, `projects.list({includePersonal:true})` | Preserve `NewThreadRequest` inputs, selection provenance and task metadata |
| Existing session | `ThreadChat`, `bb.sdk.threads.get/list/update/stop/archive/unarchive` | Session association, labels, derived status; host owns transcript/composer |
| Fork and delegation | `bb.sdk.threads.fork/spawn/wait/output`, `childSummary`, `parentThreadId` | Fork metadata, fresh phase distinction, seven role prompts |
| Queue | `bb.sdk.threads.queuedMessages.create/list/update/delete/send/reorder/setGroupBoundary`, `threads.send` | Task-level batching preference and small interrupt-delivery sidecar |
| Approvals/questions | `threads.interactions.list/get/resolve/respond/cancel`, `ThreadChat` | Observe and classify; native UI handles provider approval choices |
| Runtime projection | `bb.events.on`, `bb.sdk.subscribe`, `threads.events.list`, `threads.timeline/output` | Ordered, replayable status/usage/extraction projection |
| Dispatch coordination | `bb.experimental_hooks.on("message.dispatch")`, `.recheck("message.dispatch")` | Bind task, pause existing-environment sends for hydration; cold-start exception below |
| Artifacts | `bb.sdk.files.read/write/listPaths/mkdir/move/createPreview`, `bb.http.route` | DB bytes, versions, safe mirrors, private viewer routes |
| Agent artifact/comments access | `bb.agents.registerTool/configure/contributeInstructions`, `bb.cli.register` | Task-scoped native tools, CLI equivalents; no separate MCP daemon |
| Workspace | `threads.spawn({environment:...})`, `environments.get/status/paths`, `hosts.list/get/pathsExist` | Reference bb-owned environments and display setup progress |
| Changes / diffs | `environments.diffFiles/diffFile/diff`, `experimental_Diff`, `experimental_SourceCode`, `experimental_FileLink` | Metadata and review comments only; never parse Git output to make another viewer |
| Scratch/tips/phase controls | `app.slots.threadPanelAction`, `app.composer.customize`, `experimental_threadHeaderAction` | Per-task notes and workflow controls around native chat |
| Notification UI | `app.contentScripts.register`, shimmed `sonner.toast`, browser `Audio`, `useBbContext` in slots | Client sound/toast policy and cleanup; shell script uses bounded RPC polling |
| Preferences | `bb.settings.define`, handle `.get/.onChange`, `useSettings`, `app.slots.settingsSection`, `experimental_ProviderModelPicker`, `experimental_PermissionModePicker` | Own values only; host reconciles providers and permission ceilings |
| Background recovery | `bb.background.service`, `bb.background.schedule`, `bb.onDispose` | Resume durable plugin work and refetch after reconnect |
| Host watches/editor | `experimental_defineHostEntry`, `bb.hosts.experimental_client`, `experimental_onSignal`, `experimental_onWorkerExit`, `context.experimental_watch` | Watch invalidations; launch selected editor on explicitly resolved host |
| Navigation | `useBbNavigate().toThread/toPluginPanel/openThreadPanel/experimental_openFilePreview/experimental_openFileExternally`, `UrlLink` | Stable DB artifact routes and explicit file targets |

## 3. Database schema and invariants

Use the real better-sqlite3 connection returned by `bb.storage.database()`, its WAL/busy timeout, `PRAGMA foreign_keys=ON`, and `bb.storage.migrate(db, statements)` with append-only statement order. Times are epoch milliseconds; IDs are UUIDs from `crypto.randomUUID()`. A bb ID is an external reference, not a foreign key into bb.db. Never query/write bb's private tables.

The following is the initial schema, not a copy of HumanLayer's cloud schema. JSON columns are validated against strict Zod schemas before writing and again when loading old records.

```sql
PRAGMA foreign_keys = ON;

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 500),
  slug TEXT NOT NULL,
  is_draft INTEGER NOT NULL DEFAULT 1 CHECK(is_draft IN (0,1)),
  archived_at INTEGER,
  workflow_type TEXT NOT NULL DEFAULT 'rpi'
    CHECK(workflow_type IN ('rpi','outline_only','prd_tdd','oneshot','freeform')),
  worktree_timing TEXT NOT NULL DEFAULT 'later'
    CHECK(worktree_timing IN ('now','later','never')),
  selected_host_id TEXT NOT NULL,
  selected_directory TEXT NOT NULL,
  environment_id TEXT,
  setup_status TEXT NOT NULL DEFAULT 'pending'
    CHECK(setup_status IN ('pending','in_progress','completed','failed')),
  setup_details_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(setup_details_json)),
  workspace_spec_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(workspace_spec_json)),
  draft_request_json TEXT CHECK(draft_request_json IS NULL OR json_valid(draft_request_json)),
  execution_defaults_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(execution_defaults_json)),
  ticket_json TEXT CHECK(ticket_json IS NULL OR json_valid(ticket_json)),
  auto_advance_questions_to_research INTEGER NOT NULL DEFAULT 0 CHECK(auto_advance_questions_to_research IN (0,1)),
  auto_advance_research_to_design INTEGER NOT NULL DEFAULT 0 CHECK(auto_advance_research_to_design IN (0,1)),
  auto_advance_plan_to_worktree INTEGER NOT NULL DEFAULT 0 CHECK(auto_advance_plan_to_worktree IN (0,1)),
  auto_advance_worktree_to_implementation INTEGER NOT NULL DEFAULT 0 CHECK(auto_advance_worktree_to_implementation IN (0,1)),
  auto_advance_implementation_to_pr INTEGER NOT NULL DEFAULT 0 CHECK(auto_advance_implementation_to_pr IN (0,1)),
  current_session_id TEXT,
  next_artifact_number INTEGER NOT NULL DEFAULT 1 CHECK(next_artifact_number > 0),
  revision INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(project_id, slug)
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  thread_id TEXT UNIQUE,
  kind TEXT NOT NULL CHECK(kind IN ('phase','fork','delegate','extractor','bootstrap')),
  source_session_id TEXT REFERENCES sessions(id),
  source_seq_end INTEGER,
  creator_id TEXT NOT NULL,
  launch_request_json TEXT NOT NULL CHECK(json_valid(launch_request_json)),
  skill_id TEXT,
  labels_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(labels_json)),
  status TEXT NOT NULL CHECK(status IN (
    'ready_for_launch','waiting_for_workspace','draft','launching','running',
    'failed','ready_for_input','needs_approval','interrupt_requested',
    'interrupted','resuming','lost')),
  bootstrap_state TEXT NOT NULL DEFAULT 'needed'
    CHECK(bootstrap_state IN ('needed','hydrating','ready','failed')),
  summary_json TEXT NOT NULL DEFAULT '{"summaryHistory":[]}' CHECK(json_valid(summary_json)),
  next_step_json TEXT CHECK(next_step_json IS NULL OR json_valid(next_step_json)),
  usage_json TEXT CHECK(usage_json IS NULL OR json_valid(usage_json)),
  last_event_seq INTEGER NOT NULL DEFAULT 0,
  latest_turn_key TEXT,
  status_epoch INTEGER NOT NULL DEFAULT 0,
  last_observed_at INTEGER,
  error_json TEXT CHECK(error_json IS NULL OR json_valid(error_json)),
  archived_at INTEGER,
  deleted_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX sessions_task ON sessions(task_id, kind, created_at);

CREATE TABLE artifacts (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  file_name TEXT NOT NULL,
  current_version INTEGER NOT NULL CHECK(current_version > 0),
  frontmatter_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(frontmatter_json)),
  content_type TEXT NOT NULL,
  deleted_at INTEGER,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(task_id, file_name)
);
CREATE TABLE artifact_versions (
  artifact_id TEXT NOT NULL REFERENCES artifacts(id),
  version_number INTEGER NOT NULL CHECK(version_number > 0),
  bytes BLOB NOT NULL,
  sha256 TEXT NOT NULL CHECK(length(sha256) = 64),
  size_bytes INTEGER NOT NULL CHECK(size_bytes BETWEEN 0 AND 26214400),
  frontmatter_json TEXT NOT NULL CHECK(json_valid(frontmatter_json)),
  content_type TEXT NOT NULL,
  created_by TEXT NOT NULL,
  source_thread_id TEXT,
  operation_id TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(artifact_id, version_number),
  CHECK(length(bytes) = size_bytes)
);

CREATE TABLE artifact_comments (
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL REFERENCES artifacts(id),
  created_at_version INTEGER NOT NULL,
  reply_to_comment_id TEXT REFERENCES artifact_comments(id),
  content_text TEXT NOT NULL,
  content_json TEXT CHECK(content_json IS NULL OR json_valid(content_json)),
  block_text TEXT NOT NULL,
  previous_block_text TEXT,
  next_block_text TEXT,
  anchor_json TEXT NOT NULL CHECK(json_valid(anchor_json)),
  kind TEXT NOT NULL DEFAULT 'comment',
  is_resolved INTEGER NOT NULL DEFAULT 0 CHECK(is_resolved IN (0,1)),
  resolved_by TEXT,
  deleted_at INTEGER,
  created_by TEXT NOT NULL,
  created_by_agent INTEGER NOT NULL CHECK(created_by_agent IN (0,1)),
  revision INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(artifact_id, created_at_version)
    REFERENCES artifact_versions(artifact_id, version_number)
);
CREATE INDEX comments_artifact ON artifact_comments(artifact_id, created_at, id);

CREATE TABLE artifact_mirrors (
  artifact_id TEXT NOT NULL REFERENCES artifacts(id),
  environment_id TEXT NOT NULL,
  host_id TEXT NOT NULL,
  root_path TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  mirrored_version INTEGER,
  observed_sha256 TEXT,
  state TEXT NOT NULL CHECK(state IN ('pending','synced','conflict','trash','offline')),
  conflict_bytes BLOB,
  conflict_sha256 TEXT,
  error TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(artifact_id, environment_id)
);

CREATE TABLE workspace_repos (
  task_id TEXT NOT NULL REFERENCES tasks(id),
  repo_key TEXT NOT NULL,
  project_id TEXT NOT NULL,
  host_id TEXT NOT NULL,
  source_directory TEXT NOT NULL,
  environment_id TEXT,
  bootstrap_session_id TEXT REFERENCES sessions(id),
  is_primary INTEGER NOT NULL CHECK(is_primary IN (0,1)),
  spec_json TEXT NOT NULL CHECK(json_valid(spec_json)),
  state_json TEXT NOT NULL CHECK(json_valid(state_json)),
  revision INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY(task_id, repo_key)
);
CREATE UNIQUE INDEX one_primary_repo ON workspace_repos(task_id) WHERE is_primary = 1;

CREATE TABLE operations (
  id TEXT PRIMARY KEY,
  request_key TEXT NOT NULL UNIQUE,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  session_id TEXT REFERENCES sessions(id),
  kind TEXT NOT NULL CHECK(kind IN ('launch','advance','fork','delegate','extract','mirror','send-comments','workspace')),
  state TEXT NOT NULL CHECK(state IN ('pending','claimed','waiting','succeeded','failed','uncertain','cancelled')),
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json)),
  lease_until INTEGER,
  attempt INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER,
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX operations_due ON operations(state, next_attempt_at);

CREATE TABLE human_gates (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  session_id TEXT NOT NULL REFERENCES sessions(id),
  turn_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('advance','implementation-phase','workspace-command','comments')),
  subject_json TEXT NOT NULL CHECK(json_valid(subject_json)),
  state TEXT NOT NULL CHECK(state IN ('pending','approved','rejected','superseded')),
  approved_by TEXT,
  approved_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX gates_session ON human_gates(session_id, state);

CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  event_key TEXT NOT NULL UNIQUE,
  notification_key TEXT NOT NULL,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  session_id TEXT REFERENCES sessions(id),
  kind TEXT NOT NULL CHECK(kind IN ('ready_for_input','needs_approval','artifact_comment','operation_failed')),
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  state TEXT NOT NULL CHECK(state IN ('pending','claimed','delivered','dismissed','suppressed')),
  claimed_by_client TEXT,
  claim_until INTEGER,
  created_at INTEGER NOT NULL,
  delivered_at INTEGER,
  dismissed_at INTEGER
);

CREATE TABLE queue_options (
  queued_message_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  deliver_on_interrupt INTEGER NOT NULL CHECK(deliver_on_interrupt IN (0,1))
);

CREATE TABLE task_notes (
  task_id TEXT PRIMARY KEY REFERENCES tasks(id),
  text TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);
CREATE TABLE preferences (
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  value_json TEXT NOT NULL CHECK(json_valid(value_json)),
  revision INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY(scope, key)
);

CREATE TABLE context_shards (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  text TEXT NOT NULL,
  evidence_json TEXT NOT NULL CHECK(json_valid(evidence_json)),
  state TEXT NOT NULL CHECK(state IN ('enabled','disabled','dismissed')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE diff_comments (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  environment_id TEXT NOT NULL,
  anchor_json TEXT NOT NULL CHECK(json_valid(anchor_json)),
  reply_to_comment_id TEXT REFERENCES diff_comments(id),
  text TEXT NOT NULL,
  is_resolved INTEGER NOT NULL DEFAULT 0 CHECK(is_resolved IN (0,1)),
  deleted_at INTEGER,
  created_by TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

Transaction invariants: current artifact version exists and metadata matches that version; comment replies stay within the same artifact and cannot cycle; current session belongs to its task; exactly one primary exists once workspace configuration is complete; draft tasks have no user phase/fork sessions. Validate these cross-row relationships in the same transaction. A soft-deleted artifact retains its `(task,file_name)` identity and version sequence. Restoring an old version creates a new head version, never rewrites history.

Use `revision` predicates for mutable task, comment, note, workspace and preference updates. A stale write returns the current record, not last-writer-wins. Number allocation increments `next_artifact_number` in the artifact creation transaction, raising it above any imported numbered filename. Gaps are legal; duplicate numbers are not generated. Keep at least two digits, expanding after 99. Do not recycle numbers on deletion.

Settings descriptors hold simple discoverable defaults. `preferences` holds structured picker tuples, per-provider preferences, per-session dismissed tips, and per-client view state. Do not store the same effective setting in both places. No duplicate table of queued message bodies or approval payloads: those remain bb-owned.

## 4. Tasks, sessions, statuses, and board placement

### Task creation and drafts

The Tasks nav panel has Tasks, Sessions, Drafts views; task list/board; project/search/archive filters; and New Task. New Task combines plugin workflow/timing/auto-advance controls with `experimental_NewThreadComposer`. Use its full structured request, including attachments and `executionInputSources`, rather than reconstructing text or provider choices.

Two explicit submit modes, selected outside the native composer, use the same `onSubmit(request)`: **Save draft** persists the request and `task.md` without spawning; **Start task** commits the task/input artifact/launch intent, then schedules launch. Failed submission rejects so bb retains the composer draft. `draftKey` preserves unfinished typing within a client. The SDK does not expose the embedded new-thread composer's change stream; server-side continuous autosave of all unsent selections is unavailable. Explicit Save Draft is the complete supported workflow; do not scrape its DOM or mislabel client-local typing as a durable task.

The input artifact is `task.md`, with `ticket.md` import compatibility. Keep structured attachments in the saved request; import task-owned copies of attachment bytes into artifact versions through bb attachment reads so artifacts are not dependent on transient external URLs. Session launch returns an operation immediately; UI shows setup/launch progress and the durable thread id when known.

Workflow IDs are all supported in RPC/CLI and settings. The compact picker shows RPI, PRD/TDD, Freeform as in the study, with outline_only and oneshot under an advanced choice. Preserve `rpi` as schema/API default and `outline_only` as the launcher preset. oneshot/freeform start the user's direct prompt with no phase label or auto-next. Their completed tasks retain sessions and artifacts normally.

### bb thread correspondence

Plugin session IDs can exist before a bb thread, covering draft/ready-for-launch. Once bound, `thread_id` is unique and all chat operations use it. Phase sessions are siblings, not a chain of `parentThreadId` links: otherwise archiving an old bb parent would archive later phases. `source_session_id` records phase lineage without copying a transcript. Only actual delegated workers use `parentThreadId`; fork uses bb's `sourceThreadId` and `sourceSeqEnd`, `workspace: reuse|isolated`, and optional structured input. Source archival is explicit and only follows successful fork creation.

Renaming uses `threads.update({threadId,title})`. Archive UI clearly distinguishes archive this session and archive the task; task archival disables advancement and archives associated threads through bb. Deletion of a bb thread marks the session reference deleted and cancels pending actions, retaining artifacts and metadata. Never call `threads.delete` as routine task cleanup.

### Status reducer, highest applicable row wins

The native status vocabulary is **pending, starting, active, idle, stopping, error**. `runtime.displayStatus` additionally reports provisioning, waiting-for-host, and host-reconnecting. `hasPendingInteraction` is on list DTOs, not the basic `ThreadResponse`; fetch `interactions.list` for authoritative classification.

| Evidence | HumanLayer projection |
|---|---|
| Draft plugin session, no launch requested | `draft` |
| No thread yet, saved launch is not dispatched | `ready_for_launch` |
| Confirmed terminal provisioning/provider error; bb `error` without lost evidence | `failed` |
| Previously launching/running/resuming/interrupt_requested, explicit bb watchdog/runtime-loss evidence or expired reconnect grace with absent runtime | `lost` |
| Outstanding native interaction whose `payload.kind === 'approval'` | `needs_approval` |
| Outstanding native `user_question` or plugin human gate | `ready_for_input`, with a separate blocked-input reason |
| bb `stopping`, or accepted stop request still in progress | `interrupt_requested` |
| Last terminal event is `system/thread/interrupted`, with no later turn start | `interrupted` |
| Environment absent/provisioning, bootstrap/hydration incomplete, or new work waiting for host | `waiting_for_workspace` |
| bb `starting`, or admitted initial request awaiting provider start | `launching` |
| Existing conversation start/resume requested, not yet active | `resuming` |
| bb `active`, no blocking interaction | `running` |
| bb `idle` after completed turn, no later accepted request | `ready_for_input` |
| bb `pending`, environment ready, waiting in core queue | `ready_for_launch` with queued badge |

Archive/deleted are orthogonal filters, not invented session statuses. A quiet long-running tool is not `lost`. A frontend disconnection is not `lost`. During bb's reconnect grace keep the previous active projection plus “reconnecting”; do not use a guessed inactivity timeout. If bb does not expose enough runtime evidence, show “connection unknown” and block advancement instead of asserting lost. Recovery requires live bb state, not a plugin status setter that changes core state.

Readiness due to a question is distinguishable from a completed turn. Both can display idle/input-needed, but only a verified completed turn can auto-advance. Interactions take precedence over a stale thread.active event. Derive from refreshed snapshots and ordered event rows, not event-arrival order. Persist `status_epoch` when the semantic status changes; record the completed turn's identity separately.

### Phase labels and boards

Persist canonical `{name,title}` labels from the study, including synthetic `rpi:todo` for no sessions. Store other user labels too, but select one canonical workflow label for automation; ambiguous multiple phase labels disable automatic advancement. `showTaskPhaseLabels` controls rendering, never the underlying phase.

| Board column | Phase of designated current user session |
|---|---|
| TODO / DRAFT | Draft or no phase (`rpi:todo`); unlabeled freeform/oneshot |
| RESEARCH & DESIGN | research-questions, research, design, design-prd, design-tdd |
| PLANNING | structure, plan, worktree-setup |
| IMPLEMENTATION | implementation, describe-pr |

`review` preserves the task's previous substantive column. User sessions advance `current_session_id`; extractor/delegate/bootstrap completion cannot move a card. Manual opening of an older session cannot move it either. These fallback rules are plugin decisions where the study does not specify a mapping. The four columns are exhaustive; do not invent Done or treat idle as completion. Archive is the completion/cleanup action. No drag-to-column phase mutation: phase is execution metadata, not a free kanban status.

Task table: Name, Step, Owner (“You”), Sessions, Created, Updated. Session table: Status, Title, Labels, Task, Working directory, Updated. Display ready_for_input as red bell-slash + “idle”; active statuses get appropriate progress treatment. Research-questions blue, research green, design purple, structure pink/red, implementation green, using accessible theme-aware tokens and text labels. Unknown labels have a neutral badge.

## 5. Artifact authority, hydration, comments, and viewer

### Writes and versioning

`artifacts.upsert` accepts task-scoped filename, bytes/content, expected current version (null for create), and request id. A successful logical upsert appends a version even when its bytes match the old version, matching HumanLayer's upsert semantics. Repeating the same request id returns that result without another version. File-watcher echoes are synchronization no-ops, not logical upserts. Store exact original bytes and SHA-256; parse frontmatter into JSON for grouping without normalizing the source text.

Generated names are `NN-<type>-<2-4-word-kebab-slug>.md`, allocated by the database rather than `ls max+1`. Free filenames remain valid, including task.md, ticket.md, handoff.md, pr-description.md, YAML, HTML, and screenshot names with spaces. Reject absolute paths, separators, dot segments, NULs, ill-formed Unicode, case-fold collisions on the target host, and filenames reserved for mirror control data. Legacy nested content is explicitly imported as safe relative assets, not silently flattened into colliding names.

Text RPC/tool content caps at 1 MiB. Binary artifacts use authenticated HTTP byte reads/uploads with a 25 MiB decoded cap and MIME sniffing; base64 JSON input is validated and bounded before decoding. The DB stores BLOBs, and RPC never serializes BLOB/Buffer objects directly. Downloads use `/api/v1/plugins/humanlayer/http/artifact?id=<id>&version=<n>` with `auth: local`, safe content-disposition, `nosniff`, and no-store. HTTP paths are exact-match registrations; do not declare `/:id` routes because this SDK treats them literally.

### Mirror algorithm

Every associated environment gets real files under `<environment.directory>/.humanlayer/tasks/<immutable-task-slug>/`. Resolve `environmentId -> environments.get -> hostId,directory`; pass `hostId` and confined `rootPath` explicitly for every `bb.sdk.files` operation. Never use server `node:fs` for repository I/O, even on the current local-only deployment. Slug collisions across distinct project identities sharing a directory are rejected or disambiguated before the first mirror; renaming task display name never changes its mirror identity.

For each artifact/environment, track last exported version and observed file hash:

1. Read current DB head and mirror ledger. Read the current file through SDK.
2. If disk equals recorded hash and DB advanced, export DB bytes using `files.write({expectedSha256: observedHash,...})`; create-only uses null. Mark synced only after `outcome: written`.
3. If disk changed while DB remains at the mirrored version, import disk as a DB version using that version as the CAS predicate. Then export that new DB head to other mirrors.
4. If disk and DB both changed, retain disk bytes as a conflict candidate, leave both intact, and block hydration/auto-advance. Offer Keep DB, Import disk, or edit a merged result; each decision CAS-checks both heads again.
5. If the write reports conflict, re-read and repeat conflict classification; never retry unconditionally. If a process dies after write but before ledger update, matching content hash proves the export and repairs the ledger.
6. Missing mirror files are rehydrated. A missing disk file alone never means delete the canonical artifact. New untracked files can be explicitly imported or watcher-imported with create-only DB semantics after validation.

Commit DB version and mirror operation intent together; the filesystem update happens afterward. Never claim an atomic transaction spans SQLite and the host filesystem. Repeated reconciliation converges; offline mirrors stay pending, and the viewer remains available from DB.

Host native watchers only send path invalidations via `context.experimental_watch` and authenticated plugin host signals. Server code rereads bytes through `bb.sdk.files`, batches/coalesces changes, skips unchanged hashes, handles rescan-required with a full bounded directory listing, and reestablishes watches after host reconnect/worker exit. Poll on session start/end and periodically as a fallback. No watcher owns canonical bytes.

Soft delete marks DB tombstone and schedules a move to `.trash/<artifact-id>/<file_name>`, preserving bytes and versions. `files.move` has no CAS hash argument: hold the plugin's per-mirror operation lock, reread before move, move without replacement, and reread destination afterward. External writers can still race; preserve unexpected bytes as a conflict, never unlink them. A tombstone blocks resurrection through watcher import. Restore copies the chosen DB head to the live path with create-only/CAS and clears the tombstone only after conflict policy succeeds. Unmanaged deletion cannot be perfectly atomic with a provider file edit; that is an explicit SDK limitation.

### Session-start ordering and provider-tool hooks

On an **existing environment**, dispatch hook returns wait if the bound session is unhydrated. It schedules hydration outside the hook's global admission lock, then calls `recheck`. Do not do long file work or recursively spawn inside that hook.

On a **cold managed-worktree launch**, the hook receives `environment: null`, and worktree provisioning follows admission. Waiting for that environment inside the hook deadlocks. Therefore:

1. First spawn a real bootstrap thread with a short, non-domain prompt carrying only the durable launch token and instruction to call `hl_session_start`. Its task association is bound synchronously by the dispatch hook using the stored token and plugin origin. User task contents are withheld from this bootstrap turn.
2. bb provisions the environment. `hl_session_start` verifies the actual environment, hydrates, and records ready; its response is a receipt, not the task prompt. No research/implementation starts in this thread.
3. Once bootstrap succeeds, stop/archive it, retain the environment reference, and spawn the real phase using `environment:{type:'reuse',environmentId}`. Hydration is now enforceable at the dispatch checkpoint before domain work starts. The real phase is the first visible user session; bootstrap is excluded from counts and notifications.
4. A bootstrap failure leaves workspace setup failed with Retry. Do not create another environment automatically when the prior spawn outcome is uncertain.

This incurs one small helper turn per newly provisioned environment. Phase 0 must verify that bb permits reuse after stopping/archiving the bootstrap and keeps the worktree alive. If not, retain the hidden stopped bootstrap unarchived until the environment is no longer needed. A deterministic **post-provision/pre-provider** SDK hook or environment provisioning API would remove the helper turn and is the preferred upstream improvement, not an assumed API.

There are no generic `PreToolUse`/`PostToolUse` hooks for arbitrary providers in this SDK. Ported skills use `hl_artifact_get/upsert` and `bb humanlayer artifacts ...`, which refresh/CAS-save and return permalinks. Native Read of hydrated files still works. Ordinary editor/provider writes are imported by the watcher and end-of-turn reconciliation. Immediate refresh-before-every-native-Read and permalink injection after every arbitrary Write cannot be guaranteed; exact hook parity requires a bb SDK extension. Do not install Claude hooks behind bb's back.

### Comments and rendering

Anchor format: `{v:1, blockType, blockText, previousBlockText, nextBlockText, occurrence, sourceStart, sourceEnd}` plus the creation version. Parse Markdown into blocks with original source positions. On a new version, match exact block text and neighbors first, then unique block text; when several candidates remain, keep an orphaned anchor with the original quote. Do not silently attach to a similar-looking paragraph. Replies inherit the root anchor. Resolution and deletion are reversible, revision-checked operations.

Artifact list groups by frontmatter `type`: research-questions, research, design-discussion, structure-outline, plan, prd, tdd, pr-description, OTHER. Comment counts count visible unresolved root discussions, with total count available in the viewer. Grouped toggle and flat filename order match the screenshots. Each item has an overflow menu, Preview/Raw, history/version selector, comments, soft-delete/restore, copy link, and open mirrored file.

Use `Markdown` for preview, `experimental_SourceCode` for raw text, and a plugin-owned block gutter/list for comment targets; `Markdown` exposes no AST node-render hook. A selected block opens its thread in the comment pane, using source positions and original quotes. Do not inject handlers into bb Markdown's internal DOM. Binary previews render images/PDF/download affordances by safe MIME; HTML must run in a sandboxed iframe with no same-origin privileges and no scripts by default. Optional scripted standalone walkthroughs require a separately sandboxed preview, never raw HTML inside bb's trusted DOM. Relative HTML assets come from hydrated files via `files.createPreview` or rewritten authenticated artifact URLs; expiry triggers a fresh preview token, never a permanent link to that token.

Canonical permalink: `/plugins/humanlayer/tasks/<taskId>/artifacts/<artifactId>`; optional `/versions/<n>/comments/<commentId>` remainder. `navPanel` subPath resolves from DB, so it survives moved worktrees, offline hosts, and deleted threads. Tombstones show a restore page. This **is** the bb-hosted artifact viewer for this plugin: bb has no native artifact entity to link to. `UrlLink` preserves app navigation and modifier clicks. Tools return a relative permalink and optionally a configured, validated bb public-origin absolute link; do not use `bb.server.loopbackBaseUrl` for a remote user or enable public sharing.

## 6. RPC, CLI, and agent contracts

`contract.ts` defines one `defineRpcContract` with strict Zod input/output. Rows below are exact planned method names, not claims of existing SDK methods. IDs and fields are schema-defined; no arbitrary SQL, filesystem root, provider option bag, or transition command is accepted from the client. Use tagged results `{ok:true,value}` / `{ok:false,code,message,current?}` for expected domain failures. Core RPC's own error envelope remains unchanged. Stable domain codes: `not_found`, `invalid_scope`, `conflict`, `unsupported`, `workspace_unavailable`, `human_gate`, `stale_turn`, `launch_uncertain`, `invalid_next_step`, `cancelled`.

| Method | Input | Result / behavior |
|---|---|---|
| `tasks.list` | projectId?, view: tasks/drafts/archived, query?, cursor?, limit<=100 | TaskPage and counts |
| `tasks.get` | taskId | TaskDetail with bounded session/artifact metadata |
| `tasks.saveDraft` | requestId, taskId?, expectedRevision?, name, workflowType, worktreeTiming, autoAdvance, NewThreadRequest | Task + input artifact; no thread |
| `tasks.update` | taskId, expectedRevision, allowed field patch | Updated task; invalidate stale pending decisions |
| `tasks.archive` | taskId, expectedRevision, archived | Task + operation status; no hard delete |
| `sessions.start` | requestId, taskId, expectedTaskRevision, skillId?, request | OperationRef; bind a new visible session |
| `sessions.get` | sessionId | Derived metadata, next step, usage, gate; no transcript proxy |
| `sessions.list` | taskId?/projectId?, cursor?, limit<=100 | SessionPage with bb status projection |
| `sessions.fork` | requestId, sessionId, sourceSeqEnd?, input?, workspace, archiveSource | Fork operation; native bb fork |
| `sessions.interrupt` | sessionId, optional queued followup, confirmedChildren | Native stop + delivery intent |
| `sessions.advance` | requestId, sessionId, turnKey, expectedTaskRevision, expectedArtifactVersions, mode: manual/auto | Validated operation; auto mode callable only internally |
| `sessions.iterate` | requestId, sessionId, artifactId?, expectedVersion?, confirmed | Fresh same-phase session |
| `sessions.handoff` | sessionId, expectedTurnKey | Upsert handoff.md and return next launch proposal |
| `queue.configure` | sessionId, batch, expectedQueuedIds | Native group boundary result |
| `queue.setDelivery` | sessionId, queuedMessageId, deliverOnInterrupt | Sidecar option; bb still owns row |
| `artifacts.list` | taskId, includeDeleted?, group?, cursor?, limit<=100 | MetadataPage, no content blobs |
| `artifacts.get` | taskId, artifactId or filename, version? | Text <=1 MiB or authenticated byte route + metadata |
| `artifacts.upsert` | requestId, taskId, filename or generated type+slug, content, expectedVersion | Artifact/version, SHA, permalink, mirror state |
| `artifacts.versions` | artifactId, cursor?, limit<=100 | VersionPage |
| `artifacts.restoreVersion` | requestId, artifactId, version, expectedVersion | New head version |
| `artifacts.setDeleted` | artifactId, expectedRevision, deleted | Tombstone/restore + mirror state |
| `artifacts.resolveConflict` | artifactId, environmentId, expectedDbVersion, expectedDiskHash, choice, mergedContent? | CAS result |
| `comments.list` | artifactId, includeResolved, limit<=100, offset>=0 | Threaded comments + anchors/version + total |
| `comments.add` | requestId, artifactId, version, anchor, text | Comment with author from caller context |
| `comments.update` | artifactId, ids+expectedRevisions, resolved?, deleted? | Atomic validated patch across listed comments |
| `comments.reply` | requestId, artifactId, commentId, text | Reply with inherited anchor |
| `comments.send` | requestId, sessionId, artifactId, commentIds, mode: send/send-and-resolve | Core queued receipt; resolution only after accepted delivery |
| `workspace.get` | taskId | Repos, bb states, copy/setup states, errors, raw state |
| `workspace.configure` | taskId, expectedRevision, validated spec | Proposal/compatibility report; no execution yet |
| `workspace.retryStep` / `workspace.skipStep` | taskId, repoKey, step, expectedRevision, confirmation | Operation; skip marks skipped, never success |
| `workspace.setRepositoryDirectory` | taskId, repoKey, hostId, directory, expectedRevision | Validate through bb, rebind subsequent sessions |
| `notes.get` / `notes.save` | taskId; text + expectedRevision for save | Scratch text/revision |
| `context.shards` / `context.setShardState` | projectId?; shardId + enabled/disabled/dismissed | Local evidence-backed facts |
| `settings.get` / `settings.update` | null; validated patch+revision | Own preferences and capability report |
| `notifications.poll` / `notifications.ack` | clientId, cursor, visibleThreadIds, focused; receipt state | Bounded eligible receipts and claim token |
| `diffComments.list/add/update/reply` | taskId, environmentId, typed anchor, text/revision | Patch-anchored comments alongside native diff |

Task scope is mandatory at RPC boundaries; a thread must belong to the same task/project before a mutation reaches bb. Agent context is stricter: infer task from authenticated `PluginAgentToolContext.threadId`, never an agent-provided taskId. Delegate children inherit an explicit mapping; side chats or unrelated threads get no artifact mutation tools until deliberately attached.

### Native tools

Register tools once with `bb.agents.registerTool`; select only this plugin's IDs in synchronous `bb.agents.configure`. Names are globally unique and prefixed `hl_`. Preserve the three MCP-equivalent signatures:

```text
hl_get_artifact_comments(artifact_filename, include_resolved=false, limit=50, offset=0)
hl_update_artifact_comments(artifact_filename, comment_ids[], resolved?, deleted?)
hl_reply_to_artifact_comment(artifact_filename, comment_id, content)

hl_session_start() -> task identity, hydration receipt, artifact manifest
hl_artifact_get(artifact_filename, version?)
hl_artifact_upsert(artifact_filename? or type+slug, content, expected_version, request_id)
hl_phase_finish(turn_key, structured_summary, next_step, artifact_versions, pending_human_gate?)
hl_delegate(role, instruction, artifact_references[], phase?, request_id)
```

Comments tools return XML-compatible threaded output with escaped content and shortest unique ID prefixes of at least eight characters. Resolve prefixes only within the artifact; ambiguous prefixes are errors. Internally use full IDs. Bounds apply to both page count and serialized bytes, with next offset/total and an explicit truncation marker. `created_by_agent` comes from the tool context, never an input flag. Tools return `isError` for expected failures. `hl_phase_finish` supplies a proposal, not authority to approve a gate or initiate the next phase while the turn is still running.

One CLI registration: `bb humanlayer`, with metadata for `tasks`, `sessions`, `artifacts`, `comments`, `workspace`, `run`, `delegate`, `handoff`, and `status`. CLI calls invoke the same domain functions. `run <skill-id> --task <id> [--artifact <name>]` starts a fresh phase; `run ... --current` loads the selected skill in an already assigned session and cannot recursively spawn itself. All commands support bounded `--json` output. Agent filenames are resolved against the thread's host through SDK files, never server cwd. No-task use requires explicit task/project/host selection. Tool-first access is available when a provider's sandbox prevents CLI loopback.

## 7. Event handlers, extraction, executor, and queue

### Durable observation

Register all nine documented lifecycle events, filtering immediately to plugin-associated sessions:

| Event/signal | Handler |
|---|---|
| `thread.created` | Reconcile provisional launch token, bind thread if known; do not depend on transcript existing |
| `thread.active` | Refresh snapshot/interactions; invalidate old next-step action; mark observed turn |
| `thread.idle` | Ingest ordered terminal events, reconcile artifact mirrors, collect final answer, project status, enqueue extraction/advance decision |
| `thread.failed`, `turn.failed` | Persist failure facts, stop dependent auto work, surface retry; never blindly re-send a possibly accepted turn |
| `thread.archived`, `thread.deleted` | Cancel pending operations, remove notification attention; retain task data |
| `message.queued`, `message.dispatched` | Track own bootstrap/hydration waits and comment delivery; no duplicate queue table |
| `sdk.subscribe({event:'thread:changed'})` | Coalesced refresh; fetch interactions and typed event rows since cursor |
| `environment:changed`, `host:changed` | Reconcile workspace and watchers; retry safe mirror reads/writes |
| `realtime:connection` with reconnected | Backfill missed events and pending work before allowing new auto launches |

Use `threads.events.list({threadId,afterSeq:String(cursor),limit:'200',order:'asc',types:[...]})` and page until caught up. Relevant types: `turn/started`, `turn/completed`, `client/turn/requested`, `client/turn/rejected`, `system/interaction/lifecycle`, `system/userQuestion/lifecycle`, `system/thread/interrupted`, `system/provider-turn-watchdog`, `system/thread-provisioning`, `thread/contextWindowUsage/updated`, `thread/tokenUsage/updated`, `provider/error`. Update cursor and resulting notification/operation intents together in one DB transaction. Lifecycle events are wakeups, not the durable journal.

Subscribe has no `interaction.created` event. Typed interaction lifecycle history catches approvals that were inserted and settled between polling intervals. `interactions.list` gives current blockers; do not generate a new approval alert for an already-resolved historical interaction. Startup establishes a baseline and does not ring for every old idle thread. Pending attention is reconciled separately. One abortable background service drains work and periodically catches up linked sessions, with a slower durable schedule for repair. Unsubscribe and abort on `bb.onDispose`; do not keep callbacks holding a closed DB generation.

### Next-step and structured summary extraction

Persist the study's shape:

```text
next_step_suggestions = {
  parsedAt,
  extraction: {type:'next_step_found',nextStepPrompt,nextStepSummary,
               nextStepType,taskReference,suggestedDirectory}
           | {type:'no_next_step',reason},
  extractionError?
}
structured_summary = {
  summaryHistory: string[],
  relevantTasks?: string[],
  relevantRPIDocuments?: [{localpath,permalink?}]
}
```

Ported final-answer templates emit one fenced `text` bb command with known grammar, and call `hl_phase_finish` with the structured fields. Validate it only after the corresponding successful completed turn. For legacy final answers, accept exact `/rpi:*` aliases and parse into the same command object. Commands are never passed to a shell. Reject multiple contradictory suggestions, cross-task references, unknown auto commands, traversal, changed artifact versions, or an unapproved suggested directory.

For ordinary prose/freeform, use one bounded hidden bb extraction thread when needed, with the final assistant answer and relevant explicit document references, not the full parent transcript. Require strict JSON output, validate it, record source turn and answer hash, and stop/archive in `finally`. Cache one extraction per completed turn/hash. Never use `bb.experimental_aiServices.register` as though it were a generic completion call; it registers an inference provider. The fallback worker is an ordinary bb provider invocation, with normal permissions and no plugin mutation tools selected. If extraction fails, preserve the answer and show a manual retry/button; do not guess an automatic action.

Do not let summaries create evidence: every relevant task/doc/shard reference must resolve to a known ID/version/source event. Bound summary history in the injected context, retaining older entries in DB. Ignore stale completion from an extractor when the source thread has started another turn.

### Exact auto-advance table

| From label | Task flag | Next step name | Target label |
|---|---|---|---|
| `rpi:research-questions` | `auto_advance_questions_to_research` | research | `rpi:research` |
| `rpi:research` | `auto_advance_research_to_design` | design | `rpi:design` |
| `rpi:design` | none, human gate | structure outline | `rpi:structure` |
| `rpi:design-prd` | none, human gate | TDD | `rpi:design-tdd` |
| `rpi:design-tdd` | none, human gate | structure outline | `rpi:structure` |
| `rpi:structure` | none, human gate | plan | `rpi:plan` |
| `rpi:plan` | `auto_advance_plan_to_worktree` | worktree setup | `rpi:worktree-setup` |
| `rpi:worktree-setup` | `auto_advance_worktree_to_implementation` | implementation | `rpi:implementation` |
| `rpi:implementation` | `auto_advance_implementation_to_pr` | PR description | `rpi:describe-pr` |

The study's sentence “design, structure and plan are always human gates” must be interpreted alongside its explicit table: design/structure outputs require manual progression into the next work, including entry into plan; **plan -> worktree has its named toggle**. Do not erase that row or invent an auto flag for design/structure. A pending human review request inside any phase still blocks advancement, regardless of its outgoing toggle.

The display strip remains workflow-specific: rpi/outline_only show questions -> research -> design -> outline -> implement -> PR, with timing-dependent worktree and optional legacy plan. prd_tdd shows research -> PRD -> TDD -> outline -> implement -> PR. These are not alternate automatic tables. In particular, research -> PRD, structure -> implement-outline, and plan -> implementation when already in a worktree have no matching automatic row and require the explicit Proceed action. `oneshot/freeform` have no automatic edges. The target label must match both the table and the extracted skill; do not automatically run a PRD prompt under the design toggle.

Auto-advance eligibility is the conjunction of: task/session not archived/deleted; current user session; successful terminal turn; derived ready_for_input; no pending interactions/gates; no live implementation/reviewer workers; mirrors required for the next launch reconciled; extraction `next_step_found`; canonical source and target match the table; applicable task flag on; and no newer user input or queued user messages. In single-user mode task flags are effective directly. Preferences seed new task flags; changing global defaults never silently changes existing tasks.

### Executor and failure semantics

1. Transactionally create an advance intent with unique request key `advance:<sessionId>:<turnKey>`. Manual and automatic clicks for that same completed turn converge on it. Store target command, input artifact version map, effective execution choices, task revision, and decision reason.
2. Worker claims by state/lease CAS, revalidates live bb state and all eligibility conditions immediately before spawn, and waits if hydration/setup is required. A stale intent is cancelled, not updated silently to a different instruction.
3. Manual gates create a reviewable proposal with artifact versions and intended action. Approval is recorded from the user UI (or an explicitly verified user response), never from model-generated text. Implementation phase gates record exact phase, reviewed artifact version and validation result; “commit and proceed” approves that phase only unless the user explicitly authorizes a batch. Plan approval never grants blanket provider permissions.
4. Prepare a plugin session and persist launch token before `threads.spawn`. Include the token in a small structured text input marked `agent-only`, with task instructions as a separate input. The dispatch hook checks token + stored pending operation + plugin attribution, binds the thread, and selects its task configuration. A token is correlation, not a bearer authorization boundary.
5. Existing ready workspace uses `environment:{type:'reuse',environmentId}`. Launch with the selected provider/model/reasoning/service tier/permission tuple. No transcript fork and no full-history seed. Mark success only after recording the returned/bound thread identity, then observe its lifecycle.
6. Spawn has no idempotency-key parameter. If a call times out or crashes after core accepted it, mark **uncertain**, search recent plugin-origin threads and their token-bearing first input, and adopt the unique match. Never automatically retry an ambiguous launch. If zero matches remain after bounded reconciliation, show Recover Launch with concrete evidence; user-approved retry gets a new attempt record. Two matches are an error requiring explicit selection/cancellation. This provides fail-safe recovery, not a false exactly-once claim.
7. Restart recovers claimed intents with expired leases, but only retries idempotent reads/CAS mirrors automatically. It never blindly reissues spawn, fork, send, commit, PR creation, or setup commands. Recheck settings and gates after restart.

Disable/reload cancels work through abort signals and retains intentions. It does not silently delete environments or stop unrelated threads. On reenable, reconcile before draining. A plugin wait may be orphan-cleared by bb when the plugin is disabled; with this SDK, enforcement cannot persist while disabled. Document that disabling HumanLayer during setup requires stopping its pending threads, and expose their count before a user does so. Exact fail-closed disable behavior requires a core capability; do not present an advisory banner as enforcement.

### Queues and interrupts

Use native `ThreadChat` send/queue/steer controls. Batch preference maps to `queuedMessages.setGroupBoundary({threadId,groupBoundaryQueuedMessageId,expectedGroupedPrefixQueuedMessageIds})`: group the ready prefix together for batch mode, one message at a time otherwise. Use the host CAS expectation and refetch on conflicts; do not concatenate and delete rows manually. Timed/plugin-held/retry rows with different readiness are not forced into an immediate group. An in-flight dispatch already admitted by core is not retroactively changed by toggling the setting.

Observe queue changes and apply preference before the next drain where possible. SDK exposes no atomic default batch policy on native enqueue; phase 0 must test race behavior. If exact “all queued rows as one batch” is not enforceable, expose the native group-boundary control with the preference as a default and flag the race, or require the small upstream per-thread queue-policy hook before claiming full parity.

`deliver_on_interrupt` has no native field. `queue_options` records it for rows created through plugin actions. Stop uses `threads.stop`; once interruption is observed, request native send of designated rows in queue order. Plain queued rows wait for ordinary readiness. Preserve input/attachments and execution options. Do not send a followup twice after a timeout. User queue content always takes precedence over automatic phase creation.

## 8. Workspace behavior and context management

### Worktree timing

* **now:** provision bb managed environment(s), run approved setup, hydrate, then create the first visible session. Hidden bootstrap overhead is not a user phase.
* **later:** questions/research/design/planning run in the selected existing/unmanaged environment; create managed worktree(s) before implementation, rehydrate into the new primary environment, and leave old session environments intact.
* **never:** reuse the selected directory/environment and never run `git worktree add` or silently switch its branch. Existing worktrees can be selected explicitly.

Use `threads.spawn` host workspace discriminants exactly: `managed-worktree` with named/default baseBranch, `unmanaged` with selected path, or `reuse` with environmentId. There is no `environments.create`. `.humanlayer/workspace.json` and `.humanlayer/workspace.local.json` remain accepted inputs. Merge shared then local overrides, per-repo scalar overrides, additive deduplicated `copyGlobs`, and exactly one primary. `disabled:true` maps to never. Read and display sourceRef/setupCommand/copyGlobs and the proposed result before executing changed configuration.

For multiple repos, map each configured source repo to an explicit bb project/source and one bb environment reference. Provision per repo through the same bootstrap process, sequentially for deterministic recovery; all must reach their selected ready/skipped state before implementation. Native environments determine paths and branch names. `pathTemplate`/`branchTemplate` cannot force exact HumanLayer paths/names through the current managed-worktree spawn API. Show requested vs resolved values; never create Git worktrees in `host.ts` to fake compatibility. Sibling-relative multi-repo layouts and aggregating all repos' instruction/skill catalogs are also not guaranteed by bb's one-environment-per-thread contract. These require bb support or explicit adaptation of repository paths; exact layout/instruction parity is a release blocker for those configurations, not a silently ignored field.

Plugin setup state records stages `environment`, `copy_globs`, `setup_command`, `artifacts`; each has pending/running/completed/failed/skipped, timestamps, evidence and error. bb provisioning state is read-only and distinct from these plugin stages. SDK has no retry-step/skip-step on bb's internal worktree provisioning. Retry/Skip apply to plugin copy/setup steps; native provisioning failures link to bb recovery or a controlled new launch after uncertainty is resolved. Skipping cannot label a failed repository “Ready” without a visible skipped indicator.

Copy files through `files.listPaths/read/write` with explicit approved source/destination roots, no symlink escapes, and CAS create/merge behavior. Existing secret files are not artifacts and are never copied into plugin DB or notification logs. Setup commands run through the bb-managed bootstrap session/provider with native permissions and a recorded human gate for the selected command/config hash; terminals may be opened for a user's manual repair through `bb.sdk.terminals.create({scope:{kind:'environment',environmentId}})`. Do not build a second shell runner. Interrupted non-idempotent setup commands are uncertain and require inspection before retry.

### Fresh context, iteration, handoff, and delegation

Every phase launch gets task.md/ticket.md, explicit artifact references with pinned versions, an artifact manifest, concise structured summary, and relevant enabled context shards. Hydrate all active artifacts so skill-relative paths work, but inject/read only the requested documents. Do not dump the artifact directory into the prompt. `bb.agents.contributeInstructions` supplies task identity, mirror path and tool conventions in under 4096 characters from an in-memory/SQLite map; it cannot await hydration.

Gauge consumes `thread/contextWindowUsage/updated.contextWindowUsage.{usedTokens,modelContextWindow,estimated}`. Show used/limit/percent, estimated marker, and unavailable state. Never substitute cumulative `tokenUsage.total.totalTokens` for current context occupancy. bb owns model limits and cost display. The study does not specify the warning threshold: use a documented plugin default of 80% with a setting, dismissible per session, rather than claiming 80% is HumanLayer behavior. Offer `iterate-*` for the current phase and artifact; confirmation follows the tips preference. Iteration is a new thread, not `threads.compact`; manual compact stays bb-owned.

Handoff writes/versions handoff.md with completed work, named verification results, unresolved decisions, active artifact versions, intended next command, source session/turn, and relevant paths. Fresh continuation reads it plus explicit inputs. Unknown/stale references remain visible errors. A context shard contains text plus evidence `{citation,conversationEventId,sessionId,taskId,sourceUserId,role}`; derive local candidates in the summary extraction pass, deduplicate by evidence+normalized text, and allow enabled/disabled/dismissed/restore controls. Inject only bounded enabled relevant facts. There is no org-wide memory service; avoid duplicating bb's skills or host memory tier.

`hl_delegate` maps a fixed role name to one of seven packaged prompt files, validates artifact references, then uses a fresh bb child thread in the same environment. Child tools remain scoped to the task. Research children return bounded evidence; implementer children write code and artifact progress through the normal contracts. Parent holds only short assignments and results. Stop/archive completed hidden workers in `finally`; surface blockers and preserve their output for inspection. Cap plugin-created concurrent workers and honor bb capacity/`canSpawnChild`; no background unbounded fleet. Provider approval remains native. Confirmation before interrupting active children is a plugin action preference; it cannot intercept the native host Stop button without additional SDK support.

## 9. Port all 23 skills and seven agents

The installed prompts/templates are source material, not instructions to implement now. Copy and review them during the skill phase, subject to redistribution rights. Preserve substantive research/design/implementation rules, output type, document precedence, fully-read requirements, and exact final-answer structure. Change only provider/host integration and known inconsistencies described here.

Common change in **every SKILL.md**: unique frontmatter name `hl-<original>` (avoids global `show-me` and other skill collisions); correct package-relative `{SKILLBASE}` resolution; derive task from `bb humanlayer status --json`; call hydrate/read tools before artifact work; replace directory number allocation with DB-generated upsert; replace cloud-hook promises with returned bb viewer permalink; replace `/rpi:*` output blocks with `bb humanlayer run <skill-id> --task <id> --artifact <filename>`; treat native tool/CLI failure as blocking instead of silently writing untracked files. Keep `.humanlayer/tasks/<slug>/` paths in prose and references. Update all referenced final-answer templates, examples, scripts and aliases, not just top-level files.

| SKILL.md | Specific change and preserved behavior |
|---|---|
| create-research-questions | Task input and explicit mentions only; descriptive questions must not leak implementation intent; allocate research-questions; next create-research |
| iterate-research-questions | Get existing version + comments, same filename CAS revision; same research-questions label/next template |
| create-research | Four fixed research roles via `hl_delegate`; findings describe existing system, no design recommendations; research output |
| iterate-research | Read existing research and instructed feedback, preserve evidence and scope, upsert same file |
| create-design-discussion | Preserve back-and-forth design process and alternatives; bb artifacts for Markdown/HTML; next outline is human-gated |
| iterate-design-discussion | Apply confirmed decisions/comments to existing design artifact; never auto-clear human gate |
| create-prd | Product questions and mockups remain conversational; artifact-backed HTML; design-prd label; manual next TDD |
| iterate-prd | Preserve unresolved questions and version existing PRD, including mockup references |
| create-tdd | Technical design from explicit PRD/research inputs; retain show-me and HTML escape hatch; design-tdd label |
| iterate-tdd | Revise same TDD with comments and evidence; manual next outline |
| create-structure-outline | Read required input docs fully; source-positioned component/file/phase outline; manual implement-outline or legacy plan suggestion |
| iterate-structure-outline | CAS-update same outline and preserve progress markers only when still valid; no auto implementation |
| create-plan | Preserve plan precedence and validation design; remove raw `git checkout -b`/worktree creation from final-output branching; use bb workspace status and emit a validated next command |
| iterate-plan | Read existing plan + feedback, version same file; show exact changed phase implications before execution |
| configure-workspaces | Keep proposal-before-write process and JSON schema; translate to bb environment choices, explicitly report unsupported templates/layouts; CAS-write approved configs |
| setup-worktree | Delegate provisioning to workspace command, never shell `git worktree`; disabled/never stays in selected directory; next implement-plan/outline only after setup receipt |
| implement-plan | Fixed implementer -> reviewer -> automated evidence -> human phase gate -> commit/proceed loop; short prompts pointing to plan; preserve explicit batch authorization |
| implement-outline | Use outline-implementer-agent consistently, correcting conflicting old prompt references; outline > design > research > task precedence; same review and human gates |
| iterate-implementation | Fresh context with handoff, current plan/outline and selected feedback; delegate bounded repair/review, preserve outstanding manual checks |
| describe-pr | Version pr-description.md and HTML walkthrough; retain diff injection script but obtain paths/diffs from bb context; use existing bb Git/PR capability where supported, provider-native CLI only for explicitly authorized gaps; no automatic merge |
| ci-commit | Preserve explicit invocation and exact-path staging; exclude mirrored `.humanlayer/tasks/` data; remove obsolete blanket `rpi/` path assumption; permission/gate approval is not invented by the agent |
| review-artifact-comments | Replace `mcp__humanlayer__*` with three `hl_*` tools; preserve XML/prefix behavior, one-comment-at-a-time work and user confirmation unless action already instructed |
| show-me | Port companion skill's visual guidance; publish task HTML/Markdown artifacts and bb links, replacing cloud paths and HumanLayer-only opening commands |

Keep aliases for create-worktree -> setup-worktree, configure-workspace -> configure-workspaces, create-research-plan -> create-research-questions, create-outline -> create-structure-outline, iterate-outline -> iterate-structure-outline. Parse legacy `/rpi:` prefixes for imported final answers; new templates output native commands. Maintain one static catalog containing IDs, label names/titles, button text, iterate counterpart, and output type; tests compare the 23 skills and every final-answer command to it. This is a fixed data table, not a user-extensible workflow language.

| Agent prompt | bb port |
|---|---|
| codebase-locator | Fresh child, exact files/locations and evidence; no unsolicited changes |
| codebase-analyzer | Fresh child, fully trace actual behavior, return concise evidence |
| codebase-pattern-finder | Fresh child, existing examples and reusable patterns; no speculative framework |
| web-search-researcher | Child on a bb provider with available web tools; citations and explicit capability error if unavailable |
| implementer-agent | Implement one plan phase; run named checks; update plan through artifact CAS; return evidence |
| outline-implementer-agent | Implement one outline phase with companion docs and progress markers |
| implementation-reviewer | Independently inspect diff, requirements and test evidence; report findings, never authorize the human gate |

The manifest has no universal `agents` registration field. The seven files are role prompts loaded by plugin delegation; do not pretend bb imports Claude `subagent_type` automatically. `bb.sdk.skills` can inspect skill availability; packaging through `bb.skills` owns installation. Do not overwrite user/global skills. Haiku research preference selects Haiku only for the three codebase roles, subject to live provider availability; web researcher remains capability-driven.

## 10. Notifications and preferences

### Notification engine

Backend creates durable candidate receipts from observed **edges**, not repeated snapshots: entry to ready_for_input; a newly pending native approval; an inbound artifact comment. In single-user mode own UI comments are not inbound, while an agent reply/comment is. Imported historical comments and watcher echoes do not ring. Store firstInboundCommentReceivedAt once. No invented sound on failed/running/lost changes; operational failures get a separate visible error indicator/toast without the HumanLayer attention sound.

Apply the study's order, with the bundle-confirmed approval distinction:

1. Deduplicate the readiness session key or approval/comment ID while it is outstanding. Durable event keys also prevent replay of the same edge after reconnect. A later completed turn in the same session may notify again after the prior attention is cleared.
2. Skip if creator is not the local owner. Worker/extractor/bootstrap sessions are not user-owned attention targets; their blockers surface through the parent.
3. For **readiness only**, if the phase has an enabled auto-advance flag, suppress the readiness notification before playing sound. This follows the supplied behavior even when extraction subsequently fails; show extraction/launch failure separately so the task is not silently stranded. Human-gate labels without flags are never suppressed by this test. Pending approvals do not take this suppression branch.
4. Play the one audio asset if notificationSoundsEnabled, with clamped volume [0,1], default 0.2.
5. If the session is currently visible, skip the toast while retaining the sound. Navigating into its visible chat dismisses pending toasts. Pending approval resolution also dismisses its toast.

Readiness toast: title `ready_for_input` bold; session title or summary truncated to 40 characters using 37 + `...`, fallback `Session <id8>`. Approval toast: `needs_approval` in warning tone; title/summary capped at 50 using 47 + `...`; tool name maps `mcp__a__b` to `a:b`; serialize tool input and cap at 50 using 47 + `...`; display as code text, never HTML. bb approval subjects may expose command/file details instead of original tool_name/tool_input, so map available native subject fields explicitly and show Unknown tool only when absent. Never fabricate an unavailable payload.

All attention toasts last **8000 ms** with **Jump to Session ⌘⇧J** (Ctrl+Shift+J off macOS). Maintain pending stack; hotkey jumps to newest pending destination, dismisses it and removes its key. Comment destination includes artifact/comment ID. Eight-second visual timeout alone does not remove the pending key/stack entry: the supplied handlers remove it on explicit dismissal, jump, viewing the session, or approval resolution. Test this separately from Sonner's visual timeout. Readiness candidates enter the attention bookkeeping before auto-advance/viewing suppression, as in the supplied bundle; suppressed candidates render no toast and must be cleared when their destination is viewed or superseded. No `<Toaster>` instance is mounted by the plugin.

Use a shell-wide `app.contentScripts.register` controller so notifications work away from the Tasks page. SDK hooks are not available in content scripts; use authenticated same-origin RPC POST calls with validated JSON envelopes and an abortable, modest polling interval (2 seconds while connected). React header/composer/task-chat components report visible session IDs into a small client-local registry with mount/unmount accounting; no private router or DOM scraping. Link actions point to the plugin's canonical session route, which renders native ThreadChat; inside React, use `useBbNavigate`.

Multiple bb windows/remote clients must not all ring. `notifications.poll` claims each receipt transactionally for one short-lived client lease, preferring a recently focused client; expiry permits another client to take over. Sound is attempted once per claim, acknowledged even if browser autoplay rejects, and no catch-up sound burst is replayed. Browser Audio may require an initial user gesture: settings provides Test Sound/unlock and displays playback failure. A lost acknowledge can cause a rare duplicate after client crash; neither sound nor browser delivery can be exactly-once across crashes. If no browser is connected, retain task attention; do not claim an OS notification was delivered.

bb or another installed notification plugin may also alert on these threads. No per-thread native-notification suppression API was found. Setup must explain the duplicate source and use host-owned notification settings where available; do not mutate another plugin's preferences silently. Exact single-sound behavior across independently installed notification plugins is an integration gate.

### Settings and state placement

| Setting | Default and implementation |
|---|---|
| Notification Sounds / Volume | true / 20%; simple descriptor for enabled, validated numeric preference + native range input for volume; Test Sound |
| Default agent/model/effort/fast mode | coherent tuple from host `experimental_ProviderModelPicker`; persist per-provider selections; resolve with live catalog at launch, no hardcoded provider lists |
| Permissions mode | host `experimental_PermissionModePicker`; store native accept-edits/auto/full or inherit. HumanLayer default maps to inherit, accept_edits to accept-edits, auto to auto, bypass to full. Never widen host ceiling or automatically copy observed HL bypass preference |
| Workflow type | launcher outline_only; schema/API rpi; all five IDs retained |
| Auto-advance default | true for the launcher preset; master on/off seeds all five supported flags true/false, then individual overrides apply. Display the five effective flags before start; no gate-bypass master switch. Existing/imported task values remain unchanged |
| Batch Queue Delivery | true; native queue grouping and documented race limitation |
| Default directory | explicit bb host/environment selection, no implicit server cwd |
| Editor | system / code / cursor / zed; host preferred file opener via `experimental_openFileExternally`; explicit host `openDirectory` fallback for directory targets because no SDK directory-editor selector exists |
| Diff style / fullscreen | unified / split; pass view to `experimental_Diff`; no rewrite of bb global settings |
| Session costs | false by source default; native ThreadChat owns actual cost reporting; no fabricated pricing calculation |
| Show phase labels | false by source default; affects all plugin task/session views |
| Workflow graph / scratch pad / diff viewer | feature display toggles; data persists when hidden |
| Phase tips / iterate confirmation | enabled; phase-specific tips, Don't show again, reset preferences |
| Bypass nudge / fast-mode warning / session UI explainer | adapt wording to native bb controls; retain dismissal/reset, never programmatically enable broader permissions |
| Confirm interrupting subagents / deleting artifacts | true; honored on plugin actions; native Stop interception unsupported |
| Haiku research subagents | false; maps only three research roles to a live model selection |
| Context warning threshold | 80%, explicitly a plugin choice because source threshold is unspecified |
| Comment send mode | send-and-resolve as observed, alternate send; resolve only after accepted core dispatch |

`bb.settings.define` supports string/select/boolean/project, not arbitrary numeric descriptor types. Custom settings section handles range inputs and structured execution preferences through validated RPC. Use settings handle `.onChange` to invalidate effective values; do not require reload. Per-task scratch belongs in SQLite; selected artifact/tab, grouped/list/board, and dismissals use scoped preferences. Theme, zoom, streaming, keybinding editor, terminals and provider authentication stay in bb settings. No billing/account/daemon clone.

Directory editor fallback is a narrow host call with enumerated editor values and an environment-derived absolute path; spawn executable + argv, never interpolate a shell command. It opens on the selected enrolled host, which may differ from the remote browser's machine. Return unsupported/unavailable explicitly. Host native file links retain client-preferred opening behavior. Do not claim the two are the same destination.

## 11. Frontend composition

Use `navPanel({id:'tasks',path:'tasks',...})` at `/plugins/humanlayer/tasks/*`, with subPaths for list, new, drafts, task detail, session detail and artifact/version/comment routes. Board cards and tables are dense, text-first, with the task/session hierarchy, phase badges and updated age seen in screenshots. Native bb theme and shell win over copying HumanLayer's black/monospace app chrome. Adapt to compact viewports with scrollable columns or the list view, not a second application shell.

Task detail contains task title/actions, workflow strip, session list and selected `ThreadChat`. Configure `permissionPolicy:'editable'` only where the user is intentionally editing that thread's native permissions; inherit elsewhere. Let bb render provider/model/effort, attachments, streaming, queue, approvals and terminal integration. Use `experimental_NewThreadComposer` for creation; do not hand-roll a prompt textarea.

Thread right panel registers separate `threadPanelAction` entries for Artifacts, Workspace, Scratch Pad, Tips, Auto-advance, and Minimap. Changes/Diffs use native bb surfaces where they are directly available; if a plugin page needs them, add thin task panels using `environments.diffFiles/diffFile` and `experimental_Diff`. Artifact params contain only validated IDs/version; identical action+params focuses the existing tab, different artifacts can open sibling tabs. Check the boolean result of `openThreadPanel`; fall back to the canonical nav route if there is no side panel. Never assume these are fixed tabs on a native thread: the SDK exposes closable panel actions. The Tasks nav panel can declare fixed tabs sharing the same components.

Minimap uses `threads.conversationOutline` and bounded timeline/event metadata to render User/Assistant/Tool/Skill chips. There is no demonstrated public exact-scroll-to-timeline-event API; clicking opens the session or a bounded transcript excerpt and indicates the source event. Exact HumanLayer scroll synchronization needs a host navigation extension; no DOM selector tricks. Changes All/To Review tracks reviewed patch hashes in plugin preferences; new patch hash becomes unreviewed again. Diff comments anchor `{v:1,repoId,path,patchHash,start,end}` and show beside the native diff. `experimental_Diff` exposes no comment-selection callback, so a plugin range/comment control is necessary; exact inline commenting requires a future host slot.

**Do not replace the sidebar thread list initially or in the production default.** Keep bb's navigation, splits, child handling, unread/pinned behavior and shortcuts. The task tree/session hierarchy is available in the nav panel. Phase/status accessory uses `experimental_threadHeaderAction`; optional content-script `experimental_setThreadRowStatus` may decorate linked native rows after feature detection but cannot add a full phase-pill hierarchy. A true HL sidebar would require the exclusive `experimental_threadList` slot and conflict with other plugins. If later explicitly requested, it must preserve `Original` fallback, `experimental_useSidebarThreads/experimental_useSidebarThreadActions`, split props, `onNavigate`, and `data-sidebar-thread-shortcut-target`/`data-sidebar-thread-id`. It is not necessary for the complete task workflow here.

Shortcuts: keep bb's ⌘K, ⌘,, ⌘B, terminal, archive, send and pane movement. Add Jump ⌘⇧J through the cleanup-safe content script and register `commandPaletteAction` entries for New Task, Tasks, Jump Notification. Plugin-only T and g t are scoped to noneditable plugin views, never swallowed in chat inputs or IME composition. Expose a compact guide of actual supported keys, not HumanLayer hotkeys that bb uses differently.

## 12. Delivery phases and model assignment

These are sequential, independently usable releases. Do not expose controls for phases not yet implemented. Each phase ends with an installable build, its focused tests, and a live workflow check. The final release is complete only after all requested supported features and explicit SDK boundary gates pass.

Phase 1 launches ordinary freeform bb sessions from saved structured input; it does not advertise artifact-dependent RPI execution yet. The task input bytes and initial schema are present from that phase, while version history UI, mirrors and artifact-dependent workflow controls become available in phases 2 and 3. This keeps the early task organizer usable without promising hydration before that feature ships.

The model assignments below are engineering recommendations, not performance guarantees. Official model references confirm [GPT-5.4 mini](https://developers.openai.com/api/docs/models/gpt-5.4-mini), [Haiku 4.5](https://www.anthropic.com/claude/haiku), and [Sonnet 5](https://platform.claude.com/docs/en/models/sonnet-5/migration-guide). Resolve actual model IDs through bb's live provider catalog; do not assume an API model is configured in the user's bb. Use expensive reviewers at the listed acceptance boundaries, not to generate routine UI scaffolding.

| Phase | Shippable outcome | Coding model | Acceptance / expensive review |
|---|---|---|---|
| 0. SDK boundary proof | Installable diagnostic plugin with typed task-to-thread spike, capability report and no advertised unfinished workflow | gpt-5.4-mini for scaffold, Sonnet 5 for lifecycle spike | Reviewer traces cold provisioning/bootstrap reuse, launch-token binding before provider config, pending approvals/history, queue batching races, reconnect and disable. Decide which exact-parity requirements need upstream bb changes before committing to full parity |
| 1. Tasks and native sessions | Draft/save/start, task list/board, session table, native chat, provider settings, fork/archive | Haiku 4.5 for package/forms/tables; gpt-5.4-mini for native component wiring | Sonnet 5 owns draft/session invariants and reducer. Expensive reviewer checks DTO correctness, sibling phases vs cascading child archives, complete input forwarding, permissions ceilings |
| 2. Artifacts and mirrors | task.md, naming, DB versions, binary preview, viewer links, hydration, CAS conflicts, soft delete | Sonnet 5 for DB/CAS/paths; gpt-5.4-mini for viewer UI | Expensive reviewer checks crash windows, two writers, symlinks, cross-task scoping, HTML isolation, no private bb storage writes |
| 3. Comments and manual RPI | Block comments, three native tools, manual phase launching, all 23 skills + 7 agents | Haiku 4.5 for mechanical prompt/template port, gpt-5.4-mini for comments UI, Sonnet 5 for anchors/tools | Expensive reviewer compares every source skill, aliases, final templates, role semantics, confirmation policy and lost-context continuation |
| 4. Workspace and context | now/later/never, supported multi-repo setup, retry/skip, scratch, minimap, tips, gauge/iterate/handoff/shards | Sonnet 5 for workspace/context; gpt-5.4-mini for panels | Reviewer verifies no custom Git manager, real host routing, unsupported layout disclosures, usage semantics and per-phase context isolation |
| 5. Durable auto-advance | Exact transition table, human gates, extraction, one-intent-per-turn, crash reconciliation, queue interaction | Sonnet 5 | Expensive reviewer attempts gate bypass, stale callback, duplicate launch, user-input race, ambiguous fork/spawn and failed setup. All rows and no-flag edges tested |
| 6. Notifications and settings completeness | Exact sounds/toasts/hotkey, suppression and multi-window dedupe, remaining preferences, native changes/diffs + review metadata | Haiku 4.5 for controls, gpt-5.4-mini for client UI, Sonnet 5 for receipts/suppression | Reviewer compares section 5 behavior and screenshot labels, verifies native-notify coexistence and client autoplay/remote behavior |
| 7. Release hardening | Packaged install/update/reload, restore from DB backup, acceptance evidence and documented remaining parity gaps | gpt-5.4-mini for tests/packaging, Sonnet 5 for fixes | Independent expensive reviewer reads end-to-end evidence, not just green unit tests; final product checklist must identify any blocked exact-parity items |

An expensive reviewer should receive the ground-truth study, this plan, the exact diff and named test results. Ask for concrete mismatches, races and unsupported assumptions. A second reviewer is most valuable on artifacts and auto-advance, where data loss or duplicate work is costly. Do not ask reviewers to approve aesthetics subjectively or silently waive a failing requirement.

## 13. Test and acceptance plan

### Automated contracts

* **Schema and migration:** real temporary SQLite through `createFakePluginHost`; migrations on empty and prior fixtures; FK/check constraints, unique task filenames, number allocation under competing calls, stale revision rejection, version restore, tombstone retention, backups with WAL handled correctly. No mocked DB.
* **Status:** table-driven fixtures for all 12 HL statuses, all six native statuses, approval vs question, error vs watchdog-loss, reconnect grace, stale idle after active, no heartbeat false positives, archived/deleted workers, multiple phase labels.
* **Events/recovery:** duplicate wakeups, out-of-order callbacks, event pagination/cursor transaction, approval inserted+resolved between polls, startup baseline, reconnect backfill, reload with in-flight callbacks, no stale SDK handles after dispose.
* **Executor:** every transition table row and every missing edge; flags off/on, prd_tdd target mismatch, no extraction, malformed command, current-session check, queue precedence, gates with changed artifact versions, implementation workers still active, manual+auto double click, crash before/after spawn, unique token adoption, zero/two matches remain uncertain, archive while launch is pending.
* **Artifacts:** two UI writers; provider disk edit against newer DB; offline write; write succeeded/ledger failed; watcher echo; binary exact-byte round trip; 25 MiB limit; traversal/absolute/Unicode/case-fold collisions; symlink escape; missing disk does not delete; deletion during write and restore collision; frontmatter version grouping; live links with dead/moved environments.
* **Comments:** exact/neighbor anchor, repeated paragraphs, moved blocks, edited/deleted block becomes orphan, version-specific links, cross-artifact reply rejection, short-ID collision, XML escaping, pagination and byte bounds, agent scope, send-and-resolve only after dispatch acceptance, retry does not double-reply.
* **Context/skills:** all 23 manifest skill names, seven role files, all referenced templates/scripts present, no executable `/rpi:*` output or humanlayer cloud command left, catalog/label/button mappings, descriptive research requirements, selected-doc-only handoff, current-context usage not cumulative total, unknown limit and estimated gauge.
* **Notifications:** fake clock at 7999/8000 ms; readiness edge dedupe vs later turn; approval ID dedupe; owner filter; auto readiness suppression before sound; viewed session still sounds; navigation/approval resolution dismissal; truncation at 40/50 including Unicode display behavior; MCP tool name mapping; inbound agent comment vs own comment; newest pending hotkey; two-client claim/lease expiry; autoplay failure; no replay storm.
* **Frontend:** `loadPluginApp`, `renderSlot`, `mountPluginContentScripts`; validated subPaths/tab params, draft failed-submit retention, typed request forwarded intact, native `ThreadChat` and pickers, fallback on declined panel opening, list/board equivalence, keyboard access/focus, slot cleanup, data refetch after `useRealtimeConnectionState` reconnect.
* **Public surface:** `experimental_scanPublicSdkOnly` with no private imports or package escape. `bb plugin types --check`, TypeScript no-emit, tests, `bb plugin build`, and packed artifact metadata match manifest. The harness cannot prove real auth, provider behavior, CSS, timers or multi-plugin arbitration.

### Required live checks

Use an isolated test bb project and explicit enrolled host. Exercise two configured provider families (Claude and Codex if available), normal permissions and a deliberately pending approval, and a real small repository. Record the actual provider/model IDs and all skipped lanes.

1. Create/save/reopen draft with attachments, mentions and selections; start now/later/never tasks and verify actual bb environment/branch paths at every phase. Confirm no user-phase work starts before hydration.
2. Complete questions -> research auto transition, stop at design/outline gates, approve manually, implement one phase with implementer and reviewer, withhold commit/proceed, then approve it. Confirm UI and DB phase state agree.
3. Repeat PRD/TDD, outline_only, oneshot and freeform paths; ensure no invented auto edge bypasses the literal table. Run legacy plan->worktree separately.
4. Edit the same artifact in the UI and repo while a session runs; show conflict without overwriting either. Restore a version, resolve a anchored comment through an agent, delete/restore, preview image and sandbox HTML, open permalink after moving/offlining its worktree.
5. Queue several messages, toggle batching, interrupt with a queued followup, resolve/deny an approval, fork at an event, archive source, and verify no unrelated or later phase disappears.
6. Kill/reload plugin/server during hydration, after accepted spawn but before receipt, during setup and during extraction. Verify adoption or explicit uncertainty, no duplicated implementation thread, and no auto approval.
7. Disconnect/reconnect host and browser separately. Verify reconnect vs lost, mirror repair, historical-event backfill, no old notification burst, DB viewer still works offline.
8. Open two clients/windows with different visible sessions; test sound on/off/20% volume, eight-second toasts, viewed-session suppression, approval resolution dismissal, artifact comment jump and ⌘⇧J. Test alongside native/installed notification plugins.
9. Test each of the eight required screenshot surfaces semantically, including labels, table columns, grouped artifacts, worktree options and settings. Freeze deterministic bb-native snapshots with fixed data/time/viewports; use a predeclared 95% image-similarity gate for subsequent changes to those snapshots. Original HL full-screen pixel parity is inappropriate because bb owns the shell; compare plugin-owned regions only and explicitly list native substitutions.
10. Build/package/install from a clean dependency install, reload/disable/enable, restart with real DB, and restore a consistent SQLite backup into an isolated plugin instance. No active host watcher/process survives disposal. Artifact bytes, comments and versions remain intact.

Keep evidence as named command/results, thread/environment IDs, DB consistency assertions, screenshots and failure-injection logs. Unit tests passing is not proof of host integration. Release cannot claim exact parity for a blocked SDK lane simply because a fallback UI exists.

## 14. Risks and explicit SDK gaps

| Gap / risk | Supported solution | Exact-parity consequence |
|---|---|---|
| Cold dispatch precedes managed environment | Hidden bootstrap, then hydrated reuse session | Extra helper turn; phase 0 must prove lifecycle and association ordering |
| No idempotent spawn/fork/send | Durable correlation token, inspect/adopt, uncertain state, no blind retry | Automatic recovery cannot promise exactly-once effects |
| No general tool hooks | Native artifact tools + watcher/end-turn import | No instant refresh/permalink injection for arbitrary provider Reads/Writes |
| No managed path/branch templates or multi-repo layout API | bb environment collection and explicit resolved paths | Exact sibling layout and combined instruction-tier semantics need bb changes |
| No native provisioning retry/skip API | Plugin setup-step controls + native recovery | Cannot emulate internal provisioning stage controls through private endpoints |
| Pending interaction event is not a plugin lifecycle event | `thread:changed` + typed history + `interactions.list` | Live latency and provider-specific approval subject mapping require verification |
| Native enqueue batching has no per-thread policy hook | Native group boundaries with optimistic expectations | Race must be accepted as documented adaptation or fixed upstream |
| Embedded composer lacks complete onChange API | bb client draft + explicit durable Save Draft | Full continuous server-side draft autosave is not exposed |
| No global React slot/context in content script | Small shell controller + bounded RPC polling + visible-session registry | No private router/store dependency; minimal notification latency |
| No per-thread host notification mute API | User-visible host setting/coexistence setup | Duplicate independent notification sources remain possible |
| No node hooks on Markdown / line selection on Diff / exact minimap scroll target | Block gutter, range control, source excerpt using native rendering | Exact inline placement/navigation requires host extensions |
| Disable can orphan-clear waits | Explain pending state, stop task threads before disabling | Plugin cannot enforce gates after being disabled |
| Source skill/sound rights | Verify license and attribution before distribution | Private research does not establish redistribution rights |
| Large binary/history growth | Byte limits, metadata paging, explicit export/backup; no automatic destructive pruning | DB can grow; show size and preserve history until user chooses retention |
| Generated setup/HTML content | Native provider permission gates, confined paths, sandbox preview | Task content is untrusted data, never privileged host instructions |

The implementation should stop at these boundaries rather than fork bb's internals. The final deliverable is a production-ready bb-native HumanLayer task/workflow/artifact system with demonstrated behavior, and an explicit parity ledger for SDK limitations. If “fully” requires every unavailable timing/layout/UI detail to be identical, the corresponding upstream SDK additions are prerequisites to that claim, not optional polish.
