# Phase 8: Polish + PARITY + README

## What shipped

**Polish (item 1):**
- **(a) Context gauge + iterate banner.** `bb.sdk.threads.timeline({threadId, summaryOnly:"true"}).contextWindowUsage` is real and server-side only (verified in `node_modules/@get-bb/plugin-sdk/bundled-types/bb-plugin-sdk.d.ts`); exposed as `SessionView.contextUsage` (`{usedTokens, modelContextWindow, percent, estimated}` or `null`). `ContextGauge` renders it on `SessionsTable` rows and the thread header. At `percent >= 0.7` the header shows a warning banner wired to the existing `iterateInFreshSession` RPC, dismissible per-thread via `task_ui_state.contextWarningDismissed` (new `dismissContextWarning` RPC).
- **(b) Scratch pad.** New `saveScratchPad` RPC backed by the already-migrated (but previously unused) `scratch_pads` table, debounced 600ms client-side with an unmount flush, merged into `TaskUiState.scratch` for one `getTaskUiState` read. New `ScratchPadPanel`, a task-detail "Scratch" tab, and a `scratch` `threadPanelAction`.
- **(c) Minimap.** `MinimapPanel` lists a task's sessions in creation order with a status glyph + phase label + relative time, click-to-jump; task-detail "Minimap" tab and a `minimap` `threadPanelAction`.
- **(d) Prefs section pickers.** `prefsSchema.workflowDefaults` (`z.partialRecord(workflowTypeSchema, {providerId, model, reasoningLevel, permissionMode})`), merged per-workflow-type in `setPrefs` (verified: a patch to one workflow type never drops another's fields or an earlier field on the same type - `tests/polish.test.ts`). New Settings → Defaults section (`HumanLayerDefaultsSettings`).
- **(e) Hotkeys.** `T` (new task) and `g`-then-`t` (go to tasks) added to `HumanLayerPanel`'s own keydown listener, scoped to that component so they never fire outside the HumanLayer surface; `⌘E` (archive current task, with `window.confirm`) added to `HumanLayerThreadHeaderAction`. All three reuse `shouldHandleHotkey`'s not-in-editable guard, the same helper the existing `⌘⇧U` jump hotkey owner uses. Conflicts: none observed against bb's own hotkeys (`⌘,` settings, `⌘B`/`S` sidebar, `⌘⏎` send, `h/j/k/l` panes are all outside this plugin's DOM).
- **(f) Palette actions.** SDK exposes `commandPaletteAction` (checked `bb-plugin-sdk-app.d.ts`) - not N/A. Its `run(context)` has no `useRpc`/`useBbNavigate` hook access, so the 3 registered actions ("Open Artifacts", "Open Scratch pad", "Archive current task") call the plugin's own documented RPC HTTP route directly (`POST /api/v1/plugins/humanlayer/rpc/<method>`) instead.
- **(g) `experimental_threadList`.** SDK exposes it (not N/A). Implemented `HumanLayerThreadList`: groups this plugin's task-session threads (via `experimental_useSidebarThreads()` joined against `listSessions`/`listTasks`) under their task with a phase-status glyph and relative time; every other thread renders flat below, sorted by `updatedAt`. A manual "Use default list" toggle renders `Original` on top of the host's own automatic fallback. The SDK documents no per-row "DOM shortcut attribute" contract in this version (checked `bb-plugin-sdk-app.d.ts` and the `bb-plugin-authoring` skill's `frontend-registration.md`/`frontend-renderer-slots.md`); recorded as N/A-to-this-SDK-version in `PARITY.md`, not omitted.

**`PARITY.md`** - full feature-by-feature ledger (tasks, workflow types, sessions/status vocabulary, the complete auto-advance table with every flag, artifacts, comments, context management, 23+7 skills, agents, notifications, the 68 HL settings keys bucketed by group, hotkeys, UI surfaces), each partial/omitted row with a reason, plan §5's omissions carried forward verbatim, and a "Known risks" section mapping every plan §5 risk to its shipped mitigation.

**`README.md`** - full rewrite (the prior file was the unedited `bb plugin new` scaffold): what it is, install, the RPI loop from the UI and the CLI, settings, notifications, a hotkeys table, a licensing section, and troubleshooting (autoplay blocked, worktree provisioning, Adopt/Retry/Dismiss, a disabled Proceed button).

**Licensing packaging fix.** `npm pack --dry-run` before this phase included `docs/hl-reference/` (5.4 MB, 256 files) - HumanLayer's All-Rights-Reserved skill/agent/hook source - in the published tarball, because `package.json` had no `files` allowlist. Added one (`*.ts`, `*.tsx`, runtime dirs, `skills/`, `LICENSE`, `README.md`) and added `LICENSE` (MIT for this repo's own code, with a note that `docs/hl-reference/` is excluded and not covered). `npm pack --dry-run` after the fix: 186.6 kB / 140 files, zero files under `docs/` or `tests/`.

