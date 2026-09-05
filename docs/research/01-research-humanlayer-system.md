---
type: research
topic: How HumanLayer (Riptide, app v0.169.0 / CLI 0.31.128) works: tasks, sessions, artifacts, phases, context, notifications
status: complete
date: 2026-09-05
sources:
  - Installed CLI `humanlayer api <cmd> --help` for 47 commands (research/hl-api-schema.md)
  - HumanLayer stdio MCP server tools/list (live probe)
  - Production frontend bundle app.humanlayer.com/assets/index-D8tPFFAP.js (research/hl-frontend-bundle.js) incl. Drizzle DB schema and zod contracts
  - Installed plugin skills/agents/hooks at ~/.humanlayer/riptide/plugins/riptide-rpi-terminal/0.30.34
  - Desktop app localStorage (riptide-settings and friends) and live UI screenshots (research/shots/)
  - Real task artifact directories at ~/.humanlayer/riptide/artifacts/<taskId>/
---

# Research: How HumanLayer works

This document is descriptive only. It records what exists in HumanLayer and how it behaves. The plan (separate document) decides what to replicate in bb.

## 1. Object model (from the Drizzle schema in the frontend bundle)

Hierarchy: **Organization → Project → Task → Session → ConversationEvent**. Artifacts hang off a Task. Comments hang off Artifacts (block anchored) or off the task diff (patch anchored). Approvals and QueuedMessages hang off Sessions.

### tasks (34 cols)
`id, team_id, project_id, organization_id, created_at, created_by, resource_owner_user_id, updated_at, name, slug, default_working_directory, external_task_id, archived, is_draft, setup_status, setup_details, ticket_id, ticket_url, ticket_description, ticket_provider, github_connection_id, ticket_repository_id, ticket_repository_full_name, created_with_experiment_flags, workflow_type, worktree_timing, workspace_state, workspace_spec, auto_advance_questions_to_research, auto_advance_research_to_design, auto_advance_plan_to_worktree, auto_advance_worktree_to_implementation, auto_advance_implementation_to_pr, slack_notifications_muted`

- `workflow_type` enum: `rpi | outline_only | prd_tdd | oneshot | freeform` (default `rpi`). UI exposes three: RPI, PRD/TDD, Freeform.
- `worktree_timing`: `now | later | never` (default `later`). UI copy: "Worktree now: create before the first session", "Worktree later: create before implementation", "No worktree: use the selected directory".
- `setup_status`: `pending | in_progress | completed | failed`.
- `is_draft`: drafts are tasks with no sessions; UI has a Drafts list and "Recent drafts" on the composer.
- Ticket import: `ticket_provider` in `linear | jira | github`; task input artifact is `ticket.md` (legacy) or `task.md` (V3 composer writes the prompt to `task.md`).
- The five `auto_advance_*` booleans live on the task AND per-user in `task_user_settings` (user override wins for non-owners).

### sessions (39 cols)
`id, task_id, organization_id, forked_from_session_id, created_by, resource_owner_user_id, coding_agent, coding_agent_session_id, host_id, working_directory, model, resolved_model, provider, effort, fast_mode, title, summary, status, created_at, updated_at, last_activity_at, num_events, context_window_tokens, context_window_limit (default 168000), total_cost_usd, model_usage, applied_usage_report_keys, error_message, permissions_mode, multiplayer_prompting_user_ids, multiplayer_prompting_started_at, multiplayer_prompting_expires_at, archived, fork_data, workflow_type, prompt, labels, next_step_suggestions, structured_summary`

