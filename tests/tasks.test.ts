import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { MIGRATIONS } from "../db";
import { createDraftTask, defaultTaskPrefs, generateTaskSlug, listTasks, resolveTaskExecutionDefaults, updateTask } from "../tasks";
import { listSessions } from "../sessions";
import { deriveBoardColumn } from "../transitions";
import type { Prefs } from "../contract";

function makeDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  return db;
}

test("slug generation adds -2 and -3 suffixes on collision", () => {
  const db = makeDb();
  for (const statement of MIGRATIONS) db.exec(statement);
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

// Archiving a session's bb thread is how the human dismisses a failed or lost session: it must
// drop out of listSessions, out of the task's attention count and session count, and stop deciding
// the task's current phase, while the row itself stays for retention.
test("an archived-thread session is excluded from listSessions, counts, and the current label", () => {
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
  const insert = db.prepare(`
    INSERT INTO sessions (
      thread_id, task_id, label, skill_id, launched_by, forked_from_thread_id,
      rpi_status, rpi_status_at, had_turn, interrupted, blocked_reason, created_at, updated_at
    ) VALUES (?, ?, ?, NULL, 'user', NULL, ?, 1, 1, 0, NULL, ?, ?)
  `);
  insert.run("thr_plan", taskId, "plan", "ready_for_input", 10, 10);
  insert.run("thr_research_rerun", taskId, "research", "failed", 20, 20);

  const before = listTasks(db, { archived: false })[0]!;
  assert.equal(before.sessionCount, 2);
  assert.equal(before.attentionCount, 2);
  assert.equal(before.currentLabel, "research");

  db.prepare("UPDATE sessions SET thread_archived_at = 30 WHERE thread_id = 'thr_research_rerun'").run();
  const after = listTasks(db, { archived: false })[0]!;
  assert.equal(after.sessionCount, 1);
  assert.equal(after.attentionCount, 1);
  assert.equal(after.currentLabel, "plan");
  assert.deepEqual(listSessions(db, taskId).map((session) => session.threadId), ["thr_plan"]);
  assert.deepEqual(listSessions(db, null).map((session) => session.threadId), ["thr_plan"]);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM sessions").get() as { n: number }).n, 2, "the row is kept for retention");
});
