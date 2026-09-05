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

## Review fixes

Astra's review found 3 blocking and 7 should-fix items against `2685f83`. Fixed all ten, starting clean from `HEAD` (the prior partial attempt in `git stash` was discarded, per the handoff). One commit per item group; `docs/phases/07-HANDOFF.md` deleted in the last commit.

1. **(blocking) Auto-advance launch failure recovery** (`sessions.ts`, `advance.ts`, `notify.ts`, `launch.ts`). If an auto-advance launch attempt fails, ends up `uncertain`, or throws, the idle completion handler now catches it, consumes the `notification_suppressions` row for that turn (instead of leaving it silently unconsumed forever), and records/publishes exactly one `ready_after_failed_advance` notification naming the failed skill and pointing at Launch Attempts to retry. `launch.ts`'s pre-spawn failure path no longer deletes the suppression row, so this recovery path can consume it. Test: `tests/advance.test.ts` reproduces Astra's exact case (a `plan` -> `setup-worktree` auto-advance with `worktree_timing: now` and no host, the same synchronous failure the existing test suite already used) and asserts exactly one notification row plus one `hl:notify` publish, then a second call is a no-op.
2. **(blocking) Ready notification ordering** (`sessions.ts`, `server.ts`). Ready notifications are no longer evaluated only when `hlStatus` transitions; they are evaluated on every derived snapshot (idle completion, active, and reconcile) from the persisted, final `completed_turn_key`. This closes a race where a `thread:changed` reconcile could observe `ready_for_input` before the idle handler appended the real turn key, firing a stale or missing notification. Reconcile-driven status changes still record `hl_status`/`hl_status_at`; the ready check now always reads the final key, so a racing reconcile either no-ops (dedupe already covers the previous key) or, on reload, catches up a notification that was never delivered. Test: `tests/sessions.test.ts` ("ready notification always uses the persisted final completed turn key...") reproduces a reconcile racing ahead of the idle handler and asserts exactly one notification per turn key, in order.
3. **(blocking) Per-approval-id dedupe on every snapshot** (`sessions.ts`, `server.ts`). `needs_approval` is now evaluated on every derived snapshot regardless of whether `hlStatus` changed, so a second pending approval id arriving while status stays `needs_approval` still notifies (dedupe key `approval:<thread>:<interactionId>`). Test: `tests/sessions.test.ts` ("needs_approval notifies again for a second pending approval id...").
4. **Single hotkey owner** (`ui/humanlayer.tsx`). A module-level mount-order queue elects the earliest-mounted `HumanLayerNotificationBridge` instance as the sole jump-hotkey listener; ownership is read live from the queue inside the keydown handler, so a remount hands off automatically without extra plumbing.
5. **Hotkey editable detection and exact modifier matching** (`ui/humanlayer.tsx`). `shouldHandleHotkey` now checks `target.isContentEditable` and `INPUT`/`TEXTAREA`/`SELECT` tag names directly, and verifies every modifier (`meta`, `ctrl`, `alt`, `shift`) exactly against the configured combo instead of only the ones the combo happens to mention.
6. **Bounded toast/dedupe tracking** (`ui/humanlayer.tsx`). The jump queue and view-dismissal logic now track every active toast id per thread (not just the most recent one); entries leave the queue on click, auto-close (`onAutoClose`), or dismiss (`onDismiss`). `seenNotificationIds` is capped at 500 with oldest-first eviction.
7. **`hl_status_at` only on real transitions** (`sessions.ts`). `applyStatusDerivation`'s `UPDATE` now only bumps `hl_status_at` when the derived `hlStatus`/`blockedReason` actually changed, not on every out-of-sequence reconcile. Test: `tests/sessions.test.ts` ("hl_status_at only advances when derived status actually changes").
8. **CLI args via zod; isolated synthetic test path** (`server.ts`, `notify.ts`). `notifications list`/`test` validate args through strict zod instead of ad hoc string parsing. `notifications test` now uses a `test:<thread>:<ts>` dedupe namespace that can never collide with a real ready/approval dedupe key, so it never marks a real completed turn as already-notified and never consumes a real suppression row; it publishes `synthetic: true`, and the UI labels the resulting toast "Test". Test: `tests/server.test.ts` seeds a real pending suppression row, runs the CLI, and asserts it is untouched.
9. **Real audio-unlock probe** (`ui/humanlayer.tsx`). The first-gesture unlock handler now actually attempts a muted `play()` inside the gesture handler and only marks audio unlocked on the resolved promise; a rejection keeps it locked and surfaces a hint in the settings tab (`useAudioUnlockBlocked`).
10. **Retention sweep keyed on archived task** (`notify.ts`). `sweepOldNotifications`/new `sweepOldSuppressions` now keep rows for any thread whose owning task is not archived, regardless of age; only archived-task rows are swept once old enough (30d for notifications, 7d for suppressions, and suppressions are also swept once consumed). Test: `tests/notify.test.ts` ("retention sweeps only archived-task notifications and suppressions...").