- **status enum (authoritative, zod):** `ready_for_launch | waiting_for_workspace | draft | launching | running | failed | ready_for_input | needs_approval | interrupt_requested | interrupted | resuming | lost`. A DB index treats `running, launching, resuming, interrupt_requested` as "lost candidates" (heartbeat timeout → `lost`). UI renders `ready_for_input` as `idle` with a red bell-slash glyph in lists, and `IDLE` in the composer status pill.
- `coding_agent`: `claude | codelayer | fold` (+ CLI accepts `opencode`, `claude_code_terminal`). `provider` for codelayer: `anthropic | copilot | codex | firepass | xai`.
- `permissions_mode`: `default | accept_edits | auto | bypass`.
- `labels`: `[{name, title}]`, e.g. `{name:"rpi:implementation", title:"implementation"}`. The label is the phase badge shown everywhere (sidebar, sessions list, kanban).
- `next_step_suggestions`: `{ parsedAt, extraction: { type:"next_step_found", nextStepPrompt, nextStepSummary, nextStepType, taskReference, suggestedDirectory } | { type:"no_next_step", reason }, extractionError? }`. `nextStepType` enum equals the RPI skill ids plus `other`. This is AI-extracted from the session's final answer (skills end with a `\`\`\`text /rpi:create-research \`\`\`` block by template) and drives the "proceed to X" button and auto-advance.
- `structured_summary`: `{ summaryHistory: string[], relevantTasks?: string[], relevantRPIDocuments?: [{localpath, permalink?}] }`. Used for handoff / continuation.
- Composer footer shows: status pill, model, effort, fast-mode bolt, `context_window_tokens/limit (pct)`, `$cost`.

### conversation_events (26 cols)
`event_type: message | tool_call | tool_result | thinking | system`; `role: user | assistant | system`; `tool_call_id, tool_name, tool_input_json, parent_tool_use_id, tool_result_for_id, tool_result_content, approval_status, approval_id, next_step_suggestion, input_tokens, output_tokens, run_index`. The right-panel **Minimap** is a compressed vertical render of these rows (Bash/Skill/Assistant/User chips).

### approvals (19 cols)
`session_id, tool_use_id, status (pending | approved | denied ...), tool_name, tool_input, suggestions, applied_suggestions, comment, approved_by_user_id, responded_at`. API: `approvals resolve --decision approve|deny --comment`. Insert with `status=pending` triggers the `needs_approval` notification.

### artifacts (19 cols) + artifact_versions (11)
`task_id, task_slug, file_name, content, content_hash, frontmatter (json, default {}), share_key, shared_by, share_enabled, is_deleted, storage_type (postgres | upload), content_type, file_size_bytes`. Versions: `version_number, content, content_hash, created_by`. API: `artifacts upsert --file-name --content [--operation-type --operation-contents --frontmatter]`, `artifacts versions list`, `create-upload` (binary via presigned URL, e.g. screenshots), `update-deletion-status` (soft delete, `.trash/` locally), `sharing artifact update --enabled` (public permalink).

- **Identity is (task, file_name).** Upsert = new version. Local mirror lives in `.humanlayer/tasks/<task-slug>/` in the repo and `~/.humanlayer/riptide/artifacts/<taskId>/` on the host.
- **Naming convention (from skills):** `NN-<type>-<2-4 word kebab slug>.md`, NN zero-padded chronological (skill `ls -La`s the dir and takes max+1). Input is `task.md` or `ticket.md`. Free files also allowed (`handoff.md`, `pr-description.md`, `Screenshot ...png`, `ci-workflow-proposed.yml`).
- **Frontmatter `type`** drives grouping in the Artifacts panel ("GROUPED" toggle): `research-questions, research, design-discussion, structure-outline, plan, prd, tdd, pr-description`, everything else under OTHER. Templates add `date, git_commit, branch, repository, topic, tags, status`.
- Panel shows per-artifact comment count, "..." menu, and a Preview/Raw toggle in the viewer; version selector per artifact.
- Cloud permalink `https://cloud.humanlayer.com/artifacts/<artifactId>` is returned to the agent as `additionalContext` in the PostToolUse hook response so the final answer can link it.

### artifact_comments (21 cols)
`artifact_id, created_at_artifact_version_id, reply_to_comment_id, content_text, content_json, commented_upon_block_text, previous_block_text, next_block_text, anchor_json, kind (default comment), is_resolved, resolved_by_user_id, is_deleted, created_by_agent`. Anchor is **text-block based** (the commented block plus its neighbors) so it survives re-versioning. Agent-facing MCP tools return threaded XML with **truncated ids**. Frontend setting `riptide-send-comments-mode = "send-and-resolve"` (send comments to a session and auto-resolve) vs plain send.

### diff_comments (15 cols)
Same shape, anchor `{v:1, repoId, path, patchHash, start, end}`. Shown in the Diffs tab ("Collaborative Diff Viewer" experiment).

### queued_messages (11 cols)
`session_id, content, status (pending ...), deliver_on_interrupt`. Setting `preferBatchQueueDelivery`: send all queued messages together when the session becomes ready vs one at a time.

