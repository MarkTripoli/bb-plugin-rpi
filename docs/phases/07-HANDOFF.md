# Phase 7 handoff (paused: all strong model routes exhausted)

State on pause (2026-09-05):
- main = 40e8e96 (Phases 1-6 merged, 111 tests).
- Phase 7 coded in this worktree at 2685f83 (117 tests, tsc/build clean). Astra review found 3 blocking + 7 should-fix (see thread thr_3mk6ccw9mf; full fix spec in /tmp/fix7.md, reproduced below).
- A partial fix (findings 1-3 in progress, ~87 lines across contract.ts, db.ts, notify.ts, sessions.ts) is in `git stash` ("phase7-fix-partial"). Inspect with `git stash show -p`; either continue from it or drop it and start the fix round clean from 2685f83.

Resume steps:
1. Working route: Codex resets Sep 12 01:57; or `claude login` for Sonnet 5 / Fable 5.1.
2. Spawn coder in env_4vhcjixuhq with the fix spec, then Astra/Fable confirmation review, then `--ff-only` merge to main.
3. Phase 8: PARITY.md, README, end-to-end evidence walk, stale worktree cleanup.

## Fix spec (from Astra review)
1. sessions.ts:842 (blocking): auto-advance launch failure must never leave the user uninformed. In the idle completion path: run the advance decision + claim; if the launch result is `failed` or `uncertain` (or throws), then in the same handler: clear/consume the suppression row for that turn key and emit ONE durable notification of kind `ready_after_failed_advance` (dedupe key `ready-recover:<thread>:<turnKey>`, toast body names the failed skill and offers Retry via the launch_attempts UI). Test: launch throws → exactly one notification row + hl:notify publish; second reconcile → nothing new.
2. sessions.ts:757 (blocking): ordering. Ready notifications may only be evaluated by the idle completion handler AFTER ingest/extract/advance-claim have run for that turn (so completed_turn_key and suppression are final). Reconcile-driven status changes to ready_for_input record the transition (hl_status/hl_status_at) but defer notification to the completion handler; if no completion handler will run (e.g. reconcile on reload finds a session already ready with a completed turn key never notified), the reconcile path emits using the persisted key. Implement as one function `deliverReadyIfDue(threadId)` called from both places, idempotent via dedupe. Test: reconcile observes ready before idle handler → one notification with the FINAL key, none with the previous key.
3. sessions.ts:757, notify.ts:190 (blocking): needs_approval: evaluate EVERY pending interaction id on each derived snapshot; dedupe per interaction id (`approval:<thread>:<interactionId>`); a second approval arriving while status stays needs_approval fires. Test.
4. ui/humanlayer.tsx:255: single hotkey owner: elect one bridge instance via a module-level owner token (first mounted wins, handoff on unmount); others never register keydown.
5. ui/humanlayer.tsx:187: editable detection via `target.isContentEditable || tagName in (INPUT, TEXTAREA, SELECT)`; hotkey matcher validates and checks every modifier (meta, ctrl, alt, shift) exactly against the configured combo.
6. ui/humanlayer.tsx:229: toast state tracks all active toast ids per thread; expired/clicked/viewed entries leave the jump queue; client-side dedupe set bounded (LRU 500).
7. sessions.ts:513: `hl_status_at` updates only when derived status changes.
8. server.ts:834: CLI `notifications list/test` args through strict zod; `test` uses a synthetic namespace (`test:<thread>:<ts>` dedupe key, never touching real suppression rows, publishes hl:notify with `synthetic: true` which the UI labels "Test").
9. ui/humanlayer.tsx:215: unlock = actually `play()` the audio muted (or volume 0) inside the gesture handler, set unlocked only on resolved promise; on rejection keep locked and show a hint in settings.
10. notify.ts:328: retention: keep `notifications` rows for threads whose session is not archived (sweep only archived-session rows older than 30d); sweep `notification_suppressions` rows older than 7d that are consumed or whose session is archived. Test the sweep predicate.

Then `npm test`, `npx tsc --noEmit`, `bb plugin build`; re-run the live auto-advance case plus a forced launch failure (e.g. bogus provider on the task) and show the recovery notification fires once. Append "Review fixes" to docs/phases/07-notifications.md (10 items → commits). Small commits. End with the last commit hash only.
