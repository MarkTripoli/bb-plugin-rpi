---
type: spike-results
task: humanlayer-bb-plugin
phase: 0
status: complete
date: 2026-09-05
---

# Phase 0 SDK spike results

Throwaway plugin: `~/PersonalDevelopment/bb-plugin-hl-spike` (source left in place,
plugin uninstalled at the end of this spike). All experiments ran against this
bb install, project `alidade` (`proj_7kji38b3vv`) and `atok`
(`proj_vwnspn396t`), host `Mark's MacBook Pro (2)` (`host_bsbj4cminc`), models
`pi anthropic/claude-haiku-4-5` and `codex gpt-5.4-mini`. Test threads were
archived after use; the plugin was disabled/re-enabled once for a control test
and removed at the end.

**Headline finding that changes the plan:** an `async` `bb.agents.contributeInstructions`
callback silently crashes every thread's provisioning on this bb build (§Q6).
The plan (§2.1, §2.6) assumes this hook is safe to use for the hydration
instruction and for per-skill provider notes — it is, but only if every
registered callback is kept truly synchronous, which the plan text does not
call out. Added to phase 2/6 acceptance below.

## Q1 — `message.dispatch` wait + recheck

**Verdict: works as documented.**

Returning `{action:"wait", reason}` queues the message, and calling
`bb.experimental_hooks.recheck("message.dispatch")` re-runs the hook pass and
lets a subsequent `proceed` dispatch it — confirmed on a live queued thread
(`thr_zmxbgrp569`): wait at `09:23:34.287Z`, recheck fired at `09:23:36.295Z`
(exactly the requested 2000ms later), second pass proceeded at
`09:23:36.312Z`, and the turn actually ran (`thread.idle` arrived 8.4s later
with the assistant's reply). Exact ctx fields observed:

```json
{
  "threadId": "thr_zmxbgrp569",
  "threadTitle": "hl-spike-q4q5q6",
  "attempt": "start-turn",
  "projectId": "proj_vwnspn396t",
  "environmentIsNull": false,
  "environmentId": "env_4feu2narn5",
  "host": { "id": "host_bsbj4cminc" },
  "origin": "cli",
  "originPluginId": null,
  "startedOnBehalfOf": null,
  "parentThreadId": null,
  "queuedMessageIsNull": true,
  "alreadyWaitedOnce": false
}
```

On the second pass `origin`/`originPluginId` are both `null` (a drained queue
row is not attributed to the original creator the way the first attempt is)
and `queuedMessageIsNull` is `false` (the retry carries the queued row).

**`ctx.environment` on a cold `managed-worktree` spawn: confirmed null.**
Spawning `thr_7r2fxgck52` with `environment:{type:"host", hostId, workspace:
{type:"managed-worktree", baseBranch:{kind:"default"}}}` produced this on the
very first hook pass:

```json
{ "environmentIsNull": true, "environmentId": null, "host": { "id": "host_bsbj4cminc" } }
```

`ctx.host` is already resolved even though `ctx.environment` is null — matches
the doc's claim that host is derived from the start intent before an
environment attaches. This confirms plan §2.1's two-layer design: the
`message.dispatch` wait branch cannot rely on `ctx.environment` for a fresh
managed-worktree spawn, so `hl_task_context` (skill step 0, hydrating
synchronously once the environment exists) remains necessary as designed.

**Caveat, not an SDK finding:** this bb build failed managed-worktree
provisioning against two real repos (`alidade`, `atok`) with
`Provisioning thread failed / text2.trim is not a function`, reproduced with
a plain `bb thread spawn --new-environment worktree` and no plugin loaded —
a pre-existing bb-core bug unrelated to this plugin. Unmanaged/host-path
environments and `reuse` environments worked fine and were used for every
downstream experiment that needed a completed turn.

## Q2 — `threads.spawn` managed-worktree + reuse, `environmentId` readback

**Verdict: works, with a real race worth documenting.**

`threads.spawn({..., workspace:{type:"managed-worktree", baseBranch:{kind:"default"}}})`
request/response:

```ts
// request
{
  projectId: "proj_vwnspn396t",
  providerId: "pi", model: "anthropic/claude-haiku-4-5",
  environment: { type: "host", hostId: "host_bsbj4cminc",
    workspace: { type: "managed-worktree", baseBranch: { kind: "default" } } },
  prompt: "...", title: "hl-spike-q1q2 managed-worktree",
}
```

The immediate `ThreadResponse` from `spawn()` had `environmentId: null`, but a
`threads.get({ threadId, include: "environment" })` issued milliseconds later
(same request/response cycle) already showed the environment attached and
provisioning:

```json
{
  "environmentId": "env_x2rdveqxf3",
  "environment": {
    "id": "env_x2rdveqxf3", "hostId": "host_bsbj4cminc", "managed": true,
    "isGitRepo": false, "isWorktree": false, "baseBranch": "origin/main",
    "workspaceProvisionType": "managed-worktree", "status": "provisioning"
  }
}
```

**Finding:** `spawn()`'s own return value is not a reliable place to read
`environmentId` for a managed-worktree spawn — it can still be `null` in the
same response that a follow-up `get({include:"environment"})` already
resolves. Any plugin code needing the environment id right after spawn
(e.g. to store `worktree_environment_id` per plan §2.5) must do the follow-up
`get`, not trust the spawn response alone.

`reuse` confirmed to attach the same environment: `spawn({environment:
{type:"reuse", environmentId:"env_4feu2narn5"}, projectId:"proj_vwnspn396t", ...})`
returned `environmentId: "env_4feu2narn5"` — identical to the source thread's
environment, and `providerId` correctly reflected the project's remembered
default (`codex`) since it was omitted from this request. Note: **`projectId`
is required even for a `reuse` environment** — omitting it returns
`HTTP 400: Required`, contrary to an assumption that the environment implies
the project.

## Q3 — `interactions.list` payload for a pending approval

**Verdict: works. codex tested; claude-code auth expired (documented, not a
plugin issue).**

A `touch` outside the workspace to a well-known adjacent project directory
(not `/tmp` — codex's macOS sandbox permits `/tmp` writes even under
`accept-edits`, so that path never triggers an approval) reliably produced
a pending approval on **codex**:

```json
{
  "id": "pint_4tat38zi74",
  "threadId": "thr_cin99rr8tc",
  "status": "pending",
  "turnId": "daf3a9811b-t1",
  "providerId": "codex",
  "providerThreadId": "01a070e2-b779-7871-9c8d-ed815579ab22",
  "providerRequestId": "0b3f626b-ad9e-4efc-b82b-304fe43fb444:1",
  "origin": { "kind": "provider", "providerId": "codex", "providerThreadId": "...", "providerRequestId": "..." },
  "payload": {
    "kind": "approval",
    "subject": {
      "kind": "command",
      "itemId": "daf3a9811b-i3",
      "command": "/bin/zsh -lc 'touch /Users/marktripoli/Development/formation/hl-spike-approval-test.txt'",
      "cwd": "/Users/marktripoli/Development/atok",
      "actions": [ { "type": "unknown", "command": "touch /Users/marktripoli/Development/formation/hl-spike-approval-test.txt" } ],
      "sessionGrant": null
    },
    "reason": "Do you want to allow creating this file in the other project directory outside the current workspace?",
    "availableDecisions": ["allow_once", "deny"]
  },
  "resolution": null
}
```

Tool name lives at `payload.subject.kind` (`"command"` for a shell approval;
the type union also covers `read`/`listFiles`/`search`/`unknown` per the
bundled schema) and the tool input at `payload.subject.command` /
`payload.subject.actions[].command` (a structured, partially-parsed
sub-action list) plus `payload.subject.cwd`. `bb thread interactions deny
<interactionId> <threadId>` resolved it and the provider correctly reported
"Permission denied" back to the model, which then answered without crashing
the turn.

**claude-code:** the same spawn (`--provider claude-code --permission-mode
accept-edits`) failed immediately with `Failed to authenticate: OAuth session
expired and could not be refreshed` — an environment/auth issue on this
machine, not evidence about the interaction payload shape. Re-authenticating
claude-code and re-running is a 5-minute follow-up before phase 6, not a plan
blocker.

## Q4 — `thread.idle` → `lastAssistantText`

**Verdict: works — it is the full final assistant message, not a preview.**

For a one-line reply ("ready", 5 chars) the event delivered the complete
string with no truncation:

```json
{ "threadId": "thr_zmxbgrp569", "title": "hl-spike-q4q5q6", "lastAssistantTextLength": 5, "lastAssistantTextPreview": "ready", "lastAssistantTextTail": "ready" }
```

Only tested with a short reply in this spike (time-boxed); nothing in the
event or the docs suggests a length cap, and the doc text ("`lastAssistantText:
string | null`") does not mention one. Plan §2.3's `summaryHistory.push(first
600 chars of lastAssistantText)` should be safe as designed; no cap was
observed that would make the 600-char slice redundant, and none should be
assumed absent either — worth a longer-reply check before relying on it for
production summaries (out of scope for this throwaway spike).

## Q5 — `bb.sdk.subscribe({event:"thread:changed"})` change kinds

**Verdict: works.** Observed across one thread's full lifecycle (spawn →
queued wait → dispatch → tool call → idle → archive):

```
queue-changed        (message queued by our own message.dispatch wait)
events-appended       (repeated — every provider event/turn chunk)
status-changed        (pending → active, and again active → idle)
interactions-changed  (a pending approval appeared, separate thread thr_cin99rr8tc)
archived-changed      (on bb thread archive)
```

All five are documented enum members of the `entity:"thread"` `ChangedMessage`
schema (`archived-changed`, `environment-changed`, `events-appended`,
`history-rewritten`, `interactions-changed`, `order-changed`,
`parent-changed`, `pin-state-changed`, `queue-changed`, `read-state-changed`,
`status-changed`, `tabs-changed`, `terminals-changed`, `thread-created`,
`thread-deleted`, `title-changed`) — this spike exercised 5 of the 16; the
rest (parent/pin/tabs/terminals/title/history-rewritten/environment-changed/
thread-created/thread-deleted) were not triggered by anything this spike did,
not shown to be broken.

## Q6 — `contributeInstructions` + `configure` + `registerTool` — both providers, tool execute() context

**Verdict: works, but with a serious, plan-relevant caveat found and fixed
during this spike.**

**Root-cause finding:** the first working draft used
`bb.agents.contributeInstructions(async ({ threadId }) => {...})` — an
**async** callback. The docs state "`contributeInstructions` is synchronous"
but do not say what happens if a plugin ignores that. On this bb build, an
async callback (which returns a `Promise` instead of a `string | null`)
crashes **every subsequent thread's provisioning**, on every provider and
every environment type (managed-worktree, unmanaged, host-path), with no
error surfaced to the plugin (nothing in `bb.log`/`plugin.log`) — the user
just sees `Provisioning thread failed: text2.trim is not a function` on the
thread. This was bisected live: disabling the plugin entirely fixed a plain
control thread; re-enabling with only `registerTool` reproduced fine; adding
back `configure` alone reproduced fine; adding back **`contributeInstructions`
alone** reproduced the crash regardless of whether the async callback
returned `null` or `""`. Switching the callback to a plain (non-async)
function, backed by an in-memory `Set` instead of an `await kv.get(...)`
inside the hook, fixed it immediately and every subsequent spawn on `pi` and
`codex` succeeded.

**Plan impact:** §2.1 and §2.6 both rely on `contributeInstructions` (for the
hydration nudge and per-skill provider notes). The plan must state as a hard
rule: **every `contributeInstructions`/`configure` registration must be a
synchronous function; any state it needs must already be in memory** (mirror
kv-backed state into an in-memory `Map`/`Set` kept current by writers, the
same pattern this spike ended up using). Add this to the phase 2 and phase 6
reviewer checklists.

**registerTool + configure, once fixed, worked cleanly on both providers.**
`execute()` context for `hl_spike_ping` on a `pi` thread:

```json
{ "threadId": "thr_zmxbgrp569", "projectId": "proj_vwnspn396t", "hasSignal": true }
```

`configure()` context observed:

```json
{ "threadId": "thr_zmxbgrp569", "providerId": "pi", "model": "anthropic/claude-haiku-4-5", "projectKind": "standard", "origin": { "kind": null, "pluginId": null } }
```

The tool was called and answered correctly on both `pi` (`anthropic/claude-haiku-4-5`)
and `codex` (`gpt-5.4-mini`, thread `thr_x5nwv4tt3a`, transcript line "Ran
hl_spike_ping"). `origin.pluginId` was `null` on CLI-spawned test threads (as
expected — CLI spawns are not attributed to a plugin) and `"hl-spike"` on
threads this plugin's own `bb.sdk.threads.spawn` created, matching the
`origin`/`originPluginId` auto-attribution documented for `threads.spawn`.

## Q7 — `files.write` CAS conflict + `rootPath` escape

**Verdict: both work exactly as documented.**

```json
{
  "firstWrite": { "outcome": "written", "sha256": "3bfc2695...388fe", "sizeBytes": 2 },
  "casConflict": { "outcome": "conflict", "currentSha256": "3bfc2695...388fe" },
  "rootPathEscape": { "outcome": "threw", "message": "HTTP 400: Path \"/tmp/hl-spike-filetest/../hl-spike-escape.txt\" escapes write root" }
}
```

A mismatched `expectedSha256` returns `{ outcome: "conflict", currentSha256 }`
(never throws) — exactly the discriminated-union shape in the bundled types
(`{outcome:"written", sha256, sizeBytes}` | `{outcome:"conflict",
currentSha256}`). A `rootPath`-escaping path (`../`) **throws** (HTTP 400
`escapes write root`) rather than returning a result — code calling
`files.write` under a `rootPath` confinement must wrap it in try/catch, not
just switch on `outcome`.

## Q8 — Frontend content script: `new Audio(url)` autoplay + Cmd+Shift+J keydown

Tested live in the bb desktop app (not headless), via a `homepageSection`
component (audio, since it needs a React `useRealtime` hook) and a
`contentScripts.register` keydown listener, both fetching back to plugin HTTP
routes so the result is server-verifiable evidence, not a visual guess.

**Audio autoplay: works, with no prior user gesture.**
`bb hl-spike chime` (server `bb.realtime.publish("hl-spike-chime", ...)`)
while the New Thread screen was open (no click, no keypress before the
signal) produced:

```json
{ "outcome": "resolved", "ts": 1788600479969 }
```

`new Audio(url).play()` resolved successfully — the bb desktop app does not
block autoplay-without-gesture for a plugin-triggered `Audio` element. This
was reproduced once cleanly; recommend the real notification code still
handle the rejected/`NotAllowedError` path defensively, since this is a single
observation on one machine/build, not a cross-platform guarantee.

**Keydown for Cmd+Shift+J: does NOT reach the page — verdict: does not work
as proposed, use a different shortcut.**
With composer focus confirmed (typed text landed in the composer, and a
plain "y" keypress in the same focus state logged
`{"key":"y","meta":false,"shift":false}` from a diagnostic catch-all
`document.addEventListener("keydown", ..., {capture:true})`), the exact same
listener recorded **zero** events for Cmd+Shift+J, repeated twice. Since the
listener is registered on `document` with `capture:true` (the first possible
observer in the DOM capture phase — nothing deeper in the tree can suppress
it from reaching `document`), the only explanation is that the combination
never reaches the renderer's DOM at all. Cmd+Shift+J is Chromium's built-in
"toggle DevTools JavaScript console" shortcut; Electron/Chromium-based apps
commonly reserve it at the browser-chrome layer before any page-level
listener runs. **Plan §5's ⌘⇧J stack notification shortcut needs a different
key combination** (or bb needs to be confirmed to explicitly override this
one at the app-shell level, which this spike found no evidence of). Recommend
picking a combo with no Chromium/OS reservation (e.g. avoid ⌘⇧I/J/C and
common browser bindings) and re-testing with this same harness before phase 7.

## Q9 — `threads.timeline(...)` `contextWindowUsage` shape

**Verdict: confirmed, matches plan §2.8 exactly.**

```json
{ "estimated": false, "modelContextWindow": 258400, "usedTokens": 39851 }
```

(and, from a second thread using a bigger/estimated model: `{ "estimated":
true, "modelContextWindow": 200000, "usedTokens": 105663 }`). Both fields plan
§2.8 needs (`usedTokens`/`modelContextWindow`) are present at
`timeline().contextWindowUsage`, plus an `estimated` boolean the plan does not
currently mention — worth surfacing in the context gauge tooltip ("estimated"
vs exact) rather than discarding it.

## Q10 — `threads.list({ originPluginId })` filtering

**Verdict: works, and confirms per-call attribution, not per-plugin-install
attribution.**

`bb.sdk.threads.list({ originPluginId: bb.pluginId, limit: 50 })` returned
exactly the 4 threads this plugin's own server code created via
`bb.sdk.threads.spawn` (`thr_7r2fxgck52`, `thr_8stzfxxk24`, `thr_vi5dqeh466`,
`thr_xi55gvudvb`) and correctly excluded the ~12 other test threads spawned
via `bb thread spawn` (the bb CLI) during this same spike, even though the
plugin was loaded and active for all of them. `originPluginId` is set once at
creation by whichever caller invoked `threads.spawn`
(`origin:"plugin", originPluginId:<id>` only for the plugin's own SDK calls;
`origin:"cli", originPluginId:null` for CLI-created threads) — it is not a
"threads this plugin can see/touch" filter. Plan §2.4's `launch_attempts`
recovery/adopt flow, which needs `threads.list({originPluginId,
parentThreadId?})` to find orphaned spawns, will only ever see threads this
plugin itself spawned via the SDK — exactly what it needs.

## Summary of plan changes required

1. **§2.1/§2.6 (contributeInstructions/configure):** add an explicit rule —
   every registered callback must be synchronous; back any state it reads
   with an in-memory mirror, never an `await` inside the callback. An async
   callback does not error visibly; it silently breaks provisioning for every
   thread on the bb instance. Add to phase 2 and phase 6 reviewer checklists.
2. **§2.5 (worktree timing):** after `threads.spawn` with a `managed-worktree`
   workspace, do not trust `environmentId` on the spawn response — always
   follow up with `threads.get({threadId, include:"environment"})` before
   persisting `worktree_environment_id`.
3. **§2.5 / spawn calls generally:** `projectId` is required on every
   `threads.spawn` call, including `environment:{type:"reuse", ...}` — it is
   not inferred from the environment.
4. **§5 (notifications, ⌘⇧J):** the proposed shortcut does not reach the page
   in this bb build (Chromium DevTools-console reservation). Pick a different
   combination and verify with the same catch-all-keydown-log technique
   before phase 7 is built.
5. **§2.3 (structured summary):** `lastAssistantText` was confirmed
   untruncated for a short reply; do a longer-reply check before phase 2
   ships the `first 600 chars` slice, since this spike only exercised a
   5-character reply.
6. No other plan assumption in §2/§3 was contradicted: `message.dispatch`
   wait+recheck, `files.write` CAS/rootPath, `interactions.list` payload
   shape, `thread:changed` change kinds, `timeline().contextWindowUsage`, and
   `threads.list({originPluginId})` all behaved exactly as the plan assumes.

## Environment notes (not plugin bugs, for awareness only)

- This bb build fails `managed-worktree` provisioning against two real repos
  (`alidade`, `atok`) with `text2.trim is not a function`, reproduced with a
  plain `bb thread spawn --new-environment worktree` and the hl-spike plugin
  disabled — a pre-existing bb-core issue, not something this plan can work
  around; flag it upstream before phase 5 needs real worktree provisioning to
  work reliably.
- `claude-code` OAuth is expired on this machine; the codex/claude-code
  approval-payload comparison in Q3 is one-provider-only until that is fixed.
