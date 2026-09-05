import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { MIGRATIONS } from "../db";
import { createDraftTask } from "../tasks";
import { promoteStalePendingLaunchAttempts, resolveLaunchAttempt } from "../launch";
import { createLaunchBindingMirror, type SessionMirrorRow } from "../sessions";

function makeDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  for (const statement of MIGRATIONS) db.exec(statement);
  return db;
}

function seedTask(db: Database.Database) {
  return createDraftTask(db, {
    projectId: "proj_1",
    prompt: "prompt",
    name: "Task",
    workflowType: "freeform",
    worktreeTiming: "never",
    permissionMode: "default",
    autoAdvance: false,
    providerId: null,
    model: null,
    reasoningLevel: null,
    serviceTier: null,
  }).taskId;
}

test("resolved launch attempts are no-ops", async () => {
  const db = makeDb();
  const taskId = seedTask(db);
  db.prepare("INSERT INTO launch_attempts (id, task_id, from_thread_id, skill_id, status, thread_id, created_at) VALUES (?, ?, NULL, NULL, 'spawned', ?, ?)")
    .run("attempt_1", taskId, "thr_existing", 1);
  const mirror = new Map<string, SessionMirrorRow>();
  const result = await resolveLaunchAttempt({} as never, db, mirror, createLaunchBindingMirror(), "attempt_1", { type: "retry" });
  assert.deepEqual(result, { threadId: "thr_existing" });
  db.close();
});

test("adopt rejects a thread already bound to a session without resolving the attempt", async () => {
  const db = makeDb();
  const taskId = seedTask(db);
  db.prepare("INSERT INTO launch_attempts (id, task_id, from_thread_id, skill_id, status, thread_id, created_at) VALUES (?, ?, NULL, NULL, 'uncertain', NULL, ?)")
    .run("attempt_1", taskId, 1);
  db.prepare(`
    INSERT INTO sessions (
      thread_id, task_id, label, skill_id, launched_by, forked_from_thread_id,
      hl_status, hl_status_at, had_turn, interrupted, blocked_reason, created_at, updated_at
    ) VALUES ('thr_bound', ?, NULL, NULL, 'user', NULL, 'running', 1, 1, 0, NULL, 1, 1)
  `).run(taskId);
  const thread = makeThreadResponse({ id: "thr_bound", projectId: "proj_1", createdAt: 2, originPluginId: "humanlayer" });
  const bb = {
    pluginId: "humanlayer",
    sdk: {
      threads: {
        list: async () => [thread],
        get: async () => ({ ...thread, environmentId: "env_1", environment: { id: "env_1", path: "/tmp/repo", status: "ready" } }),
      },
    },
  };
  await assert.rejects(
    () => resolveLaunchAttempt(bb as never, db, new Map(), createLaunchBindingMirror(), "attempt_1", { type: "adopt", threadId: "thr_bound" }),
    /already bound/,
  );
  const attempt = db.prepare("SELECT status, thread_id FROM launch_attempts WHERE id = ?").get("attempt_1") as { status: string; thread_id: string | null };
  assert.equal(attempt.status, "uncertain");
  assert.equal(attempt.thread_id, null);
  db.close();
});

test("stale pending launch attempts promote to uncertain", () => {
  const db = makeDb();
  const taskId = seedTask(db);
  db.prepare("INSERT INTO launch_attempts (id, task_id, from_thread_id, skill_id, status, thread_id, created_at) VALUES (?, ?, NULL, NULL, 'pending', NULL, ?)")
    .run("attempt_old", taskId, Date.now() - 180_000);
  db.prepare("INSERT INTO launch_attempts (id, task_id, from_thread_id, skill_id, status, thread_id, created_at) VALUES (?, ?, NULL, NULL, 'pending', NULL, ?)")
    .run("attempt_new", taskId, Date.now());
  assert.deepEqual(promoteStalePendingLaunchAttempts(db), [taskId]);
  const statuses = db.prepare("SELECT id, status FROM launch_attempts ORDER BY id").all() as Array<{ id: string; status: string }>;
  assert.deepEqual(statuses, [
    { id: "attempt_new", status: "pending" },
    { id: "attempt_old", status: "uncertain" },
  ]);
  db.close();
});
