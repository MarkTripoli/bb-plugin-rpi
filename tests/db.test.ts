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
    .map((row: { name: string }) => row.name);
  assert.ok(tables.includes("tasks"));
  assert.ok(tables.includes("launch_attempts"));
  assert.ok(tables.includes("task_ui_state"));
  await harness.lifecycle.dispose();
});
