import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { onCompletedTurn } from "../advance";
import { MIGRATIONS, stringifyJson } from "../db";
import { createDraftTask } from "../tasks";
import { AUTO_ADVANCE } from "../transitions";
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
      created_at, updated_at
    ) VALUES ('thr_source', ?, ?, NULL, 'user', NULL, 'ready_for_input', 1, 1, 0, NULL, ?, 1, 1)
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

test("auto-advance matrix respects every table row and task flags", async () => {
  for (const [label, transition] of Object.entries(AUTO_ADVANCE)) {
    const db = makeDb();
    const { bb, spawns } = fakeBb();
    const { session } = seed(db, label, transition.next);
    await onCompletedTurn(bb as never, db, new Map(), createLaunchBindingMirror(), session);
    assert.equal(spawns.length, transition.flag === null ? 0 : 1, label);
    db.close();
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
  const suppression = db.prepare("SELECT reason FROM notification_suppressions WHERE thread_id = 'thr_source'").get() as { reason: string } | undefined;
  assert.equal(suppression?.reason, "auto_advance");
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