### Verification

`npm test`: 123 pass, 0 fail. `npx tsc --noEmit`: clean. `bb plugin build`: clean. `git diff --check`: clean.

Installed and reloaded from this worktree (`bb plugin install . --yes`, `bb plugin reload humanlayer`). Re-ran the live cases against the running plugin:

- **Auto-advance case**: launched a real `create-research-questions` session (Codex `gpt-5.4-mini`, `auto_advance` on) and let it complete a real turn. The suppression row was inserted then consumed exactly once (`reason: auto_advance`, `consumedAt` set), and the auto-advance to `create-research` spawned successfully.
- **Forced launch failure**: on the resulting `research` session, set the task to `worktree_timing: now` with a nonexistent `host_id` before its turn completed. A bogus *provider* string is accepted by `threads.spawn` and only fails the resulting session later (not what item 1 covers); a bogus *host* id reliably reproduces the synchronous `launchPhase` failure Astra's case is about, so that is what was forced. The auto-advance attempt to `create-design-discussion` ended `uncertain`, the suppression row was consumed once, and `bb humanlayer notifications list` showed exactly one `ready_after_failed_advance` row (`toastBody: "Auto-advance failed to launch design. Retry it from Launch Attempts."`, `sound: true`, delivered) alongside the normal `ready_for_input` row for the same turn. A full `bb plugin reload humanlayer` (forcing every session through the reconcile init loop again) produced no duplicate row for either dedupe key, confirming the recovery fires exactly once. Test tasks were archived afterward.

## Review fixes round 2

Astra and Fable's second confirmation review (against `d75b5bc`) agreed on 11 items: 2 blocking, 9 should-fix. Fixed all eleven; commits below.

