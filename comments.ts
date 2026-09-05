import { randomUUID } from "node:crypto";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type * as BetterSqlite3 from "better-sqlite3";
import { getArtifactVersion } from "./artifacts";
import { nowMs, parseJson, readRow, readRows, stringifyJson, transaction, writeRow } from "./db";

type Database = BetterSqlite3.Database;

export type CommentAnchor = {
  v: 1;
  blockIndex: number;
  start: number;
  end: number;
  selectedText: string;
};

export type CommentRecord = {
  id: string;
  artifactId: string;
  versionId: string;
  replyToId: string | null;
  contentText: string;
  blockText: string | null;
  prevBlockText: string | null;
  nextBlockText: string | null;
  anchorJson: CommentAnchor | null;
  kind: string;
  isResolved: boolean;
  isDeleted: boolean;
  createdByAgent: boolean;
  createdByThreadId: string | null;
  createdAt: number;
  updatedAt: number;
  anchor: (CommentAnchor & { orphaned: boolean }) | null;
};

export type CommentThread = {
  root: CommentRecord;
  replies: CommentRecord[];
};

type RawComment = {
  id: string;
  artifactId: string;
  versionId: string;
  replyToId: string | null;
  contentText: string;
  blockText: string | null;
  prevBlockText: string | null;
  nextBlockText: string | null;
  anchorJson: string | null;
  kind: string;
  isResolved: number | boolean;
  isDeleted: number | boolean;
  createdByAgent: number | boolean;
  createdByThreadId: string | null;
  createdAt: number;
  updatedAt: number;
};

const XML_LIMIT_BYTES = 40_000;

