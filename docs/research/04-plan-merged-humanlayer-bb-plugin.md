---
type: plan
task: humanlayer-bb-plugin
status: proposed
date: 2026-09-05
inputs:
  - research/01-research-humanlayer-system.md (ground truth)
  - research/02-plan-astra-humanlayer-bb-plugin.md (Astra, gpt-6-astra high)
  - research/03-plan-fable-humanlayer-bb-plugin.md (Fable 5.1 high)
---

# Merged plan: HumanLayer inside bb (`bb-plugin-humanlayer`)

Both source plans agree on the skeleton. This document records the shared architecture briefly, then **decides every divergence** with a reason, then fixes the delivery order and model routing. Where a section says "per Fable §N" or "per Astra §N", that section of the source plan is adopted verbatim as the spec for implementation; the coder reads it there.

## 0. Non-negotiables (from the brief and both plans)

- bb owns threads, environments/worktrees, providers, permissions, diff viewer, terminals, skills tier. The plugin owns tasks, artifacts, versions, comments, phase labels, next-step extraction, auto-advance, notifications, preferences, RPI skills and tools.
- Local-first, single user, plugin SQLite is the source of truth; repo dir `.humanlayer/tasks/<slug>/` is a mirror.
- Feature parity with HL where the SDK allows; where it does not, ship the supported behavior and record the gap in `PARITY.md` (Astra's ledger idea). Never reach around bb (no Claude hooks installed behind bb, no `git worktree add` from `host.ts`, no private endpoints).
- Licensing: HL skills are "All Rights Reserved" and the mp3 is theirs. **Rewrite every skill in our own words** preserving structure/rules/templates shape; **generate our own chime** (ffmpeg synth, committed as `assets/notification.mp3`). The study's `research/notification.mp3` is reference only.

## 1. Shared architecture (agreed by both)

- Package: single plugin, `server.ts` (wiring) + pure modules (`transitions.ts`, `extraction.ts`, `notify.ts` decisions, `artifacts.ts` naming/frontmatter, `sessions.ts` derivation) + `app.tsx` + `ui/` + `skills/`. Layout per **Fable §1**.
- DB: **Fable §2** migrations 0..4 (tasks, sessions, artifacts, artifact_versions, comments, notified, scratch_pads, task_ui_state). Add from Astra: `launch_attempts(id, task_id, from_thread_id, skill_id, status pending|spawned|uncertain|failed, thread_id, created_at)` for crash-safe spawn (see §2.4).
- bb thread = HL session. Status derived, never set. Derivation table per **Fable §5.1**, amended by Astra: `lost` only from `runtime.displayStatus` evidence (`waiting-for-host`, `host-reconnecting`), never from an inactivity timer; a `user_question` interaction maps to `ready_for_input` (documented deviation).
- Re-derive on `bb.sdk.subscribe("thread:changed")` changes (`status-changed`, `interactions-changed`, `queue-changed`, `environment-changed`) plus `bb.events.on(thread.idle|active|failed|archived)`. Persist `hl_status`, publish `bb.realtime` signal, frontends refetch via RPC.
- Tools (`bb.agents.registerTool`, `hl_` prefix, selected only for task threads via `bb.agents.configure`; task context via `contributeInstructions` ≤4096): `hl_task_context`, `hl_artifact_save`, `hl_get_artifact_comments`, `hl_update_artifact_comments`, `hl_reply_to_artifact_comment`, `hl_next_artifact_number` per **Fable §6.4**. Comment XML format, truncated-id prefix matching, `created_by_agent` from tool context (Astra).
- CLI: `bb humanlayer {tasks,sessions,artifacts,comments,status,run}` calling the same domain functions, bounded `--json` (Astra §6). Used by ported skills for subagent-style delegation via `bb thread spawn --parent-self`.
- Frontend per **Fable §11**: `navPanel` "HumanLayer" (Tasks list/board/drafts, New task composer with toolbar + workflow strip, Task detail with fixed tabs Artifacts/Sessions/Workspace/Scratch/Auto-advance/Tips), `threadPanelAction` tabs on task threads (Artifacts, Workspace, Scratch pad, Tips, Minimap), `experimental_threadHeaderAction` (phase pill + HL status + proceed/fork/auto-advance controls; also registers "viewing" threadId), `messageDirective` `::hl-artifact{...}` for permalinks, settings section, palette actions, content script for keydown ⌘⇧J and the notification bridge. Changes/Diffs: reuse bb's environment diff panel (link to it), no reimplementation. Sidebar `experimental_threadList` replacement is last and optional (exclusive slot).
- Notifications per study §5, engine per **Fable §10**: triggers = transition into `ready_for_input`, new pending `approval` interaction, inbound artifact comment; suppression order = already notified (durable `notified` table) → not owner (n/a single user, keep the hook) → auto-advance covers transition (skip toast, still launch) → viewing session (sound yes, toast no, auto-dismiss on navigate). Toast 8s, titles `ready_for_input` / `needs_approval`, description rules and `mcp__a__b → a:b`, "Jump to Session ⌘⇧U" (configurable, see §1.1) with a pending stack. Sound: `GET /api/v1/plugins/humanlayer/http/sound`, `new Audio(url).volume = notificationVolume`.
- Settings: `bb.settings.define` for scalar prefs (sounds on/off, volume 0..1 as string parsed, default workflow type, default worktree timing, default permission mode, auto-advance default, batch queue delivery, show phase labels, diff style, default editor, tips toggles). Structured defaults (provider/model/effort/tier) in `bb.storage.kv`.

## 1.1 Hard rules from the Phase 0 spike (research/05-spike-results.md)

1. **`bb.agents.contributeInstructions` and `bb.agents.configure` callbacks must be synchronous.** An `async` callback does not throw; it silently breaks provisioning for every thread on the instance (`text2.trim is not a function`). Back anything they read with an in-memory mirror (`Map<threadId, session>`) refreshed by the event handlers; never `await` inside. Reviewer checklist item for phases 2 and 6, plus a `node:test` asserting the registered callbacks return non-Promise values.
2. After a `managed-worktree` spawn, `spawn()`'s response may still have `environmentId: null`; always follow up with `threads.get({threadId, include:"environment"})` before persisting `worktree_environment_id`.
3. `projectId` is required on every `threads.spawn`, including `environment:{type:"reuse"}`.
4. Notification jump hotkey is **not** ⌘⇧J (Chromium reserves it). Use `⌘⇧U` ("unread") and verify with the catch-all keydown log before Phase 7 ships; expose it as a setting.
5. `thread.idle.lastAssistantText` is the full final message (verified on a short reply); Phase 2 re-verifies on a multi-KB reply before relying on it for summaries and extraction.
6. Autoplay of `new Audio()` without a prior gesture worked in the desktop app; still handle `NotAllowedError` by showing a one-time "click to enable sounds" toast.

## 2. Divergences, decided

### 2.1 Hydration before the agent's first read
- Astra: hidden bootstrap thread per newly provisioned worktree, then reuse. Fable: hydrate on `thread.active` (accepts a race).
- **Decision: neither. Two cheap layers, no helper thread.**
  1. `message.dispatch` hook: if the thread is a task session, its environment exists, and `sessions.hydrated_at IS NULL` → return `{action:"wait", reason:"hydrating task artifacts"}`, run hydrate off-hook, then `recheck("message.dispatch")`. Covers every phase after the first in an existing environment (the common case) with zero race. Both plans confirm this works on existing environments.
  2. Cold `managed-worktree` spawn (environment is null at dispatch): the prompt's first line instructs the skill to call `hl_task_context` before anything else; `hl_task_context` hydrates synchronously (idempotent) and returns task.md + artifact manifest + permalinks. Every rewritten skill has step 0 = `hl_task_context`. Also hydrate on `thread.active` as belt-and-braces.
  Add `sessions.hydrated_at INTEGER` (migration 5). Phase 0 spike verifies `wait`+`recheck` timing and that `hl_task_context` executes before file reads in codex and claude-code.

### 2.2 Next-step extraction
- Astra: deterministic parser plus a hidden AI extraction thread for freeform prose. Fable: deterministic only.
- **Decision: deterministic only (Fable §7), arguments preserved.** Our templates are ours; the final-answer block is a known grammar (`/rpi-<skill> [args]` in a fenced `text` block, legacy `/rpi:<skill>` accepted). The parser keeps the full command line as `nextStepPrompt` and validates any `@`-referenced artifact filenames against the task's live artifacts (unknown file → `no_next_step` with reason); `launchPhase()` passes the validated line through unchanged so "selected document" workflows (iterate-* on a specific file) keep working. Freeform/oneshot sessions get `no_next_step`. A `node:test` asserts every `references/*final_answer*.md` parses to its expected skill. AI extraction is YAGNI; revisit if users demand proceed-buttons on freeform sessions.

### 2.3 Structured summary
- **Decision:** `summaryHistory.push(first 600 chars of lastAssistantText)` per idle (Fable). Optional `hl_phase_finish` tool (Astra) is **skipped**: a second reporting channel the model can forget; the parser already yields nextStep and the answer text yields the summary.

### 2.4 Auto-advance executor and spawn idempotency
- Astra: intent ledger, leases, adoption of uncertain spawns, "Recover launch" UI. Fable: single `advanced_at` CAS.
- **Decision: Fable's CAS plus a minimal `launch_attempts` row.** Before `threads.spawn`, insert `launch_attempts(status='pending')`; after success set `spawned` + `thread_id`; on exception set `uncertain`. Executor and `proceed` refuse to launch while any `pending` or `uncertain` attempt exists for that task, with no time-based release: bb has no spawn idempotency key, so elapsed time cannot prove a thread was or was not created. The 2-minute timer only promotes `pending` → `uncertain` (on plugin start and in a sweep). The Sessions tab shows a "Recover launch" row for `uncertain` attempts with **Adopt** (pick from `threads.list({originPluginId, parentThreadId?})` candidates created after the attempt), **Retry** (new attempt) and **Dismiss** (marks `failed`); one of these is required before the task can launch again. No lease machinery. `// ponytail: no adoption of orphan threads; add threads.list(originPluginId) matching if uncertain rows appear in practice`.
- Transition table exactly per study §3 (`AUTO_ADVANCE`), human gates never auto-advance, per-transition flags on the task, master toggle `task.auto_advance`. Executor runs only after a **completed turn** (`thread.idle` with `lastAssistantText`), never on a `user_question` idle (Astra's point). Same `launchPhase()` serves auto-advance, proceed, iterate-in-fresh-session, new session, launch-draft (Fable §8).

### 2.5 Worktree timing
- **Decision: Fable §8 step 1 rules** (`never` → reuse base env; `now` → first spawn managed-worktree, store `worktree_environment_id`; `later` → first `worktree-setup`/`implementation` spawn creates it). No `environments.create` exists; creation via spawn is the only path and HL also runs a session there. `.humanlayer/workspace.json` is parsed and **applied where bb supports it**: `sourceRef` maps to the spawn's `baseBranch` (`origin/<b>` or `<b>` → `{kind:"named", name}`; `HEAD`/absent → `{kind:"default"}`; anything else, e.g. a SHA, is rejected at task creation with a clear message). `setupCommand` and `copyGlobs` are executed by the rewritten `setup-worktree` skill inside the worktree thread (agent copies files, runs the command, reports each stage). `pathTemplate`/`branchTemplate` are displayed as requested vs bb-resolved values only (PARITY). Multi-repo: supported only as "one bb environment per repo, sequential" and flagged in `PARITY.md` (Astra); v1 UI shows the primary repo only.

### 2.6 Skill naming and invocation
- **Decision:** frontmatter names `rpi-<skill>` (invoked as `/rpi-create-research`), keeping HL muscle memory. `show-me` ships as `rpi-show-me` to avoid the global collision Astra flagged. Skill text rewritten (licensing) but structure, step order, "read fully / do not read other artifacts / research is descriptive / never leak intent / final answer template EXACTLY" rules preserved. Per-skill change list per **Astra §9 table**. Templates live in `skills/<name>/references/`. The 7 Claude agents become 7 skills invoked by child threads spawned with `bb thread spawn --parent-self --prompt "/rpi-agent-codebase-locator ..."`; the research skills instruct which model class to use (Haiku-class when the "faster research subagents" pref is on, mapped through `bb.sdk.providers.models`).

### 2.7 Sidebar
- **Decision:** nav panel is the primary surface; `experimental_threadList` replacement (task → phase sessions grouping, phase pills, relative times, DOM shortcut attributes, `Original` fallback) ships in the last phase and stays optional.

### 2.8 Costs
- bb exposes no pricing; `$cost` is omitted from the footer (Fable). Context gauge uses `timeline().contextWindowUsage` (`usedTokens/modelContextWindow`), warning banner at ≥70% with "Iterate in a fresh session" (launches `iterate-<current phase>`), dismiss stored per thread in `task_ui_state`.

### 2.9 Batch queue delivery
- bb drains its own queue; a plugin policy hook per thread does not exist. **Decision:** ship behind a default-off setting using `queuedMessages.setGroupBoundary`; if the Phase 6 race test shows loss/duplication, remove and record in `PARITY.md`.

## 3. Phased delivery (each phase installable), model routing

Coding models resolve via `bb provider models`. Cheap: `anthropic/claude-haiku-4-5` (pi), `gpt-5.4-mini` (codex). Logic: `anthropic/claude-sonnet-5` (pi). Reviewers: `gpt-6-astra` (codex, high) and `anthropic/claude-fable-5-1` (pi, high). Each phase: coder thread(s) in an isolated worktree of the plugin repo, then both reviewers get the study, this plan, the diff, and test output; they answer only the listed questions; blocking findings go back to the coder.

| # | Scope | Coder | Reviewer questions |
|---|---|---|---|
| 0 | **SDK spike** (throwaway `bb-plugin-hl-spike`): `message.dispatch` wait+recheck on an existing env; spawn `managed-worktree` and read back `environmentId`; `interactions.list` payload for a codex and a claude-code approval; `thread.idle.lastAssistantText` content; `thread:changed` change kinds; `contributeInstructions` reaches both providers; `files.write` CAS conflict shape; `contentScripts` keydown + `new Audio` autoplay behavior. Output: `research/05-spike-results.md`. | Sonnet 5 | none (facts) |
| 1 | Scaffold + tasks: package, migrations 0..5, `tasks.ts`, RPC `listTasks/createTask(draft)/updateTask/archiveTask`, nav panel list/board/drafts, New task page (composer row: permissions, auto-advance, host, project/dir, worktree timing, workflow type; workflow strip), settings descriptors, chime asset generated | Haiku 4.5 (UI) + gpt-5.4-mini (wiring) | manifest fields; migrations append-only; RPC schemas strict; host components not misused; no hardcoded colors |
| 2 | Sessions: spawn first thread from `createTask`/`launchDraft` (freeform/oneshot only; RPI workflows stay in draft with "available in a later release"), `sessions.ts` derivation + subscription + reconcile on load, `launch_attempts` + Recover launch, sessions table, header action (pill, status, fork, interrupt), `contributeInstructions`/`configure`, dispatch hook labeling. The hydration wait branch is coded but **gated off** until Phase 3 ships `mirror.ts` | Sonnet 5 | §5.1 table exhaustive and literal; idempotent event handling; `had_turn`/`interrupted`; `lost` only from displayStatus; recover-launch requires explicit resolution |
| 3 | Artifacts: `artifacts.ts`, `mirror.ts` hydrate/ingest (CAS, sha256, `rootPath` confinement, `.git/info/exclude`), enable the Phase 2 hydration wait, `hl_task_context`, `hl_artifact_save`, `hl_next_artifact_number`, Artifacts tabs (grouped by frontmatter type, comment counts), viewer Preview/Raw/versions/soft-delete/restore, `/artifact` binary route, `::hl-artifact` directive | Sonnet 5 (logic), Haiku 4.5 (UI) | any `files.write` escaping the task dir; two-writer conflict path; binary caps; soft delete + `.trash/`; scoping by task; wait+recheck never deadlocks |
| 4 | Comments: viewer block rail, anchors + re-anchoring, three `hl_*` comment tools, send-to-session (`send` vs `send-and-resolve`), agent-comment notification hook point | Sonnet 5 | anchor re-attachment across versions; prefix ambiguity; XML escaping |
| 5 | Auto-advance + worktree: `advance.ts` + `launchPhase()`, timing rules, `sourceRef` → baseBranch mapping, Auto-advance tab, Workspace tab (env status, provisioning events, workspace.json requested vs resolved), `hydrateNow` | Sonnet 5 | double-fire guard; human gates; executor ignores `user_question` idles; environment choice per timing; `waiting_for_workspace` while provisioning; bad sourceRef rejected |
| 6 | Skills + extraction + proceed: rewrite 23 skills + 7 agent skills with a fidelity checklist (comment tools, worktree, and launchPhase now exist so every skill is runnable), `extraction.ts` with argument preservation + template test, summaries, proceed button, live workflow strip, Tips tab; enable RPI workflow types in the composer | gpt-5.4-mini (skills, checklist-driven), Sonnet 5 (extraction) | every template parses incl. args; no skill reads other artifacts during research; no intent leakage; child-thread commands correct on codex and claude-code; no verbatim HL prose; review-artifact-comments only resolves on confirmation |
| 7 | Notifications: `notify.ts`, sound route, bridge, toasts, ⌘⇧J stack, viewing detection, comment notifications, batch queue delivery behind setting | Sonnet 5 (rules), Haiku 4.5 (UI) | suppression order literal to study §5; approval text format; 8s; dedupe across mounted bridges; autoplay failure handled; batch race evidence or removal |
| 8 | Polish: scratch pad, context gauge + iterate banner, Minimap (timeline chips), prefs section pickers, palette actions, hotkeys (T, g t, ⌘E archive), `experimental_threadList`, `PARITY.md`, README | Haiku 4.5 / gpt-5.4-mini; threadList Sonnet 5 | DOM shortcut attributes; `Original` fallback; parity ledger complete and honest |

Final review (both expensive models, high): end-to-end evidence walk of one RPI task from draft to PR description on codex, one on claude-code; every study §5 rule exercised; `bb plugin build`, install, reload, disable/enable mid-task.

## 4. Tests (per Fable §14, Astra §13)
- `node:test` on pure modules: `transitions` (table equals study §3 literally), `extraction` (every template + legacy `/rpi:` aliases + negative cases), `sessions.deriveStatus` (every row of §5.1 + `lost` rules), `notify.decide` (suppression matrix), `artifacts` naming/frontmatter/NN allocation, `comments` anchor re-attach.
- Plugin harness tests (SDK `testing.md`): migrations idempotent, RPC schema rejections, tool scoping error for non-task threads, `files.write` confinement.
- Live checklist per phase in the Reviewer column; recorded in `research/06-acceptance-log.md`.

## 5. Risks carried forward and explicit omissions (see `PARITY.md` at release)

Risks: no file-write interception (mitigated by tool + idle ingest); cold worktree hydration relies on skill step 0; no per-step setup retry API; realtime signals ephemeral (misses possible, duplicates not); `contributeInstructions` sync 4096; batch delivery race; threadList exclusivity; frontmatter parser flat only; multi-repo layout not identical to HL.

Deliberately omitted from v1 (each listed in `PARITY.md` with the reason; adopt Fable §13 by reference):
- **Context shards** (server-side cross-session fact extraction with evidence and per-user enable/disable/dismiss): needs an LLM extraction pass and a durable-facts store; bb's Memory plugin already covers the user-preference half. Revisit after v1.
- **Patch-anchored diff comments** and the **Changes ALL / TO REVIEW review-state tracking**: bb's environment diff panel is reused as-is and has no plugin comment/annotation slot; requires an upstream SDK extension.
- **Ticket-provider import** (Linear/Jira/GitHub issue → `ticket.md`): bb's GitHub and GitLab plugins own integrations; a later phase can add an `@issue` mention → `task.md` prefill. Manual paste works in v1.
- **Public artifact sharing** (`share_key`, permalinks outside bb): local-first plugin; bb connect tunnels already expose the app if needed.
- **Queued-message `deliver_on_interrupt`**: bb queue rows have no interrupt-delivery flag; queued messages dispatch on idle via bb's own drain.
- **Multiplayer prompting, org/team ACLs, Slack mute, billing, cost display**: no local or single-user equivalent.
- **Cloud sync of artifacts**: intentionally none; DB + repo mirror only.
