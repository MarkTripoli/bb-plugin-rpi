# PARITY.md - HumanLayer vs bb-plugin-humanlayer

Ground truth is `docs/research/01-research-humanlayer-system.md`. The plan is
`docs/research/04-plan-merged-humanlayer-bb-plugin.md`. This ledger is
verified against the code in this repository as of phase 8, not aspirational.
`status` is one of:

- **full** - same behavior, same rules.
- **partial** - shipped, with a named gap.
- **omitted** - deliberately not shipped in v1, with a reason.
- **N/A** - bb owns this surface, or HL's version has no local equivalent.

## Tasks

| HL behavior | bb plugin behavior | status | where | note |
|---|---|---|---|---|
| Task with name, slug, draft prompt, workflow type, worktree timing, permission mode, host/directory | Same fields, one SQLite row per task, `.humanlayer/tasks/<slug>/` mirror dir | full | `tasks.ts`, `db.ts` migration 0 | Slug collisions get `-2`, `-3`, ... suffixes (`generateTaskSlug`). |
| Draft vs launched task, board columns (TODO/DRAFT, RESEARCH & DESIGN, PLANNING, IMPLEMENTATION) | `isDraft`, `deriveBoardColumn()` from the current phase label | full | `transitions.ts` `deriveBoardColumn` | `review` (comment-review phase) buckets into Implementation; ground truth does not specify it. |
| Lists: LIST/BOARD, EVERYTHING/MINE, FILTER USERS, GROUPED | List and Board views only | partial | `ui/humanlayer.tsx` `TaskListView`/`TaskBoard` | Single-user plugin: no MINE/FILTER USERS/GROUPED-by-owner (nothing to filter by). |
| Archive task | `archiveTask` RPC, `⌘E` hotkey with confirm, palette action, "Archive current task" | full | `tasks.ts`, `ui/humanlayer.tsx` `HumanLayerThreadHeaderAction`, `app.tsx` | |

## Workflow types

| HL behavior | bb plugin behavior | status | where | note |
|---|---|---|---|---|
| `rpi`: questions → research → design → plan → worktree → implementation → PR | Same graph, `WORKFLOW_GRAPHS.rpi` | full | `transitions.ts` | |
| `outline_only`: questions → research → structure → implementation → PR | Same | full | `transitions.ts` | |
| `prd_tdd`: research → PRD → TDD → plan → worktree → implementation → PR | Same | full | `transitions.ts` | |
| `oneshot` / `freeform` single-session workflows | Same, no phase graph | full | `transitions.ts` | |
| Workflow strip showing live position in the graph | `WorkflowStrip` component in composer and task detail | full | `ui/humanlayer.tsx` `WorkflowStrip` | |

## Sessions / status vocabulary

| HL status | bb `hlStatus` | status | where | note |
|---|---|---|---|---|
| draft, ready_for_launch, launching, resuming, running, needs_approval, ready_for_input, interrupt_requested, failed, interrupted, lost, waiting_for_workspace | Same 12 values, derived from bb thread/environment/interaction state, never set directly | full | `sessions.ts` `deriveStatus` | `lost` is derived only from `runtime.displayStatus` (`waiting-for-host`/`host-reconnecting`), never an inactivity timer, per spike result. |
| `user_question` interaction blocks the session | Maps to `ready_for_input` with `blockedReason: "question"` (documented deviation, plan §1) | partial | `sessions.ts` | HL's own vocabulary for this case was not confirmed in the bundle scan; the plugin's choice is the plan's explicit decision, not a gap. |
| Fork, interrupt | `forkSession`/`interruptSession` RPCs, header buttons | full | `launch.ts`, `ui/humanlayer.tsx` | |
| Re-derivation on `thread:changed`, `thread.idle/active/failed/archived` | Same event set plus a periodic reconcile sweep | full | `sessions.ts` `registerSessionRuntime` | |

## Auto-advance table (all flags)