### task_user_settings (15), task_workspace_setup_for_host (10), online_hosts (6), context shards
- `task_user_settings`: per-user `working_directory, host_id, workspace_base_directory, workspace_materialized_at` + the 5 auto-advance overrides.
- `task_workspace_setup_for_host`: `status (default setup_requested), resolved_workspace_spec, workspace_setup_state, error`. Stages: `copy_globs`, `setup_command` (API `retry-step`, `skip-step`, `update-repository-directory`).
- `online_hosts`: `host_id, host_name, status online|offline, last_seen`. Header shows `Marks-MacBook-Pro.local (32cf73)`.
- **Context shards**: `{ id, shardText, evidence: [{citation, conversationEventId, sessionId, taskId, sourceUserId, role}], state: enabled|disabled|dismissed, createdAt }`. Server-extracted durable facts about the user/org gathered from conversations, with per-user preference (`update-preference`, `restore`). Injected into new sessions as background context.

## 2. Session lifecycle and hooks

The desktop daemon (`riptided`) owns sessions. For terminal Claude Code sessions the plugin's `hooks.json` mirrors the same state machine:

| Claude hook | HL command | Effect |
|---|---|---|
| SessionStart | `hook auth-check`, `hook session-start` | Hydrate task artifacts from cloud into `.humanlayer/tasks/<slug>/`, mark session `running` |
| UserPromptSubmit | `hook user-prompt-submit` | mark `running` |
| PermissionRequest (`*`) | `hook permission-request` | mark `needs_approval` (waiting for approval) |
| PostToolUse (`*`), PostToolUseFailure | `hook permission-resolved` | mark `running` |
| PreToolUse (Read/Write/Edit/MultiEdit) | `hook pre-tool-use` | refresh that artifact from cloud before the agent touches it |
| PostToolUse (Write/Edit/MultiEdit/Skill) | `hook post-tool-use` | push artifact to cloud (new version), return cloud permalink as additionalContext |
| Stop | `hook stop` | mark `ready_for_input` |

MCP server (`humanlayer mcp`) is scoped by env `HUMANLAYER_TASK_ID`, `HUMANLAYER_SESSION_ID` and exposes exactly three tools: `get_artifact_comments(artifact_filename, include_resolved, limit, offset)`, `update_artifact_comments(artifact_filename, comment_ids[], resolved?, deleted?)`, `reply_to_artifact_comment(artifact_filename, comment_id, content)`.

Session operations (API): `create` (draft/ready_for_launch), `launch`, `continue` (send text, may change model/effort/fast-mode/permissions), `interrupt --message`, `fork --source-session-id --fork-at-event-id --text [--archive-source]`, `update-status`, `queued-messages create/update/delete/send-now`, `multiplayer-prompting update` (time-boxed shared prompting, default 15m).

Composer action row (session): bypass-permissions toggle (red bell-slash), auto-advance (fast-forward), "proceed to next phase" (skip-forward, green when a next step is extracted), archive, fork, open directory in editor, multiplayer.

## 3. Workflow phases, skills, and auto-advance

### Skill → label table (from bundle `eE`)
| command | skillId | label | button text |
|---|---|---|---|
| rpi:create-research-questions | create-research-questions | research-questions | proceed to research questions |
| rpi:iterate-research-questions | iterate-research-questions | research-questions | iterate research questions |
| rpi:create-research | create-research | research | proceed to research |
| rpi:iterate-research | iterate-research | research | iterate research |
| rpi:create-design-discussion | create-design-discussion | design | proceed to design |
| rpi:iterate-design-discussion | iterate-design-discussion | design | iterate design |
| rpi:create-prd | create-prd | design-prd | proceed to PRD |
| rpi:iterate-prd | iterate-prd | design-prd | iterate PRD |
| rpi:create-tdd | create-tdd | design-tdd | proceed to TDD |
| rpi:iterate-tdd | iterate-tdd | design-tdd | iterate TDD |
| rpi:create-structure-outline | create-structure-outline | structure | proceed to outline |
| rpi:iterate-structure-outline | iterate-structure-outline | structure | iterate outline |
| rpi:create-plan | create-plan | plan | write plan |
| rpi:iterate-plan | iterate-plan | plan | iterate plan |
| rpi:configure-workspaces | configure-workspaces | worktree-setup | configure workspaces |
| rpi:setup-worktree | setup-worktree | worktree-setup | setup worktree |
| rpi:implement-plan | implement-plan | implementation | implement |
| rpi:implement-outline | implement-outline | implementation | implement from outline |
| rpi:iterate-implementation | iterate-implementation | implementation | iterate implementation |
| rpi:describe-pr | describe-pr | describe-pr | create pull request |
| rpi:ci-commit | ci-commit | implementation | commit changes |
| rpi:review-artifact-comments | review-artifact-comments | review | review comments |

