import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { MIGRATIONS } from "../db";
import { createDraftTask, generateTaskSlug, listTasks } from "../tasks";
import { deriveBoardColumn } from "../transitions";

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
