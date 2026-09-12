import test from "node:test";
import assert from "node:assert/strict";
import DatabaseCtor from "better-sqlite3";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { consumeSuppression, MIGRATIONS, needsPreRenameReset } from "../db";

test("completion migration preserves existing tasks and defaults them to open", () => {
  const db = new DatabaseCtor(":memory:");
  try {
    const completionIndex = MIGRATIONS.findIndex((statement) => statement.startsWith("ALTER TABLE tasks ADD COLUMN completed"));
    for (const statement of MIGRATIONS.slice(0, completionIndex)) db.exec(statement);
    db.prepare("INSERT INTO tasks (id, project_id, name, slug, draft_prompt, created_at, updated_at) VALUES ('task_1', 'proj_1', 'Task', 'task', 'Keep me', 1, 2)").run();
    for (const statement of MIGRATIONS.slice(completionIndex)) db.exec(statement);
    assert.deepEqual(db.prepare("SELECT draft_prompt, archived, completed, updated_at FROM tasks").get(), {
      draft_prompt: "Keep me", archived: 0, completed: 0, updated_at: 2,
    });
    assert.throws(() => db.prepare("UPDATE tasks SET completed = 2").run());
  } finally {
    db.close();
  }
});

test("migrations are idempotent", async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "rpi" });
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
  assert.ok(launchAttemptColumns.some((row) => row.name === "request_json"));
  assert.ok(launchAttemptColumns.some((row) => row.name === "target_phase"));
  db.prepare("INSERT INTO tasks (id, project_id, name, slug, draft_prompt, created_at, updated_at) VALUES ('task_1', 'proj_1', 'Task', 'task', '', 1, 1)").run();
  db.prepare("INSERT INTO launch_attempts (id, task_id, status, created_at) VALUES ('attempt_1', 'task_1', 'retrying', 1)").run();
  assert.equal((db.prepare("SELECT request_json AS requestJson FROM launch_attempts WHERE id = 'attempt_1'").get() as { requestJson: string | null }).requestJson, null);
  await harness.lifecycle.dispose();
});

test("needsPreRenameReset detects a sessions table from before the status-column rename", () => {
  const fresh = new DatabaseCtor(":memory:");
  assert.equal(needsPreRenameReset(fresh), false, "no sessions table yet: nothing to reset");

  const stale = new DatabaseCtor(":memory:");
  stale.exec("CREATE TABLE sessions (thread_id TEXT PRIMARY KEY, status TEXT NOT NULL)");
  assert.equal(needsPreRenameReset(stale), true, "pre-rename column layout: needs a reset");

  const current = new DatabaseCtor(":memory:");
  current.exec("CREATE TABLE sessions (thread_id TEXT PRIMARY KEY, rpi_status TEXT NOT NULL)");
  assert.equal(needsPreRenameReset(current), false, "already-renamed column: no reset needed");
});

test("notification suppression is consumed once per completed turn", async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "rpi" });
  const db = bb.storage.database();
  bb.storage.migrate(db, MIGRATIONS);
  db.prepare("INSERT INTO notification_suppressions (thread_id, completed_turn_key, reason, created_at) VALUES ('thr_1', 'turn_1', 'auto_advance', 1)").run();
  assert.equal(consumeSuppression(db, "thr_1", "turn_1"), true);
  assert.equal(consumeSuppression(db, "thr_1", "turn_1"), false);
  await harness.lifecycle.dispose();
});
