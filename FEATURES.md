# FEATURES.md - what the plugin does

This is a feature ledger for the plugin as shipped, verified against the code in this
repository as of phase 8, not aspirational. `status` is one of:

- **full** - shipped, works as described, no named gap.
- **partial** - shipped, with a named gap or a deliberate deviation.
- **omitted** - deliberately not shipped in v1, with a reason.
- **N/A** - bb owns this surface; there is no plugin-level concept to ship.

`npm run check:features` (`scripts/features-count.ts`, covered by `tests/features.test.ts`)
mechanically counts every `status`-column cell in this file's one table and asserts the total
matches what's printed here, so this paragraph cannot silently drift from the table: **90
status-bearing rows, 1 of them mixed (the palette row counts toward both N/A and full): 60
full, 12 partial, 7 omitted, 12 N/A**.

## Features

| Category | Feature | Status | Where | Note |
|---|---|---|---|---|
| Tasks | Task with name, slug, draft prompt, workflow type, worktree timing, permission mode, host/directory; one SQLite row per task, `.rpi/tasks/<slug>/` mirror dir | full | `tasks.ts`, `db.ts` migration 0 | Slug collisions get `-2`, `-3`, ... suffixes (`generateTaskSlug`). |
| Tasks | Board columns (TODO/DRAFT, RESEARCH & DESIGN, PLANNING, IMPLEMENTATION) derived from `isDraft` and the current phase label | full | `transitions.ts` `deriveBoardColumn` | `review` (comment-review phase) buckets into Implementation; a deliberate simplification, not a spec requirement. |
| Tasks | List and Board views | partial | `ui/rpi.tsx` `TaskListView`/`TaskBoard` | Single-user plugin: no MINE/FILTER USERS/GROUPED-by-owner view (nothing to filter by). |
| Tasks | Archive task: `archiveTask` RPC, `⌘E` hotkey with confirm, palette action, "Archive current task" | full | `tasks.ts`, `ui/rpi.tsx` `RpiThreadHeaderAction`, `app.tsx` | |
| Workflow types | `rpi`: questions → research → design → plan → worktree → implementation → PR | full | `transitions.ts` `WORKFLOW_GRAPHS.rpi` | |
| Workflow types | `outline_only`: questions → research → structure → implementation → PR | full | `transitions.ts` | |
| Workflow types | `prd_tdd`: research → PRD → TDD → plan → worktree → implementation → PR | full | `transitions.ts` | |
| Workflow types | `oneshot` / `freeform` single-session workflows, no phase graph | full | `transitions.ts` | |
| Workflow types | Workflow strip showing live position in the graph | full | `ui/rpi.tsx` `WorkflowStrip` | |
| Sessions / status vocabulary | 12 session statuses (draft, ready_for_launch, launching, resuming, running, needs_approval, ready_for_input, interrupt_requested, failed, interrupted, lost, waiting_for_workspace), derived from bb thread/environment/interaction state, never set directly | full | `sessions.ts` `deriveStatus` | `lost` is derived only from `runtime.displayStatus` (`waiting-for-host`/`host-reconnecting`), never an inactivity timer. |
| Sessions / status vocabulary | `user_question` interaction blocks the session, mapped to `ready_for_input` with `blockedReason: "question"` | partial | `sessions.ts` | Deliberate design decision for this case, not a gap. |
| Sessions / status vocabulary | Fork, interrupt: `forkSession`/`interruptSession` RPCs, header buttons | full | `launch.ts`, `ui/rpi.tsx` | |
| Sessions / status vocabulary | Re-derivation on `thread:changed`, `thread.idle/active/failed/archived` plus a periodic reconcile sweep | full | `sessions.ts` `registerSessionRuntime` | |
| Auto-advance table (all flags) | research-questions → `aa_questions_to_research` → create-research → research | full | `transitions.ts` | |
| Auto-advance table (all flags) | research → `aa_research_to_design` → create-design-discussion (rpi) / create-structure-outline (outline_only) / create-prd (prd_tdd) → design / structure / design-prd | full | `transitions.ts` | Workflow-specific target resolved by `autoAdvanceTransition()`. |
| Auto-advance table (all flags) | design → human gate (`flag: null`) → create-plan → plan | full | `transitions.ts` | Human gates never auto-advance (hard rule). |
| Auto-advance table (all flags) | design-prd → human gate → create-tdd → design-tdd | full | `transitions.ts` | |
| Auto-advance table (all flags) | design-tdd → human gate → create-plan → plan | full | `transitions.ts` | |
| Auto-advance table (all flags) | structure → human gate → implement-outline → implementation | full | `transitions.ts` | |
| Auto-advance table (all flags) | plan → `aa_plan_to_worktree` → setup-worktree → worktree-setup | full | `transitions.ts` | |
| Auto-advance table (all flags) | worktree-setup → `aa_worktree_to_implementation` → implement-plan → implementation | full | `transitions.ts` | |
| Auto-advance table (all flags) | implementation → `aa_implementation_to_pr` → describe-pr → describe-pr | full | `transitions.ts` | Default **off** (a PR is typically a manual step). |
| Executor & recovery notes | Executor idempotency via CAS (`advanced_at`) plus a minimal `launch_attempts` row | full (by design, decision §2.4) | `advance.ts`, `launch.ts` | Executor runs only after a completed turn (never a `user_question` idle). |
| Executor & recovery notes | Recover-launch for `uncertain` spawns: Adopt / Retry / Dismiss row on the Sessions tab | full | `launch.ts`, `ui/rpi.tsx` `RecoverLaunchRow` | No time-based auto-release of a stuck attempt (bb has no spawn idempotency key). |
| Artifacts | Numbered task artifacts, frontmatter type, grouped viewer (Preview/Raw/versions/soft-delete/restore); SQLite is the source of truth, mirrored to `.rpi/tasks/<slug>/` | full | `artifacts.ts`, `mirror.ts`, `ui/rpi.tsx` `ArtifactsPanel` | |
| Artifacts | `rpi_task_context`, `rpi_artifact_save`, `rpi_next_artifact_number` tools, scoped to task threads only | full | `tools.ts` | |
| Artifacts | Free-form files, binary uploads, `.trash/` soft delete | full | `mirror.ts`, `artifacts.ts` | |
| Artifacts | `::rpi-artifact{...}` permalink directive | full | `app.tsx`, `ui/rpi.tsx` `RpiArtifactDirective` | |
| Artifacts | No file-write hook; ingest happens at `rpi_artifact_save` and on `thread.idle` | partial (named risk) | `mirror.ts` | The Artifacts tab has no "syncing" indicator for a mid-turn edit until the next ingest. |
| Comments | Block-anchored comments, re-anchoring across versions, three `rpi_*` tools; exact-match then `>=0.8` token-ratio fuzzy fallback | partial (superset) | `comments.ts` | Fuzzy matching is a deliberate superset added at the phase 4 acceptance criteria's request, not a gap. |
| Comments | Send-to-session (`send` / `send-and-resolve`), request-id dedupe | full | `comments.ts` `sendCommentsToSession` | |
| Comments | Truncated-id prefix matching (`resolveTruncatedId`) | full | `comments.ts` | |
| Comments | Patch-anchored diff comments; Changes ALL / TO REVIEW tracking | omitted | - | bb's environment diff panel is reused as-is and has no plugin comment/annotation slot; would need an upstream SDK extension. |
| Context management | Fresh session per phase, artifacts as the only carry-over: `rpi_task_context` hydrates a fresh session; skills instruct not reading other artifacts during research | full | `tools.ts`, `skills/rpi-*` | |
| Context management | Context gauge `usedTokens/contextWindow (pct)` in the footer, from `bb.sdk.threads.timeline({summaryOnly:"true"}).contextWindowUsage`; shown on session rows and the thread header | full | `server.ts` `readContextUsage`/`sessionView`, `ui/rpi.tsx` `ContextGauge` | Percent, not the exact token pair, is the default display; both numbers are in the tooltip. Null (shown as no gauge) when bb has not reported usage yet, not a fabricated 0%. |
| Context management | ≥70% warning banner offering "Iterate in a fresh session", dismiss stored per-thread in `task_ui_state.contextWarningDismissed` | full | `ui/rpi.tsx` `RpiThreadHeaderAction` | Wired to the existing `iterateInFreshSession` RPC. |
| Context management | `summaryHistory` (last 600 chars per idle) plus deterministic `next_step_json` extraction; no separate finish tool | full | `advance.ts`, `extraction.ts` | Deterministic parsing already yields both a summary and next-step suggestions without a second reporting channel. |
| Context management | Context shards (cross-session extracted facts, evidence, per-user enable/disable/dismiss) | omitted | - | Would need an LLM extraction pass and a durable-facts store; bb's Memory plugin already covers the user-preference half. |
| Context management | Handoff artifacts by convention (`handoff.md`), no special-casing needed (plain artifact) | full | `skills/rpi-*` | |
| Context management | Subagent delegation for research/implementation: 7 agent skills spawned as `--parent-self` child threads | full | `sessions.ts` `registerSessionRuntime`, `child_threads` table | Delegation itself (spawn, classify, instructions) is deterministic and fully wired; whether a given model actually *invokes* an agent skill instead of doing the work inline is model-dependent (mini-class models in particular; see README's model guidance table). |
| Skills (23 RPI skills + 7 agent skills) | 22 phase skills + `show-me` = 23, one directory per skill, `rpi-` prefix to avoid the global `show-me` collision | full | `skills/`, `transitions.ts` `SKILLS`/`HELPERS` | `tests/skills.test.ts` enforces that shipped skills and references contain no third-party reference shingles. |
| Skills (23 RPI skills + 7 agent skills) | 7 agents (codebase-locator, codebase-analyzer, codebase-pattern-finder, web-search-researcher, implementer, outline-implementer, implementation-reviewer) as `rpi-agent-*` skills, invoked in child threads (`bb thread spawn --parent-self`) | full | `skills/rpi-agent-*`, `transitions.ts` `RPI_AGENT_SKILL_IDS` | |
| Skills (23 RPI skills + 7 agent skills) | Every final-answer template's command block parses to the expected next skill | full | `tests/skills.test.ts`, `tests/extraction.test.ts` | |
| Skills (23 RPI skills + 7 agent skills) | "Faster research subagents" (Haiku-class) preference: `researchModel` in prefs, threaded into `taskInstructions()` | full | `contract.ts`, `sessions.ts` `taskInstructions` | |
| Agents (per-thread configuration) | Task session gets the phase skill set + comment/artifact tools via `bb.agents.configure` returning `{tools, skills}` for task-session and child-agent threads, `{}` otherwise | full | `server.ts` | Callback is synchronous per the phase-0 spike hard rule; `tests/sessions.test.ts` asserts non-Promise return. |
| Agents (per-thread configuration) | Task context injected at session start via `bb.agents.contributeInstructions`, ≤4096 chars, sync, backed by an in-memory mirror | full | `server.ts`, `sessions.ts` `taskInstructions` | |
| Notifications | Triggers: → `ready_for_input`, new pending approval, inbound artifact comment | full | `notify.ts` | |
| Notifications | Suppression order: already notified → not owner → auto-advance covers it → viewing session | partial | `notify.ts` `decideNotification` | `not_owner` is implemented in the pure decision function but is N/A in the server adapter: bb exposes no current-owner/last-actor concept on the surfaces available, and this is a single-user plugin. |
| Notifications | Toast 8s, `ready_for_input` bold / `needs_approval` warning color, description truncation 40/50, `mcp__a__b` → `a:b`, "Jump to Session ⌘⇧U" | partial | `notify.ts`, `ui/rpi.tsx` | `⌘⇧U` is used instead of `⌘⇧J` because `⌘⇧J` is reserved by Chromium; it's a setting. |
| Notifications | Sound: own synthesized chime asset, volume default 0.2, gated by a sounds-enabled setting | full | `server.ts` sound route, `assets/notification.mp3` | Chime is generated for this project. |
| Notifications | Autoplay without a prior gesture: probed on first click/keydown; `NotAllowedError` shows a one-time hint, Test Sound always works | full | `ui/rpi.tsx` `RpiNotificationBridge` | |
| Notifications | Batch Queue Delivery setting (`preferBatchQueueDelivery`, default off), not wired to `queuedMessages.setGroupBoundary` | omitted | `server.ts` settings | No plugin-level batch policy hook exists in the SDK surfaces inspected; shipping it unverified against a race would violate the project's own gate ("remove if the phase 8 test shows loss/duplication"). The setting is kept, inert, so a later phase can wire it without a schema change. |
| Notifications | Per-task mute | N/A | - | No chat-integration mute concept in bb; not a local concept. |
| Settings (68 keys) | Notifications: `notificationSoundsEnabled`, `notificationVolume` (+ per-kind ready/approval/comment sound and toast toggles, `jumpHotkey`) | full | `server.ts` settings + `contract.ts` `notificationPrefsSchema` | |
| Settings (68 keys) | Defaults for new tasks: `defaultDirectory`, permissions mode, workflow type, auto-advance | full | `server.ts` settings | |
| Settings (68 keys) | Model/provider defaults, generalized: `prefs.defaults` (provider/model/reasoning/researchModel/serviceTier) + `prefs.workflowDefaults` per workflow type, applied at task creation with precedence explicit request > workflow default > global default | full | `contract.ts`, `tasks.ts` `resolveTaskExecutionDefaults`, `tests/tasks.test.ts`, `ui/rpi.tsx` `RpiDefaultsSettings` | |
| Settings (68 keys) | Phase/UI toggles (`showTaskPhaseLabels`, `workflowGraphEnabled`, `scratchPadEnabled`, `showPhaseTips`, `showIterateConfirmation`, `showBypassPermissionsNudge`, `showFastModeWarning`, `showSessionUiExplainer`, `confirmBeforeInterruptingSubAgents`) | partial | `server.ts` settings | Not every key is present, and not every present key is read. |
| Settings (68 keys) | Queueing: `preferBatchQueueDelivery`, unwired | omitted | `server.ts` | Same feature as the Notifications table's Batch Queue Delivery row; one feature, one status. |
| Settings (68 keys) | Delete confirm: `confirmBeforeDeletingArtifacts` | omitted | - | A deliberate choice not to add a confirm dialog; delete/restore is already reversible via `.trash/` and the Artifacts tab. |
| Settings (68 keys) | Research subagents: `haikuResearchSubagentsEnabled`, shipped as `researchModel` (a model id, not a boolean) | full | `contract.ts` `prefsDefaultsSchema` | |
| Settings (68 keys) | Experimental-subagents gate | N/A | - | All 7 agent skills ship, none gated behind an experiment flag. |
| Settings (68 keys) | Diff viewer / theme / zoom / streaming rendering | N/A | - | bb owns the diff viewer, theme, zoom, and streaming rendering; no plugin-level equivalent. |
| Settings (68 keys) | Diff style / default editor | partial | `server.ts` settings | Kept as settings for parity of intent, but bb's own diff panel and file-open behavior are authoritative. |
| Settings (68 keys) | Session cost display | N/A | - | bb exposes no pricing; `$cost` is omitted everywhere. |
| Settings (68 keys) | Keybinding remapping | partial | `ui/rpi.tsx` | `⌘E` is hardcoded (not user-remappable); `⌘⏎` send is bb's own composer, not this plugin's concern. |
| Settings (68 keys) | Multiplayer/thinking-verbs/nudges settings | N/A | - | Single-user; no multiplayer prompting, no bypass/fast-mode concepts distinct from bb's own permission-mode picker. |
| Settings (68 keys) | Per-task local state (scratch pad text, dismissed tips, context-warning dismissal) | partial | `task_ui_state`, `ui/rpi.tsx` | Terminal height/open and "last working dir" are bb's own terminal/composer state, not this plugin's to track. |
| Hotkeys | `⌘⇧P` quick palette with 3 rows this plugin contributes | N/A (bb owns the palette) / full (rows) | `app.tsx` `commandPaletteAction` | |
| Hotkeys | `T` create task, listens on the panel's own root element while it is mounted and has focus | full | `ui/rpi.tsx` `RpiPanel` | |
| Hotkeys | `g t` tasks: `g` then `t` chord, 800ms window, same while-panel-mounted-and-focused scoping | full | `ui/rpi.tsx` `RpiPanel` | |
| Hotkeys | `⌘,` settings | N/A | - | bb's own settings shortcut. |
| Hotkeys | `⌘B` sidebar, `S` toggle sidebar | N/A | - | bb's own sidebar. |
| Hotkeys | `⌘E` archive, confirms first | full | `ui/rpi.tsx` `RpiThreadHeaderAction` | |
| Hotkeys | `⌘⏎` send | N/A | - | bb's own composer. |
| Hotkeys | `⌘⇧U` jump to notified session (configurable) | partial | `ui/rpi.tsx`, `notify.ts` | Two different mechanisms, stated so the difference doesn't read as an inconsistency: `T`/`g t`/`⌘E` are panel-scoped (`usePanelHotkeys`, listens on the panel's or action's own root element, only fires while focus is inside it), while `⌘⇧U` is intentionally global on `document` (capture, owner-queue) for as long as `RpiNotificationBridge` is mounted, because jumping to a notified session must work regardless of what has focus when the notification arrives. |
| Hotkeys | `⌘J` terminal, `⌘⇧O` open dir in editor | N/A | - | bb's own terminal/file-open. |
| Hotkeys | `h/j/k/l`, `⇧H/⇧L` pane focus | N/A | - | bb's own pane navigation. |
| Hotkeys | `⏎` focus input, `esc` blur | N/A | - | bb's own composer. |
| Hotkeys | Dedicated hotkeys help overlay | omitted | - | No dedicated help overlay; hotkeys are documented in `README.md`. |
| UI surfaces | Task list/board, drafts | full | `app.tsx`, `ui/rpi.tsx` `RpiPanel` | `navPanel` titled "RPI". |
| UI surfaces | New task composer (permissions, auto-advance, host, project/dir, worktree timing, workflow type, workflow strip) | full | `ui/rpi.tsx` `NewTaskPage` | |
| UI surfaces | Task detail tabs: Artifacts, Sessions, Workspace, Scratch, Auto-advance, Tips, plus **Minimap** (one chip per session, not per message) | full (superset) | `ui/rpi.tsx` `TaskDetailPage` | |
| UI surfaces | Thread panel tabs: Artifacts, Workspace, Scratch pad, Tips, Minimap | full | `app.tsx` `threadPanelAction` registrations | Minimap renders one chip per **session** (`MinimapPanel`), not per message inside a session; this plugin has no per-message timeline to chip. |
| UI surfaces | Diff/changes view | omitted | - | bb's environment diff panel is reused as-is (link out); no plugin comment/annotation slot exists to replicate a collaborative diff-comment surface. |
| UI surfaces | Thread header: phase pill, status, context gauge, context-warning banner, Proceed/Iterate/Fork/Interrupt controls | full (superset) | `ui/rpi.tsx` `RpiThreadHeaderAction` | |
| UI surfaces | `::rpi-artifact{...}` permalinks | full | `app.tsx`, `ui/rpi.tsx` | |
| UI surfaces | Settings section: Notifications + Defaults | full | `app.tsx` | |
| UI surfaces | Palette actions: 3 rows, Open Artifacts, Open Scratch pad, Archive current task | full | `app.tsx` `commandPaletteAction` | SDK exposes `commandPaletteAction`; not N/A. `run()` has no hook access, so these 3 call the plugin's own documented RPC HTTP route directly instead of `useRpc`. |
| UI surfaces | Sidebar `experimental_threadList` replacement: groups this plugin's task session threads by task with a phase pill; every other thread renders flat below via bb's own sidebar feed; a manual "Use default list" toggle renders `Original` | full, shipped last/optional | `ui/rpi.tsx` `RpiThreadList`, `app.tsx` | SDK exposes no per-row "DOM shortcut attribute" contract in this SDK version (checked against `bb-plugin-sdk-app.d.ts` and the `bb-plugin-authoring` skill reference); the sidebar-row-attribute idea from the original design docs is **N/A to this SDK version**, not omitted. |
| UI surfaces | Content script for keydown ⌘⇧U and the notification bridge | partial | `ui/rpi.tsx` | No `contentScripts` registration; hotkeys and the audio bridge live inside the mounted React components (`RpiNotificationBridge`, `RpiPanel`, `RpiThreadHeaderAction`) that already own a shared-keydown-owner pattern (mount-order queue, `shouldHandleHotkey`), so `app.slots.contentScripts` was not needed. |

## Known risks and mitigation as shipped

1. **No file-write interception.** Mitigated by the `rpi_artifact_save` tool plus idle-turn ingest (`mirror.ts`); the Artifacts tab has no "syncing" indicator for a mid-turn edit, which is the residual gap.
2. **Cold worktree hydration relies on skill step 0.** Every rewritten skill's step 0 is `rpi_task_context` (`tests/skills.test.ts` checks every reference template); `thread.active` hydration is belt-and-braces (`sessions.ts`).
3. **No per-step setup retry API.** "Rerun workspace setup" re-sends a re-run instruction into the existing worktree session thread (`threads.send`) rather than retrying one failed step in isolation (`workspace.ts` `rerunWorkspaceSetup`).
4. **Realtime signals are ephemeral.** The `notifications`/`notified` tables prevent duplicate delivery but not misses after a disconnect; acceptable for a local single-user app.
5. **`contributeInstructions` is sync and 4096 chars.** `taskInstructions()` stays well under the limit; enforced by keeping it a flat point read (`sessions.ts`).
6. **Batch delivery race.** Not wired at all (see Notifications table) rather than shipped unverified.
7. **Sidebar replacement is exclusive.** Shipped behind the user's own Settings → Appearance → Sidebar choice, plus the component's own "Use default list" toggle; the nav panel remains the primary, always-available surface.
8. **Frontmatter parser is flat only.** Nested frontmatter values are not supported (`artifacts.ts`).
9. **Multi-repo layout.** One bb environment per repo, sequential; v1 UI shows only the primary repo (`workspace.ts`, `ui/rpi.tsx` `WorkspacePanel`).

## Explicit v1 omissions

- **Context shards** (cross-session fact extraction with evidence and per-user enable/disable/dismiss): needs an LLM extraction pass and a durable-facts store; bb's Memory plugin already covers the user-preference half. Revisit after v1.
- **Patch-anchored diff comments** and **Changes ALL / TO REVIEW** review-state tracking: bb's environment diff panel is reused as-is and has no plugin comment/annotation slot; requires an upstream SDK extension.
- **Ticket-provider import** (Linear/Jira/GitHub issue → `ticket.md`): bb's GitHub and GitLab plugins own integrations; a later phase can add an `@issue` mention → `task.md` prefill. Manual paste works in v1.
- **Public artifact sharing** (`share_key`, permalinks outside bb): local-first plugin; bb connect tunnels already expose the app if needed.
- **Queued-message `deliver_on_interrupt`**: bb queue rows have no interrupt-delivery flag; queued messages dispatch on idle via bb's own drain.
- **Multiplayer prompting, org/team ACLs, chat-integration mute, billing, cost display**: no local or single-user equivalent.
- **Cloud sync of artifacts**: intentionally none; DB + repo mirror only.
