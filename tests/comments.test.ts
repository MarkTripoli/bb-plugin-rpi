import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { MIGRATIONS } from "../db";
import { createDraftTask } from "../tasks";
import { upsertArtifact } from "../artifacts";
import {
  createComment,
  listComments,
  reanchor,
  resolveTruncatedId,
  toAgentXml,
  type CommentRecord,
} from "../comments";
import plugin from "../server";

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

function anchor(blockIndex: number, selectedText = "Beta") {
  return { v: 1 as const, blockIndex, start: 0, end: selectedText.length, selectedText };
}

function comment(input: Partial<CommentRecord> = {}) {
  return {
    blockText: "Beta",
    prevBlockText: "Alpha",
    nextBlockText: "Gamma",
    anchorJson: anchor(1),
    ...input,
  };
}

test("reanchor uses exact, context, fuzzy, then orphan", () => {
  assert.deepEqual(reanchor(comment(), "Inserted\n\nAlpha\n\nBeta\n\nGamma").blockIndex, 2);
  assert.deepEqual(reanchor(comment({ blockText: "Beta old" }), "Alpha\n\nBeta new\n\nGamma").blockIndex, 1);
  const fuzzy = reanchor(
    comment({
      blockText: "The quick brown fox jumps over a lazy dog",
      prevBlockText: "missing",
      nextBlockText: "missing",
      anchorJson: anchor(0, "The quick brown fox jumps over a lazy dog"),
    }),
    "The quick brown fox jumps over the very lazy dog",
  );
  assert.equal(fuzzy.orphaned, false);
  assert.equal(reanchor(comment(), "Delta\n\nEpsilon").orphaned, true);
});

test("agent XML escapes content and extends ambiguous prefixes", () => {
  const root = {
    id: "12345678a-root",
    artifactId: "artifact",
    versionId: "version",
    replyToId: null,
    contentText: "Use <tag> & \"quotes\"",
    blockText: "Block & text",
    prevBlockText: null,
    nextBlockText: null,
    anchorJson: anchor(0),
    kind: "comment",
    isResolved: false,
    isDeleted: false,
    createdByAgent: false,
    createdByThreadId: null,
    createdAt: 1,
    updatedAt: 1,
    anchor: { ...anchor(0), orphaned: false },
  } satisfies CommentRecord;
  const reply = { ...root, id: "12345678b-reply", replyToId: root.id, contentText: "ack", createdByAgent: true } satisfies CommentRecord;
  const xml = toAgentXml([{ root, replies: [reply] }]);
  assert.match(xml, /id="12345678a"/);
  assert.match(xml, /id="12345678b"/);
  assert.match(xml, /Use &lt;tag&gt; &amp; &quot;quotes&quot;/);
  assert.match(xml, /block="Block &amp; text"/);
});

test("listComments returns chronological root threads with replies", () => {
  const db = makeDb();
  const taskId = seedTask(db);
  const saved = upsertArtifact(db, taskId, "notes.md", "A\n\nB\n\nC", { createdBy: "test", operation: "test" });
  const version = db.prepare("SELECT id FROM artifact_versions WHERE artifact_id = ?").get(saved.artifact.id) as { id: string };
  const second = createComment(db, saved.artifact.id, version.id, {
    contentText: "second",
    blockText: "C",
    prevBlockText: "B",
    nextBlockText: null,
    anchorJson: anchor(2, "C"),
  });
  const first = createComment(db, saved.artifact.id, version.id, {
    contentText: "first",
    blockText: "B",
    prevBlockText: "A",
    nextBlockText: "C",
    anchorJson: anchor(1, "B"),
  });
  db.prepare("UPDATE comments SET created_at = ? WHERE id = ?").run(1, first.id);
  db.prepare("UPDATE comments SET created_at = ? WHERE id = ?").run(2, second.id);
  const reply = createComment(db, saved.artifact.id, version.id, {
    contentText: "reply",
    blockText: "B",
    prevBlockText: "A",
    nextBlockText: "C",
    anchorJson: anchor(1, "B"),
    replyToId: first.id,
    createdByAgent: true,
  });
  const page = listComments(db, saved.artifact.id);
  assert.deepEqual(page.threads.map((thread) => thread.root.contentText), ["first", "second"]);
  assert.equal(page.threads[0]?.replies[0]?.id, reply.id);
  db.close();
});