Plus a synthetic `rpi:todo` label for tasks with no sessions. Aliases: `rpi:create-worktree → setup-worktree`, `rpi:configure-workspace`, `rpi:create-research-plan → create-research-questions`, `rpi:create-outline`, `rpi:iterate-outline`. Built-in `hl` plugin adds `show-me`.

### Workflow graphs (UI strip under the composer, "RPI WORKFLOW")
- **rpi**: worktree(dashed, timing-dependent) → questions → research → design → outline → implement → PR. (Legacy includes plan.)
- **outline_only**: questions → research → design → outline → implement → PR (the user's default `launcherV3WorkflowType`).
- **prd_tdd**: research → PRD → TDD → outline → implement → PR.
- **oneshot / freeform**: single session, no labels.

### Auto-advance transition table (bundle `K9n`)
| from label | flag | next step | target label |
|---|---|---|---|
| rpi:research-questions | auto_advance_questions_to_research | research | rpi:research |
| rpi:research | auto_advance_research_to_design | design | rpi:design |
| rpi:design | (none, human gate) | structure outline | rpi:structure |
| rpi:design-prd | (none) | TDD | rpi:design-tdd |
| rpi:design-tdd | (none) | structure outline | rpi:structure |
| rpi:structure | (none) | plan | rpi:plan |
| rpi:plan | auto_advance_plan_to_worktree | worktree setup | rpi:worktree-setup |
| rpi:worktree-setup | auto_advance_worktree_to_implementation | implementation | rpi:implementation |
| rpi:implementation | auto_advance_implementation_to_pr | PR description | rpi:describe-pr |

Design, structure and plan are always human gates. When a session flips to `ready_for_input`, has a `next_step_found` extraction, and the flag for its label is on (user override else task), the app launches a new session in the same task with `nextStepPrompt` (skill command), in the task's working directory (or `suggestedDirectory`), and suppresses the ready_for_input toast. Task-level toggle: fast-forward icon on composer; per-transition toggles in the "auto-advance" sidebar tab.

### Skill design conventions (from the 23 SKILL.md files)
- Every "create-*" skill: read `task.md`/`ticket.md` and @-mentioned files fully; do NOT read other artifacts unless asked; use the four research subagents (`codebase-locator`, `codebase-analyzer`, `codebase-pattern-finder`, `web-search-researcher`) via Task tool; read `{SKILLBASE}/references/<type>_template.md`; write `NN-<type>-<slug>.md`; read `references/<type>_final_answer.md` and respond with EXACTLY that template (it ends with a fenced `text` block containing the next `/rpi:*` command, which the extractor parses).
- Research is strictly descriptive ("how does it work", never "how should we"). Research-questions must not leak the task's intent.
- `implement-plan`/`implement-outline`: orchestrator loop per phase: spawn `implementer-agent` with a short prompt pointing at the plan file (no duplication), then `implementation-reviewer`, then pause for the human ("commit and proceed"). Keeps the parent context low; that is the explicit context-management strategy.
- `iterate-*` skills: read the existing artifact + comments, apply, bump version (same file name), respond with the same final-answer template.
- `review-artifact-comments`: read artifact, fetch comments via MCP, ask the user how to proceed unless instructed, work one comment at a time, only resolve/reply/delete on confirmation.
- `setup-worktree` / `configure-workspaces`: `.humanlayer/workspace.json` (+ `.local.json`, gitignored): `disabled, pathTemplate (~/.humanlayer/workspaces/{{ TASKSLUG }}/{{ REPOBASENAME }}), branchTemplate ({{ TASKSLUG }}), sourceRef, setupCommand, copyGlobs (additive dedupe), repos[{localPath, description, primary, sourceRef?, setupCommand?, copyGlobs?}]`. Multi-repo with exactly one primary.
- `describe-pr`: PR description template + HTML walkthrough with injected diffs (script `inject-walkthrough-diffs.sh`).
- `create-tdd` / `create-design-discussion`: HTML artifact escape hatch (`artifact_template.html`) and `show-me` visual conventions (pseudocode, call tree, component tree, file tree, mermaid, diff).
- Experiments: "Faster Research Subagents" = Haiku for the three codebase-* agents. "HumanLayer Library Researcher" = cloud tool for dependency docs.

## 4. Context management (what HL actually does)
1. **Fresh session per phase**, with artifacts as the only carry-over. The composer's Tips tab literally says "keeping parent context low for re-steering".
2. **Artifact hydration**: session-start hook pulls the task's artifact directory into the repo so `Read(.humanlayer/tasks/...)` works from a fresh context.
3. **Context gauge**: `context_window_tokens / context_window_limit` shown in the footer (e.g. `122,016/353,400 (35%)`); a per-session dismissible context warning (`riptide-context-warning-dismissed.<sessionId>`) offers to launch an `iterate-*` session in a fresh context ("Show Iterate Confirmation Dialog" setting).
4. **structured_summary** + **next_step_suggestions** extracted per session for handoff and buttons.
5. **Context shards**: cross-session durable facts with evidence and per-user enable/disable/dismiss.
6. **Handoff artifacts** by convention (`handoff.md`), and skills that instruct "do not read other artifacts unless requested".
7. **Subagent delegation** for research and implementation so the orchestrator holds little.

## 5. Notifications, sounds, statuses (exact rules from bundle)
- One sound asset: `/sounds/notification.mp3` (12,888 bytes, saved at research/notification.mp3). Played with `new Audio(...); volume = notificationVolume (default 0.2)`; gated by `notificationSoundsEnabled` (default true). Settings UI: "Notification Sounds: Play a sound when a session needs your input or approval" + Volume slider.
- **Triggers** (exactly two, plus artifact comments):
  1. Session status transitions into `ready_for_input` (previous != ready_for_input).
  2. Approval row inserted with `status = pending` (`needs_approval`).
  3. Inbound artifact comment (toast with artifact/comment ids; `firstInboundCommentReceivedAt`).
- **Suppression rules**, in order: already notified for this id; current user is not the session's `created_by`; auto-advance flag covers this label's transition (skip toast, still auto-launch); user is currently viewing that session (sound still plays, toast skipped, and any pending toast for the session auto-dismisses when navigating to it).
- **Toast**: 8s duration, title `ready_for_input` (bold) or `needs_approval` (warning color); description = session title/summary truncated to 40/50 chars or `Session <id8>`; approval toasts add `` `tool_name` using `tool_input(47)...` `` with `mcp__a__b` rendered as `a:b`; action "Jump to Session ⌘⇧J". Pending toasts kept in a stack for the hotkey.
- Status glyphs in lists: red bell-slash + "idle" for ready_for_input; label pill colored by phase (research-questions blue, research green, design purple, structure pink/red, implementation green).
- Kanban columns: TODO / DRAFT, RESEARCH & DESIGN, PLANNING, IMPLEMENTATION. Lists: LIST/BOARD, EVERYTHING/MINE, FILTER USERS, GROUPED. Tasks table: Name, Step, Owner, Sessions, Created, Updated. Sessions table: Status, Title, Labels, Task, Working directory, Updated.
- Also: `slack_notifications_muted` per task (Slack integration), `Batch Queue Delivery`.

## 6. Settings (localStorage `riptide-settings`, 68 keys) worth mirroring
`defaultEditor (code|cursor|zed|system), showSessionCosts, notificationSoundsEnabled, notificationVolume, diffStyle unified|split, diffStyleFullscreen, zoomLevel, streamingRenderingEnabled, theme, defaultAgent, defaultModel, defaultClaudeCodeModel/Effort/FastMode, defaultCodelayerProvider + per-provider model/effort, defaultDirectory, launcherV3PermissionsMode (bypass), launcherV3WorkflowType (outline_only), launcherV3AutoAdvance, preferBatchQueueDelivery, showTaskPhaseLabels, workflowGraphEnabled, diffViewerEnabled, scratchPadEnabled, haikuResearchSubagentsEnabled, experimentalSubagentsEnabled, confirmBeforeInterruptingSubAgents, confirmBeforeDeletingArtifacts, multiplayerPromptingLastDuration, archiveKeybinding (mod+e), sendMessageKeybinding (mod+enter), thinkingVerbsDisabled, bypassNudgeSilenced, fastModeWarningAcknowledged`. Tips toggles: phase tips, iterate confirmation, bypass nudge, fast-mode warning, session UI explainer, confirm interrupting sub-agents. Per-task local state: scratch pad text, selected artifact, selected sidebar tab, terminal height/open, last working dir.

Hotkeys: ⌘K palette, T create task, g t tasks, ⌘, settings, ⌘B sidebar, ⌘E archive, ⌘⏎ send, ⌘⇧J jump to notified session, ⌘J terminal, ⌘⇧O open dir in editor, h/j/k/l pane focus, ⇧H/⇧L focus pane, S toggle sidebar, ⏎ focus input, esc blur, ⇧? hotkeys guide.

## 7. Right panel tabs (task/session context)
ARTIFACTS (grouped by type, comment counts, viewer with Preview/Raw + versions + comments), CHANGES (git changes tree ALL / TO REVIEW, M/A/D badges, "Open files in Sidebar|Editor"), DIFFS (collaborative diff with anchored comments), WORKSPACE (worktree setup state, repos, setup steps retry/skip), SCRATCH PAD (per-task local notes), MINIMAP (event chips), TIPS (phase tips, "Don't show again"), and an `auto-advance` tab id in localStorage.

## 8. Real artifact directory example
`~/.humanlayer/riptide/artifacts/01a05846-e035-.../`: `task.md`, `01-research-questions-design-system-foundations.md`, `02-research-design-system-foundations.md`, `03-research-design-system-runtime.md`, `04-design-discussion-...md`, `05-structure-outline-...md`, `06-proposal-...md`, `07-design-discussion-...md`, `08-structure-outline-...md`, `09-structure-outline-...md`, `handoff.md`, `pr-description.md`, `loop-fixes.md`, 20+ `review-*.md`/`luna-*.md` free-form docs, 3 screenshots, `ci-workflow-proposed.yml`, `.trash/` with soft-deleted files. Confirms: numbering is per task, free-form files are common, binary uploads live alongside, deletes are soft.

## 9. bb primitives available (for the plan; from the installed Plugin SDK 0.4.34 docs)
- Backend: `bb.settings.define`, `bb.storage.database()/migrate/kv`, `bb.rpc.register(defineRpcContract)`, `bb.http.route`, `bb.realtime.publish`, `bb.background.service/schedule`, `bb.events.on(thread.created|active|idle|failed|archived|deleted, message.queued|dispatched, turn.failed)`, `bb.experimental_hooks.on("message.dispatch") → proceed|wait|reject`, `bb.agents.registerTool` (+ `configure`, `contributeInstructions`), `bb.cli.register`, `bb.sdk.threads.{spawn(prompt|input, environment, visibility hidden, parent), fork, send(mode auto), timeline, interactions.{list,respond}, queuedMessages.*, compact, stop, archive, update(title)}`, `bb.sdk.environments.{diff,diffFiles,commit,pullRequest}`, `bb.sdk.files.{read,write(CAS),list}`, `bb.sdk.terminals`, `bb.sdk.providers.models`, `bb.sdk.skills`, `bb.hosts`.
- Frontend (`definePluginApp`): `navPanel` (own route + sidebar entry), `threadPanelAction` (right-panel tab per thread), `experimental_threadList` (sidebar replacement, with DOM shortcut contract), `messageDirective`, `messageAction`, settings sections, `useRpc/useRealtime/useSettings/useBbNavigate/useBbContext`, host `ThreadChat`, `NewThreadComposer`, source/diff viewers, sonner `toast`, vendored shadcn.
- bb thread ≈ HL session (status, provider/model/effort/permission mode, fork, queue, interactions). bb has no task or artifact concept: those are plugin-owned. bb worktree environments ≈ HL workspace setup. bb `--parent-self` child threads ≈ HL subagents/phase sessions. bb skills tier ≈ HL plugin skills.
