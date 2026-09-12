import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { MIGRATIONS } from "../db";
import { archiveTask, createDraftTask, defaultTaskPrefs, deleteTask, generateTaskSlug, getTask, listChildren, listDeliveringEpics, listTasks, resolveTaskExecutionDefaults, updateTask } from "../tasks";
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

test("e2e mode and phase models round-trip through create, update, and list", () => {
  const db = makeDb();
  for (const statement of MIGRATIONS) {
    if (statement.trim().length > 0) {
      db.exec(statement);
    }
  }
  const { taskId } = createDraftTask(db, {
    projectId: "proj_1",
    prompt: "Run full auto",
    name: "Full auto task",
    workflowType: "rpi",
    worktreeTiming: "later",
    permissionMode: "default",
    autoAdvance: false,
    e2eMode: true,
    providerId: null,
    model: null,
    reasoningLevel: null,
    serviceTier: null,
  });
  const row = listTasks(db, { archived: false }).find((task) => task.id === taskId);
  assert.ok(row);
  assert.equal(row.e2eMode, true);

  const models = { implementation: { providerId: "codex", model: "gpt-fast" } };
  const withModels = updateTask(db, taskId, { phaseModels: models });
  assert.deepEqual(withModels?.phaseModels, models);

  const cleared = updateTask(db, taskId, { phaseModels: null });
  assert.deepEqual(cleared?.phaseModels, {});

  // Persisted JSON is untrusted: an invalid value reads back as {}.
  db.prepare("UPDATE tasks SET phase_models = '{not json' WHERE id = ?").run(taskId);
  const corrupted = updateTask(db, taskId, {});
  assert.deepEqual(corrupted?.phaseModels, {});
});

test("createDraftTask persists a provider composer environment and updateTask clears it on an explicit host or directory edit", () => {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  for (const statement of MIGRATIONS) db.exec(statement);
  const environment = {
    type: "provider" as const,
    environmentProviderId: "personal-workspace",
    machine: { type: "existing" as const, hostId: "host_1" },
    inputs: null,
  };
  const taskId = createDraftTask(db, {
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
    composerEnvironment: environment,
  }).taskId;
  assert.deepEqual(getTask(db, taskId)?.task.composerEnvironment, environment);

  // Unrelated edits keep the intent.
  assert.deepEqual(updateTask(db, taskId, { name: "Renamed" })?.composerEnvironment, environment);

  // An explicit host or directory edit wins; the intent is dropped.
  assert.equal(updateTask(db, taskId, { hostId: "host_2" })?.composerEnvironment, null);
  db.close();
});

test("a corrupt persisted composer environment reads back as null", () => {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  for (const statement of MIGRATIONS) db.exec(statement);
  const taskId = createDraftTask(db, {
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
  db.prepare("UPDATE tasks SET composer_environment_json = '{not json' WHERE id = ?").run(taskId);
  assert.equal(getTask(db, taskId)?.task.composerEnvironment, null);
  db.close();
});

test("epic children carry parent, dependency, position, pause, and cap fields through create, update, and list", () => {
  const db = makeDb();
  for (const statement of MIGRATIONS) db.exec(statement);
  const base = {
    projectId: "proj_1",
    worktreeTiming: "later" as const,
    permissionMode: "default",
    autoAdvance: false,
    providerId: null,
    model: null,
    reasoningLevel: null,
    serviceTier: null,
  };
  const epicId = createDraftTask(db, { ...base, prompt: "Ship the epic", name: "Epic", workflowType: "epic" }).taskId;
  const secondId = createDraftTask(db, { ...base, prompt: "second", name: "Second", workflowType: "rpi", parentTaskId: epicId, position: 2 }).taskId;
  const firstId = createDraftTask(db, { ...base, prompt: "first", name: "First", workflowType: "rpi", parentTaskId: epicId, position: 1 }).taskId;
  db.prepare("UPDATE tasks SET is_draft = 0 WHERE id = ?").run(epicId);

  const updated = updateTask(db, secondId, { dependsOn: [firstId], maxParallel: 3, epicPaused: true });
  assert.deepEqual(updated?.dependsOn, [firstId]);
  assert.equal(updated?.maxParallel, 3);
  assert.equal(updated?.epicPaused, true);
  // An unrelated edit keeps the stored dependencies.
  assert.deepEqual(updateTask(db, secondId, { name: "Second child" })?.dependsOn, [firstId]);

  const rows = listTasks(db, { archived: false });
  const second = rows.find((task) => task.id === secondId);
  assert.equal(second?.parentTaskId, epicId);
  assert.deepEqual(second?.dependsOn, [firstId]);
  assert.equal(second?.position, 2);
  assert.equal(second?.epicPaused, true);
  assert.equal(second?.maxParallel, 3);
  const first = rows.find((task) => task.id === firstId);
  assert.deepEqual([first?.parentTaskId, first?.dependsOn, first?.position, first?.epicPaused, first?.maxParallel], [epicId, [], 1, false, null]);

  assert.deepEqual(listChildren(db, epicId).map((task) => task.id), [firstId, secondId]);

  const epic = rows.find((task) => task.id === epicId);
  assert.equal(epic?.currentLabel, "delivery");
  assert.equal(epic?.stepLabel, "delivery");
  assert.equal(epic?.boardColumn, "implementation");
  assert.equal(getTask(db, epicId)?.workspace.currentLabel, "delivery");
  // A child's own label still comes from its sessions.
  assert.equal(first?.currentLabel, null);

  assert.deepEqual(listDeliveringEpics(db), [epicId]);
  updateTask(db, epicId, { epicPaused: true });
  assert.deepEqual(listDeliveringEpics(db), []);
  updateTask(db, epicId, { epicPaused: false, maxParallel: null });
  assert.deepEqual(listDeliveringEpics(db), [epicId]);

  // Persisted JSON is untrusted: a corrupt depends_on_json reads back as [].
  db.prepare("UPDATE tasks SET depends_on_json = '{not json' WHERE id = ?").run(secondId);
  assert.deepEqual(getTask(db, secondId)?.task.dependsOn, []);

  assert.throws(() => deleteTask(db, epicId), /child tasks first/);
  assert.equal(deleteTask(db, firstId), true);
  assert.equal(deleteTask(db, secondId), true);
  assert.equal(deleteTask(db, epicId), true);
  db.close();
});

test("archiveTask archives an epic's children with it", () => {
  const db = makeDb();
  for (const statement of MIGRATIONS) db.exec(statement);
  const base = { projectId: "proj_1", worktreeTiming: "never" as const, permissionMode: "default", autoAdvance: false, providerId: null, model: null, reasoningLevel: null, serviceTier: null };
  const epicId = createDraftTask(db, { ...base, prompt: "Ship the epic", name: "Epic", workflowType: "epic" }).taskId;
  const childId = createDraftTask(db, { ...base, prompt: "child", name: "Child", workflowType: "oneshot", parentTaskId: epicId, position: 0 }).taskId;
  const otherId = createDraftTask(db, { ...base, prompt: "other", name: "Other", workflowType: "oneshot" }).taskId;
  assert.equal(archiveTask(db, epicId)?.archived, true);
  assert.deepEqual(listTasks(db, { archived: false }).map((task) => task.id), [otherId]);
  assert.deepEqual(listTasks(db, { archived: true }).map((task) => task.id).sort(), [childId, epicId].sort());
  assert.deepEqual(listChildren(db, epicId), []);
  db.close();
});
