import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { MIGRATIONS } from "../db";
import { createDraftTask } from "../tasks";
import {
  ARTIFACT_SIZE_LIMIT_BYTES,
  artifactType,
  assertSafeArtifactFileName,
  getArtifactVersion,
  groupByType,
  listArtifactVersions,
  nextArtifactNumber,
  parseFrontmatter,
  upsertArtifact,
} from "../artifacts";

function makeDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  for (const statement of MIGRATIONS) db.exec(statement);
  return db;
}

function seedTask(db: Database.Database) {
  return createDraftTask(db, {
    projectId: "proj_1",
    prompt: "Task prompt",
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
}

test("parseFrontmatter accepts flat fenced scalars only", () => {
  assert.deepEqual(parseFrontmatter("---\ntype: research\nready: true\ncount: 2\n---\nBody"), {
    type: "research",
    ready: true,
    count: 2,
  });
  assert.deepEqual(parseFrontmatter("type: research\n---\nBody"), {});
  assert.deepEqual(parseFrontmatter("---\ntype: research\nBody"), {});
});

test("artifact type uses frontmatter before numbered file names", () => {
  assert.equal(artifactType("01-research-topic.md", {}), "research");
  assert.equal(artifactType("01-research-topic.md", { type: "notes" }), "notes");
  assert.equal(artifactType("handoff.md", {}), "other");
});

test("next artifact number ignores gaps, non-numbered files, and deleted files", () => {
  const db = makeDb();
  const taskId = seedTask(db);
  upsertArtifact(db, taskId, "01-research-a.md", "a", { createdBy: "t", operation: "test" });
  upsertArtifact(db, taskId, "03-plan-c.md", "c", { createdBy: "t", operation: "test" });
  upsertArtifact(db, taskId, "99-plan-deleted.md", "d", { createdBy: "t", operation: "test" });
  db.prepare("UPDATE artifacts SET is_deleted = 1 WHERE file_name = ?").run("99-plan-deleted.md");
  upsertArtifact(db, taskId, "handoff.md", "h", { createdBy: "t", operation: "test" });
  assert.equal(nextArtifactNumber(db, taskId), "04");
  db.close();
});

test("upsert deduplicates unchanged sha and creates a version only on change", () => {
  const db = makeDb();
  const taskId = seedTask(db);
  const first = upsertArtifact(db, taskId, "01-research-a.md", "a", { createdBy: "t", operation: "test" });
  const second = upsertArtifact(db, taskId, "01-research-a.md", "a", { createdBy: "t", operation: "test" });
  const third = upsertArtifact(db, taskId, "01-research-a.md", "b", { createdBy: "t", operation: "test" });
  assert.deepEqual([first.version, first.changed], [1, true]);
  assert.deepEqual([second.version, second.changed], [1, false]);
  assert.deepEqual([third.version, third.changed], [2, true]);
  assert.equal(listArtifactVersions(db, taskId, "01-research-a.md").length, 2);
  assert.equal(getArtifactVersion(db, taskId, "01-research-a.md", 2)?.version.content.toString("utf8"), "b");
  db.close();
});

test("groupByType follows HumanLayer panel order with other last", () => {
  const grouped = groupByType([
    { type: "notes", fileName: "n.md" },
    { type: "research", fileName: "r.md" },
    { type: "prd", fileName: "p.md" },
  ]);
  assert.deepEqual(grouped.map((group) => group.type), ["research", "prd", "other"]);
});

test("artifact size cap and path confinement reject unsafe writes", () => {
  const db = makeDb();
  const taskId = seedTask(db);
  assert.throws(() => upsertArtifact(db, taskId, "big.bin", Buffer.alloc(ARTIFACT_SIZE_LIMIT_BYTES + 1), { createdBy: "t", operation: "test" }), /10 MB/);
  assert.throws(() => assertSafeArtifactFileName("../escape.md"), /invalid artifact file name/);
  assert.throws(() => assertSafeArtifactFileName("/tmp/escape.md"), /invalid artifact file name/);
  db.close();
});