| Phase | Flag | Next skill | Target phase | status | note |
|---|---|---|---|---|---|
| research-questions | `aa_questions_to_research` | create-research | research | full | |
| research | `aa_research_to_design` | create-design-discussion (rpi) / create-structure-outline (outline_only) / create-prd (prd_tdd) | design / structure / design-prd | full | Workflow-specific target resolved by `autoAdvanceTransition()`. |
| design | human gate (`flag: null`) | create-plan | plan | full | Human gates never auto-advance (hard rule). |
| design-prd | human gate | create-tdd | design-tdd | full | |
| design-tdd | human gate | create-plan | plan | full | |
| structure | human gate | implement-outline | implementation | full | |
| plan | `aa_plan_to_worktree` | setup-worktree | worktree-setup | full | |
| worktree-setup | `aa_worktree_to_implementation` | implement-plan | implementation | full | |
| implementation | `aa_implementation_to_pr` | describe-pr | describe-pr | full | Default **off** (study ground truth: PR is typically a manual step). |
| Executor idempotency | Astra's intent-ledger/lease design not adopted; Fable's CAS (`advanced_at`) plus a minimal `launch_attempts` row instead | full (by design, decision §2.4) | `advance.ts`, `launch.ts` | Executor runs only after a completed turn (never a `user_question` idle). |
| Recover-launch for `uncertain` spawns | Adopt / Retry / Dismiss row on the Sessions tab | full | `launch.ts`, `ui/humanlayer.tsx` `RecoverLaunchRow` | No time-based auto-release of a stuck attempt (plan §2.4: bb has no spawn idempotency key). |

## Artifacts

| HL behavior | bb plugin behavior | status | where | note |
|---|---|---|---|---|
| Numbered task artifacts, frontmatter type, grouped viewer (Preview/Raw/versions/soft-delete/restore) | Same, SQLite is the source of truth, mirrored to `.humanlayer/tasks/<slug>/` | full | `artifacts.ts`, `mirror.ts`, `ui/humanlayer.tsx` `ArtifactsPanel` | |
| `hl_task_context`, `hl_artifact_save`, `hl_next_artifact_number` tools | Same tool set, `hl_` prefix, scoped to task threads only | full | `tools.ts` | |
| Free-form files, binary uploads, `.trash/` soft delete | Same | full | `mirror.ts`, `artifacts.ts` | |
| `::hl-artifact{...}` permalink directive | `messageDirective` registration | full | `app.tsx`, `ui/humanlayer.tsx` `HumanLayerArtifactDirective` | |
| No file-write hook (risk carried from the plan) | Ingest happens at `hl_artifact_save` and on `thread.idle`; the panel does not see a mid-turn edit until then | partial (named risk, plan §5) | `mirror.ts` | |

## Comments

| HL behavior | bb plugin behavior | status | where | note |
|---|---|---|---|---|
| Block-anchored comments, re-anchoring across versions, three `hl_*` tools | Same, exact-match then `>=0.8` token-ratio fuzzy fallback | partial (superset) | `comments.ts` | Fable §9 specified no fuzzy matching; the phase 4 acceptance criteria required a fallback, so this is a deliberate superset, not a gap. |
| Send-to-session (`send` / `send-and-resolve`) | Same two modes, request-id dedupe | full | `comments.ts` `sendCommentsToSession` | |
| Truncated-id prefix matching | `resolveTruncatedId` | full | `comments.ts` | |
| Patch-anchored diff comments; Changes ALL / TO REVIEW tracking | Not shipped | omitted (plan §5) | - | bb's environment diff panel is reused as-is and has no plugin comment/annotation slot; needs an upstream SDK extension. |

## Context management

