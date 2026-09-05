# bb-plugin-humanlayer

HumanLayer's task/session/artifact research-plan-implement (RPI) workflow,
rebuilt as a bb plugin. bb owns threads, environments/worktrees, providers,
permissions, and diffs; this plugin owns tasks, artifacts, versions, comments,
auto-advance, notifications, and the RPI skills that drive the loop.

See [`PARITY.md`](./PARITY.md) for the exact feature-by-feature comparison
against HumanLayer, including everything that is partial, omitted, or N/A and
why.

## Install

```
npm install
bb plugin install .
bb plugin reload humanlayer
```

Or install a published release: `bb plugin install npm:bb-plugin-humanlayer`
or `bb plugin install git:https://github.com/<org>/bb-plugin-humanlayer.git@<tag>`.

## The RPI loop

A task moves through **questions → research → design → plan → worktree setup
→ implementation → describe-pr**, one bb thread ("session") per phase. Each
phase is a `rpi-<skill>` skill invoked as `/rpi-create-research` etc.; the
task's artifacts (`task.md`, numbered research/design/plan docs,
`pr-description.md`, ...) live in the plugin's SQLite database and mirror out
to `.humanlayer/tasks/<slug>/` in the workspace so a fresh session can `Read`
them.

### From the UI

Open **HumanLayer** in the sidebar, **Create task** (or press `T`), describe
the work, pick a workflow type (`rpi`, `outline_only`, `prd_tdd`, `oneshot`,
`freeform`), worktree timing (`now`/`later`/`never`), and permission mode, then
**Create** to launch immediately or **Save draft** to launch later. The task
detail page has tabs for Sessions, Artifacts, Workspace, Auto-advance, Scratch,
Minimap, and Tips. Each phase session's header shows its phase pill, status,
context-window gauge, and Proceed / Iterate / Fork / Interrupt controls.

### From the CLI

```
# Create and launch a task
bb humanlayer tasks create --name "Add rate limiting" --project <projectId> \
  --prompt "Add a token-bucket rate limiter to the API gateway" --launch

# List tasks and sessions
bb humanlayer tasks list
bb humanlayer sessions list --task <taskId>

# Drive a session by hand once its next step is parsed
bb humanlayer proceed --thread <threadId>

# Launch a specific RPI skill directly
bb humanlayer launch-skill --task <taskId> --skill create-research --command-line "/rpi-create-research"

# Artifacts and comments
bb humanlayer artifacts list --task <taskId>
bb humanlayer artifacts get --task <taskId> --file 02-research-*.md
bb humanlayer comments list --task <taskId> --file 02-research-*.md

# Recovery, notifications, workspace
bb humanlayer launch-attempts --task <taskId>
bb humanlayer notifications list
bb humanlayer workspace --task <taskId>
```

Every command accepts `--json` for scripting. Run `bb humanlayer` with no
arguments (or an unknown subcommand) to print the full usage list.

## Settings

**Settings → HumanLayer → Notifications**: enable/disable, per-kind sound and
toast toggles (ready sessions, approvals, comments), volume, and the jump
hotkey (`⌘⇧U` by default; not `⌘⇧J`, which Chromium reserves).

**Settings → HumanLayer → Defaults**: global provider/model/reasoning-effort
defaults for new tasks, plus a per-workflow-type override table (provider,
model, reasoning, permission mode) so `rpi` tasks can default to a different
model than a quick `oneshot`.

**Settings → HumanLayer** (host-registered scalar settings): default workflow
type, default worktree timing, default permission mode, auto-advance default,
show task phase labels, diff style, default editor, phase tips and other tip
toggles, confirm-before-interrupting-subagents, batch queue delivery
(default off; see `PARITY.md`).

## Notifications

A toast (8s) and/or a chime fires when a session becomes `ready_for_input`,
gets a pending approval, or receives an inbound artifact comment — unless
you're already viewing that session (sound only), auto-advance is about to
launch the next phase for that transition (no toast, still launches), or the
notification already fired for that exact event. `⌘⇧U` jumps to the oldest
outstanding one; a synthetic `bb humanlayer notifications test --thread <id>`
command exists for manually verifying delivery without touching real
dedupe/suppression state.

## Hotkeys

