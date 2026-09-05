import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { MIGRATIONS } from "../db";
import { createDraftTask } from "../tasks";
import { upsertArtifact } from "../artifacts";
import {
  createComment,
  boundedAgentXml,
  listComments,
  reanchor,
  restoreComments,
  resolveTruncatedId,
  sendCommentsToSession,
  setCommentsResolved,
  softDeleteComments,
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

function commentRecord(id: string, contentText: string, blockText: string, replyToId: string | null = null) {
  return {
    id,
    artifactId: "artifact",
    versionId: "version",
    replyToId,
    contentText,
    blockText,
    prevBlockText: null,
    nextBlockText: null,
    anchorJson: anchor(0, blockText),
    kind: "comment",
    isResolved: false,
    isDeleted: false,
    createdByAgent: false,
    createdByThreadId: null,
    createdAt: 1,
    updatedAt: 1,
    anchor: { ...anchor(0, blockText), orphaned: false },
  } satisfies CommentRecord;
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

test("reanchor keeps Astra's changed block attached by unique prev and next context", () => {
  const moved = reanchor(comment({ blockText: "Beta old", anchorJson: anchor(1, "Beta old") }), "Alpha\n\nBeta new\n\nGamma");
  assert.equal(moved.blockIndex, 1);
  assert.equal(moved.orphaned, false);
  assert.equal((moved as { rewritten?: boolean }).rewritten, true);
});

test("reanchor orphans ambiguous similar blocks and disambiguates repeated items by context", () => {
  const ambiguous = reanchor(
    comment({
      blockText: "wind changed east and west marker",
      prevBlockText: "missing",
      nextBlockText: "missing",
      anchorJson: anchor(3, "wind changed east and west marker"),
    }),
    [
      "intro",
      "wind changed east marker",
      "middle",
      "wind changed west marker",
      "outro",
    ].join("\n\n"),
  );
  assert.equal(ambiguous.orphaned, true);

  const repeated = reanchor(
    comment({
      blockText: "- Review item",
      prevBlockText: "- East context",
      nextBlockText: "- West context",
      anchorJson: anchor(1, "- Review item"),
    }),
    [
      "- North context",
      "- Review item",
      "- South context",
      "- East context",
      "- Review item",
      "- West context",
    ].join("\n\n"),
  );
  assert.equal(repeated.orphaned, false);
  assert.equal(repeated.blockIndex, 4);
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

test("agent XML strips invalid XML code points before escaping", () => {
  const root = {
    id: "strip-root",
    artifactId: "artifact",
    versionId: "version",
    replyToId: null,
    contentText: "ok\u0000\u0008\t\n\r\u000b\ud800\ufffe<done>",
    blockText: "block\u0001",
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
  const xml = toAgentXml([{ root, replies: [] }]);
  assert.match(xml, />ok\t\n\r&lt;done&gt;</);
  assert.doesNotMatch(xml, /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ud800\ufffe]/u);
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

test("boundedAgentXml stops at first omitted root and truncates a single oversized thread", () => {
  const root = {
    id: "aaaa-root",
    artifactId: "artifact",
    versionId: "version",
    replyToId: null,
    contentText: "A".repeat(900),
    blockText: "B".repeat(900),
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
  const second = { ...root, id: "bbbb-root", contentText: "small", blockText: "small" } satisfies CommentRecord;
  const page = {
    threads: [{ root, replies: [] }, { root: second, replies: [] }],
    total: 2,
    nextOffset: null,
    offset: 0,
    idPrefixes: new Map([["aaaa-root", "aaaa"], ["bbbb-root", "bbbb"]]),
  };
  const xml = boundedAgentXml(page, 420);
  assert.ok(Buffer.byteLength(xml, "utf8") <= 420);
  assert.match(xml, /<thread id="aaaa" truncated="true">/);
  assert.match(xml, /next_offset="1"/);
  assert.match(xml, /hint="fetch again with offset 1"/);

  const smallFirst = { ...root, id: "cccc-root", contentText: "small", blockText: "small" } satisfies CommentRecord;
  const omitted = boundedAgentXml({
    ...page,
    threads: [{ root: smallFirst, replies: [] }, { root, replies: [] }, { root: second, replies: [] }],
    total: 3,
    idPrefixes: new Map([["cccc-root", "cccc"], ["aaaa-root", "aaaa"], ["bbbb-root", "bbbb"]]),
  }, 430);
  assert.match(omitted, /<thread id="cccc">/);
  assert.doesNotMatch(omitted, /<thread id="bbbb">/);
  assert.match(omitted, /next_offset="1"/);
});

test("boundedAgentXml never exceeds 40000 bytes for a huge single thread", () => {
  const root = commentRecord("huge-root", "A".repeat(120_000), "B".repeat(120_000));
  const replies = Array.from({ length: 20 }, (_, index) => commentRecord(`huge-reply-${index}`, "R".repeat(5_000), "B", root.id));
  const xml = boundedAgentXml({
    threads: [{ root, replies }],
    total: 1,
    nextOffset: null,
    offset: 0,
    idPrefixes: new Map([[root.id, "huge-root"], ...replies.map((reply) => [reply.id, reply.id] as const)]),
  }, 40_000);
  assert.ok(Buffer.byteLength(xml, "utf8") <= 40_000);
  assert.match(xml, /truncated="true"/);
  assert.match(xml, /replies_omitted="/);
  assert.doesNotMatch(xml, /next_offset=/);
});

test("boundedAgentXml never exceeds 40000 bytes for many small roots and emits no empty trailing fetch", () => {
  const threads = Array.from({ length: 260 }, (_, index) => ({ root: commentRecord(`root-${index}`, `comment-${index}-${"x".repeat(700)}`, `block-${index}`), replies: [] }));
  const idPrefixes = new Map(threads.map((thread) => [thread.root.id, thread.root.id]));
  let offset = 0;
  const seen = new Set<number>();
  while (true) {
    assert.equal(seen.has(offset), false);
    seen.add(offset);
    const pageThreads = threads.slice(offset, offset + 100);
    const xml = boundedAgentXml({
      threads: pageThreads,
      total: threads.length,
      nextOffset: offset + pageThreads.length < threads.length ? offset + pageThreads.length : null,
      offset,
      idPrefixes,
    }, 40_000);
    assert.ok(Buffer.byteLength(xml, "utf8") <= 40_000);
    const nextOffset = /next_offset="(\d+)"/.exec(xml)?.[1];
    if (!nextOffset) break;
    offset = Number(nextOffset);
    assert.ok(offset > 0 && offset < threads.length);
  }
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

test("comment updates restore only the requested deleted id and resolve roots only", () => {
  const db = makeDb();
  const taskId = seedTask(db);
  const saved = upsertArtifact(db, taskId, "notes.md", "A", { createdBy: "test", operation: "test" });
  const version = db.prepare("SELECT id FROM artifact_versions WHERE artifact_id = ?").get(saved.artifact.id) as { id: string };
  const root = createComment(db, saved.artifact.id, version.id, {
    contentText: "root",
    blockText: "A",
    anchorJson: anchor(0, "A"),
  });
  const reply = createComment(db, saved.artifact.id, version.id, {
    contentText: "reply",
    blockText: "A",
    anchorJson: anchor(0, "A"),
    replyToId: root.id,
  });

  softDeleteComments(db, [root.id], saved.artifact.id);
  assert.equal((db.prepare("SELECT is_deleted FROM comments WHERE id = ?").get(root.id) as { is_deleted: number }).is_deleted, 1);
  assert.equal((db.prepare("SELECT is_deleted FROM comments WHERE id = ?").get(reply.id) as { is_deleted: number }).is_deleted, 1);
  assert.deepEqual(restoreComments(db, [root.id], saved.artifact.id), [{ input: root.id, id: root.id, ok: true }]);
  assert.equal((db.prepare("SELECT is_deleted FROM comments WHERE id = ?").get(root.id) as { is_deleted: number }).is_deleted, 0);
  assert.equal((db.prepare("SELECT is_deleted FROM comments WHERE id = ?").get(reply.id) as { is_deleted: number }).is_deleted, 1);
  assert.deepEqual(restoreComments(db, [reply.id], saved.artifact.id), [{ input: reply.id, id: reply.id, ok: true }]);
  assert.deepEqual(setCommentsResolved(db, [root.id], true, saved.artifact.id), [{ input: root.id, id: root.id, ok: true }]);
  assert.deepEqual(setCommentsResolved(db, [reply.id], true, saved.artifact.id), [{ input: reply.id, ok: false, code: "not_a_root" }]);
  assert.deepEqual(setCommentsResolved(db, [root.id], false, saved.artifact.id), [{ input: root.id, id: root.id, ok: true }]);
  assert.equal((db.prepare("SELECT is_resolved FROM comments WHERE id = ?").get(root.id) as { is_resolved: number }).is_resolved, 0);
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

test("comment tools inherit the parent task for recorded agent children", async () => {
  const { bb, harness } = createFakePluginHost({
    pluginId: "humanlayer",
    sdk: { subscribe: () => () => undefined },
  });
  await plugin(bb);
  const created = await harness.behavior.callRpc("createTask", {
    request: { text: "prompt", projectId: "proj_1", workflowType: "freeform", worktreeTiming: "never", permissionMode: "default", autoAdvance: false },
    name: "Task",
    draft: true,
  }) as { taskId: string };
  bb.storage.database().prepare(`
    INSERT INTO sessions (
      thread_id, task_id, label, skill_id, launched_by, forked_from_thread_id,
      hl_status, hl_status_at, had_turn, interrupted, blocked_reason, created_at, updated_at
    ) VALUES ('thr_parent', ?, 'research', 'create-research', 'user', NULL, 'running', 1, 1, 0, NULL, 1, 1)
  `).run(created.taskId);
  await harness.inspection.registrations.hooks["message.dispatch"]?.({
    thread: { id: "thr_child", parentThreadId: "thr_parent" },
    input: { text: "/rpi-agent-codebase-locator find files", blocks: [] },
    parentThreadId: "thr_parent",
    originPluginId: null,
  } as never);
  await harness.behavior.callRpc("saveArtifact", {
    taskId: created.taskId,
    fileName: "notes.md",
    content: "A\n\nB",
  });
  const result = await harness.behavior.callAgentTool("hl_get_artifact_comments", {
    artifact_filename: "notes.md",
  }, { threadId: "thr_child" });
  assert.equal(typeof result === "string" && result.includes("not a HumanLayer task session"), false);
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

test("comment RPC validates version ownership, roots, edit ownership, and realtime kinds", async () => {
  const { bb, harness } = createFakePluginHost({
    pluginId: "humanlayer",
    sdk: { subscribe: () => () => undefined },
  });
  await plugin(bb);
  const created = await harness.behavior.callRpc("createTask", {
    request: { text: "prompt", projectId: "proj_1", workflowType: "freeform", worktreeTiming: "never", permissionMode: "default", autoAdvance: false },
    name: "Task",
    draft: true,
  }) as { taskId: string };
  const saved = await harness.behavior.callRpc("saveArtifact", { taskId: created.taskId, fileName: "notes.md", content: "A\n\nB" }) as { artifact: { id: string } };
  const other = await harness.behavior.callRpc("saveArtifact", { taskId: created.taskId, fileName: "other.md", content: "C" }) as { artifact: { id: string } };
  const db = bb.storage.database();
  const version = db.prepare("SELECT id FROM artifact_versions WHERE artifact_id = ?").get(saved.artifact.id) as { id: string };
  const otherVersion = db.prepare("SELECT id FROM artifact_versions WHERE artifact_id = ?").get(other.artifact.id) as { id: string };

  await assert.rejects(harness.behavior.callRpc("createComment", {
    artifactId: saved.artifact.id,
    versionId: otherVersion.id,
    contentText: "wrong version",
    blockText: "A",
    anchorJson: anchor(0, "A"),
  }), /version does not belong to artifact/);
  await assert.rejects(harness.behavior.callRpc("createComment", {
    artifactId: saved.artifact.id,
    versionId: version.id,
    contentText: "bad block",
    blockText: "A",
    anchorJson: anchor(9, "A"),
  }), /anchor blockIndex out of range/);

  const rootResult = await harness.behavior.callRpc("createComment", {
    artifactId: saved.artifact.id,
    versionId: version.id,
    contentText: "root",
    blockText: "A",
    anchorJson: anchor(0, "A"),
  }) as { comment: { id: string } };
  const createdSignal = harness.inspection.realtimeSignals.at(-2);
  assert.equal(createdSignal?.channel, "hl:comments");
  assert.equal((createdSignal?.payload as { kind?: string }).kind, "created");

  const replyResult = await harness.behavior.callRpc("replyComment", {
    artifactId: saved.artifact.id,
    commentId: rootResult.comment.id,
    content: "reply",
  }) as { comment: { id: string } };
  const repliedSignal = harness.inspection.realtimeSignals.at(-2);
  assert.equal((repliedSignal?.payload as { kind?: string }).kind, "replied");
  await assert.rejects(harness.behavior.callRpc("replyComment", {
    artifactId: saved.artifact.id,
    commentId: replyResult.comment.id,
    content: "reply to reply",
  }), /not_a_root/);
  await assert.rejects(harness.behavior.callRpc("resolveComments", {
    artifactId: saved.artifact.id,
    commentIds: [replyResult.comment.id],
    resolved: true,
  }), /not_a_root/);

  db.prepare("UPDATE comments SET created_by_agent = 1 WHERE id = ?").run(rootResult.comment.id);
  await assert.rejects(harness.behavior.callRpc("editComment", {
    commentId: rootResult.comment.id,
    content: "edit",
  }), /cannot edit agent comments/);
  await harness.lifecycle.dispose();
});

test("sendCommentsToSession splits selected roots without dropping requested ids", async () => {
  const sent: string[] = [];
  const bb = {
    sdk: {
      threads: {
        send: async (input: { input: Array<{ text: string }> }) => {
          sent.push(input.input[0]!.text);
        },
      },
    },
  } as unknown as Parameters<typeof sendCommentsToSession>[0];
  const db = makeDb();
  const taskId = seedTask(db);
  const saved = upsertArtifact(db, taskId, "notes.md", "A\n\nB\n\nC", { createdBy: "test", operation: "test" });
  db.prepare(`
    INSERT INTO sessions (
      thread_id, task_id, label, skill_id, launched_by, forked_from_thread_id,
      hl_status, hl_status_at, had_turn, interrupted, blocked_reason,
      created_at, updated_at
    ) VALUES ('thr_1', ?, NULL, NULL, 'user', NULL, 'ready_for_input', 1, 1, 0, NULL, 1, 1)
  `).run(taskId);
  const version = db.prepare("SELECT id FROM artifact_versions WHERE artifact_id = ?").get(saved.artifact.id) as { id: string };
  const comments = ["A", "B", "C"].map((blockText, index) => createComment(db, saved.artifact.id, version.id, {
    contentText: `${blockText}${"x".repeat(120)}`,
    blockText,
    anchorJson: anchor(index, blockText),
  }));
  const result = await sendCommentsToSession(bb, db, "thr_1", saved.artifact.id, comments.map((item) => item.id), "send-and-resolve", {
    requestId: "request-1",
    byteLimit: 520,
  });
  assert.equal(result.sent, 3);
  assert.equal(sent.length > 1, true);
  assert.deepEqual(comments.map((item) => (db.prepare("SELECT is_resolved FROM comments WHERE id = ?").get(item.id) as { is_resolved: number }).is_resolved), [1, 1, 1]);
  const sentCount = sent.length;
  const duplicate = await sendCommentsToSession(bb, db, "thr_1", saved.artifact.id, comments.map((item) => item.id), "send-and-resolve", {
    requestId: "request-1",
    byteLimit: 520,
  });
  assert.equal(duplicate.sent, 3);
  assert.equal(sent.length, sentCount);
  db.close();
});

test("sendCommentsToSession claims request ids and resumes undelivered chunks", async () => {
  let releaseFirstSend!: () => void;
  const firstSendGate = new Promise<void>((resolve) => { releaseFirstSend = resolve; });
  let waitOnFirstSend = true;
  let failSecondSend = false;
  const sent: string[] = [];
  const bb = {
    sdk: {
      threads: {
        send: async (input: { input: Array<{ text: string }> }) => {
          sent.push(input.input[0]!.text);
          if (sent.length === 1 && waitOnFirstSend) {
            waitOnFirstSend = false;
            await firstSendGate;
          }
          if (failSecondSend && sent.length === 2) throw new Error("second send failed");
        },
      },
    },
  } as unknown as Parameters<typeof sendCommentsToSession>[0];
  const db = makeDb();
  const taskId = seedTask(db);
  const saved = upsertArtifact(db, taskId, "notes.md", "A\n\nB\n\nC", { createdBy: "test", operation: "test" });
  db.prepare(`
    INSERT INTO sessions (
      thread_id, task_id, label, skill_id, launched_by, forked_from_thread_id,
      hl_status, hl_status_at, had_turn, interrupted, blocked_reason,
      created_at, updated_at
    ) VALUES ('thr_1', ?, NULL, NULL, 'user', NULL, 'ready_for_input', 1, 1, 0, NULL, 1, 1)
  `).run(taskId);
  const version = db.prepare("SELECT id FROM artifact_versions WHERE artifact_id = ?").get(saved.artifact.id) as { id: string };
  const comments = ["A", "B", "C"].map((blockText, index) => createComment(db, saved.artifact.id, version.id, {
    contentText: `${blockText}${"x".repeat(120)}`,
    blockText,
    anchorJson: anchor(index, blockText),
  }));

  const first = sendCommentsToSession(bb, db, "thr_1", saved.artifact.id, comments.map((item) => item.id), "send", {
    requestId: "request-pending",
    byteLimit: 520,
  });
  const pending = await sendCommentsToSession(bb, db, "thr_1", saved.artifact.id, comments.map((item) => item.id), "send", {
    requestId: "request-pending",
    byteLimit: 520,
  });
  assert.deepEqual(pending, { sent: 0, status: "pending" });
  releaseFirstSend();
  assert.equal((await first).sent, 3);

  sent.length = 0;
  failSecondSend = true;
  await assert.rejects(sendCommentsToSession(bb, db, "thr_1", saved.artifact.id, comments.map((item) => item.id), "send", {
    requestId: "request-resume",
    byteLimit: 520,
  }), /second send failed/);
  assert.deepEqual(JSON.parse((db.prepare("SELECT delivered_chunk_indexes_json FROM send_receipts WHERE request_id = 'request-resume'").get() as { delivered_chunk_indexes_json: string }).delivered_chunk_indexes_json), [0]);

  failSecondSend = false;
  sent.length = 0;
  const resumed = await sendCommentsToSession(bb, db, "thr_1", saved.artifact.id, comments.map((item) => item.id), "send", {
    requestId: "request-resume",
    byteLimit: 520,
  });
  assert.equal(resumed.sent, 3);
  assert.equal(sent.length, 2);
  db.close();
});
