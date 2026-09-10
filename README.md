# bb-plugin-rpi

An RPI (research-plan-implement) task/session/artifact workflow, built as a bb
plugin. bb owns threads, environments/worktrees, providers, permissions, and
diffs; this plugin owns tasks, artifacts, versions, comments, auto-advance,
notifications, and the RPI skills that drive the loop.

See [`FEATURES.md`](./FEATURES.md) for the full feature ledger, including
everything that is partial, omitted, or N/A and why.

## Install

```
npm install
bb plugin install .
bb plugin reload rpi
```

Or install a published release: `bb plugin install npm:bb-plugin-rpi`
or `bb plugin install git:https://github.com/<org>/bb-plugin-rpi.git@<tag>`.

## The RPI loop

A task moves through **questions → research → design → plan → worktree setup
→ implementation → optional code review/fix loop → describe-pr → optional pull
request review loop**, one bb thread ("session") per phase. Each
phase is a `rpi-<skill>` skill invoked as `/rpi-create-research` etc.; the
task's artifacts (`task.md`, numbered research/design/plan docs,
`pr-description.md`, ...) live in the plugin's SQLite database and mirror out
to `.rpi/tasks/<slug>/` in the workspace so a fresh session can `Read`
them.

### From the UI

Open **RPI** in the sidebar, **Create task** (or press `T`), describe
the work, pick a workflow type (`rpi`, `outline_only`, `prd_tdd`, `oneshot`,
`freeform`), worktree timing (`now`/`later`/`never`), and permission mode, then
**Create** to launch immediately or **Save draft** to launch later. The task
detail page has tabs for Sessions, Artifacts, Workspace, Auto-advance, Scratch,
Minimap, and Tips. Each phase session's header shows its phase pill, status,
context-window gauge, and Proceed / Iterate / Fork / Interrupt controls. After
implementation, the header action menu can start a code review or jump directly
to pull request creation. Review findings flow to a fix session and back to a
fresh review until clean. After pull request creation, the same menu can run
another review-comment resolution round until the current head is approved.
Oneshot and freeform tasks expose the same optional actions after their single
work session. The thread side panel has one **RPI** action that keeps Artifacts,
Workspace, Scratch, Minimap, Tips, model settings, code review, pull request
creation, and pull request review resolution available from any task session.

Manual quick actions open bb's new-thread composer with the intended prompt and
wait for explicit submission. The draft can be edited and its model, reasoning,
service tier, and permission mode apply to that session only. The task's project
and workspace remain fixed; for unmanaged workspaces bb may display a normalized
checkout while RPI restores the task's canonical path on submit. Retry reuses the
validated request stored with the launch attempt. CLI launch commands and
eligible lifecycle auto-advance remain immediate.

BB's current embedded composer persists edited prompt text under the RPI draft
key, but execution and environment selections are component-local. Leaving the
composer and reopening it restores the text and reseeds those selections from
the task defaults.

When the first task session starts, it receives a best-effort instruction to
move exactly one unambiguous linked ticket to the repository's existing active
or in-progress state. It skips safely when no supported ticketing system or
unique ticket is declared. This uses the agent's configured ticketing tools;
the plugin does not persist a second ticket status.

### From the CLI

```
# Create and launch a task
bb rpi tasks create --name "Add rate limiting" --project <projectId> \
  --prompt "Add a token-bucket rate limiter to the API gateway" --launch

# List tasks and sessions
bb rpi tasks list
bb rpi sessions list --task <taskId>

# Drive a session by hand once its next step is parsed
bb rpi proceed --thread <threadId>

# Launch a specific RPI skill directly
bb rpi launch-skill --task <taskId> --skill create-research --command-line "/rpi-create-research"

# Artifacts and comments
bb rpi artifacts list --task <taskId>
bb rpi artifacts get --task <taskId> --file 02-research-*.md
bb rpi comments list --task <taskId> --file 02-research-*.md

# Recovery, notifications, workspace
bb rpi launch-attempts --task <taskId>
bb rpi notifications list
bb rpi workspace --task <taskId>
```