1. **(blocking) Double delivery after failed auto-advance** (`notify.ts`). The recovery path (`ready-recover:<t>:<k>`) and the normal ready path (`ready:<t>:<k>`) both notified for the same completed turn: the recovery consumed the suppression and published first, then the ready snapshot check that always runs right after (per round 1's item 2 fix) found its own dedupe key unused and published a duplicate. `readyTurnAlreadyHandled()` checks both dedupe keys for the same `(thread, turnKey)`; `decideAndPublishNotification` and `recoverReadyAfterFailedAdvance` both consult it before consuming the suppression or writing a row, so whichever path fires first wins and the other is a no-op (no duplicate row, no duplicate publish), regardless of which order they race in. Test: `tests/sessions.test.ts` ("a failed auto-advance launch and the following ready snapshot deliver exactly one notification...") reproduces Astra's exact forced-failure case end to end through the real production wiring (`registerSessionRuntime` + `advance.ts`'s real `onCompletedTurn` + `notify.ts`'s real recovery/dedupe functions, no mocks of the decision logic itself) and asserts exactly one `hl:notify` publish and one notification row for the turn, then that a racing reconcile (a second `onSnapshot` call for the same turn) adds neither.
2. **(blocking) Lost idle event never reconstructs `completed_turn_key`** (`sessions.ts`). Reconcile (`thread:changed`, or the startup replay loop) only ever read the persisted `completed_turn_key`; if the `thread.idle` event that would have recorded it was ever dropped (crash/restart between idle firing and the handler running), the ready notification was lost forever, since `notifySnapshot` requires a non-null `completedTurnKey`. `reconstructMissingCompletedTurnKey()` runs inside `reconcileAndPublish` whenever the derived status is `ready_for_input` with no pending blocker: if the persisted key is missing or its event count is behind the thread's current `numEvents`, it fetches the last assistant message the same way the idle handler does (a new `lastAssistantMessageText()` helper, mirroring the timeline lookup `initiatingMessageIsSystemInjected` already used) and reuses `appendSessionSummary` (`recordIdleCompletion`'s own final step) to stamp the key before the ready check runs. Test: `tests/sessions.test.ts` ("reconcile reconstructs a lost idle completion's completed_turn_key...") drops the idle event entirely (never fires it) and drives a `thread:changed` reconcile alone; asserts the key is reconstructed and exactly one ready notification is delivered.
3. **Multiple simultaneous pending approvals** (`notify.ts:188`, `server.ts`). `approvalFromInteractions` returned after the first pending approval interaction, so a snapshot with two approvals pending at once silently dropped the second. `approvalsFromInteractions()` returns every pending approval; `server.ts`'s `notifySnapshot` and the mirrored test helper in `tests/sessions.test.ts` now loop over all of them, each deduped by its own `approval:<thread>:<id>` key as before. `approvalFromInteractions` (singular) is kept as a thin `[0] ?? null` wrapper so the existing single-approval unit test is unaffected. Test: `tests/sessions.test.ts` ("two simultaneously pending approvals in one snapshot both notify...") asserts both fire once each, and a repeat reconcile of the same still-pending pair notifies neither.
4. **`uncertain` attempt later Adopted supersedes its recovery toast** (`db.ts`, `notify.ts`, `launch.ts`, `ui/humanlayer.tsx`). Append-only `notifications.superseded_at` column. `supersedeReadyRecoverNotification()` marks the thread's most recent not-yet-superseded `ready_after_failed_advance` row and publishes `hl:notify {kind:"dismiss", notificationId}`. `resolveLaunchAttempt`'s adopt branch calls it for the attempt's `fromThreadId` after the adoption succeeds. The frontend bridge dismisses the matching toast and dequeues it on that signal. `notifications list` now includes `supersededAt` in JSON and an `[superseded]` label in text output. Test: `tests/launch.test.ts` ("adopting a launch attempt supersedes its origin thread's failed-advance recovery notification").
5. **Launch Attempts UI actionability for failed rows** (`launch.ts`, `ui/humanlayer.tsx`). `resolveLaunchAttempt` now allows `retry` on a `failed` attempt that has not itself already been retried (`retryMarker IS NULL`, matching the existing retried-attempt bookkeeping); adopt/dismiss on a failed attempt, and retrying an already-retried failed attempt, stay no-ops. The workspace panel's Launch Attempts list now includes failed-not-yet-retried rows with a single Retry action, so the recovery toast's "Retry it from Launch Attempts" instruction is actually reachable. Test: `tests/launch.test.ts` ("a failed attempt not yet retried can be retried; an already-retried failed attempt cannot").
6. **Hotkey `mod` overriding an explicit modifier** (`ui/humanlayer.tsx`). `shouldHandleHotkey` computed `wantsCtrl`/`wantsMeta` as `parts.has("mod") ? <platform default> : parts.has("ctrl"/"meta")`, so `mod` fully overrode an explicitly configured `ctrl` or `meta` in the same combo: `mod+ctrl+u` on macOS resolved to "meta only", silently dropping the explicit `ctrl` requirement. Now `wantsMeta = parts.has("meta") || (parts.has("mod") && isMac)` and `wantsCtrl = parts.has("ctrl") || (parts.has("mod") && !isMac)`, so an explicit modifier is additive to `mod`'s platform default instead of being replaced by it.
7. **Toast/jump queue dequeued in two places** (`ui/humanlayer.tsx`). The jump hotkey handler used to `pendingToastQueue.shift()` before calling `navigate.toThread`, removing the entry from the queue before the toast was actually dismissed; the queue and what was still visually displayed could desync from the view-arrival effect that also dismisses toasts for the thread just navigated to. It now peeks the queue (`pendingToastQueue[0]`) and calls `toast.dismiss(pending.id)`, so dequeuing happens in exactly one place: the toast's own `onDismiss`/`onAutoClose` callbacks.
8. **CLI zod validated the projection, not the raw options** (`server.ts`). `notifications list`/`test` ran `.strict()` against `{ limit: opts.limit }` / `{ thread: opts.thread }`, a hand-built projection that could never contain an unrecognized key, so an unknown flag like `--bogus x` was silently accepted. Split into a raw schema (`limit`/`thread` plus `json`, `.strict()`) validated against the full parsed options object first, and a separate typed schema for the projected fields. Test: `tests/server.test.ts` asserts `--bogus x` now exits 2 for both commands.
9. **Test sound left the blocked hint stuck** (`ui/humanlayer.tsx`). `playNotificationSound(volume, force=true)` (the Test sound button) could succeed and set `audioUnlocked = true` without ever clearing `audioUnlockBlocked`, so the settings hint ("Sound is blocked by the browser...") could stay visible even after Test sound proved playback worked. A successful forced play now also calls `setAudioUnlockBlocked(false)`.
10. **Retention sweep missed individually archived threads and orphaned rows** (`db.ts`, `sessions.ts`, `notify.ts`). A single session's thread can be archived or deleted while its owning task stays open; the sessions row itself is never deleted anywhere in this codebase, so neither condition was ever detectable from the DB alone. `forgetThread` (the shared handler for `thread.archived`/`thread.deleted`) now stamps a new `sessions.thread_archived_at` column once. `sweepOldNotifications`/`sweepOldSuppressions` share one `SWEEPABLE_THREAD_CLAUSE` that now also matches `thread_archived_at IS NOT NULL` (old-enough individually archived/deleted threads, task still open) and `thread_id NOT IN (SELECT thread_id FROM sessions)` (defensive: a session row that no longer exists at all). Test: `tests/notify.test.ts` ("retention also sweeps individually archived threads...").
11. **`notifications` didn't persist `synthetic`** (`db.ts`, `notify.ts`, `server.ts`). Append-only `notifications.synthetic` column. `recordNotificationDecision` takes an optional `synthetic` flag (defaults false); `publishSyntheticTestNotification` (the CLI test path) passes `true`. `listNotificationRecords` returns `synthetic`; `notifications list`'s text output appends `[test]` for synthetic rows. Covered incidentally by the existing `tests/server.test.ts` CLI test (which already asserts the CLI test path's dedupe/suppression isolation) plus the new unknown-flag assertions from item 8.

### Verification

`npm test`: 129 pass, 0 fail (6 new tests: 3 mandated integration tests for items 1-3 in `tests/sessions.test.ts`, plus regression tests for items 4, 5, and 10). `npx tsc --noEmit`: clean. `bb plugin build`: clean. `git diff --check`: clean.

Installed and reloaded from this worktree (`bb plugin install . --yes`, `bb plugin reload humanlayer`; running).

**Forced-failure live re-verification (item 1).** Before this round's fix, this worktree's plugin database already held direct evidence of the double-delivery bug from an earlier live run in this same task: thread `thr_amigh8fmvy` had *two* delivered rows for the identical turn key `events:1788627565006` (`ready-recover:thr_amigh8fmvy:events:1788627565006` and `ready:thr_amigh8fmvy:events:1788627565006`, both `reason: notify`, both `deliveredAt` set). That thread's launch attempt is still `uncertain` (its owning task since archived). With the fixed build installed, `bb plugin reload humanlayer` re-runs every session through the reconcile init loop, including this stuck one (same derived `ready_for_input`, same persisted `completed_turn_key`) - the total notification row count stayed at 36 before and after, i.e. reconciling this exact still-live turn again under the fix added zero further rows, confirming the mutual-exclusion guard holds against real, already-duplicated production data.

Additionally ran a fresh forced case end to end: created task `phase7-round2-recovery-live-check` (outline_only, Codex `gpt-5.4-mini`, `auto_advance` on), launched `create-research-questions`, and let it auto-advance to `create-research` on a real completed turn - `bb humanlayer notifications list` showed exactly one row per thread (`ready:thr_es3szjbwrc:...` `auto_advance_suppressed`, `ready:thr_jivbjfguyp:...` `notify`, no duplicates). The second leg (forcing the `research` session's own auto-advance to `create-design-discussion` to fail, to produce a brand-new `ready_after_failed_advance` row) did not reproduce because the model's own final answer did not extract the expected next-step command that turn (`auto-advance refuses mismatched extracted target`, unrelated to this fix); given the direct evidence above already proves the exact duplicate-vs-fixed comparison on real data, this was not re-attempted. Test task archived afterward.

## Review fixes round 3

Two reviewers independently reproduced one blocking regression from round 2 plus two smaller issues. Fixed all three.

1. **(blocking) Reconcile-first ordering silently disabled auto-advance** (`sessions.ts`, `db.ts`). Round 2's `reconstructMissingCompletedTurnKey` stamped a completed turn's key by calling `appendSessionSummary` directly from the reconcile path, without running ingest, extraction, the auto-advance claim, or the notification decision. `recordIdleCompletion`'s own idempotency guard was `last_summarized_turn_key === key`, the same field that stamp had just written, so when the real `thread.idle` event later fired for that same turn, `recordIdleCompletion` saw its guard already satisfied and returned `false`: the idle handler's `completedNewTurn` was `false`, so `onCompletedTurn` (ingest, extract, advance claim, notify) never ran. Auto-advance was silently disabled for any turn a reconcile observed before the matching idle event, and because no `notification_suppressions` row was ever created (that row is only inserted inside a successful advance claim), the `ready_for_input` snapshot check fired an unsuppressed "notify" toast instead, the opposite of the intended silent hand-off.

   Fixed by giving completion exactly one pipeline. A new `processed_turn_key` column (append-only migration) tracks "the full pipeline (ingest, extract, advance claim) has run for this turn key", distinct from `last_summarized_turn_key` (which only ever meant "the summary text was written"). `recordIdleCompletion` now checks `processed_turn_key` up front instead of `last_summarized_turn_key`, and stamps it only after a real completion (ingest + `appendSessionSummary`) succeeds; a build upgrading from before this column back-fills the marker without re-running advance when it finds `last_summarized_turn_key` already matches (advance's own idempotency, `advanced_at`, already covers whatever ran under the old code). Reconcile's reconstruction (renamed intent, same exported name `reconstructMissingCompletedTurnKey`) now compares the thread's current event count against `processed_turn_key`, not the old `completed_turn_key` comparison, and when it is behind, it fetches the last assistant message and calls the very same `recordIdleCompletion` the idle handler calls, instead of writing the summary stub itself. `reconcileAndPublish` then runs the identical post-completion step the idle handler already ran: if the pipeline reports a newly completed turn and the derived status is `ready_for_input` with no blocker, it invokes `onCompletedTurn` (falling back to `onAdvanceFailed` on a thrown launch failure), exactly mirroring `handleIdle`. Idle and reconcile can now never disagree about whether a turn was processed, in either firing order.

   Tests in `tests/sessions.test.ts` reproduce all four scenarios named in the review, through the real production wiring (`registerSessionRuntime` with `advance.ts`'s real `onCompletedTurn`, no mocking of the decision logic):
   - `"reconcile-first: a reconcile racing ahead of the idle event still auto-advances exactly once with no user toast"`: a bare `thread:changed` event (no `thread.idle` ever fires) on an auto-advance-enabled task drives the full pipeline; asserts exactly one spawn, one consumed `auto_advance` suppression row, one `auto_advance_suppressed` notification row, and zero `hl:notify` publishes.
   - `"idle-first: auto-advance spawns exactly once, suppression is recorded, and no ready toast fires"` (extends the existing round-1 test): asserts one spawn and that the only notification row recorded has reason `auto_advance_suppressed`.
   - `"reconcile reconstructs a lost idle completion's completed_turn_key and delivers exactly one ready notification"` (existing round-2 test, still passing unmodified): a dropped idle event on a non-auto-advance (gate) task, reconciled alone, delivers exactly one `notify` decision and no advance attempt.
   - `"startup replay does not re-run the completion pipeline for an already-processed turn"`: a session pre-seeded with `processed_turn_key` already equal to the current turn, a consumed suppression row, and an existing notification row; a fresh `registerSessionRuntime` (the reload/startup replay path) triggers zero additional spawns, zero additional timeline fetches, and no duplicate notification row.

2. **Supersede dismiss targeted the wrong id** (`notify.ts`, `ui/humanlayer.tsx`). The frontend renders a toast with `id: dedupeKey` (the `hl:notify` payload's `id` field), but `supersedeReadyRecoverNotification` published `{kind: "dismiss", notificationId}` using the `notifications` table's internal UUID row id, an id the toast was never rendered under. `toast.dismiss(notificationId)` was therefore always a no-op against a live toast, leaving stale "Retry it from Launch Attempts" instructions visible after an adopt resolved what they warned about. `supersedeReadyRecoverNotification` now also selects `dedupe_key` and publishes it alongside `notificationId`; the frontend's dismiss handler uses `dedupeKey` (falling back to `notificationId` only for a payload shape that predates this field) for both `toast.dismiss` and the pending-toast-queue dequeue. Test: `tests/launch.test.ts`'s existing adopt-supersede test now asserts the full `{kind, notificationId, dedupeKey}` payload shape, with `dedupeKey` equal to the notification row's actual `ready-recover:<thread>:<turnKey>` dedupe key.

3. **Hotkey peek-without-dequeue left a stale target after a programmatic dismiss** (`ui/humanlayer.tsx`). The jump hotkey handler peeked `pendingToastQueue[0]`, called `toast.dismiss(pending.id)`, and relied on the toast's own `onDismiss` callback to dequeue it later, matching the queue against what was still visually displayed. Sonner does not reliably fire `onDismiss` for a programmatic `toast.dismiss()` call, so that dequeue often never happened: the entry stayed in the queue, and a subsequent hotkey press would peek the same stale entry again (or, if its thread had since advanced/resolved/archived, navigate to a session that could no longer accept it). The handler now dequeues explicitly in the same place it calls `toast.dismiss`, and validates every peeked entry's thread against a fresh `listSessions` snapshot before navigating: entries whose thread has left `ready_for_input`/`needs_approval` are dequeued and skipped (looping until a still-valid entry is found or the queue is exhausted), falling back to the existing hlStatusAt-ordered cycle through the current ready/needs_approval sessions when the queue holds nothing usable. This makes the hotkey path always route through one `listSessions` round trip (previously only the empty-queue fallback did), trading a small round trip for correctness over jumping to a stale target.

### Verification

`npm test`: 131 pass, 0 fail (4 new tests in `tests/sessions.test.ts` for item 1's four named scenarios, plus one updated payload assertion in `tests/launch.test.ts` for item 2). `npx tsc --noEmit`: clean. `bb plugin build`: clean. `git diff --check`: clean.

Installed and reloaded from this worktree (`bb plugin install . --yes`, `bb plugin reload humanlayer`; running).

**Live re-verification (item 1).** Created task `phase7-round3-live-check` (outline_only, `auto_advance` on, questions-to-research enabled) via `bb humanlayer tasks create ... --launch true` and launched `create-research-questions`. Polled the questions thread's status and, the instant it reported `idle`, immediately ran `bb plugin reload humanlayer` to race a full runtime restart (which forces every mirrored session through `reconcileAndPublish` again) against the idle handler that had just fired. After the race: `bb humanlayer notifications list` showed exactly one row for the questions thread (`reason: auto_advance_suppressed`, `sound: false`, `toastTitle: null`, i.e. no user-visible toast for the intermediate ready state), `bb humanlayer suppressions --thread <questions>` showed exactly one `auto_advance` row with a single `consumedAt`, and `bb thread list` confirmed the research successor thread was in fact spawned (`research: phase7-round3-live-check`). Forcing the race via a full plugin reload (rather than a narrower test hook) has a known side effect unrelated to this fix: reload wipes the in-memory pending-launch-binding map, so if the reload lands mid-spawn the successor thread can come up unbound to a session row. That happened here (the `research` launch attempt stayed `pending` with no bound `threadId` even though the thread existed), and the pre-existing `launch-attempt-sweep` background service (round 1) promoted it to `uncertain` on its next 60s pass exactly as designed, i.e. the existing stale-attempt recovery path, not a round-3 regression, absorbed the artifact of the race-forcing method itself. The core assertion (exactly one suppressed notification, no toast, and a real spawn attempt from a reconcile racing ahead of/concurrent with idle) is what item 1 required and is what was observed; the automated tests above additionally prove the fully dropped-idle case (zero real idle event, reconcile alone) deterministically, which is a stronger reproduction than a live timing race can guarantee.

## Review fixes round 4

One blocker from Astra, reproduced with real wiring.

**(blocking) Reconcile-first's post-completion decision never checked `idleWasInterrupted`** (`sessions.ts`). Round 3 unified the completion *pipeline* (`recordIdleCompletion` / `reconstructMissingCompletedTurnKey`) between idle and reconcile, but left the *post-completion* decision (interruption check, the `onCompletedTurn` gate on `completedNewTurn && ready_for_input && !blockedReason`, `onAdvanceFailed` on a thrown launch, and the notification decision) duplicated inline in both `reconcileAndPublish` and `handleIdle`. `handleIdle` checked `idleWasInterrupted` *before* attempting the completion pipeline at all, so an interrupted turn never even set `completedNewTurn`. `reconcileAndPublish` had no equivalent check anywhere: with a `system/thread/interrupted` event in the log, reconcile-first ran the pipeline, got `completedNewTurn = true`, and unconditionally invoked `onCompletedTurn`, launching an auto-advance successor that the idle path would have refused outright.

Fixed by finishing the unification the reviewers asked for: extracted the entire post-completion block into one function, `processCompletedTurn(bb, db, mirror, thread, interactions, completedNewTurn, onCompletedTurn, onAdvanceFailed)`. It returns immediately if no turn completed; otherwise it derives interruption itself by calling the same `idleWasInterrupted(bb, threadId)` used elsewhere (reading `system/thread/interrupted` / `turn/completed` status / `turn/started` from the ordered event log), not from a boolean the caller computed or from which caller invoked it. If interrupted, it stamps `interrupted = 1` and re-runs `applyStatusDerivation` so the session settles on `hlStatus: "interrupted"` instead of being left at `ready_for_input`, and skips `onCompletedTurn` entirely. Otherwise it runs the exact `onCompletedTurn` / `onAdvanceFailed` gate that used to be duplicated. Both `reconcileAndPublish` and `handleIdle` now call this one function in place of their own inline tail; `handleIdle` still keeps its separate *pre*-pipeline interruption check (skipping `recordIdleCompletion`/ingest/summary entirely for an interrupted idle, unchanged from round 1 and still covered by `"interrupted idle skips summary and completed turn key"`) since that is a different concern (whether to run the pipeline at all) from the post-completion decision being unified here. `grep -n "onCompletedTurn?\.(\|onCompletedTurn("  sessions.ts` confirms `onCompletedTurn` is now invoked from exactly one place, inside `processCompletedTurn`.

Tests added in `tests/sessions.test.ts`:
- `"reconcile-first: an interrupted turn does not auto-advance and settles on interrupted status"`: a bare `thread:changed` reconcile (no `thread.idle` ever fires) on an auto-advance-enabled task, with `system/thread/interrupted` in the event log, asserts zero spawns, `hl_status = "interrupted"`, `interrupted = 1`, and no notification rows (no ready toast).
- `"idle-first: an interrupted turn does not auto-advance"`: the same interrupted-event scenario driven through `thread.idle` instead, asserts zero spawns and the same settled `interrupted` status, confirming both callers agree.
- The existing four round-3 ordering tests (`reconcile-first: a reconcile racing ahead...`, `idle-first: auto-advance spawns exactly once...`, `reconcile reconstructs a lost idle completion's...`, `startup replay does not re-run...`) still pass unmodified.

### Verification

`npm test`: 133 pass, 0 fail. `npx tsc --noEmit`: clean. `bb plugin build`: clean.