| HL behavior | bb plugin behavior | status | where | note |
|---|---|---|---|---|
| Fresh session per phase, artifacts as the only carry-over | Same: `hl_task_context` hydrates a fresh session; skills instruct not reading other artifacts during research | full | `tools.ts`, `skills/rpi-*` | |
| Context gauge `usedTokens/contextWindow (pct)` in the footer | `contextUsage` on every `SessionView`, from `bb.sdk.threads.timeline({summaryOnly:"true"}).contextWindowUsage`; shown on session rows and the thread header | full | `server.ts` `readContextUsage`/`sessionView`, `ui/humanlayer.tsx` `ContextGauge` | Percent, not the exact `122,016/353,400` token pair, is the default display; both numbers are in the tooltip. Null (shown as no gauge) when bb has not reported usage yet, not a fabricated 0%. |
| ≥70% warning banner offering "Iterate in a fresh session" | Same threshold, banner in the thread header wired to the existing `iterateInFreshSession` RPC, dismiss stored per-thread in `task_ui_state.contextWarningDismissed` | full | `ui/humanlayer.tsx` `HumanLayerThreadHeaderAction` | |
| `structured_summary` + `next_step_suggestions` | `summaryHistory` (last 600 chars per idle) + deterministic `next_step_json` extraction; no separate `hl_phase_finish` tool | full (decision §2.3) | `advance.ts`, `extraction.ts` | Astra's AI-extraction/second-reporting-channel idea was judged unnecessary duplication; deterministic parsing already yields both. |
| Context shards (cross-session AI-extracted facts, evidence, per-user enable/disable/dismiss) | Not shipped | omitted (plan §5) | - | Needs an LLM extraction pass and a durable-facts store; bb's Memory plugin already covers the user-preference half. |
| Handoff artifacts by convention (`handoff.md`) | Same convention, no special-casing needed (plain artifact) | full | `skills/rpi-*` | |
| Subagent delegation for research/implementation | 7 agent skills spawned as `--parent-self` child threads | full | `sessions.ts` `registerSessionRuntime`, `child_threads` table | |

## Skills (23 RPI skills + 7 agent skills)

| HL behavior | bb plugin behavior | status | where | note |
|---|---|---|---|---|
| 22 phase skills + `show-me` = 23, rewritten prose, preserved structure/step-order/rules | `skills/rpi-*`, one directory per skill, `rpi-` prefix to avoid the global `show-me` collision | full | `skills/`, `transitions.ts` `SKILLS`/`HELPERS` | `rewritten skills and references do not contain HumanLayer reference shingles` is an enforced `node:test` (`tests/skills.test.ts`), not just a claim. |
| 7 Claude agents (codebase-locator, codebase-analyzer, codebase-pattern-finder, web-search-researcher, implementer, outline-implementer, implementation-reviewer) | 7 `rpi-agent-*` skills, invoked in child threads (`bb thread spawn --parent-self`) | full | `skills/rpi-agent-*`, `transitions.ts` `RPI_AGENT_SKILL_IDS` | |
| Every final-answer template's command block parses to the expected next skill | `node:test` covers every shipped `references/*final_answer*.md` | full | `tests/skills.test.ts`, `tests/extraction.test.ts` | |
| "Faster research subagents" (Haiku-class) preference | `researchModel` in prefs, threaded into `taskInstructions()` | full | `contract.ts`, `sessions.ts` `taskInstructions` | |

## Agents (per-thread configuration)

| HL behavior | bb plugin behavior | status | where | note |
|---|---|---|---|---|
| Task session gets the phase skill set + comment/artifact tools | `bb.agents.configure` returns `{tools, skills}` for task-session and child-agent threads, `{}` otherwise | full | `server.ts` | Callback is synchronous per the phase-0 spike hard rule; `tests/sessions.test.ts` asserts non-Promise return. |
| Task context injected at session start | `bb.agents.contributeInstructions`, ≤4096 chars, sync, backed by an in-memory mirror | full | `server.ts`, `sessions.ts` `taskInstructions` | |

## Notifications

