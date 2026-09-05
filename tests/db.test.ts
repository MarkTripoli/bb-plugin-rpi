import test from "node:test";
import assert from "node:assert/strict";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { MIGRATIONS } from "../db";

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
  assert.ok(tables.includes("notification_suppressions"));
  const taskColumns = db.prepare("PRAGMA table_info(tasks)").all().map((row) => (row as { name: string }).name);
  const sessionColumns = db.prepare("PRAGMA table_info(sessions)").all().map((row) => (row as { name: string }).name);
  assert.ok(taskColumns.includes("base_environment_id"));
  assert.ok(taskColumns.includes("worktree_environment_id"));
  assert.ok(taskColumns.includes("aa_questions_to_research"));
  assert.ok(sessionColumns.includes("last_reconcile_seq"));
  assert.ok(sessionColumns.includes("last_summarized_turn_key"));
  assert.ok(sessionColumns.includes("completed_turn_key"));
  const launchAttemptColumns = db
    .prepare("PRAGMA table_info(launch_attempts)")
    .all()
    .map((row) => row as { name: string; notnull: number });
  assert.equal(launchAttemptColumns.find((row) => row.name === "from_thread_id")?.notnull, 0);
  await harness.lifecycle.dispose();
});
