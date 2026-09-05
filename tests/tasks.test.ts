import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { MIGRATIONS } from "../db";
import { createDraftTask, defaultTaskPrefs, generateTaskSlug, listTasks, resolveTaskExecutionDefaults, updateTask } from "../tasks";
import { deriveBoardColumn } from "../transitions";
import type { Prefs } from "../contract";

function makeDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  return db;
}

test("slug generation adds -2 and -3 suffixes on collision", () => {
  const db = makeDb();
  const createTable = MIGRATIONS[0];
  db.exec(createTable);
  db.prepare("INSERT INTO tasks (id, project_id, name, slug, draft_prompt, workflow_type, worktree_timing, is_draft, archived, auto_advance, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run("1", "proj_1", "Alpha", "alpha", "", "rpi", "later", 1, 0, 0, 1, 1);
  db.prepare("INSERT INTO tasks (id, project_id, name, slug, draft_prompt, workflow_type, worktree_timing, is_draft, archived, auto_advance, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run("2", "proj_1", "Alpha", "alpha-2", "", "rpi", "later", 1, 0, 0, 1, 1);
  assert.equal(generateTaskSlug(db, "Alpha"), "alpha-3");
});

test("board column derives from label and draft state", () => {
  assert.equal(deriveBoardColumn("research", false), "research_design");
  assert.equal(deriveBoardColumn("plan", false), "planning");
  assert.equal(deriveBoardColumn("implement-outline", false), "implementation");
  assert.equal(deriveBoardColumn(null, true), "todo_draft");
});

test("creating a draft persists a row and surfaces in listTasks", () => {
  const db = makeDb();
  for (const statement of MIGRATIONS) {
    if (statement.trim().length > 0) {
      db.exec(statement);
    }
  }
  createDraftTask(db, {
    projectId: "proj_1",
    prompt: "Build a task system",
    name: "Build a task system",
    workflowType: "rpi",
    worktreeTiming: "later",
    permissionMode: "default",
    autoAdvance: false,
    providerId: null,
    model: null,
    reasoningLevel: null,
    serviceTier: null,
  });
  const tasks = listTasks(db, { archived: false });
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0]?.name, "Build a task system");
  assert.equal(tasks[0]?.boardColumn, "todo_draft");
});

test("renaming a task keeps its slug stable", () => {
  const db = makeDb();
  for (const statement of MIGRATIONS) {
    if (statement.trim().length > 0) {
      db.exec(statement);
    }
  }
  const { taskId } = createDraftTask(db, {
    projectId: "proj_1",
    prompt: "Build a task system",
    name: "Build a task system",
    workflowType: "rpi",
    worktreeTiming: "later",
    permissionMode: "default",
    autoAdvance: false,
    providerId: null,
    model: null,
    reasoningLevel: null,
    serviceTier: null,
  });
  const before = listTasks(db, { archived: false })[0];
  assert.ok(before);
  const updated = updateTask(db, taskId, { name: "Renamed task" });
  assert.equal(updated?.slug, before.slug);
  assert.equal(updated?.name, "Renamed task");
});

test("resolveTaskExecutionDefaults: explicit request > workflow default > global default, undefined vs null distinguish omitted vs clear", () => {
  const prefs: Prefs = {
    ...defaultTaskPrefs({ providerId: "global-provider", model: "global-model", reasoningLevel: "medium", serviceTier: "default" }),
    workflowDefaults: {
      rpi: { providerId: "workflow-provider", model: "workflow-model", reasoningLevel: "high", permissionMode: "auto" },
    },
  };

  // All omitted: falls all the way through to the global default (or the documented fallback).
  assert.deepEqual(resolveTaskExecutionDefaults({}, "rpi", prefs), {
    providerId: "workflow-provider",
    model: "workflow-model",
    reasoningLevel: "high",
    serviceTier: "default", // no workflow override exists for serviceTier; global wins
    permissionMode: "auto",
  });

  // A workflow type with no stored override falls through to the global default.
  assert.deepEqual(resolveTaskExecutionDefaults({}, "freeform", prefs), {
    providerId: "global-provider",
    model: "global-model",
    reasoningLevel: "medium",
    serviceTier: "default",
    permissionMode: "default",
  });

  // Explicit request value always wins over both defaults.
  assert.deepEqual(
    resolveTaskExecutionDefaults({ providerId: "explicit-provider", permissionMode: "bypass" }, "rpi", prefs).providerId,
    "explicit-provider",
  );
  assert.equal(resolveTaskExecutionDefaults({ permissionMode: "bypass" }, "rpi", prefs).permissionMode, "bypass");

  // Explicit `null` means "clear this field", distinct from omitting it (`undefined`), and still
  // wins over both the workflow and global default.
  assert.equal(resolveTaskExecutionDefaults({ providerId: null }, "rpi", prefs).providerId, null);
  assert.equal(resolveTaskExecutionDefaults({ model: undefined }, "rpi", prefs).model, "workflow-model");
});