| HL rule | bb plugin behavior | status | where | note |
|---|---|---|---|---|
| Triggers: → `ready_for_input`, new pending approval, inbound artifact comment | Same three triggers | full | `notify.ts` | |
| Suppression order: already notified → not owner → auto-advance covers it → viewing session | Same order (`already_notified` → `not_owner` → `auto_advance_suppressed` → `viewing_session`) | partial | `notify.ts` `decideNotification` | `not_owner` is implemented in the pure decision function but is N/A in the server adapter: bb exposes no current-owner/last-actor concept on the surfaces available, and this is a single-user plugin. |
| Toast 8s, `ready_for_input` bold / `needs_approval` warning color, description truncation 40/50, `mcp__a__b` → `a:b`, "Jump to Session ⌘⇧J" | Same, except the hotkey is `⌘⇧U` | partial | `notify.ts`, `ui/humanlayer.tsx` | `⌘⇧J` is reserved by Chromium (spike hard rule #4); `⌘⇧U` is used instead and is a setting. |
| Sound: `/sounds/notification.mp3`, volume default 0.2, gated by a sounds-enabled setting | Same, own synthesized chime asset | full | `server.ts` sound route, `assets/notification.mp3` | Chime is generated for this project, not HumanLayer's asset (licensing). |
| Autoplay without a prior gesture | Probed on first click/keydown; `NotAllowedError` shows a one-time hint, Test Sound always works | full | `ui/humanlayer.tsx` `HumanLayerNotificationBridge` | Per spike hard rule #6. |
| Batch Queue Delivery | Setting exists (`preferBatchQueueDelivery`, default off) but not wired to `queuedMessages.setGroupBoundary` | omitted (plan §2.9 / §5) | `server.ts` settings | No plugin-level batch policy hook exists in the SDK surfaces inspected; shipping it unverified against a race would violate the plan's own gate ("remove if the phase 8 test shows loss/duplication"). The setting is kept, inert, so a later phase can wire it without a schema change. |
| Slack mute per task | Not shipped | N/A | - | No Slack integration in bb; not a local concept. |

## Settings (68 HL keys)

| Group | HL keys | bb status | where |
|---|---|---|---|
| Notifications | `notificationSoundsEnabled`, `notificationVolume` (+ per-kind ready/approval/comment sound and toast toggles, `jumpHotkey` beyond HL's fixed list) | full | `server.ts` settings + `contract.ts` `notificationPrefsSchema` |
| Defaults for new tasks | `defaultDirectory`, `launcherV3PermissionsMode`, `launcherV3WorkflowType`, `launcherV3AutoAdvance` | full (`defaultWorktreeTiming`, `defaultPermissionMode`, `defaultWorkflowType`, `autoAdvanceDefault`) | `server.ts` settings |
| Model/provider defaults | `defaultAgent`, `defaultModel`, `defaultClaudeCodeModel/Effort/FastMode`, `defaultCodelayerProvider` + per-provider model/effort | full, generalized: `prefs.defaults` (provider/model/reasoning/researchModel/serviceTier) + `prefs.workflowDefaults` per workflow type | `contract.ts`, `ui/humanlayer.tsx` `HumanLayerDefaultsSettings` |
| Phase/UI toggles | `showTaskPhaseLabels`, `workflowGraphEnabled`, `scratchPadEnabled`, `showPhaseTips`, `showIterateConfirmation`, `showBypassPermissionsNudge`, `showFastModeWarning`, `showSessionUiExplainer`, `confirmBeforeInterruptingSubAgents` | full (all present as bb settings) | `server.ts` settings |
| Queueing | `preferBatchQueueDelivery` | partial - setting exists, unwired (see Notifications table) | `server.ts` |
| Delete confirm | `confirmBeforeDeletingArtifacts` | N/A - not implemented as a setting; delete/restore is already reversible via `.trash/` and the Artifacts tab | - |
| Research subagents | `haikuResearchSubagentsEnabled` | full, as `researchModel` (a model id, not a boolean) | `contract.ts` `prefsDefaultsSchema` |
| `experimentalSubagentsEnabled` | Not applicable: all 7 agent skills ship, none gated behind an experiment flag | N/A | - |
| Diff/editor/theme/zoom | `diffStyle`, `diffStyleFullscreen`, `zoomLevel`, `theme`, `streamingRenderingEnabled`, `defaultEditor` | mostly N/A (bb owns diff viewer, theme, zoom, streaming rendering) / partial (`diffStyle`, `defaultEditor` kept as settings for parity but bb's own diff panel and file-open behavior are authoritative) | `server.ts` settings |
| Cost | `showSessionCosts` | N/A | - | bb exposes no pricing; `$cost` is omitted everywhere (plan §2.8). |
| Keybindings | `archiveKeybinding`, `sendMessageKeybinding` | partial - `⌘E` is hardcoded (not user-remappable); `⌘⏎` send is bb's own composer, not this plugin's concern | `ui/humanlayer.tsx` |
| Multiplayer/thinking-verbs/nudges | `multiplayerPromptingLastDuration`, `thinkingVerbsDisabled`, `bypassNudgeSilenced`, `fastModeWarningAcknowledged` | N/A | - | Single-user; no multiplayer prompting, no bypass/fast-mode concepts distinct from bb's own permission-mode picker. |
| Per-task local state | scratch pad text, selected artifact, selected sidebar tab, terminal height/open, last working dir | partial | `task_ui_state` (scratch, dismissed tips, context-warning dismissal), `ui/humanlayer.tsx` | Terminal height/open and "last working dir" are bb's own terminal/composer state, not this plugin's to track. |

## Hotkeys

| HL hotkey | bb plugin | status | where | note |
|---|---|---|---|---|
| `⌘K` palette | bb's own `⌘⇧P` quick palette, with 3 HumanLayer rows | N/A (bb owns the palette) / full (rows) | `app.tsx` `commandPaletteAction` | |
| `T` create task | `T`, scoped to the HumanLayer panel | full | `ui/humanlayer.tsx` `HumanLayerPanel` | |
| `g t` tasks | `g` then `t` chord, 800ms window | full | `ui/humanlayer.tsx` `HumanLayerPanel` | |
| `⌘,` settings | bb's own settings shortcut | N/A | - | |
| `⌘B` sidebar, `S` toggle sidebar | bb's own sidebar | N/A | - | |
| `⌘E` archive | `⌘E`, confirms first | full | `ui/humanlayer.tsx` `HumanLayerThreadHeaderAction` | |
| `⌘⏎` send | bb's own composer | N/A | - | |
| `⌘⇧J` jump to notified session | `⌘⇧U` (configurable) | partial (renamed, reason above) | `ui/humanlayer.tsx`, `notify.ts` | |
| `⌘J` terminal, `⌘⇧O` open dir in editor | bb's own terminal/file-open | N/A | - | |
| `h/j/k/l`, `⇧H/⇧L` pane focus | bb's own pane navigation | N/A | - | |
| `⏎` focus input, `esc` blur | bb's own composer | N/A | - | |
| `⇧?` hotkeys guide | Not shipped | omitted | - | No dedicated help overlay; hotkeys are documented in `README.md`. |

## UI surfaces

| HL surface | bb plugin behavior | status | where | note |
|---|---|---|---|---|
| Task list/board, drafts | `navPanel` "HumanLayer" | full | `app.tsx`, `ui/humanlayer.tsx` `HumanLayerPanel` | |
| New task composer (permissions, auto-advance, host, project/dir, worktree timing, workflow type, workflow strip) | Same fields | full | `ui/humanlayer.tsx` `NewTaskPage` | |
| Task detail tabs: Artifacts, Sessions, Workspace, Scratch, Auto-advance, Tips | Same 6, plus **Minimap** | full (superset) | `ui/humanlayer.tsx` `TaskDetailPage` | |
| Thread panel tabs: Artifacts, Workspace, Scratch pad, Tips, Minimap | All 5 | full | `app.tsx` `threadPanelAction` registrations | |
| CHANGES / DIFFS tabs | Not shipped as plugin tabs | omitted (plan §5, Fable §13) | - | bb's environment diff panel is reused as-is (link out); no plugin comment/annotation slot exists to replicate the collaborative diff-comment surface. |
| Thread header: phase pill, HL status, proceed/fork/auto-advance controls | Phase pill, status, **context gauge**, context-warning banner, Proceed/Iterate/Fork/Interrupt | full (superset) | `ui/humanlayer.tsx` `HumanLayerThreadHeaderAction` | |
| `::hl-artifact{...}` permalinks | Same | full | `app.tsx`, `ui/humanlayer.tsx` | |
| Settings section | Notifications + **Defaults** (new in phase 8) | full | `app.tsx` | |
| Palette actions | 3 rows: Open Artifacts, Open Scratch pad, Archive current task | full | `app.tsx` `commandPaletteAction` | SDK exposes `commandPaletteAction`; not N/A. `run()` has no hook access, so these 3 call the plugin's own documented RPC HTTP route directly instead of `useRpc`. |
| Sidebar `experimental_threadList` replacement | Groups this plugin's task session threads by task with a phase pill; every other thread renders flat below via bb's own sidebar feed; a manual "Use default list" toggle renders `Original` | full, shipped last/optional per plan §2.7 | `ui/humanlayer.tsx` `HumanLayerThreadList`, `app.tsx` | SDK exposes no per-row "DOM shortcut attribute" contract in this SDK version (`bb-plugin-sdk-app.d.ts` and the `bb-plugin-authoring` skill reference were checked; neither documents one), so that specific plan wording (Fable §11) is **N/A to this SDK version**, not omitted. |
| Content script for keydown ⌘⇧J and the notification bridge | No `contentScripts` registration; hotkeys and the audio bridge live inside the mounted React components (`HumanLayerNotificationBridge`, `HumanLayerPanel`, `HumanLayerThreadHeaderAction`) that already own this pattern from phase 7 | partial (different mechanism, same effect) | `ui/humanlayer.tsx` | `app.slots.contentScripts` was not used because the existing shared-keydown-owner pattern (mount-order queue, `shouldHandleHotkey`) already covers every case these hotkeys need without a separate global script. |

## Known risks (plan §5) and mitigation as shipped

1. **No file-write interception.** Mitigated by the `hl_artifact_save` tool plus idle-turn ingest (`mirror.ts`); the Artifacts tab has no "syncing" indicator for a mid-turn edit, which is the residual gap.
2. **Cold worktree hydration relies on skill step 0.** Every rewritten skill's step 0 is `hl_task_context` (`tests/skills.test.ts` checks every reference template); `thread.active` hydration is belt-and-braces (`sessions.ts`).
3. **No per-step setup retry API.** "Rerun workspace setup" re-sends a re-run instruction into the existing worktree session thread (`threads.send`) rather than retrying one failed step in isolation (`workspace.ts` `rerunWorkspaceSetup`).
4. **Realtime signals are ephemeral.** The `notifications`/`notified` tables prevent duplicate delivery but not misses after a disconnect; acceptable for a local single-user app (unchanged from phase 7).
5. **`contributeInstructions` is sync and 4096 chars.** `taskInstructions()` stays well under the limit; enforced by keeping it a flat point read (`sessions.ts`).
6. **Batch delivery race.** Not wired at all (see Notifications table) rather than shipped unverified, per the plan's own gate.
7. **Sidebar replacement is exclusive.** Shipped behind the user's own Settings → Appearance → Sidebar choice, plus the component's own "Use default list" toggle; the nav panel remains the primary, always-available surface.
8. **Frontmatter parser is flat only.** Unchanged from phase 3/6; nested frontmatter values are not supported (`artifacts.ts`).
9. **Multi-repo layout not identical to HL.** Unchanged from phase 5: one bb environment per repo, sequential; v1 UI shows only the primary repo (`workspace.ts`, `ui/humanlayer.tsx` `WorkspacePanel`).

## Explicit v1 omissions (plan §5, verbatim reasons)

- **Context shards** (cross-session fact extraction with evidence and per-user enable/disable/dismiss): needs an LLM extraction pass and a durable-facts store; bb's Memory plugin already covers the user-preference half. Revisit after v1.
- **Patch-anchored diff comments** and **Changes ALL / TO REVIEW** review-state tracking: bb's environment diff panel is reused as-is and has no plugin comment/annotation slot; requires an upstream SDK extension.
- **Ticket-provider import** (Linear/Jira/GitHub issue → `ticket.md`): bb's GitHub and GitLab plugins own integrations; a later phase can add an `@issue` mention → `task.md` prefill. Manual paste works in v1.
- **Public artifact sharing** (`share_key`, permalinks outside bb): local-first plugin; bb connect tunnels already expose the app if needed.
- **Queued-message `deliver_on_interrupt`**: bb queue rows have no interrupt-delivery flag; queued messages dispatch on idle via bb's own drain.
- **Multiplayer prompting, org/team ACLs, Slack mute, billing, cost display**: no local or single-user equivalent.
- **Cloud sync of artifacts**: intentionally none; DB + repo mirror only.