export function markdownBlocks(text: string) {
  const blocks: Array<{ index: number; text: string; start: number; end: number }> = [];
  let start = 0;
  let cursor = 0;
  let inFence = false;
  const lines = text.match(/[^\n]*(?:\n|$)/g) ?? [];
  for (const line of lines) {
    if (line === "") break;
    const lineStart = cursor;
    cursor += line.length;
    if (/^\s*```/.test(line)) inFence = !inFence;
    if (!inFence && line.trim() === "") {
      const blockText = text.slice(start, lineStart).trim();
      if (blockText) blocks.push({ index: blocks.length, text: blockText, start, end: lineStart });
      start = cursor;
    }
  }
  const tail = text.slice(start).trim();
  if (tail) blocks.push({ index: blocks.length, text: tail, start, end: text.length });
  return blocks;
}

export function normalizeComment(row: RawComment, currentText: string | null): CommentRecord {
  const anchorJson = parseJson<CommentAnchor | null>(row.anchorJson, null);
  const base = {
    id: row.id,
    artifactId: row.artifactId,
    versionId: row.versionId,
    replyToId: row.replyToId,
    contentText: row.contentText,
    blockText: row.blockText,
    prevBlockText: row.prevBlockText,
    nextBlockText: row.nextBlockText,
    anchorJson,
    kind: row.kind,
    isResolved: Boolean(row.isResolved),
    isDeleted: Boolean(row.isDeleted),
    createdByAgent: Boolean(row.createdByAgent),
    createdByThreadId: row.createdByThreadId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
  const anchor = currentText === null || !row.blockText || !anchorJson ? null : reanchor(base, currentText);
  return { ...base, anchor };
}

function rowsForArtifact(db: Database, artifactId: string) {
  return readRows<RawComment>(
    db,
    `
    SELECT
      id,
      artifact_id AS artifactId,
      version_id AS versionId,
      reply_to_id AS replyToId,
      content_text AS contentText,
      block_text AS blockText,
      prev_block_text AS prevBlockText,
      next_block_text AS nextBlockText,
      anchor_json AS anchorJson,
      kind,
      is_resolved AS isResolved,
      is_deleted AS isDeleted,
      created_by_agent AS createdByAgent,
      created_by_thread_id AS createdByThreadId,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM comments
    WHERE artifact_id = ? AND is_deleted = 0
    ORDER BY created_at ASC, id ASC
    `,
    artifactId,
  );
}

function currentVersionText(db: Database, artifactId: string) {
  const row = readRow<{ taskId: string; fileName: string }>(
    db,
    "SELECT task_id AS taskId, file_name AS fileName FROM artifacts WHERE id = ?",
    artifactId,
  );
  if (!row) return null;
  return getArtifactVersion(db, row.taskId, row.fileName)?.version.content.toString("utf8") ?? null;
}

export function listComments(db: Database, artifactId: string, options: { includeResolved?: boolean; limit?: number; offset?: number } = {}) {
  const limit = Math.min(100, Math.max(1, options.limit ?? 50));
  const offset = Math.max(0, options.offset ?? 0);
  const text = currentVersionText(db, artifactId);
  const comments = rowsForArtifact(db, artifactId).map((row) => normalizeComment(row, text));
  const byParent = new Map<string | null, CommentRecord[]>();
  for (const comment of comments) {
    const key = comment.replyToId;
    byParent.set(key, [...(byParent.get(key) ?? []), comment]);
  }
  const roots = (byParent.get(null) ?? []).filter((comment) => options.includeResolved || !comment.isResolved);
  const page = roots.slice(offset, offset + limit);
  return {
    threads: page.map((root) => ({
      root,
      replies: (byParent.get(root.id) ?? []).map((reply) => ({ ...reply, anchor: root.anchor })),
    })),
    total: roots.length,
    nextOffset: offset + page.length < roots.length ? offset + page.length : null,
  };
}

export function createComment(
  db: Database,
  artifactId: string,
  versionId: string,
  input: {
    contentText: string;
    blockText: string;
    prevBlockText?: string | null;
    nextBlockText?: string | null;
    anchorJson: CommentAnchor;
    replyToId?: string | null;
    createdByThreadId?: string | null;
    createdByAgent?: boolean;
  },
) {
  const timestamp = nowMs();
  const id = randomUUID();
  writeRow(
    db,
    `
    INSERT INTO comments (
      id, artifact_id, version_id, reply_to_id, content_text, block_text, prev_block_text,
      next_block_text, anchor_json, kind, is_resolved, is_deleted, created_by_agent,
      created_by_thread_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'comment', 0, 0, ?, ?, ?, ?)
    `,
    id,
    artifactId,
    versionId,
    input.replyToId ?? null,
    input.contentText,
    input.blockText,
    input.prevBlockText ?? null,
    input.nextBlockText ?? null,
    stringifyJson(input.anchorJson),
    input.createdByAgent ? 1 : 0,
    input.createdByThreadId ?? null,
    timestamp,
    timestamp,
  );
  return readComment(db, id)!;
}

export function replyToComment(
  db: Database,
  artifactId: string,
  commentId: string,
  contentText: string,
  options: { createdByThreadId?: string | null; createdByAgent?: boolean } = {},
) {
  const root = readComment(db, commentId);
  if (!root || root.artifactId !== artifactId || root.isDeleted) return null;
  const replyToId = root.replyToId ?? root.id;
  return createComment(db, artifactId, root.versionId, {
    contentText,
    blockText: root.blockText ?? "",
    prevBlockText: root.prevBlockText,
    nextBlockText: root.nextBlockText,
    anchorJson: root.anchorJson ?? { v: 1, blockIndex: 0, start: 0, end: 0, selectedText: "" },
    replyToId,
    createdByThreadId: options.createdByThreadId ?? null,
    createdByAgent: options.createdByAgent ?? false,
  });
}

export function editComment(db: Database, id: string, contentText: string) {
  writeRow(db, "UPDATE comments SET content_text = ?, updated_at = ? WHERE id = ? AND is_deleted = 0", contentText, nowMs(), id);
  return readComment(db, id);
}

export function setCommentsResolved(db: Database, ids: string[], resolved: boolean, artifactId?: string) {
  const update = transaction(db, () => {
    for (const id of ids) {
      writeRow(
        db,
        `UPDATE comments SET is_resolved = ?, updated_at = ? WHERE id = ? AND reply_to_id IS NULL AND is_deleted = 0 ${artifactId ? "AND artifact_id = ?" : ""}`,
        ...(artifactId ? [resolved ? 1 : 0, nowMs(), id, artifactId] : [resolved ? 1 : 0, nowMs(), id]),
      );
    }
  });
  update();
}

export function softDeleteComments(db: Database, ids: string[], artifactId?: string) {
  const update = transaction(db, () => {
    for (const id of ids) {
      writeRow(
        db,
        `UPDATE comments SET is_deleted = 1, updated_at = ? WHERE (id = ? OR reply_to_id = ?) AND is_deleted = 0 ${artifactId ? "AND artifact_id = ?" : ""}`,
        ...(artifactId ? [nowMs(), id, id, artifactId] : [nowMs(), id, id]),
      );
    }
  });
  update();
}

export function readComment(db: Database, id: string) {
  const row = readRow<RawComment>(
    db,
    `
    SELECT
      id,
      artifact_id AS artifactId,
      version_id AS versionId,
      reply_to_id AS replyToId,
      content_text AS contentText,
      block_text AS blockText,
      prev_block_text AS prevBlockText,
      next_block_text AS nextBlockText,
      anchor_json AS anchorJson,
      kind,
      is_resolved AS isResolved,
      is_deleted AS isDeleted,
      created_by_agent AS createdByAgent,
      created_by_thread_id AS createdByThreadId,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM comments
    WHERE id = ?
    `,
    id,
  );
  return row ? normalizeComment(row, null) : null;
}

export function resolveTruncatedId(db: Database, artifactId: string, prefix: string) {
  const rows = readRows<{ id: string }>(db, "SELECT id FROM comments WHERE artifact_id = ? AND is_deleted = 0 AND id LIKE ? ORDER BY id ASC", artifactId, `${prefix}%`);
  if (rows.length === 0) return { ok: false as const, code: "not_found" as const };
  if (rows.length > 1) return { ok: false as const, code: "ambiguous" as const };
  return { ok: true as const, id: rows[0]!.id };
}

export function reanchor(
  comment: Pick<CommentRecord, "blockText" | "prevBlockText" | "nextBlockText" | "anchorJson">,
  newVersionText: string,
) {
  const blocks = markdownBlocks(newVersionText);
  const originalIndex = comment.anchorJson?.blockIndex ?? 0;
  const makeAnchor = (block: (typeof blocks)[number], orphaned = false) => ({
    v: 1 as const,
    blockIndex: block.index,
    start: block.start,
    end: block.end,
    selectedText: comment.anchorJson?.selectedText ?? comment.blockText ?? "",
    orphaned,
  });
  const nearest = (candidates: typeof blocks) => candidates.sort((left, right) => Math.abs(left.index - originalIndex) - Math.abs(right.index - originalIndex))[0];
  const exact = nearest(blocks.filter((block) => block.text === comment.blockText));
  if (exact) return makeAnchor(exact);
  const context = blocks.filter((block) => {
    const prev = blocks[block.index - 1]?.text ?? null;
    const next = blocks[block.index + 1]?.text ?? null;
    return prev === (comment.prevBlockText ?? null) && next === (comment.nextBlockText ?? null);
  });
  if (context.length === 1) return makeAnchor(context[0]!);
  const scored = blocks
    .map((block) => ({ block, score: tokenRatio(comment.blockText ?? "", block.text) }))
    .filter((item) => item.score >= 0.8)
    .sort((left, right) => right.score - left.score || Math.abs(left.block.index - originalIndex) - Math.abs(right.block.index - originalIndex));
  if (scored[0] && scored[0].score > (scored[1]?.score ?? 0)) return makeAnchor(scored[0].block);
  return {
    v: 1 as const,
    blockIndex: originalIndex,
    start: comment.anchorJson?.start ?? 0,
    end: comment.anchorJson?.end ?? 0,
    selectedText: comment.anchorJson?.selectedText ?? comment.blockText ?? "",
    orphaned: true,
  };
}

function tokenRatio(left: string, right: string) {
  const a = normalizeText(left).split(" ").filter(Boolean);
  const b = normalizeText(right).split(" ").filter(Boolean);
  if (a.length === 0 || b.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const token of a) counts.set(token, (counts.get(token) ?? 0) + 1);
  let hits = 0;
  for (const token of b) {
    const count = counts.get(token) ?? 0;
    if (count > 0) {
      hits += 1;
      counts.set(token, count - 1);
    }
  }
  return hits / Math.max(a.length, b.length);
}

function normalizeText(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

export function toAgentXml(threads: CommentThread[], options: { truncatedIds?: string[]; total?: number; nextOffset?: number | null } = {}) {
  const prefixes = idPrefixes(threads.flatMap((thread) => [thread.root, ...thread.replies]).map((comment) => comment.id));
  const attrs = [
    `total="${options.total ?? threads.length}"`,
    options.nextOffset === null || options.nextOffset === undefined ? null : `next_offset="${options.nextOffset}"`,
  ].filter(Boolean).join(" ");
  const lines = [`<artifact_comments ${attrs}>`];
  for (const thread of threads) {
    lines.push(`  <thread id="${escapeXml(prefixes.get(thread.root.id) ?? thread.root.id.slice(0, 8))}">`);
    lines.push(commentXml(thread.root, prefixes, "    "));
    for (const reply of thread.replies) lines.push(commentXml(reply, prefixes, "    ", "reply"));
    lines.push("  </thread>");
  }
  if (options.truncatedIds?.length) {
    lines.push(`  <truncated>${options.truncatedIds.map(escapeXml).join(",")}</truncated>`);
  }
  lines.push("</artifact_comments>");
  return lines.join("\n");
}

export function boundedAgentXml(page: ReturnType<typeof listComments>, byteLimit = XML_LIMIT_BYTES) {
  const included: CommentThread[] = [];
  const truncatedIds: string[] = [];
  for (const thread of page.threads) {
    const next = toAgentXml([...included, thread], { total: page.total, nextOffset: page.nextOffset, truncatedIds });
    if (Buffer.byteLength(next, "utf8") > byteLimit) {
      truncatedIds.push(thread.root.id.slice(0, 8));
      continue;
    }
    included.push(thread);
  }
  return toAgentXml(included, { total: page.total, nextOffset: page.nextOffset, truncatedIds });
}

function idPrefixes(ids: string[]) {
  const result = new Map<string, string>();
  for (const id of ids) {
    for (let length = 8; length <= id.length; length += 1) {
      const prefix = id.slice(0, length);
      if (ids.filter((candidate) => candidate.startsWith(prefix)).length === 1) {
        result.set(id, prefix);
        break;
      }
    }
  }
  return result;
}

function commentXml(comment: CommentRecord, prefixes: Map<string, string>, indent: string, tag = "comment") {
  const author = comment.createdByAgent ? "Agent" : "You";
  const block = comment.anchor?.orphaned ? "unanchored" : comment.blockText ?? "";
  return `${indent}<${tag} id="${escapeXml(prefixes.get(comment.id) ?? comment.id.slice(0, 8))}" author="${author}" resolved="${comment.isResolved ? "true" : "false"}" block="${escapeXml(block)}">${escapeXml(comment.contentText)}</${tag}>`;
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}

export async function sendCommentsToSession(
  bb: BbPluginApi,
  db: Database,
  threadId: string,
  artifactId: string,
  commentIds: string[],
  mode: "send" | "send-and-resolve",
) {
  const artifact = readRow<{ taskId: string; fileName: string }>(db, "SELECT task_id AS taskId, file_name AS fileName FROM artifacts WHERE id = ?", artifactId);
  if (!artifact) throw new Error("artifact not found");
  const session = readRow<{ taskId: string }>(db, "SELECT task_id AS taskId FROM sessions WHERE thread_id = ?", threadId);
  if (!session || session.taskId !== artifact.taskId) throw new Error("not a HumanLayer task session");
  const selected = new Set(commentIds);
  const all = listComments(db, artifactId, { includeResolved: true, limit: 100, offset: 0 });
  const threads = all.threads.filter((thread) => selected.has(thread.root.id));
  const xml = boundedAgentXml({ ...all, threads, total: threads.length, nextOffset: null });
  const text = `Please review the following comments on ${artifact.fileName} and address them:\n\n${xml}`;
  await bb.sdk.threads.send({ threadId, mode: "auto", input: [{ type: "text", text }] } as never);
  if (mode === "send-and-resolve") setCommentsResolved(db, threads.map((thread) => thread.root.id), true);
  return { sent: threads.length };
}