test("resolveTruncatedId reports ambiguity and not found", () => {
  const db = makeDb();
  const taskId = seedTask(db);
  const saved = upsertArtifact(db, taskId, "notes.md", "A", { createdBy: "test", operation: "test" });
  const version = db.prepare("SELECT id FROM artifact_versions WHERE artifact_id = ?").get(saved.artifact.id) as { id: string };
  for (const id of ["abcdef12-one", "abcdef12-two"]) {
    db.prepare(`
      INSERT INTO comments (id, artifact_id, version_id, content_text, kind, created_at, updated_at)
      VALUES (?, ?, ?, 'x', 'comment', 1, 1)
    `).run(id, saved.artifact.id, version.id);
  }
  assert.deepEqual(resolveTruncatedId(db, saved.artifact.id, "abcdef12"), { ok: false, code: "ambiguous" });
  assert.deepEqual(resolveTruncatedId(db, saved.artifact.id, "missing"), { ok: false, code: "not_found" });
  assert.deepEqual(resolveTruncatedId(db, saved.artifact.id, "abcdef12-o"), { ok: true, id: "abcdef12-one" });
  db.close();
});

test("comment tool errors outside HumanLayer task sessions", async () => {
  const { bb, harness } = createFakePluginHost({
    pluginId: "humanlayer",
    sdk: { subscribe: () => () => undefined },
  });
  await plugin(bb);
  const result = await harness.behavior.callAgentTool("hl_get_artifact_comments", { artifact_filename: "notes.md" });
  assert.match(typeof result === "string" ? result : JSON.stringify(result), /not a HumanLayer task session/);
  await harness.lifecycle.dispose();
});

test("send-and-resolve resolves only after threads.send succeeds", async () => {
  const { bb, harness } = createFakePluginHost({
    pluginId: "humanlayer",
    sdk: {
      subscribe: () => () => undefined,
      threads: { send: async () => { throw new Error("send failed"); } },
    },
  });
  await plugin(bb);
  const created = await harness.behavior.callRpc("createTask", {
    request: { text: "prompt", projectId: "proj_1", workflowType: "freeform", worktreeTiming: "never", permissionMode: "default", autoAdvance: false },
    name: "Task",
    draft: true,
  }) as { taskId: string };
  const saved = await harness.behavior.callRpc("saveArtifact", { taskId: created.taskId, fileName: "notes.md", content: "A\n\nB" }) as { artifact: { id: string }; version: number };
  const db = bb.storage.database();
  const version = db.prepare("SELECT id FROM artifact_versions WHERE artifact_id = ?").get(saved.artifact.id) as { id: string };
  db.prepare(`
    INSERT INTO sessions (
      thread_id, task_id, label, skill_id, launched_by, forked_from_thread_id,
      hl_status, hl_status_at, had_turn, interrupted, blocked_reason,
      created_at, updated_at
    ) VALUES ('thr_1', ?, NULL, NULL, 'user', NULL, 'ready_for_input', 1, 1, 0, NULL, 1, 1)
  `).run(created.taskId);
  const added = createComment(db, saved.artifact.id, version.id, {
    contentText: "fix this",
    blockText: "A",
    anchorJson: anchor(0, "A"),
  });
  await assert.rejects(
    harness.behavior.callRpc("sendCommentsToSession", { threadId: "thr_1", artifactId: saved.artifact.id, commentIds: [added.id], mode: "send-and-resolve" }),
    /send failed/,
  );
  assert.equal(listComments(db, saved.artifact.id).threads[0]?.root.isResolved, false);
  await harness.lifecycle.dispose();
});
