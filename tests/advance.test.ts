import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { onCompletedTurn } from "../advance";
import { MIGRATIONS, stringifyJson } from "../db";
import { createDraftTask } from "../tasks";
import { proceed } from "../advance";
import { createLaunchBindingMirror, mirrorSession, type SessionMirrorRow } from "../sessions";

function makeDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  for (const statement of MIGRATIONS) db.exec(statement);
  return db;
}

function seed(db: Database.Database, label: string | null, nextStepType: string | null, patch: Record<string, unknown> = {}) {
  const taskId = createDraftTask(db, {
    projectId: "proj_1",
    prompt: "prompt",
    name: "Task",
    workflowType: "rpi",
    worktreeTiming: "never",
    permissionMode: "default",
    autoAdvance: true,
    providerId: null,
    model: null,
    reasoningLevel: null,
    serviceTier: null,
  }).taskId;
  db.prepare("UPDATE tasks SET aa_questions_to_research = 1, aa_research_to_design = 1, aa_plan_to_worktree = 1, aa_worktree_to_implementation = 1, aa_implementation_to_pr = 1 WHERE id = ?").run(taskId);
  for (const [key, value] of Object.entries(patch)) db.prepare(`UPDATE tasks SET ${key} = ? WHERE id = ?`).run(value, taskId);
  const nextStepJson = nextStepType
    ? stringifyJson({ parsedAt: 1, extraction: { type: "next_step_found", nextStepPrompt: `/rpi-${nextStepType}`, nextStepSummary: "next", nextStepType, taskReference: "task", suggestedDirectory: null } })
    : stringifyJson({ parsedAt: 1, extraction: { type: "no_next_step", reason: "no command block" } });
  db.prepare(`
    INSERT INTO sessions (
      thread_id, task_id, label, skill_id, launched_by, forked_from_thread_id,
      hl_status, hl_status_at, had_turn, interrupted, blocked_reason, next_step_json,
      completed_turn_key, next_step_turn_key, created_at, updated_at
    ) VALUES ('thr_source', ?, ?, NULL, 'user', NULL, 'ready_for_input', 1, 1, 0, NULL, ?, 'turn_1', 'turn_1', 1, 1)
  `).run(taskId, label, nextStepJson);
  return { taskId, session: mirrorSession(db, new Map<string, SessionMirrorRow>(), "thr_source")! };
}

function fakeBb() {
  let count = 0;
  const spawns: unknown[] = [];
  return {
    bb: {
      pluginId: "humanlayer",
      realtime: { publish: () => undefined },
      log: { warn: () => undefined },
      sdk: {
      threads: {
        interactions: { list: async () => [] },
        spawn: async (input: unknown) => {
            count += 1;
            spawns.push(input);
            return makeThreadResponse({ id: `thr_next_${count}`, environmentId: "env_base", projectId: "proj_1", originPluginId: "humanlayer" });
          },
          get: async () => makeThreadResponse({ id: `thr_next_${count}`, environmentId: "env_base", projectId: "proj_1", originPluginId: "humanlayer" }),
      },
      },
    },
    spawns,
  };
}

const MATRIX = [
  { label: "research-questions", next: "create-research", flag: "aa_questions_to_research", humanGate: false },
  { label: "research", next: "create-design-discussion", flag: "aa_research_to_design", humanGate: false },
  { label: "design", next: "create-structure-outline", flag: null, humanGate: true },
  { label: "design-prd", next: "create-tdd", flag: null, humanGate: true },
  { label: "design-tdd", next: "create-structure-outline", flag: null, humanGate: true },
  { label: "structure", next: "create-plan", flag: null, humanGate: true },
  { label: "plan", next: "setup-worktree", flag: "aa_plan_to_worktree", humanGate: false },
  { label: "worktree-setup", next: "implement-plan", flag: "aa_worktree_to_implementation", humanGate: false },
  { label: "implementation", next: "describe-pr", flag: "aa_implementation_to_pr", humanGate: false },
] as const;

test("auto-advance matrix covers rows, flags, master switch, blockers, and missing next step", async () => {
  for (const row of MATRIX) {
    for (const flagOn of [false, true]) {
      for (const masterOn of [false, true]) {
        for (const blocked of [false, true]) {
          for (const found of [false, true]) {
            const db = makeDb();
            const { bb, spawns } = fakeBb();
            const patch: Record<string, unknown> = { auto_advance: masterOn ? 1 : 0 };
            if (row.flag) patch[row.flag] = flagOn ? 1 : 0;
            const { session } = seed(db, row.label, found ? row.next : null, patch);
            if (blocked) db.prepare("UPDATE sessions SET blocked_reason = 'question' WHERE thread_id = 'thr_source'").run();
            const fresh = mirrorSession(db, new Map<string, SessionMirrorRow>(), "thr_source")!;
            await onCompletedTurn(bb as never, db, new Map(), createLaunchBindingMirror(), fresh ?? session);
            const expected = !row.humanGate && found && !blocked && masterOn && (!row.flag || flagOn) ? 1 : 0;
            assert.equal(spawns.length, expected, `${row.label} flag=${flagOn} master=${masterOn} blocked=${blocked} found=${found}`);
            db.close();
          }
        }
      }
    }
  }
});

