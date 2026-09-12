import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import { MIGRATIONS } from "../db";
import { createDraftTask } from "../tasks";
import { deleteArtifact, getArtifact, getArtifactVersion, listArtifactVersions, upsertArtifact } from "../artifacts";
import { hydrate, ingest, mirrorRestoredArtifact } from "../mirror";

function makeDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  for (const statement of MIGRATIONS) db.exec(statement);
  return db;
}

function sha(content: string | Buffer) {
  return createHash("sha256").update(content).digest("hex");
}

function seedTask(db: Database.Database, name = "Task") {
  return createDraftTask(db, {
    projectId: "proj_1",
    prompt: "Prompt",
    name,
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

function seedSession(db: Database.Database, taskId: string) {
  db.prepare(`
    INSERT INTO sessions (
      thread_id, task_id, label, skill_id, launched_by, forked_from_thread_id,
      rpi_status, rpi_status_at, had_turn, interrupted, blocked_reason, created_at, updated_at
    ) VALUES ('thr_1', ?, NULL, NULL, 'user', NULL, 'running', 1, 1, 0, NULL, 1, 1)
  `).run(taskId);
}

test("hydrate writes task artifacts through .rpi rootPath with CAS", async () => {
  const db = makeDb();
  const taskId = seedTask(db);
  upsertArtifact(db, taskId, "01-notes-live-check.md", "---\ntype: notes\n---\nBody", { createdBy: "test", operation: "test" });
  seedSession(db, taskId);

  const writes: Array<{ path: string; rootPath?: string; expectedSha256?: string | null }> = [];
  const mkdirs: Array<{ path: string; rootPath?: string }> = [];
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
        mkdir: async (input: { path: string; rootPath?: string }) => {
          mkdirs.push(input);
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
  assert.ok(mkdirs.some((mkdir) => mkdir.path === "/repo/.rpi/tasks" && mkdir.rootPath === "/repo"));
  assert.ok(mkdirs.some((mkdir) => mkdir.path === "/repo/.rpi/tasks/task" && mkdir.rootPath === "/repo/.rpi/tasks"));
  assert.equal(writes.length, 2);
  assert.ok(writes.every((write) => write.path.startsWith("/repo/.rpi/tasks/task/")));
  assert.ok(writes.every((write) => write.rootPath === "/repo/.rpi/tasks/task"));
  assert.ok(writes.every((write) => write.expectedSha256 === null));
  db.close();
});

test("hydrate ingests untracked disk edits instead of clobbering them", async () => {
  const db = makeDb();
  const taskId = seedTask(db);
  seedSession(db, taskId);
  upsertArtifact(db, taskId, "01-notes-live-check.md", "db", { createdBy: "test", operation: "test" });
  const disk = "disk edit";
  const writes: string[] = [];
  const bb = {
    log: { info: () => undefined, warn: () => undefined },
    realtime: { publish: () => undefined },
    sdk: {
      threads: { get: async () => ({ environment: { path: "/repo", hostId: "host_1" } }) },
      files: {
        mkdir: async () => ({ ok: true }),
        read: async ({ path }: { path: string }) => {
          if (path.endsWith("/.git")) throw new Error("not found");
          if (path.endsWith("/01-notes-live-check.md")) return { content: disk, contentEncoding: "utf8", sha256: sha(disk), sizeBytes: Buffer.byteLength(disk) };
          throw new Error("not found");
        },
        write: async ({ path }: { path: string }) => {
          writes.push(path);
          return { outcome: "written", sha256: "written", sizeBytes: 1 };
        },
      },
    },
  };
  await hydrate(bb as never, db, taskId, "thr_1");
  assert.equal(getArtifactVersion(db, taskId, "01-notes-live-check.md")?.version.content.toString("utf8"), disk);
  assert.equal(listArtifactVersions(db, taskId, "01-notes-live-check.md").length, 2);
  assert.ok(!writes.some((path) => path.endsWith("/01-notes-live-check.md")));
  db.close();
});

test("hydrate skips unstable local edits instead of writing db content over them", async () => {
  const db = makeDb();
  const taskId = seedTask(db);
  seedSession(db, taskId);
  upsertArtifact(db, taskId, "01-notes-live-check.md", "db", { createdBy: "test", operation: "test" });
  const diskReads = ["A", "B", "A", "B", "A", "B", "A"];
  const writes: string[] = [];
  const warnings: string[] = [];
  const bb = {
    log: { info: () => undefined, warn: (message: string) => warnings.push(message) },
    realtime: { publish: () => undefined },
    sdk: {
      threads: { get: async () => ({ environment: { path: "/repo", hostId: "host_1" } }) },
      files: {
        mkdir: async () => ({ ok: true }),
        read: async ({ path }: { path: string }) => {
          if (path.endsWith("/.git")) throw new Error("not found");
          if (path.endsWith("/01-notes-live-check.md")) {
            const content = diskReads.shift() ?? "A";
            return { content, contentEncoding: "utf8", sha256: sha(content), sizeBytes: Buffer.byteLength(content) };
          }
          throw new Error("not found");
        },
        write: async ({ path }: { path: string }) => {
          writes.push(path);
          return { outcome: "written", sha256: "written", sizeBytes: 1 };
        },
      },
    },
  };
  await hydrate(bb as never, db, taskId, "thr_1");
  assert.equal(getArtifactVersion(db, taskId, "01-notes-live-check.md")?.version.content.toString("utf8"), "db");
  assert.ok(!writes.some((path) => path.endsWith("/01-notes-live-check.md")));
  assert.ok(warnings.some((message) => message.includes("unstable")));
  db.close();
});

test("restore picks newest trash copy by numeric version before timestamp", async () => {
  const db = makeDb();
  const taskId = seedTask(db);
  seedSession(db, taskId);
  const moves: Array<{ sourcePath: string; destinationPath: string }> = [];
  const bb = {
    log: { info: () => undefined, warn: () => undefined },
    sdk: {
      threads: { get: async () => ({ environment: { path: "/repo", hostId: "host_1" } }) },
      files: {
        read: async () => {
          throw new Error("not found");
        },
        listPaths: async () => ({ paths: [
          { kind: "file", path: ".trash/notes.md.9.9999999999999" },
          { kind: "file", path: ".trash/notes.md.10.1" },
        ] }),
        move: async (input: { sourcePath: string; destinationPath: string }) => {
          moves.push(input);
          return { ok: true };
        },
      },
    },
  };
  assert.equal(await mirrorRestoredArtifact(bb as never, db, taskId, "thr_1", "notes.md"), "moved");
  assert.equal(moves[0]!.sourcePath, "/repo/.rpi/tasks/task/.trash/notes.md.10.1");
  db.close();
});

test("ingest only accepts direct child files under the task root", async () => {
  const db = makeDb();
  const taskId = seedTask(db);
  seedSession(db, taskId);
  const seen = { listRoot: "", readRoots: [] as Array<string | undefined>, warnings: [] as string[] };
  const bb = {
    log: { info: () => undefined, warn: (message: string) => seen.warnings.push(message) },
    realtime: { publish: () => undefined },
    sdk: {
      threads: { get: async () => ({ environment: { path: "/repo", hostId: "host_1" } }) },
      files: {
        listPaths: async (input: { rootPath?: string }) => {
          seen.listRoot = input.rootPath ?? "";
          return { paths: [
            { kind: "file", path: "01-notes.md", sizeBytes: 5 },
            { kind: "file", path: "nested/02-notes.md", sizeBytes: 5 },
            { kind: "directory", path: "folder" },
            { kind: "file", path: "linked.md", isSymbolicLink: true },
          ] };
        },
        read: async (input: { path: string; rootPath?: string }) => {
          seen.readRoots.push(input.rootPath);
          if (input.path.endsWith("/01-notes.md")) return { content: "notes", contentEncoding: "utf8", sha256: sha("notes"), sizeBytes: 5 };
          throw new Error("not found");
        },
      },
    },
  };
  assert.deepEqual(await ingest(bb as never, db, taskId, "test", { threadId: "thr_1" }), { ingested: 1, skipped: 3, artifactDir: "/repo/.rpi/tasks/task" });
  assert.equal(seen.listRoot, "/repo/.rpi/tasks/task");
  assert.ok(seen.readRoots.every((root) => root === "/repo/.rpi/tasks/task"));
  assert.equal(getArtifact(db, taskId, "01-notes.md")?.currentVersion, 1);
  assert.ok(seen.warnings.some((message) => message.includes("nested artifact")));
  assert.ok(seen.warnings.some((message) => message.includes("non-file")));
  db.close();
});

test("ingest recovers a file whose first read misses transiently", async () => {
  const db = makeDb();
  const taskId = seedTask(db);
  seedSession(db, taskId);
  let reads = 0;
  const bb = {
    log: { info: () => undefined, warn: () => undefined },
    realtime: { publish: () => undefined },
    sdk: {
      threads: { get: async () => ({ environment: { path: "/repo", hostId: "host_1" } }) },
      files: {
        read: async () => {
          reads += 1;
          if (reads === 1) throw new Error("not found");
          return { content: "notes", contentEncoding: "utf8", sha256: sha("notes"), sizeBytes: 5 };
        },
      },
    },
  };
  assert.deepEqual(await ingest(bb as never, db, taskId, "test", { threadId: "thr_1", fileName: "01-notes.md" }), { ingested: 1, skipped: 0, artifactDir: "/repo/.rpi/tasks/task" });
  assert.equal(getArtifact(db, taskId, "01-notes.md")?.currentVersion, 1);
  db.close();
});

test("ingest skips files changing between two reads", async () => {
  const db = makeDb();
  const taskId = seedTask(db);
  seedSession(db, taskId);
  let reads = 0;
  const warnings: string[] = [];
  const bb = {
    log: { info: () => undefined, warn: (message: string) => warnings.push(message) },
    realtime: { publish: () => undefined },
    sdk: {
      threads: { get: async () => ({ environment: { path: "/repo", hostId: "host_1" } }) },
      files: {
        read: async () => {
          reads += 1;
          const content = reads % 2 === 1 ? "partial" : "complete";
          return { content, contentEncoding: "utf8", sha256: sha(content), sizeBytes: Buffer.byteLength(content) };
        },
      },
    },
  };
  assert.deepEqual(await ingest(bb as never, db, taskId, "test", { threadId: "thr_1", fileName: "01-notes.md" }), { ingested: 0, skipped: 1, artifactDir: "/repo/.rpi/tasks/task" });
  assert.equal(getArtifact(db, taskId, "01-notes.md"), null);
  assert.ok(warnings.some((message) => message.includes("unstable")));
  db.close();
});

test("tombstoned artifacts are not resurrected by ingest", async () => {
  const db = makeDb();
  const taskId = seedTask(db);
  seedSession(db, taskId);
  upsertArtifact(db, taskId, "01-notes.md", "old", { createdBy: "test", operation: "test" });
  deleteArtifact(db, taskId, "01-notes.md");
  const moves: Array<{ sourcePath: string; destinationPath: string; rootPath?: string }> = [];
  const bb = {
    log: { info: () => undefined, warn: () => undefined },
    realtime: { publish: () => undefined },
    sdk: {
      threads: { get: async () => ({ environment: { path: "/repo", hostId: "host_1" } }) },
      files: {
        mkdir: async () => ({ ok: true }),
        read: async () => ({ content: "old", contentEncoding: "utf8", sha256: sha("old"), sizeBytes: 3 }),
        move: async (input: { sourcePath: string; destinationPath: string; rootPath?: string }) => {
          moves.push(input);
          return { ok: true };
        },
      },
    },
  };
  assert.deepEqual(await ingest(bb as never, db, taskId, "test", { threadId: "thr_1", fileName: "01-notes.md" }), { ingested: 0, skipped: 1, artifactDir: "/repo/.rpi/tasks/task" });
  assert.equal(getArtifact(db, taskId, "01-notes.md")?.isDeleted, true);
  assert.equal(listArtifactVersions(db, taskId, "01-notes.md").length, 1);
  assert.equal(moves.length, 1);
  assert.ok(moves[0]!.destinationPath.includes("/.trash/01-notes.md.1."));
  assert.equal(moves[0]!.rootPath, "/repo/.rpi/tasks/task");
  db.close();
});
