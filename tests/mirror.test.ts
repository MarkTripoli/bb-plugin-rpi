import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { MIGRATIONS } from "../db";
import { createDraftTask } from "../tasks";
import { upsertArtifact } from "../artifacts";
import { hydrate } from "../mirror";

function makeDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  for (const statement of MIGRATIONS) db.exec(statement);
  return db;
}

test("hydrate writes task artifacts through .humanlayer rootPath with CAS", async () => {
  const db = makeDb();
  const { taskId } = createDraftTask(db, {
    projectId: "proj_1",
    prompt: "Prompt",
    name: "Task",
    workflowType: "freeform",
    worktreeTiming: "never",
    permissionMode: "default",
    autoAdvance: false,
    providerId: null,
    model: null,
    reasoningLevel: null,
    serviceTier: null,
  });
  upsertArtifact(db, taskId, "01-notes-live-check.md", "---\ntype: notes\n---\nBody", { createdBy: "test", operation: "test" });
  db.prepare(`
    INSERT INTO sessions (
      thread_id, task_id, label, skill_id, launched_by, forked_from_thread_id,
      hl_status, hl_status_at, had_turn, interrupted, blocked_reason, created_at, updated_at
    ) VALUES ('thr_1', ?, NULL, NULL, 'user', NULL, 'running', 1, 1, 0, NULL, 1, 1)
  `).run(taskId);

  const writes: Array<{ path: string; rootPath?: string; expectedSha256?: string | null }> = [];
  const mkdirs: string[] = [];
  const bb = {
    log: { info: () => undefined, warn: () => undefined },
    realtime: { publish: () => undefined },
    sdk: {
      threads: {
        get: async () => ({
          environment: { path: "/repo", hostId: "host_1" },
        }),
      },
      files: {
        mkdir: async (input: { path: string }) => {
          mkdirs.push(input.path);
          return { outcome: "created" };
        },
        read: async () => {
          throw new Error("not found");
        },
        write: async (input: { path: string; rootPath?: string; expectedSha256?: string | null }) => {
          writes.push(input);
          return { outcome: "written", sha256: "next", sizeBytes: 1 };
        },
      },
    },
  };

  await hydrate(bb as never, db, taskId, "thr_1");
  assert.ok(mkdirs.includes("/repo/.humanlayer"));
  assert.ok(mkdirs.includes("/repo/.humanlayer/tasks/task"));
  assert.equal(writes.length, 2);
  assert.ok(writes.every((write) => write.path.startsWith("/repo/.humanlayer/tasks/task/")));
  assert.ok(writes.every((write) => write.rootPath === "/repo/.humanlayer"));
  assert.ok(writes.every((write) => write.expectedSha256 === null));
  db.close();
});
