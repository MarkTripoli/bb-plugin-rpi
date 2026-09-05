import { randomUUID } from "node:crypto";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type * as BetterSqlite3 from "better-sqlite3";
import { getArtifactVersion } from "./artifacts";
import { markdownBlocks, type MarkdownBlock } from "./blocks";
import { nowMs, parseJson, readRow, readRows, stringifyJson, transaction, writeRow } from "./db";

type Database = BetterSqlite3.Database;

export type CommentAnchor = {
  v: 1;
  blockIndex: number;
  start: number;
  end: number;
  selectedText: string;
  rewritten?: boolean;
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
  anchor: (CommentAnchor & { orphaned: boolean; rewritten?: boolean }) | null;
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
const SEND_RECEIPT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const inFlightSendRequests = new Set<string>();

type CommentPage = {
  threads: CommentThread[];
  total: number;
  nextOffset: number | null;
  offset: number;
  idPrefixes: Map<string, string>;
};

type SendReceipt = {
  sentIdsJson: string;
  status: "pending" | "done";
  deliveredChunkIndexesJson: string;
};

export type CommentMutationResult =
  | { input: string; id: string; ok: true }
  | { input: string; ok: false; code: "not_found" | "ambiguous" | "not_a_root" };

export function normalizeComment(row: RawComment, currentBlocks: MarkdownBlock[] | null): CommentRecord {
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
  const anchor = currentBlocks === null || !row.blockText || !anchorJson ? null : reanchor(base, currentBlocks);
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
  const currentBlocks = text === null ? null : markdownBlocks(text);
  const rows = rowsForArtifact(db, artifactId);
  const idPrefixes = idPrefixesForIds(rows.map((row) => row.id));
  const rawByParent = new Map<string | null, RawComment[]>();
  for (const row of rows) {
    rawByParent.set(row.replyToId, [...(rawByParent.get(row.replyToId) ?? []), row]);
  }
  const roots = (rawByParent.get(null) ?? []).filter((comment) => options.includeResolved || !Boolean(comment.isResolved));
  const page = roots.slice(offset, offset + limit);
  return {
    threads: page.map((rootRow) => {
      const root = normalizeComment(rootRow, currentBlocks);
      const replies = (rawByParent.get(root.id) ?? []).map((reply) => ({ ...normalizeComment(reply, currentBlocks), anchor: root.anchor }));
      return { root, replies };
    }),
    total: roots.length,
    nextOffset: offset + page.length < roots.length ? offset + page.length : null,
    offset,
    idPrefixes,
  } satisfies CommentPage;
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
  if (!root || root.artifactId !== artifactId || root.isDeleted || root.replyToId !== null) return null;
  return createComment(db, artifactId, root.versionId, {
    contentText,
    blockText: root.blockText ?? "",
    prevBlockText: root.prevBlockText,
    nextBlockText: root.nextBlockText,
    anchorJson: root.anchorJson ?? { v: 1, blockIndex: 0, start: 0, end: 0, selectedText: "" },
    replyToId: root.id,
    createdByThreadId: options.createdByThreadId ?? null,
    createdByAgent: options.createdByAgent ?? false,
  });
}

export function editComment(db: Database, id: string, contentText: string) {
  writeRow(db, "UPDATE comments SET content_text = ?, updated_at = ? WHERE id = ? AND is_deleted = 0", contentText, nowMs(), id);
  return readComment(db, id);
}

export function setCommentsResolved(db: Database, ids: string[], resolved: boolean, artifactId?: string) {
  const results: CommentMutationResult[] = [];
  const update = transaction(db, () => {
    for (const id of ids) {
      const comment = readComment(db, id);
      if (!comment || comment.isDeleted || (artifactId && comment.artifactId !== artifactId)) {
        results.push({ input: id, ok: false, code: "not_found" });
        continue;
      }
      if (comment.replyToId !== null) {
        results.push({ input: id, ok: false, code: "not_a_root" });
        continue;
      }
      writeRow(
        db,
        `UPDATE comments SET is_resolved = ?, updated_at = ? WHERE id = ? AND reply_to_id IS NULL AND is_deleted = 0 ${artifactId ? "AND artifact_id = ?" : ""}`,
        ...(artifactId ? [resolved ? 1 : 0, nowMs(), id, artifactId] : [resolved ? 1 : 0, nowMs(), id]),
      );
      results.push({ input: id, id, ok: true });
    }
  });
  update();
  return results;
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

export function restoreComments(db: Database, ids: string[], artifactId?: string) {
  const results: CommentMutationResult[] = [];
  const update = transaction(db, () => {
    for (const id of ids) {
      const comment = readComment(db, id);
      if (!comment || (artifactId && comment.artifactId !== artifactId)) {
        results.push({ input: id, ok: false, code: "not_found" });
        continue;
      }
      writeRow(
        db,
        `UPDATE comments SET is_deleted = 0, updated_at = ? WHERE id = ? ${artifactId ? "AND artifact_id = ?" : ""}`,
        ...(artifactId ? [nowMs(), id, artifactId] : [nowMs(), id]),
      );
      results.push({ input: id, id, ok: true });
    }
  });
  update();
  return results;
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

export function resolveTruncatedId(db: Database, artifactId: string, prefix: string, options: { includeDeleted?: boolean } = {}) {
  const rows = readRows<{ id: string }>(
    db,
    `SELECT id FROM comments WHERE artifact_id = ? ${options.includeDeleted ? "" : "AND is_deleted = 0"} AND id LIKE ? ORDER BY id ASC`,
    artifactId,
    `${prefix}%`,
  );
  if (rows.length === 0) return { ok: false as const, code: "not_found" as const };
  if (rows.length > 1) return { ok: false as const, code: "ambiguous" as const };
  return { ok: true as const, id: rows[0]!.id };
}

export function reanchor(
  comment: Pick<CommentRecord, "blockText" | "prevBlockText" | "nextBlockText" | "anchorJson">,
  newVersionText: string | MarkdownBlock[],
) {
  const blocks = typeof newVersionText === "string" ? markdownBlocks(newVersionText) : newVersionText;
  const originalIndex = comment.anchorJson?.blockIndex ?? 0;
  const makeAnchor = (block: MarkdownBlock, orphaned = false, rewritten = false) => ({
    v: 1 as const,
    blockIndex: block.index,
    start: block.start,
    end: block.end,
    selectedText: comment.anchorJson?.selectedText ?? comment.blockText ?? "",
    orphaned,
    ...(rewritten ? { rewritten } : {}),
  });
  const orphan = () => ({
    v: 1 as const,
    blockIndex: originalIndex,
    start: comment.anchorJson?.start ?? 0,
    end: comment.anchorJson?.end ?? 0,
    selectedText: comment.anchorJson?.selectedText ?? comment.blockText ?? "",
    orphaned: true,
  });
  const exact = blocks.filter((block) => block.text === comment.blockText);
  const bothContext = exact.filter((block) => {
    const prev = blocks[block.index - 1]?.text ?? null;
    const next = blocks[block.index + 1]?.text ?? null;
    return prev === (comment.prevBlockText ?? null) && next === (comment.nextBlockText ?? null);
  });
  if (bothContext.length === 1) return makeAnchor(bothContext[0]!);
  if (exact.length === 0 && comment.prevBlockText !== null && comment.prevBlockText !== undefined && comment.nextBlockText !== null && comment.nextBlockText !== undefined) {
    const changedWithContext = blocks.filter((block) => {
      const prev = blocks[block.index - 1]?.text ?? null;
      const next = blocks[block.index + 1]?.text ?? null;
      return prev === comment.prevBlockText && next === comment.nextBlockText;
    });
    if (changedWithContext.length === 1) return makeAnchor(changedWithContext[0]!, false, true);
  }
  if (exact.length === 1) return makeAnchor(exact[0]!);
  if (exact.length > 1) {
    const hasPrev = comment.prevBlockText !== null && comment.prevBlockText !== undefined;
    const hasNext = comment.nextBlockText !== null && comment.nextBlockText !== undefined;
    const oneContext = exact.filter((block) => {
      const prev = blocks[block.index - 1]?.text ?? null;
      const next = blocks[block.index + 1]?.text ?? null;
      return (hasPrev && prev === comment.prevBlockText) || (hasNext && next === comment.nextBlockText);
    });
    if (oneContext.length === 1) return makeAnchor(oneContext[0]!);
    const inWindow = exact.filter((block) => Math.abs(block.index - originalIndex) <= 2);
    if (oneContext.length === 0 && inWindow.length === 1) return makeAnchor(inWindow[0]!);
    return orphan();
  }
  const scored = blocks
    .map((block) => ({ block, score: tokenRatio(comment.blockText ?? "", block.text) }))
    .sort((left, right) => right.score - left.score || Math.abs(left.block.index - originalIndex) - Math.abs(right.block.index - originalIndex));
  const candidates = scored.filter((item) => item.score >= 0.8);
  if (candidates.length === 1 && (scored[1]?.score ?? 0) < 0.6) return makeAnchor(candidates[0]!.block);
  return orphan();
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

export function toAgentXml(
  threads: CommentThread[],
  options: {
    truncatedIds?: string[];
    total?: number;
    nextOffset?: number | null;
    idPrefixes?: Map<string, string>;
    truncatedThreadIds?: Set<string>;
    omittedReplies?: Map<string, number>;
    hint?: string;
  } = {},
) {
  const prefixes = options.idPrefixes ?? idPrefixesForIds(threads.flatMap((thread) => [thread.root, ...thread.replies]).map((comment) => comment.id));
  const attrs = [
    `total="${options.total ?? threads.length}"`,
    options.nextOffset === null || options.nextOffset === undefined ? null : `next_offset="${options.nextOffset}"`,
  ].filter(Boolean).join(" ");
  const lines = [`<artifact_comments ${attrs}>`];
  for (const thread of threads) {
    const truncated = options.truncatedThreadIds?.has(thread.root.id) ? ` truncated="true"` : "";
    const repliesOmitted = options.omittedReplies?.get(thread.root.id);
    const omitted = repliesOmitted ? ` replies_omitted="${repliesOmitted}"` : "";
    lines.push(`  <thread id="${escapeXml(prefixes.get(thread.root.id) ?? thread.root.id.slice(0, 8))}"${truncated}${omitted}>`);
    lines.push(commentXml(thread.root, prefixes, "    "));
    for (const reply of thread.replies) lines.push(commentXml(reply, prefixes, "    ", "reply"));
    lines.push("  </thread>");
  }
  if (options.truncatedIds?.length) {
    const hint = options.hint ? ` hint="${escapeXml(options.hint)}"` : "";
    lines.push(`  <truncated${hint}>${options.truncatedIds.map(escapeXml).join(",")}</truncated>`);
  }
  lines.push("</artifact_comments>");
  return lines.join("\n");
}

export function boundedAgentXml(page: ReturnType<typeof listComments>, byteLimit = XML_LIMIT_BYTES) {
  const included: CommentThread[] = [];
  const truncation = (offset: number, thread: CommentThread) => ({
    truncatedIds: [page.idPrefixes.get(thread.root.id) ?? thread.root.id.slice(0, 8)],
    hint: `fetch again with offset ${offset}`,
  });
  for (const thread of page.threads) {
    const nextOffset = page.offset + included.length + 1;
    const next = toAgentXml([...included, thread], {
      total: page.total,
      nextOffset: nextOffset < page.total ? nextOffset : null,
      idPrefixes: page.idPrefixes,
      ...(nextOffset < page.total ? truncation(nextOffset, page.threads[included.length + 1] ?? thread) : {}),
    });
    if (Buffer.byteLength(next, "utf8") > byteLimit) {
      if (included.length === 0) return truncatedThreadXml(page, thread, byteLimit);
      const nextOffset = page.offset + included.length;
      return toAgentXml(included, {
        total: page.total,
        nextOffset,
        idPrefixes: page.idPrefixes,
        ...truncation(nextOffset, thread),
      });
    }
    included.push(thread);
  }
  return toAgentXml(included, { total: page.total, nextOffset: page.nextOffset, idPrefixes: page.idPrefixes });
}

function truncatedThreadXml(page: ReturnType<typeof listComments>, thread: CommentThread, byteLimit: number) {
  const nextOffset = page.offset + 1 < page.total ? page.offset + 1 : null;
  const truncatedIds = [page.idPrefixes.get(thread.root.id) ?? thread.root.id.slice(0, 8)];
  const hint = nextOffset === null ? undefined : `fetch again with offset ${nextOffset}`;
  let low = 0;
  let high = Math.max(...[thread.root, ...thread.replies].flatMap((comment) => [comment.contentText.length, comment.blockText?.length ?? 0]));
  let best = truncateThread(thread, 0);
  let bestReplyCount = 0;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = truncateThread(thread, mid);
    const replyCount = maxReplyCount(page, candidate, byteLimit, nextOffset, truncatedIds, hint);
    const xml = toAgentXml([{ root: candidate.root, replies: candidate.replies.slice(0, replyCount) }], {
      total: page.total,
      nextOffset,
      idPrefixes: page.idPrefixes,
      truncatedThreadIds: new Set([thread.root.id]),
      omittedReplies: omittedReplies(thread, replyCount),
      truncatedIds,
      hint,
    });
    if (Buffer.byteLength(xml, "utf8") <= byteLimit) {
      best = candidate;
      bestReplyCount = replyCount;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return toAgentXml([{ root: best.root, replies: best.replies.slice(0, bestReplyCount) }], {
    total: page.total,
    nextOffset,
    idPrefixes: page.idPrefixes,
    truncatedThreadIds: new Set([thread.root.id]),
    omittedReplies: omittedReplies(thread, bestReplyCount),
    truncatedIds,
    hint,
  });
}

function maxReplyCount(page: ReturnType<typeof listComments>, thread: CommentThread, byteLimit: number, nextOffset: number | null, truncatedIds: string[], hint: string | undefined) {
  for (let count = thread.replies.length; count >= 0; count -= 1) {
    const xml = toAgentXml([{ root: thread.root, replies: thread.replies.slice(0, count) }], {
      total: page.total,
      nextOffset,
      idPrefixes: page.idPrefixes,
      truncatedThreadIds: new Set([thread.root.id]),
      omittedReplies: omittedReplies(thread, count),
      truncatedIds,
      hint,
    });
    if (Buffer.byteLength(xml, "utf8") <= byteLimit) return count;
  }
  return 0;
}

function omittedReplies(thread: CommentThread, includedReplyCount: number) {
  const omitted = thread.replies.length - includedReplyCount;
  return omitted > 0 ? new Map([[thread.root.id, omitted]]) : undefined;
}

function truncateThread(thread: CommentThread, maxChars: number): CommentThread {
  return {
    root: truncateComment(thread.root, maxChars),
    replies: thread.replies.map((reply) => truncateComment(reply, maxChars)),
  };
}

function truncateComment(comment: CommentRecord, maxChars: number): CommentRecord {
  return {
    ...comment,
    contentText: truncateValue(comment.contentText, maxChars),
    blockText: comment.blockText === null ? null : truncateValue(comment.blockText, maxChars),
  };
}

function truncateValue(value: string, maxChars: number) {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}[truncated]`;
}

function idPrefixesForIds(ids: string[]) {
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
  return stripInvalidXmlCodePoints(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}

function stripInvalidXmlCodePoints(value: string) {
  let result = "";
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        const point = value.codePointAt(index)!;
        if (point !== 0xfffe && point !== 0xffff) result += value[index] + value[index + 1];
        index += 1;
      }
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) continue;
    if ((code >= 0x00 && code <= 0x08) || (code >= 0x0b && code <= 0x0c) || (code >= 0x0e && code <= 0x1f)) continue;
    if (code === 0xfffe || code === 0xffff) continue;
    result += value[index];
  }
  return result;
}

function selectedThreadsByRootIds(db: Database, artifactId: string, commentIds: string[], includeResolved: boolean) {
  const text = currentVersionText(db, artifactId);
  const currentBlocks = text === null ? null : markdownBlocks(text);
  const rows = rowsForArtifact(db, artifactId);
  const idPrefixes = idPrefixesForIds(rows.map((row) => row.id));
  const byId = new Map(rows.map((row) => [row.id, row]));
  const byParent = new Map<string | null, RawComment[]>();
  for (const row of rows) byParent.set(row.replyToId, [...(byParent.get(row.replyToId) ?? []), row]);
  const seen = new Set<string>();
  const threads: CommentThread[] = [];
  for (const id of commentIds) {
    const row = byId.get(id);
    if (!row) throw new Error(`comment not found: ${id}`);
    if (row.replyToId !== null) throw new Error(`not_a_root: ${id}`);
    if (!includeResolved && Boolean(row.isResolved)) continue;
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    const root = normalizeComment(row, currentBlocks);
    threads.push({
      root,
      replies: (byParent.get(root.id) ?? []).map((reply) => ({ ...normalizeComment(reply, currentBlocks), anchor: root.anchor })),
    });
  }
  return { threads, total: threads.length, nextOffset: null, offset: 0, idPrefixes } satisfies CommentPage;
}

function sendXmlChunks(page: CommentPage, byteLimit: number) {
  const chunks: CommentThread[][] = [];
  let current: CommentThread[] = [];
  for (const thread of page.threads) {
    const single = toAgentXml([thread], { total: 1, nextOffset: null, idPrefixes: page.idPrefixes });
    if (Buffer.byteLength(single, "utf8") > byteLimit) throw new Error("selection too large, send fewer comments");
    const next = [...current, thread];
    const xml = toAgentXml(next, { total: next.length, nextOffset: null, idPrefixes: page.idPrefixes });
    if (Buffer.byteLength(xml, "utf8") > byteLimit && current.length > 0) {
      chunks.push(current);
      current = [thread];
    } else {
      current = next;
    }
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

export async function sendCommentsToSession(
  bb: BbPluginApi,
  db: Database,
  threadId: string,
  artifactId: string,
  commentIds: string[],
  mode: "send" | "send-and-resolve",
  options: { requestId?: string | null; includeResolved?: boolean; byteLimit?: number } = {},
) {
  const artifact = readRow<{ taskId: string; fileName: string }>(db, "SELECT task_id AS taskId, file_name AS fileName FROM artifacts WHERE id = ?", artifactId);
  if (!artifact) throw new Error("artifact not found");
  const session = readRow<{ taskId: string }>(db, "SELECT task_id AS taskId FROM sessions WHERE thread_id = ?", threadId);
  if (!session || session.taskId !== artifact.taskId) throw new Error("not a HumanLayer task session");
  const page = selectedThreadsByRootIds(db, artifactId, commentIds, options.includeResolved ?? false);
  const chunks = sendXmlChunks(page, options.byteLimit ?? XML_LIMIT_BYTES);
  let delivered: string[] = [];
  const deliveredChunkIndexes = new Set<number>();
  const requestId = options.requestId ?? null;

  if (requestId) {
    const receipt = claimSendReceipt(db, requestId, artifactId, threadId, commentIds, mode);
    delivered = parseJson<string[]>(receipt.sentIdsJson, []);
    for (const index of parseJson<number[]>(receipt.deliveredChunkIndexesJson, [])) deliveredChunkIndexes.add(index);
    if (receipt.status === "done" || inFlightSendRequests.has(requestId)) {
      return { sent: delivered.length, status: receipt.status };
    }
    inFlightSendRequests.add(requestId);
  }
  try {
    for (const [index, chunk] of chunks.entries()) {
      if (deliveredChunkIndexes.has(index)) continue;
      const xml = toAgentXml(chunk, { total: chunk.length, nextOffset: null, idPrefixes: page.idPrefixes });
      const text = `Please review the following comments on ${artifact.fileName} and address them:\n\n${xml}`;
      await bb.sdk.threads.send({ threadId, mode: "auto", input: [{ type: "text", text }] } as never);
      const ids = chunk.map((thread) => thread.root.id);
      if (mode === "send-and-resolve") setCommentsResolved(db, ids, true, artifactId);
      delivered.push(...ids);
      deliveredChunkIndexes.add(index);
      if (requestId) updateSendReceipt(db, requestId, delivered, deliveredChunkIndexes, "pending");
    }
    if (requestId) updateSendReceipt(db, requestId, delivered, deliveredChunkIndexes, "done");
  } finally {
    if (requestId) inFlightSendRequests.delete(requestId);
  }
  return { sent: delivered.length, status: "done" as const };
}

function claimSendReceipt(db: Database, requestId: string, artifactId: string, threadId: string, commentIds: string[], mode: "send" | "send-and-resolve") {
  return transaction(db, () => {
    try {
      writeRow(
        db,
        "INSERT INTO send_receipts (request_id, artifact_id, thread_id, comment_ids_json, mode, sent_ids_json, status, delivered_chunk_indexes_json, created_at) VALUES (?, ?, ?, ?, ?, '[]', 'pending', '[]', ?)",
        requestId,
        artifactId,
        threadId,
        stringifyJson(commentIds),
        mode,
        nowMs(),
      );
    } catch (error) {
      if (!String(error).includes("UNIQUE")) throw error;
    }
    return readRow<SendReceipt>(
      db,
      "SELECT sent_ids_json AS sentIdsJson, status, delivered_chunk_indexes_json AS deliveredChunkIndexesJson FROM send_receipts WHERE request_id = ?",
      requestId,
    )!;
  })();
}

function updateSendReceipt(db: Database, requestId: string, delivered: string[], deliveredChunkIndexes: Set<number>, status: "pending" | "done") {
  writeRow(
    db,
    "UPDATE send_receipts SET sent_ids_json = ?, delivered_chunk_indexes_json = ?, status = ?, completed_at = ? WHERE request_id = ?",
    stringifyJson(delivered),
    stringifyJson([...deliveredChunkIndexes].sort((left, right) => left - right)),
    status,
    status === "done" ? nowMs() : null,
    requestId,
  );
}

export function sweepOldSendReceipts(db: Database, beforeMs = nowMs() - SEND_RECEIPT_RETENTION_MS) {
  return writeRow(db, "DELETE FROM send_receipts WHERE created_at < ?", beforeMs).changes;
}