test("auto-advance skips when master, flag, blocked reason, or next step is absent", async () => {
  const cases = [
    { patch: { auto_advance: 0 }, next: "create-research", blocked: null },
    { patch: { aa_questions_to_research: 0 }, next: "create-research", blocked: null },
    { patch: {}, next: null, blocked: null },
    { patch: {}, next: "create-research", blocked: "question" },
  ];
  for (const item of cases) {
    const db = makeDb();
    const { bb, spawns } = fakeBb();
    const { session } = seed(db, "research-questions", item.next, item.patch);
    if (item.blocked) db.prepare("UPDATE sessions SET blocked_reason = ? WHERE thread_id = 'thr_source'").run(item.blocked);
    const row = mirrorSession(db, new Map<string, SessionMirrorRow>(), "thr_source")!;
    await onCompletedTurn(bb as never, db, new Map(), createLaunchBindingMirror(), row ?? session);
    assert.equal(spawns.length, 0);
    db.close();
  }
});

test("double completed-turn events launch once and suppress the ready toast", async () => {
  const db = makeDb();
  const { bb, spawns } = fakeBb();
  const { session } = seed(db, "research-questions", "create-research");
  await onCompletedTurn(bb as never, db, new Map(), createLaunchBindingMirror(), session);
  await onCompletedTurn(bb as never, db, new Map(), createLaunchBindingMirror(), session);
  assert.equal(spawns.length, 1);
  const suppression = db.prepare("SELECT reason, completed_turn_key FROM notification_suppressions WHERE thread_id = 'thr_source'").get() as { reason: string; completed_turn_key: string } | undefined;
  assert.equal(suppression?.reason, "auto_advance");
  assert.equal(suppression?.completed_turn_key, "turn_1");
  db.close();
});

test("auto-advance refuses mismatched extracted target", async () => {
  const db = makeDb();
  const { bb, spawns } = fakeBb();
  const { session } = seed(db, "research-questions", "create-design-discussion");
  await onCompletedTurn(bb as never, db, new Map(), createLaunchBindingMirror(), session);
  assert.equal(spawns.length, 0);
  db.close();
});

test("proceed and auto-advance racing create one launch", async () => {
  const db = makeDb();
  const { bb, spawns } = fakeBb();
  const { session } = seed(db, "research-questions", "create-research");
  await Promise.all([
    onCompletedTurn(bb as never, db, new Map(), createLaunchBindingMirror(), session),
    proceed(bb as never, db, new Map(), createLaunchBindingMirror(), "thr_source"),
  ]);
  assert.equal(spawns.length, 1);
  const attempts = db.prepare("SELECT COUNT(*) AS count FROM launch_attempts WHERE from_thread_id = 'thr_source'").get() as { count: number };
  assert.equal(attempts.count, 1);
  db.close();
});

test("preflight failure resets only its advanced_at stamp, fails the attempt, and removes suppression", async () => {
  const db = makeDb();
  const { session } = seed(db, "plan", "setup-worktree", { worktree_timing: "now", host_id: null });
  const bb = {
    pluginId: "humanlayer",
    realtime: { publish: () => undefined },
    log: { warn: () => undefined },
    sdk: { threads: { interactions: { list: async () => [] } } },
  };
  await assert.rejects(() => onCompletedTurn(bb as never, db, new Map(), createLaunchBindingMirror(), session), /hostId is required/);
  const row = db.prepare("SELECT advanced_at AS advancedAt, advanced_attempt_id AS advancedAttemptId FROM sessions WHERE thread_id = 'thr_source'").get() as { advancedAt: number | null; advancedAttemptId: string | null };
  const attempt = db.prepare("SELECT id, status FROM launch_attempts WHERE from_thread_id = 'thr_source'").get() as { id: string; status: string };
  const suppression = db.prepare("SELECT COUNT(*) AS count FROM notification_suppressions WHERE thread_id = 'thr_source'").get() as { count: number };
  assert.equal(row.advancedAt, null);
  assert.equal(row.advancedAttemptId, null);
  assert.equal(attempt.status, "failed");
  assert.equal(suppression.count, 0);
  db.close();
});

test("stale completion makes Proceed reject stale extraction", async () => {
  const db = makeDb();
  seed(db, "research-questions", "create-research");
  db.prepare("UPDATE sessions SET completed_turn_key = 'turn_new', next_step_turn_key = 'turn_old' WHERE thread_id = 'thr_source'").run();
  const { bb, spawns } = fakeBb();
  await assert.rejects(() => proceed(bb as never, db, new Map(), createLaunchBindingMirror(), "thr_source"), /stale extraction/);
  db.close();
});

test("reload with pending attempt and stamped advance keeps launch blocked without duplicate spawn", async () => {
  const db = makeDb();
  const { taskId } = seed(db, "research-questions", "create-research");
  db.prepare("INSERT INTO launch_attempts (id, task_id, from_thread_id, skill_id, status, thread_id, created_at) VALUES ('attempt_old', ?, 'thr_source', 'create-research', 'pending', NULL, ?)").run(taskId, Date.now() - 180_000);
  db.prepare("UPDATE sessions SET advanced_at = ?, advanced_attempt_id = 'attempt_old' WHERE thread_id = 'thr_source'").run(Date.now());
  const { promoteStalePendingLaunchAttempts } = await import("../launch");
  assert.deepEqual(promoteStalePendingLaunchAttempts(db), [taskId]);
  const { bb, spawns } = fakeBb();
  const mirror = new Map<string, SessionMirrorRow>();
  mirrorSession(db, mirror, "thr_source");
  await assert.rejects(() => proceed(bb as never, db, mirror, createLaunchBindingMirror(), "thr_source"), /pending/);
  const attempt = db.prepare("SELECT status FROM launch_attempts WHERE id = 'attempt_old'").get() as { status: string };
  assert.equal(attempt.status, "uncertain");
  assert.equal(spawns.length, 0);
  db.close();
});
