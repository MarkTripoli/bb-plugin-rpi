# Phase 2: Sessions

## Shipped

- Added `sessions.ts` with pure `deriveStatus(thread, interactions, row)` covering Fable section 5.1 in order, with Astra amendments:
  - `lost` only comes from `runtime.displayStatus` evidence.
  - `user_question` and plugin waits derive `ready_for_input` and persist `blocked_reason`.
  - `had_turn` is set on `thread.active`.
  - user requested interrupts mark `interrupted` through the stop path.
- Added live session reconciliation:
  - in-memory `Map<threadId, SessionRow>` mirror loaded at plugin start,
  - `bb.sdk.subscribe({ event: "thread:changed" })` filters tracked session threads and derives on status, interaction, queue, and environment changes,
  - `thread.active`, `thread.idle`, and `thread.failed` listeners reconcile tracked sessions,
  - `thread.idle` appends `summary_json.summaryHistory` with the first 600 chars of `lastAssistantText`,
  - `bb.realtime.publish("rpi:sessions", { taskId, threadId })` fires after relevant updates.
- Added `launch.ts`:
  - freeform and oneshot draft launch only,
  - `worktree_timing=never` only for this phase,
  - `launch_attempts` pending to spawned or uncertain,
  - launch refusal while pending or uncertain attempts exist,
  - `threads.spawn` always passes `projectId`,
  - `threads.get({ include: "environment" })` is used after spawn before persisting `base_environment_id`,
  - draft state flips only in `launchDraft`.
- Added RPC:
  - `launchDraft`,
  - `listSessions`,
  - `getSession`,
  - `forkSession`,
  - `interruptSession`,
  - `listLaunchAttempts`,
  - `resolveLaunchAttempt`.
- Added `bb rpi` CLI:
  - `tasks create`,
  - `tasks list`,
  - `sessions list`.
- Added synchronous agent callbacks:
  - `bb.agents.configure` returns `tools: []` and `skills: []` for task sessions,
  - `bb.agents.contributeInstructions` returns the task instruction block from the in-memory mirror.
- Added disabled hydration hook path:
  - `HYDRATION_ENABLED = false`,
  - `message.dispatch` wait and recheck branch is present but inactive until Phase 3.
- Added frontend session surfaces:
  - task detail route at `tasks/<id>`,
  - Sessions table with HL status glyph text, title, label, working directory, and updated time,
  - Recover launch row for uncertain attempts with Adopt, Retry, and Dismiss,
  - thread header action with phase pill, HL status, Fork, and Interrupt,
  - module-level `viewing` set registration while task thread headers are mounted,
  - new task Create path for freeform and oneshot tasks with no worktree.

## Verification

Command:

```text
env npm_config_cache=/private/tmp/bb-plugin-rpi-npm-cache npm test
```

Excerpt:

```text
✔ deriveStatus covers Fable 5.1 rows in order
✔ lost is only derived from runtime displayStatus evidence
✔ user_question stores blocked reason for executor skip
✔ agent callbacks return non-Promise values
ℹ pass 13
ℹ fail 0
```

Command:

```text
env npm_config_cache=/private/tmp/bb-plugin-rpi-npm-cache npm run build
```

Excerpt:

```text
dist/server.js
dist/server.js.map
dist/server.meta.json
dist/app.js
dist/app.css
dist/app.meta.json
```

Live check:

```text
bb plugin install . --yes
bb rpi tasks create --name "Phase 2 live check" --project proj_v36xq75qse --prompt "Reply with a 1200 word plain-text test message about session status derivation. Do not run commands or edit files." --launch --provider codex --model gpt-5.4-mini --json
bb rpi sessions list --task ff37a82b-8d38-4ef3-a3cc-dbaf0def14ed --json
bb thread wait thr_yn8dm9ph32 --status idle --timeout 300 --json
bb rpi sessions list --task ff37a82b-8d38-4ef3-a3cc-dbaf0def14ed --json
bb thread output thr_yn8dm9ph32
wc -c /private/tmp/rpi-phase2-live-output.txt
bb thread archive thr_yn8dm9ph32
bb plugin remove rpi
```

Observed:

```text
{"taskId":"ff37a82b-8d38-4ef3-a3cc-dbaf0def14ed","threadId":"thr_yn8dm9ph32"}
rpiStatus "running", hadTurn true
thread wait matched idle
rpiStatus "ready_for_input", hadTurn true, blockedReason null
summary_json stored one 600-character summaryHistory entry
8584 bytes in final assistant output
Thread thr_yn8dm9ph32 archived
Removed rpi.
```

The multi-KB reply confirms `thread.idle.lastAssistantText` was not truncated for the summary path in this phase.

## Deviations