Every command accepts `--json` for scripting. Run `bb rpi` with no
arguments (or an unknown subcommand) to print the full usage list.

## Settings

**Settings → RPI → Notifications**: enable/disable, per-kind sound and
toast toggles (ready sessions, approvals, comments), volume, and the jump
hotkey (`⌘⇧U` by default; not `⌘⇧J`, which Chromium reserves).

**Settings → RPI → Defaults**: global provider/model/reasoning-effort
defaults for new tasks, plus a per-workflow-type override table (provider,
model, reasoning, permission mode) so `rpi` tasks can default to a different
model than a quick `oneshot`.

**Settings → RPI** (host-registered scalar settings): default workflow
type, default worktree timing, default permission mode, auto-advance default,
show task phase labels, diff style, default editor, phase tips and other tip
toggles, confirm-before-interrupting-subagents, batch queue delivery
(default off; see `FEATURES.md`).

## Model guidance

Each phase skill's final-answer template (a fenced `/rpi-<skill> [args]` command
block) is parsed deterministically, not with an LLM. A model that
does not reliably reproduce that exact template on request will finish the
turn with no machine-readable next step.

| Phase | Recommended | Notes |
|---|---|---|
| Design, plan, implementation orchestration, code review, and pull request review resolution | Sonnet-class or gpt-5.4 (non-mini) | These phases carry the most judgment and the most template discipline; a mini-class model dropping the template here costs the most rework. |
| Research questions, bounded research children (the 7 `rpi-agent-*` skills), `describe-pr` | mini-class acceptable | Narrower, more mechanical tasks; a dropped template here is cheap to recover from. |

A mini-class model frequently drops the final-answer template even when asked
for it directly. When that happens the session still finishes correctly, it
just extracts to `no_next_step` (see "A skill's Proceed button is disabled"
below); the thread header then shows **Suggested next: `<button text>`**, the
workflow's own canonical next skill for that phase, one click away through the
reviewable launch composer. Submission uses the same per-task launch mutex as
Proceed and auto-advance. This
is the same affordance that appears when the model's extraction disagrees
with what the workflow expects, and for a human-gated phase, which is manual
regardless. Auto-advance itself is unaffected: it only ever fires on an exact
allowed extraction target, never on a Suggested-next fallback. Code review is
the one branching phase: findings lead to fixes, while a clean review leads to
pull request creation. If that extraction is missing, the plugin does not guess;
use the header action menu to review again or create the pull request.

This plugin does not pre-seed model ids anywhere (`prefs.defaults`,
`prefs.workflowDefaults`, or the bb settings default-model keys all start
empty/unset); the table above is guidance for what to pick in Settings ->
RPI -> Defaults, not a shipped default.

## Notifications

A toast (8s) and/or a chime fires when a session becomes `ready_for_input`,
gets a pending approval, or receives an inbound artifact comment - unless
you're already viewing that session (sound only), auto-advance is about to
launch the next phase for that transition (no toast, still launches), or the
notification already fired for that exact event. `⌘⇧U` jumps to the oldest
outstanding one; a synthetic `bb rpi notifications test --thread <id>`
command exists for manually verifying delivery without touching real
dedupe/suppression state.

## Hotkeys

| Key | Action |
|---|---|
| `T` | New task (while the RPI panel is mounted and has focus, not while typing) |
| `g` then `t` | Go to the tasks list (same scoping as `T`) |
| `⌘E` | Archive the current task and its session threads (confirms first) |
| `⌘⇧U` | Jump to the oldest outstanding notified session (configurable, works anywhere in bb) |
| `⌘⇧P` | bb's command palette - lists "RPI: Open Artifacts / Open Scratch pad / Archive current task" |