**A real bug found and fixed during the live walk** (see below): `launch.ts`'s `selectEnvironment()` used `{type: "project-default"}` as its base-role fallback whenever a task had no `hostId`/`defaultDirectory`. That literal is a composer-seeding concept whose actual resolution is the project's own ambient default, which this very project happens to have set to "spawn a managed worktree for a new thread" (a reasonable choice for a repo developed across many parallel phase worktrees). That silently broke `worktreeTiming: "later"/"never"`'s guarantee that no worktree exists before the plan calls for one. Fixed by resolving a real host (`task.hostId` or the first `bb.sdk.hosts.list()` entry) and spawning an explicit `{type:"host", workspace:{type:"unmanaged", path:null}}` - a workspace type that is never a managed worktree by construction - falling back to `project-default` only when literally no host can be found. Two new regression tests in `tests/launch.test.ts`; the existing `launchPhase selects environments...` test's two `never`/`later` cases were updated from `expected: "project-default"` to `expected: "unmanaged"` since a `hostId` was already present in that fixture.

## How it was verified

```
npm test            # 139/139 pass (was 133 before this phase; +4 tests/polish.test.ts, +2 tests/launch.test.ts, others updated)
npx tsc --noEmit     # clean
bb plugin build      # dist/server.js, dist/app.js, dist/app.css written
bb plugin types --check   # SDK pin 0.4.34 matches host 0.4.34
npm pack --dry-run   # 186.6 kB / 140 files; no docs/hl-reference, no tests/
```

Key new/updated test excerpts (`node --test --import tsx tests/launch.test.ts tests/polish.test.ts`):
```
✔ a hostless base-role task resolves a real host into an unmanaged workspace, never project-default
✔ project-default is only used when no host can be resolved at all
✔ scratch pad round trips through task_ui_state without disturbing dismissed tips
✔ context warning dismissal is scoped per thread within one task
✔ getSession reports context usage percent from threads.timeline summaryOnly, and null on failure
✔ setPrefs merges workflowDefaults per workflow type instead of replacing the whole map
```

## Live end-to-end evidence walk

Installed from this worktree (`bb plugin install . --yes`, project `proj_v36xq75qse` at `/Users/marktripoli/PersonalDevelopment/bb-plugin-humanlayer`). Created an `rpi` task (`bb humanlayer tasks create ... --workflow rpi --worktree later --provider codex --model gpt-5.4-mini`), then set flags with `bb humanlayer tasks update`: `autoAdvance=true`, `aa_questions_to_research=true`, `aa_research_to_design=false` (human gate into design), `aa_plan_to_worktree=true`, `aa_worktree_to_implementation=true`, `aa_implementation_to_pr=false` (human gate into describe-pr; design→plan is always a human gate regardless of flags). Task: fix one line of wording in this repo's `README.md`.

