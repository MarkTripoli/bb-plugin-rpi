import test from "node:test";
import assert from "node:assert/strict";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { consumeSuppression, MIGRATIONS } from "../db";

test("migrations are idempotent", async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "humanlayer" });
  const db = bb.storage.database();
  bb.storage.migrate(db, MIGRATIONS);
  bb.storage.migrate(db, MIGRATIONS);
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((row) => (row as { name: string }).name);
  assert.ok(tables.includes("tasks"));
  assert.ok(tables.includes("launch_attempts"));
  assert.ok(tables.includes("mirror_state"));
  assert.ok(tables.includes("task_ui_state"));
  assert.ok(tables.includes("child_threads"));
  assert.ok(tables.includes("notification_suppressions"));
  assert.ok(tables.includes("notifications"));
  const taskColumns = db.prepare("PRAGMA table_info(tasks)").all().map((row) => (row as { name: string }).name);
  const sessionColumns = db.prepare("PRAGMA table_info(sessions)").all().map((row) => (row as { name: string }).name);
  assert.ok(taskColumns.includes("base_environment_id"));
  assert.ok(taskColumns.includes("worktree_environment_id"));
  assert.ok(taskColumns.includes("aa_questions_to_research"));
  assert.ok(sessionColumns.includes("last_reconcile_seq"));
  assert.ok(sessionColumns.includes("last_summarized_turn_key"));
  assert.ok(sessionColumns.includes("completed_turn_key"));
  assert.ok(sessionColumns.includes("advanced_attempt_id"));
  assert.ok(sessionColumns.includes("ingest_error"));
  const launchAttemptColumns = db
    .prepare("PRAGMA table_info(launch_attempts)")
    .all()
    .map((row) => row as { name: string; notnull: number });
  assert.equal(launchAttemptColumns.find((row) => row.name === "from_thread_id")?.notnull, 0);
  assert.ok(launchAttemptColumns.some((row) => row.name === "command_line"));
  assert.ok(launchAttemptColumns.some((row) => row.name === "environment_role"));
  assert.ok(launchAttemptColumns.some((row) => row.name === "retried_from"));
  assert.ok(launchAttemptColumns.some((row) => row.name === "retry_marker"));
  db.prepare("INSERT INTO tasks (id, project_id, name, slug, draft_prompt, created_at, updated_at) VALUES ('task_1', 'proj_1', 'Task', 'task', '', 1, 1)").run();
  db.prepare("INSERT INTO launch_attempts (id, task_id, status, created_at) VALUES ('attempt_1', 'task_1', 'retrying', 1)").run();
  await harness.lifecycle.dispose();
});

test("notification suppression is consumed once per completed turn", async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "humanlayer" });
  const db = bb.storage.database();
  bb.storage.migrate(db, MIGRATIONS);
  db.prepare("INSERT INTO notification_suppressions (thread_id, completed_turn_key, reason, created_at) VALUES ('thr_1', 'turn_1', 'auto_advance', 1)").run();
  assert.equal(consumeSuppression(db, "thr_1", "turn_1"), true);
  assert.equal(consumeSuppression(db, "thr_1", "turn_1"), false);
  await harness.lifecycle.dispose();
});