`T` and `g t` are scoped to the RPI panel's own root DOM element (a
keydown listener on that element, not `document`), so they only fire while
focus is somewhere inside the panel and never `preventDefault` on a keypress
elsewhere in bb. `⌘E` has no panel root of its own to scope to (it is
injected into bb's native thread header), so it stays gated on the session
actually being viewed. All three share one hook (`usePanelHotkeys` in
`ui/rpi.tsx`), no-op while focus is in an editable field
(`shouldHandleHotkey`), and skip a combo that collides with the configured
jump hotkey so a rebound jump hotkey always wins. `⌘E`, the palette action,
and the task page's Archive button all ask for confirmation before archiving.
Archiving flags the task and cascades `threads.archive` to every session
thread that is not already archived (also `bb rpi tasks archive --task <id>`);
the `.rpi/tasks/<slug>/` mirror stays on disk and there is no unarchive yet.

## Licensing

This repository's code and skills (`skills/rpi-*`) are original rewrites of a
workflow shape (step order, "read fully", "do not leak intent", final-answer
template rules) in this project's own words, researched from third-party
reference material kept outside this repository entirely (a sibling checkout,
default path `~/PersonalDevelopment/bb-plugin-rpi-reference/third-party`,
overridable with `RPI_REFERENCE_DIR`; see `tests/skills.test.ts`). At HEAD,
this repository does not contain that material: it is **All Rights
Reserved**, is never copied into `skills/`, and `package.json`'s `files`
allowlist excludes `docs/` (along with `tests/`) from every published package
regardless - verify with `npm run check:pack` after changes to either.
**Release step:** an early commit in this repository's history briefly
vendored that third-party reference material into a docs subdirectory before
it was moved out to the sibling checkout; before any public push, a
maintainer must purge that commit from git history (`git log` for the exact
historical path and commit; `git filter-repo --path <that path> --invert-paths`)
as a deliberate, documented, one-time step. Do not rewrite history as a side
effect of unrelated work. The notification chime (`assets/notification.mp3`)
was synthesized for this project.

## Troubleshooting

**"Notification sound is blocked"** - browsers require a user gesture before
`new Audio().play()` succeeds. The bridge tries to unlock on the first click
or keypress; until then it shows this toast. Settings → Notifications → **Test
sound** always works (it's triggered by that same click) and clears the
warning once playback succeeds.

**Worktree provisioning is stuck / the Workspace tab shows an error** - bb
creates a worktree environment only as a side effect of the first thread
spawned into it (there is no standalone `environments.create`), so a failed
provisioning surfaces as a `failed` session with the hook's log in the
Workspace tab, not a separate retry step. Use **Rerun workspace setup** on the
Workspace tab, which spawns a fresh `rpi-setup-worktree` session into the same
environment.

**A launch attempt is stuck "pending" or shows "uncertain"** - the task
refuses to launch again while a `pending`/`uncertain` attempt is unresolved
(bb has no idempotency key for `threads.spawn`, so elapsed time alone can't
prove whether a thread was created). Resolve it from the Sessions tab's
Recover-launch row:
- **Adopt** - pick a matching thread bb already created for this task after
  the attempt started (candidates come from `threads.list` filtered to
  `originPluginId`/`parentThreadId`).
- **Retry** - start a fresh attempt with the same command.
- **Dismiss** - mark it `failed` without adopting or retrying (a failed
  attempt without a retry stays visible so a recovery toast's "Retry it from
  Launch Attempts" instruction stays actionable).

**A skill's Proceed button is disabled** - next-step extraction is
deterministic: the final-answer block must be an exact `/rpi-<skill> [args]`
(or legacy `/rpi:<skill>`) fenced `text` block. A freeform reply, a
missing/renamed artifact reference, or a template the model altered will not
parse; the session still finished, it just has no machine-readable next step
(`no_next_step`; mini-class models drop this template more often, see "Model
guidance" above). The thread header shows a **Suggested next** button in that
case (and whenever extraction disagrees with what the workflow expects)
instead of leaving you to guess; it opens the workflow's own next skill in a
reviewable launch draft. `bb rpi launch-skill` is still available for
immediately launching a different skill than the suggested one.

## Development

```
npm install
npm test            # node:test on the pure modules + plugin harness tests
npm run check:conventional # Conventional Commit subjects on this branch
npx tsc --noEmit
bb plugin build      # dist/server.js, dist/app.js, dist/app.css
bb plugin dev        # rebuild + reload on every save
```

`AGENTS.md` has the phase conventions this repo was built under; each
`docs/phases/NN-*.md` records what shipped and how it was verified.
