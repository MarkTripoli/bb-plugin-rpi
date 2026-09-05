# Phase 7: Notifications

## Shipped

- Added `notify.ts` as the notification decision boundary and server adapter.
- Added append-only `notifications` migration with durable dedupe keys so reloads do not re-fire decisions.
- Wired server-side decisions from derived `hl_status` transitions and human comments, then published `hl:notify` only when sound or toast is deliverable.
- Added `GET` and `HEAD /sound/notification.mp3` for `assets/notification.mp3` with the same security header discipline as artifact delivery.
- Added notification settings, defaults, host settings mirrors, and KV prefs persistence with zod validation.
- Added CLI support:
  - `bb humanlayer notifications list --limit N --json`
  - `bb humanlayer notifications test --thread <id> --json`
- Added the frontend notification bridge, sound playback, toast rendering via `sonner`, settings controls, ready/approval badges, unread dots, and jump hotkey fallback.

## Suppression Order

| Order | Rule | Implementation | Result |
| --- | --- | --- | --- |
| 1 | Already notified for `(thread_id, completed_turn_key)`, approval interaction id, or comment id | `notifications.dedupe_key UNIQUE` is checked before side effects | No sound, no toast, reason `already_notified` |
| 2 | Session owner check | N/A for this SDK surface. I did not find a current owner or lastActor field exposed to the plugin for these sessions. The adapter passes `owner: "unknown"` and `decideNotification` supports `not_owner` for the rule when the SDK exposes it. | Rule documented as N/A for now |
| 3 | Auto-advance suppression | `consumeSuppression(threadId, completedTurnKey)` is called only after dedupe misses and only for ready transitions | No sound, no toast, reason `auto_advance_suppressed` |
| 4 | User is viewing the session | `setViewingSession` keeps a mounted-session set in server memory | Sound follows prefs, toast is skipped, reason `viewing_session` |

After those rules, user prefs apply:

- `enabled: false` mutes both sound and toast.
- Per-kind sound toggles gate sound for `ready_for_input`, `needs_approval`, and `comment`.
- Per-kind toast toggles gate toast for the same kinds.
- Volume clamps to `0..1`, default `0.2`.

## Trigger Semantics

- `running` or any non-ready state to `ready_for_input` fires once per `completed_turn_key`.
- `ready_for_input` to `ready_for_input` is not a trigger.
- A later return to `ready_for_input` with a new `completed_turn_key` is a new notification.
- `needs_approval` fires on a derived status transition when a pending approval interaction id is present.
- Human comments fire when `createdByAgent` is false. Agent comments do not trigger.
- Needs-approval tool names format `mcp__a__b` as `a:b`; tool input is reduced to one line before truncation.

## Autoplay And Sound

The frontend keeps one reusable `Audio` element for `/api/v1/plugins/humanlayer/http/sound/notification.mp3`. It is created after the first `pointerdown` or `keydown`, matching browser autoplay policy. If playback is still blocked, the UI emits a toast explaining that the Test sound button unlocks playback.

Sound playback is throttled to at most one chime every 500 ms. The settings tab includes Test sound, and the volume slider previews through the same playback route.

## Hotkey

Default: `mod+shift+u`.

Spike Q7 showed `Cmd Shift J` is eaten by Chromium, so the settings tab includes that conflict note and stores the configurable hotkey in prefs.

I did not find a plugin SDK keybinding registration surface in the inspected frontend references, so the implementation uses a document `keydown` listener scoped to the mounted HumanLayer panel. It ignores editable targets and cycles through `ready_for_input` and `needs_approval` sessions ordered by `hlStatusAt`.

## Status Visuals

- `ready_for_input`: destructive attention glyph.
- `needs_approval`: warning triangle glyph.
- `running` and `launching`: success token with pulse.
- Task rows and the Sessions tab show a destructive dot when any session in the task needs attention.

All new frontend colors use host token classes.

## Verification

### Local checks

`npm test`

```text
117 pass
0 fail
```

`bb plugin build`

```text
Built server: dist/server.js
Built frontend: dist/app.js
Build completed successfully
```

`git diff --check`

```text
clean
```

### Live install

Installed and reloaded from this worktree:

```text
bb plugin install . --yes
bb plugin reload humanlayer
```

The plugin reported `humanlayer@0.1.0 running`.

### Sound route

`curl -sI http://127.0.0.1:38886/api/v1/plugins/humanlayer/http/sound/notification.mp3`

```text
HTTP/1.1 200 OK
cache-control: no-store
content-length: 2934
content-security-policy: sandbox; default-src 'none'
content-type: audio/mpeg
x-content-type-options: nosniff
```

### Freeform ready notification

Created a freeform task with Codex `gpt-5.4-mini`:

```text
taskId=47576472-04b8-4cb6-82fd-94d7b948daa9
threadId=thr_xvrhxngcqn
```

After `bb thread wait thr_xvrhxngcqn --status idle --timeout 180000`, the session derived `ready_for_input` with summary `ack`.

`bb humanlayer notifications list --limit 5 --json` included:

```json
{
  "threadId": "thr_xvrhxngcqn",
  "kind": "ready_for_input",
  "dedupeKey": "ready:thr_xvrhxngcqn:events:1788621938290",
  "reason": "notify",
  "sound": true,
  "toastTitle": "ready_for_input",
  "toastBody": "Phase 7 notification smoke",
  "deliveredAt": 1788621938536
}
```

Reloading the plugin did not add another notification row for that dedupe key.

The synthetic CLI path honored suppression:

```text
bb humanlayer notifications test --thread thr_xvrhxngcqn --json
{"decision":{"sound":false,"toast":null,"reason":"already_notified"}}
```

### Auto-advance suppression

Created an `outline_only` auto-advance task and launched `create-research-questions`:

```text
taskId=bfad32d4-aa81-40b7-b75c-319c65674330
questionsThread=thr_znxkecfj5t
researchThread=thr_7w4kmneh35
```

The intermediate ready state was suppressed:

```json
{
  "threadId": "thr_znxkecfj5t",
  "completedTurnKey": "events:1788622035188",
  "reason": "auto_advance",
  "consumedAt": 1788622035552
}
```

The notification log recorded:

```json
{
  "threadId": "thr_znxkecfj5t",
  "kind": "ready_for_input",
  "dedupeKey": "ready:thr_znxkecfj5t:events:1788622035188",
  "reason": "auto_advance_suppressed",
  "sound": false,
  "toastTitle": null,
  "toastBody": null,
  "deliveredAt": null
}
```

The requested final gate notification was not observed. `thr_7w4kmneh35` remained `active` with `activeBackgroundAgentCount: 0`, `queuedMessageCount: 0`, and no newer notification rows during the live check.

## Deviations

- The owner or lastActor suppression rule is implemented in the pure decision function, but is treated as N/A in the server adapter because no current bb owner or lastActor concept was exposed by the SDK surfaces inspected for this phase.
- I did not publish no-op `hl:notify` events for suppressed decisions. They are recorded in the durable `notifications` table and available through the CLI. The UI only needs events that can produce sound or toast.
- `docs/research/shots/23-general-2.png` was referenced by the phase request but was not present in this worktree; `24-keybindings.png` and `40-hotkeys.png` were present and inspected.
- The SDK keybinding surface was not found in the inspected plugin authoring refs, so the hotkey uses the documented panel-scoped `keydown` fallback.

## Reviewer Open Items

- Re-run the live auto-advance final gate once the spawned research thread can complete, and confirm it records a delivered `ready_for_input` or `needs_approval` notification after the suppressed questions gate.
- Add the owner or lastActor server adapter once bb exposes that identity on sessions or threads.