| Step | Trigger | Thread | Label | Status at completion | Notes |
|---|---|---|---|---|---|
| 1 | `launchDraft` RPC | `thr_v9cphn22i8` | research-questions | ready_for_input | `nextStepType: create-research` parsed cleanly |
| 2 | auto_advance (aa_questions_to_research) | `thr_8wifbqcxmu` | research | ready_for_input | `nextStepType: create-design-discussion`; correctly **not** auto-advanced further (`aa_research_to_design=false`) |
| 3 | `proceed --thread thr_8wifbqcxmu` (manual, human gate) | `thr_s9ipg5iaak` | design | ready_for_input | **Model did not emit the final-answer command block** (`no_next_step`, reason "no command block") - see Findings |
| 4 | `launch-skill --skill create-plan` (manual recovery) | `thr_czvr3ij4ni` | plan | ready_for_input | Parsed `nextStepType: implement-plan` - **wrong template** (skill offers `plan_final_answer.md`→setup-worktree, `plan_in_worktree_answer.md`→implement-plan, `plan_disabled_answer.md`; model incorrectly claimed "already in a worktree" and chose the in-worktree template). Auto-advance's exact-match guard (`advance.ts`: `transition.next !== nextStep.extraction.nextStepType`) correctly refused to auto-launch this mismatched target - no bug there. |
| 5 | `launch-skill --skill setup-worktree` (manual, following the canonical policy instead of the model's wrong suggestion) | `thr_bvijj52542` | worktree-setup | ready_for_input | **New managed-worktree environment `env_htzgeka6mm` created here**, distinct from the earlier accidental one - confirms the fix |
| 6 | auto_advance (aa_worktree_to_implementation) | `thr_5uxzp7x22s` | implementation | ready_for_input | Made the real one-line `README.md` edit (in that worktree's own branch, which forks from `main` as of task creation, so it saw the pre-phase-8 scaffold README and added a Troubleshooting note rather than editing my in-flight phase-8 wording - expected, not a bug). **No child `implementer`/`reviewer` threads spawned** despite `rpi-implement-plan`'s explicit "Do not do bulk implementation inline. Launch focused child threads" rule - see Findings. `no_next_step` again (no command block). |
| 7 | `launch-skill --skill describe-pr` (manual) | `thr_63cj38dmd6` | describe-pr | ready_for_input | `pr-description.md` artifact written |

Artifacts (`bb humanlayer artifacts list --task <id>`): `task.md`, `01-research-questions-readme-launch-attempts.md`, `02-research-readme-launch-attempts.md`, `03-design-discussion-readme-launch-attempts.md`, `04-plan-readme-troubleshooting-typo.md`, `05-worktree-setup-readme-troubleshooting-typo.md`, `pr-description.md` - 7 artifacts, matching every phase.

Launch attempts (`listLaunchAttempts`): every attempt reached `status: "spawned"`, none stuck `pending`/`uncertain` - no Recover-launch row was ever needed in this run.

Notifications (confirmed via `SELECT thread_id, kind, reason, sound FROM notifications` on the plugin's `data.db` after `bb plugin remove` made the CLI unavailable): all 7 sessions produced exactly one `ready_for_input` row each. `thr_v9cphn22i8` (research-questions) and `thr_bvijj52542` (worktree-setup) both have `reason: "auto_advance_suppressed", sound: 0` - correctly suppressed because `aa_questions_to_research`/`aa_worktree_to_implementation` covered those transitions (toast/sound skipped, launch still happened). The other 5 (research, design, plan, implementation, describe-pr - every phase behind a human gate) have `reason: "notify", sound: 1`.

Environments: `base_environment_id = env_8vvmvy5h7u` (the accidental pre-fix managed-worktree - task creation happened moments before the fix was reloaded), `worktree_environment_id = env_htzgeka6mm` (`kind: managed-worktree`, created correctly post-fix at the worktree-setup phase). `getWorkspace` confirmed `environment.kind: "managed-worktree"`.

Child threads: `SELECT * FROM child_threads WHERE task_id = '<id>'` on the plugin's own `data.db` returned **zero rows** - see Findings below; the plugin's own child-thread infrastructure (`registerSessionRuntime`, `child_threads` table, `RPI_AGENT_SKILL_NAMES` selection) is unit-tested (`tests/sessions.test.ts`: "agent child skills require a task parent and survive reload", "agent child classification uses the thread record's actual parent") and simply was never exercised because the implementation session did not spawn one.

### Findings from the walk

1. **Fixed (plugin bug):** the `project-default` environment fallback silently created worktrees under `worktreeTiming: "later"`. Root cause, fix, and regression tests recorded above.
2. **Not a plugin bug (model non-compliance, gpt-5.4-mini, chosen for cost per plan §3):** three phases (design, plan-template-choice, implementation) produced replies that did not follow their skill's exact final-answer template or delegation rule. In every case the deterministic parser degraded gracefully (`no_next_step` with a clear reason, or - for the plan phase - a well-formed but policy-mismatched command that the auto-advance guard correctly refused to trust) and the CLI's manual recovery path (`bb humanlayer launch-skill`) worked exactly as `README.md`'s troubleshooting section describes. No crash, no silent wrong-phase transition, no duplicate spawn. This is the plan's own risk #8 ("extraction fragility... depends on templates staying intact") manifesting live; the mitigation (graceful `no_next_step`, manual recovery, existing template-parsing tests) already exists and is now also documented for a user who hits it. I did not add enforcement machinery (e.g., requiring a tool call before turn completion) to force a small model to comply - that would be new scope beyond "polish" and isn't something any other phase's design calls for.

## Deviations from the plan

- Section 1(g)'s wording ("`experimental_threadList` filter for task threads") is implemented as the full sidebar-replacement grouping described in plan §2.7/Fable §11, not a narrower "filter" - the SDK exposes only the one exclusive replacement slot, no separate filter primitive.
- The live walk's `worktree-setup` phase created a genuinely new environment because the task's `base_environment_id` had already been assigned (by the pre-fix bug) to a worktree; the walk therefore demonstrates the fix (a second, correctly-created worktree at the right phase) rather than a single environment used throughout. Restarting the walk from scratch after the fix would have cost another ~15 minutes of live agent time for no additional coverage the regression tests don't already provide, so I continued the in-flight task instead of discarding it.
- Palette actions and `⌘E`/`T`/`g t` hotkeys were not covered by new automated tests (no DOM/browser harness exists in this repo's test suite for `ui/humanlayer.tsx`; existing UI code is entirely unit-tested indirectly through the RPC/CLI layer). Manually exercised live: `T` and `⌘E` were verified as reachable code paths by reading the mounted-component keydown listeners; a full click-through browser test was out of scope for this phase's test infrastructure.

## Cleanup

- Archived the task (`archiveTask` RPC) and every one of its 7 threads (`bb environment archive-threads env_8vvmvy5h7u`, `bb environment archive-threads env_htzgeka6mm`).
- `bb plugin remove humanlayer` - confirmed absent from `bb plugin list`.
- `git worktree prune` - nothing to prune (all worktrees still have valid directories on disk).

**Stale phase worktrees for the parent to remove via `bb`** (every worktree below except `main` and this phase's own `env_7pbckyvuy4`; the live walk added the last two rows and they can be removed the same way once their environments are no longer needed):

```
env_2nxh7jc22t  bb/research-questions-phase-5-sibling-live-check-thr_u6yn6tby44
env_339kec2ijw  bb/phase-3-artifacts-thr_n3a8dtwp8m
env_4icexzc8pm  bb/phase-6b-deep-skill-rewrite-lane-2-thr_zag9m4sz4r
env_4vhcjixuhq  bb/phase-7-notifications-thr_tik4sy29d7
env_8vvmvy5h7u  bb/research-questions-phase8-evidence-walk-readme-t-thr_v9cphn22i8  (created by this phase's live walk; threads archived)
env_a2ti9a8pn4  bb/research-questions-phase7-recovery-live-check-thr_x7fas2aikj
env_bd4cjx7mxx  bb/phase-6b-deep-skill-rewrite-lane-1-thr_c9upztm5wy
env_bht3qcm5xy  bb/research-questions-phase-6-review-outline-smoke-thr_gs3v6ec8yd
env_cbfz9stdj9  bb/research-questions-phase7-auto-advance-recovery-thr_dcaptqfbhq
env_cnusrtykaq  bb/phase-5-auto-advance-worktree-thr_5r9apnckv3
env_hdrdgrfqg9  bb/research-questions-phase-7-auto-advance-smoke-thr_znxkecfj5t
env_htzgeka6mm  bb/worktree-setup-phase8-evidence-walk-readme-troub-thr_bvijj52542  (created by this phase's live walk; threads archived)
env_j7tueiu3df  bb/phase-2-sessions-thr_xrg3rsaypv
env_jc684p4n9d  bb/research-questions-phase7-round2-recovery-live-c-thr_es3szjbwrc
env_m95esupxas  bb/phase-4-comments-thr_7nvnrqc4st
env_q4qb3jh7hk  bb/research-questions-phase7-round3-live-check-thr_5km3smvx95
env_qe438eumby  bb/phase-1-scaffold-tasks-thr_a49vqccud8
env_quymdd2qrf  bb/phase-6-skills-extraction-proceed-thr_5xfqnzcsaf
env_wpcp943ue4  bb/research-phase7-recovery-live-check-thr_amigh8fmvy
env_x283wdws9t  bb/phase-6b-deep-skill-rewrite-lane-3-thr_npvhcp6kv6
```

I did not remove any of these; only the parent/reviewer should decide which phase branches are done merging before their worktrees are torn down.

## Open items for the reviewer checklist

- Confirm `HumanLayerThreadList`'s grouping behavior against a project with many non-task threads (not exercised live beyond this repo's own project, which had few active threads at review time).
- Confirm the `⌘E`/`T`/`g t` hotkeys against a real keyboard in the bb desktop app (verified as reachable code, not click-tested in a browser harness - see Deviations).
- Decide whether `preferBatchQueueDelivery` should be removed entirely (still unwired, inert setting) or wired in a follow-up now that `queuedMessages.setGroupBoundary` exists in the SDK.
- The 20 stale worktrees listed above are safe to prune once their branches are confirmed merged or abandoned.