- RPI and PRD/TDD launch paths intentionally return `available in a later release`; Phase 2 only launches freeform and oneshot sessions.
- `worktree_timing=now` and `later` are rejected until Phase 5 worktree behavior ships.
- Hydration wait and recheck code is present but gated with `HYDRATION_ENABLED = false` until Phase 3.
- Recover launch Adopt currently accepts a thread id rather than rendering a candidate picker. The backend still validates candidates through `threads.list({ originPluginId, parentThreadId? })` and created-at filtering.
- `configure` selects no tools because no `rpi_*` tools are registered until later phases.

## Reviewer Notes

- Review that `deriveStatus` order matches Fable 5.1 plus the Astra amendments.
- Check that no status path invents `lost` without `runtime.displayStatus` evidence.
- Check that launch attempts require explicit recovery after `uncertain`.
- Check that `bb.agents.configure` and `bb.agents.contributeInstructions` remain synchronous and mirror-backed.

## Review fixes

Commit: `d2ffad5139454288339cb4d0f21f35b4ffb304d0`

- Finding 1: added launch correlation markers, pre-spawn pending bindings, earliest dispatch/spawn-return binding, and buffered lifecycle replay.
- Finding 2: restored active-only interaction precedence while preserving idle `user_question` blocked reasons.
- Finding 3: serialized reconciliation per thread and persisted monotonic `last_reconcile_seq`, with stale-snapshot refusal.
- Finding 4: gated summaries behind completed non-blocked idle turns, deduped by `last_summarized_turn_key`, and added `completed_turn_key`.
- Finding 5: made adoption reject already-bound threads transactionally, persist `base_environment_id`, insert the session, mark the attempt spawned, and reconcile.
- Finding 6: made retry/adopt/dismiss claim only unresolved attempts and return current state for resolved replays.
- Finding 7: added startup and 60s stale pending launch sweep, and rendered pending rows as `launching...`.
- Finding 8: changed interrupted derivation to ordered recent thread events instead of cached display status.
- Finding 9: added the gated hydration `hydrateSession` stub path that sets `hydrated_at`, logs, proceeds on failure, and waits once per thread.
- Finding 10: bounded `sessions list` with `--limit` default 50 and `--offset`, and truncated CLI summary history to the last 3 entries of 200 chars.

Verification after fixes:

```text
npm test
...
tests 22
pass 22
fail 0
```

```text
npx tsc --noEmit
exit 0
```

```text
bb plugin build
dist/server.js
dist/server.js.map
dist/server.meta.json
dist/app.js
dist/app.css
dist/app.meta.json
```

Live check:

```text
bb plugin install . --yes
Installed:
rpi@0.1.0  running
  service launch-attempt-sweep: running

bb rpi tasks create --name "Phase 2 review fixes live check" --project proj_v36xq75qse --prompt "Reply with a short plain-text confirmation that the RPI session status live check reached the model. Do not run commands or edit files." --launch --provider codex --model gpt-5.4-mini --json
{"taskId":"ff22ec4f-f617-4b41-af2c-cdf4c9ddf48b","threadId":"thr_628nfms6n4"}

bb rpi sessions list --task ff22ec4f-f617-4b41-af2c-cdf4c9ddf48b --json
rpiStatus "running", hadTurn true, lastReconcileSeq 4

bb thread wait thr_628nfms6n4 --status idle --timeout 300 --json
"matched": true

bb rpi sessions list --task ff22ec4f-f617-4b41-af2c-cdf4c9ddf48b --json
rpiStatus "ready_for_input", summaryHistory ["RPI session status live check reached the model."], completedTurnKey "events:1788605291970"

bb thread output thr_628nfms6n4
RPI session status live check reached the model.

bb thread archive thr_628nfms6n4
Thread thr_628nfms6n4 archived

bb plugin remove rpi
Removed rpi.
```

## Review fixes round 2

Commit: `65f2074549133b97f6e6cc3b41af52e1ece94fe5`

- Seeded runtime reconcile sequencing from persisted `MAX(last_reconcile_seq) + 1` so reloads cannot reject fresh snapshots as stale.
- Serialized buffered active/idle/failed/changed replay through the per-thread chain, and dropped idle chains after commit.
- Checked interrupted idle events before writing summaries or `completed_turn_key`.
- Cleared dismissed/retried/adopted launch bindings and made late spawn binding conditional on winning `pending|uncertain -> spawned`.
- Evicted runtime mirrors, buffers, pending thread bindings, and chains on `thread.archived` and `thread.deleted` while retaining the DB row.

Verification:

```text
npm test
tests 29
pass 29
fail 0
```

```text
npx tsc --noEmit
TypeScript: No errors found
```

```text
bb plugin build
dist/server.js
dist/server.js.map
dist/server.meta.json
dist/app.js
dist/app.css
dist/app.meta.json
```