| Key | Action |
|---|---|
| `T` | New task (while the HumanLayer panel is mounted and has focus, not while typing) |
| `g` then `t` | Go to the tasks list (same scoping as `T`) |
| `⌘E` | Archive the current task (confirms first) |
| `⌘⇧U` | Jump to the oldest outstanding notified session (configurable, works anywhere in bb) |
| `⌘⇧P` | bb's command palette — lists "HumanLayer: Open Artifacts / Open Scratch pad / Archive current task" |

`T` and `g t` are scoped to the HumanLayer panel's own root DOM element (a
keydown listener on that element, not `document`), so they only fire while
focus is somewhere inside the panel and never `preventDefault` on a keypress
elsewhere in bb. `⌘E` has no panel root of its own to scope to (it is
injected into bb's native thread header), so it stays gated on the session
actually being viewed. All three share one hook (`usePanelHotkeys` in
`ui/humanlayer.tsx`), no-op while focus is in an editable field
(`shouldHandleHotkey`), and skip a combo that collides with the configured
jump hotkey so a rebound jump hotkey always wins. `⌘E` and the palette's
archive action both ask for confirmation before archiving.

## Licensing

This repository's code and skills (`skills/rpi-*`) are original rewrites of
HumanLayer's workflow shape (step order, "read fully", "do not leak intent",
final-answer template rules) in this project's own words — see
`docs/research/01-research-humanlayer-system.md` and the plan docs for the
research this was built from. HumanLayer's own skill/agent/hook source, kept
only for local reference during development, lives outside this repository
entirely (a sibling checkout, default path
`../bb-plugin-humanlayer-hl-reference/`, overridable with `HL_REFERENCE_DIR`;
see `tests/skills.test.ts`). At HEAD, this repository does not contain that
material: it is **All Rights Reserved**, is never copied into `skills/`, and
`package.json`'s `files` allowlist excludes `docs/` (along with `tests/`)
from every published package regardless — verify with `npm run check:pack`
after changes to either. **Release step:** an earlier commit in this
repository's history contained `docs/hl-reference/` before it was moved out;
before any public push, a maintainer must purge that material from git
history (e.g. `git filter-repo --path docs/hl-reference --invert-paths`) as a
deliberate, documented, one-time step. Do not rewrite history as a side effect
of unrelated work. The notification chime (`assets/notification.mp3`) is
synthesized for this project, not HumanLayer's asset.

## Troubleshooting

**"Notification sound is blocked"** — browsers require a user gesture before
`new Audio().play()` succeeds. The bridge tries to unlock on the first click
or keypress; until then it shows this toast. Settings → Notifications → **Test
sound** always works (it's triggered by that same click) and clears the
warning once playback succeeds.

**Worktree provisioning is stuck / the Workspace tab shows an error** — bb
creates a worktree environment only as a side effect of the first thread
spawned into it (there is no standalone `environments.create`), so a failed
provisioning surfaces as a `failed` session with the hook's log in the
Workspace tab, not a separate retry step. Use **Rerun workspace setup** on the
Workspace tab, which spawns a fresh `rpi-setup-worktree` session into the same
environment.

**A launch attempt is stuck "pending" or shows "uncertain"** — the task
refuses to launch again while a `pending`/`uncertain` attempt is unresolved
(bb has no idempotency key for `threads.spawn`, so elapsed time alone can't
prove whether a thread was created). Resolve it from the Sessions tab's
Recover-launch row:
- **Adopt** — pick a matching thread bb already created for this task after
  the attempt started (candidates come from `threads.list` filtered to
  `originPluginId`/`parentThreadId`).
- **Retry** — start a fresh attempt with the same command.
- **Dismiss** — mark it `failed` without adopting or retrying (a failed
  attempt without a retry stays visible so a recovery toast's "Retry it from
  Launch Attempts" instruction stays actionable).

**A skill's Proceed button is disabled** — next-step extraction is
deterministic (Fable §7): the final-answer block must be an exact
`/rpi-<skill> [args]` (or legacy `/rpi:<skill>`) fenced `text` block. A
freeform reply, a missing/renamed artifact reference, or a template the
model altered will not parse; the session still finished, it just has no
machine-readable next step (`no_next_step`) — start the next phase manually
with `bb humanlayer launch-skill`.

## Development

```
npm install
npm test            # node:test on the pure modules + plugin harness tests
npx tsc --noEmit
bb plugin build      # dist/server.js, dist/app.js, dist/app.css
bb plugin dev        # rebuild + reload on every save
```

`AGENTS.md` has the phase conventions this repo was built under; each
`docs/phases/NN-*.md` records what shipped and how it was verified.
