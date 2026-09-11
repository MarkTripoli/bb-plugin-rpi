import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import type * as BetterSqlite3 from "better-sqlite3";
import { markdownBlocks } from "./blocks";
import { nowMs, parseJson, readRow, readRows, stringifyJson, transaction, writeRow } from "./db";

type Database = BetterSqlite3.Database;

export const ARTIFACT_SIZE_LIMIT_BYTES = 10 * 1024 * 1024;
export const ARTIFACT_TYPE_ORDER = [
  "research-questions",
  "research",
  "design-discussion",
  "prd",
  "tdd",
  "structure-outline",
  "plan",
  "pr-description",
  "other",
] as const;

export type ArtifactTypeGroup = (typeof ARTIFACT_TYPE_ORDER)[number];
export type Frontmatter = Record<string, string | number | boolean>;
export type ArtifactRow = {
  id: string;
  taskId: string;
  fileName: string;
  frontmatter: Frontmatter;
  contentType: string;
  isDeleted: boolean;
  currentVersion: number;
  currentSha256: string | null;
  sizeBytes: number;
  type: string;
  groupType: ArtifactTypeGroup;
  commentCount: number;
  createdAt: number;
  updatedAt: number;
};
export type ArtifactVersionRow = {
  id: string;
  artifactId: string;
  version: number;
  content: Buffer;
  sha256: string;
  sizeBytes: number;
  createdBy: string;
  operation: string | null;
  createdAt: number;
};

export type ContextArtifactReason = "command" | "previous-session" | "checkpoint" | "phase-input";
export type ContextArtifactSelection = ArtifactRow & { reason: ContextArtifactReason };

const CONTEXT_TYPES_BY_PHASE: Record<string, readonly string[]> = {
  "research-questions": [],
  research: ["research-questions"],
  design: ["research", "design-discussion"],
  "design-prd": ["research", "prd"],
  "design-tdd": ["prd", "design-discussion", "research", "tdd"],
  structure: ["tdd", "prd", "design-discussion", "research", "structure-outline"],
  plan: ["structure-outline", "tdd", "prd", "design-discussion", "plan"],
  "worktree-setup": ["plan", "structure-outline"],
  implementation: ["plan", "structure-outline"],
  "code-review": ["plan", "structure-outline"],
  "review-fixes": ["plan", "structure-outline"],
  "describe-pr": ["plan", "structure-outline", "pr-description"],
  "pr-review": ["pr-description", "plan", "structure-outline"],
  review: [],
};

export const CONTEXT_ARTIFACT_LIMIT = 12;

export function markdownHeadings(content: string) {
  return markdownBlocks(content).flatMap((block) => {
    const match = block.code ? null : /^(#{1,6})\s+(.+?)\s*$/.exec(block.text);
    return match ? [{ level: match[1]!.length, text: match[2]!, line: content.slice(0, block.start).split("\n").length }] : [];
  });
}

export function markdownSection(content: string, heading: string) {
  const lines = content.split(/\r?\n/);
  const needle = heading.trim().toLowerCase();
  if (!needle) return null;
  const headings = markdownHeadings(content);
  const selected = headings.find((candidate) => candidate.text.toLowerCase() === needle)
    ?? headings.find((candidate) => new RegExp(`^${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s|:|-|$)`, "i").test(candidate.text));
  if (!selected) return null;
  const next = headings.find((candidate) => candidate.line > selected.line && candidate.level <= selected.level);
  const endLine = next ? next.line - 1 : lines.length;
  return { content: lines.slice(selected.line - 1, endLine).join("\n"), startLine: selected.line, endLine };
}

/**
 * Selects the small artifact manifest a phase needs to start. Explicit references win, followed
 * by the predecessor's output, the stable handoff, and recent phase inputs. The hard cap keeps
 * unrelated files from growing bootstrap context without hiding explicitly selected inputs.
 */
export function selectContextArtifacts(
  artifacts: readonly ArtifactRow[],
  input: { phase: string | null; commandLine?: string | null; previousCommandLine?: string | null; previousArtifactNames?: readonly string[] },
) {
  const live = artifacts.filter((artifact) => !artifact.isDeleted);
  const byName = new Map(live.map((artifact) => [artifact.fileName, artifact]));
  const selected = new Map<string, ContextArtifactSelection>();
  const add = (artifact: ArtifactRow | undefined, reason: ContextArtifactReason) => {
    if (artifact && !selected.has(artifact.fileName)) selected.set(artifact.fileName, { ...artifact, reason });
  };

  const references = (commandLine: string | null | undefined) => [...(commandLine ?? "").matchAll(/@([^\s]+)/g)]
    .map((match) => match[1]!.replace(/[),.;:]+$/, "").split("/").pop()!);
  const assigned = [...new Set(references(input.commandLine))];
  const missing = assigned.filter((fileName) => !byName.has(fileName));
  if (missing.length > 0) throw new Error(`assigned artifact not found: ${missing.join(", ")}`);
  if (assigned.length > CONTEXT_ARTIFACT_LIMIT) {
    throw new Error(`assignment selects more than ${CONTEXT_ARTIFACT_LIMIT} artifacts; split it into smaller work`);
  }
  for (const fileName of assigned) add(byName.get(fileName), "command");
  const research = input.phase === "research";
  const checkpoint = research ? undefined : byName.get("handoff.md");
  const taskInput = research ? undefined : byName.get("task.md") ?? byName.get("ticket.md");
  const reserved = [checkpoint, taskInput].filter((artifact) => artifact && !selected.has(artifact.fileName));
  const previous = [...references(input.previousCommandLine), ...(input.previousArtifactNames ?? [])];
  for (const fileName of previous) {
    if (research && (fileName === "task.md" || fileName === "ticket.md" || fileName === "handoff.md")) continue;
    if (selected.size >= CONTEXT_ARTIFACT_LIMIT - reserved.length) break;
    add(byName.get(fileName), "previous-session");
  }
  add(checkpoint, "checkpoint");
  add(taskInput, "phase-input");

  const phaseTypes = CONTEXT_TYPES_BY_PHASE[input.phase ?? ""] ?? [];
  const candidates = live
    .filter((artifact) => phaseTypes.includes(artifact.type))
    .sort((left, right) => right.updatedAt - left.updatedAt || left.fileName.localeCompare(right.fileName));
  for (const artifact of candidates) {
    if (selected.size >= CONTEXT_ARTIFACT_LIMIT) break;
    add(artifact, "phase-input");
  }
  return [...selected.values()].slice(0, CONTEXT_ARTIFACT_LIMIT);
}

const TEXT_EXTENSIONS = new Set([".md", ".markdown", ".txt", ".json", ".yml", ".yaml", ".html", ".htm", ".css", ".js", ".ts", ".tsx", ".jsx", ".xml", ".csv"]);
const CONTENT_TYPES: Record<string, string> = {
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".txt": "text/plain",
  ".json": "application/json",
  ".yml": "text/yaml",
  ".yaml": "text/yaml",
  ".html": "text/html",
  ".htm": "text/html",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
};

export function mimeFor(fileName: string) {
  return CONTENT_TYPES[path.extname(fileName).toLowerCase()] ?? "application/octet-stream";
}

function hasUnpairedSurrogate(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

export function assertSafeArtifactFileName(fileName: string) {
  const segments = fileName.split(/[\\/]/);
  if (fileName.trim() !== fileName || fileName.length === 0) throw new Error("invalid artifact file name");
  if (path.posix.isAbsolute(fileName) || path.win32.isAbsolute(fileName)) throw new Error("invalid artifact file name");
  if (fileName.includes("\\") || fileName.includes("/") || fileName.includes("\0")) throw new Error("invalid artifact file name");
  if (segments.some((segment) => segment === "." || segment === "..")) throw new Error("invalid artifact file name");
  if (/[\u0000-\u001f\u007f]/.test(fileName) || hasUnpairedSurrogate(fileName)) throw new Error("invalid artifact file name");
  if (fileName.toLowerCase().startsWith(".trash")) throw new Error("invalid artifact file name");
  if (Buffer.byteLength(fileName, "utf8") > 255) throw new Error("invalid artifact file name");
  return fileName;
}

export const validateFileName = assertSafeArtifactFileName;

export type PrimaryReviewArtifact = { fileName: string };

export function extractPrimaryReviewArtifact(
  text: string,
  taskId: string,
  liveArtifactNames: ReadonlySet<string>,
): PrimaryReviewArtifact | null {
  let fence: { marker: "`" | "~"; length: number } | null = null;
  for (const line of text.split(/\r?\n/)) {
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      const run = fenceMatch[1]!;
      if (!fence) fence = { marker: run[0] as "`" | "~", length: run.length };
      else if (run[0] === fence.marker && run.length >= fence.length) fence = null;
      continue;
    }
    if (fence || /^(?: {4}|\t)/.test(line)) continue;
    const match = /^ {0,3}::rpi-artifact\{task="([^"\r\n]+)" file="([^"\r\n]+)"\} {0,3}$/.exec(line);
    if (!match || match[1] !== taskId) continue;
    try {
      const fileName = assertSafeArtifactFileName(match[2]!);
      if (liveArtifactNames.has(fileName)) return { fileName };
    } catch {
      // Invalid directives are untrusted assistant output; keep looking for the first valid one.
    }
  }
  return null;
}

export function parseFrontmatter(input: string | Buffer): Frontmatter {
  const text = Buffer.isBuffer(input) ? input.toString("utf8") : input;
  if (!text.startsWith("---\n") && !text.startsWith("---\r\n")) return {};
  const newline = text.startsWith("---\r\n") ? "\r\n" : "\n";
  const end = text.indexOf(`${newline}---${newline}`, 4);
  const eofEnd = text.endsWith(`${newline}---`) ? text.length - `${newline}---`.length : -1;
  const fenceEnd = end === -1 ? eofEnd : end;
  if (fenceEnd === -1) return {};
  const body = text.slice(4, fenceEnd);
  const result: Frontmatter = {};
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const colon = trimmed.indexOf(":");
    if (colon <= 0) continue;
    const key = trimmed.slice(0, colon).trim();
    let raw: string | number | boolean = trimmed.slice(colon + 1).trim();
    const quoted = (raw.startsWith("\"") && raw.endsWith("\"")) || (raw.startsWith("'") && raw.endsWith("'"));
    if (quoted) raw = raw.slice(1, -1);
    else if (raw === "true") raw = true;
    else if (raw === "false") raw = false;
    else if (/^-?\d+(\.\d+)?$/.test(raw)) raw = Number(raw);
    result[key] = raw;
  }
  return result;
}

// Frontmatter `summary:` surfaced in the rpi_task_context manifest so a downstream session can
// decide which upstream artifacts to open instead of reading every one fully. Bounded because
// the manifest lists up to 200 artifacts and the value is agent-written (untrusted length).
export const ARTIFACT_SUMMARY_LIMIT = 400;

export function artifactSummary(frontmatter: Frontmatter): string | null {
  const raw = frontmatter.summary;
  if (typeof raw !== "string") return null;
  const text = raw.replace(/\s+/g, " ").trim();
  if (text === "" || /^\[.*\]$/.test(text)) return null;
  return text.length > ARTIFACT_SUMMARY_LIMIT ? `${text.slice(0, ARTIFACT_SUMMARY_LIMIT - 1)}\u2026` : text;
}

export function artifactType(fileName: string, frontmatter: Frontmatter) {
  const fromFrontmatter = frontmatter.type;
  if (typeof fromFrontmatter === "string" && fromFrontmatter.trim() !== "") return fromFrontmatter.trim();
  const match = /^(\d{2})-([a-z0-9]+(?:-[a-z0-9]+)*)-.+\.md$/i.exec(fileName);
  const prefix = match?.[2]?.toLowerCase();
  if (!prefix) return "other";
  return [...ARTIFACT_TYPE_ORDER]
    .filter((type) => type !== "other")
    .sort((left, right) => right.length - left.length)
    .find((type) => prefix === type || prefix.startsWith(`${type}-`)) ?? "other";
}

// Middle-truncates a file name so the descriptive middle survives (the numbered-phase word, e.g.
// "01-research-questions-..."), keeping the head and the tail (usually the extension) intact.
// Ui/rpi.tsx keeps its own copy of this (the frontend bundle never imports this server-only
// module; see ARTIFACT_GROUP_ORDER's comment there for the same reason), so a change here needs
// the same change made there.
export function middleEllipsis(name: string, max: number): string {
  if (name.length <= max) return name;
  const headLength = Math.max(0, max - 12);
  const head = name.slice(0, headLength);
  const tail = name.slice(name.length - 11);
  return `${head}\u2026${tail}`;
}

export function parseArtifactNumber(fileName: string) {
  const match = /^(\d{2})-/.exec(fileName);
  return match ? Number.parseInt(match[1]!, 10) : null;
}

export function groupForType(type: string): ArtifactTypeGroup {
  return ARTIFACT_TYPE_ORDER.includes(type as ArtifactTypeGroup) ? type as ArtifactTypeGroup : "other";
}

export function groupByType<T extends { type: string }>(artifacts: T[]) {
  return ARTIFACT_TYPE_ORDER.map((type) => ({
    type,
    artifacts: artifacts.filter((artifact) => groupForType(artifact.type) === type),
  })).filter((group) => group.artifacts.length > 0 || group.type === "other");
}

export function inferContentType(fileName: string, contentType?: string | null) {
  if (contentType?.trim()) return contentType.trim();
  return mimeFor(fileName);
}

export function isTextArtifact(fileName: string, contentType: string) {
  const normalized = contentType.toLowerCase();
  return normalized.startsWith("text/") || normalized.includes("json") || normalized.includes("xml") || TEXT_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

function sha256(content: Buffer) {
  return createHash("sha256").update(content).digest("hex");
}

function activeNameCollision(db: Database, taskId: string, fileName: string) {
  return readRow<{ fileName: string }>(
    db,
    "SELECT file_name AS fileName FROM artifacts WHERE task_id = ? AND is_deleted = 0 AND lower(file_name) = lower(?) AND file_name <> ? LIMIT 1",
    taskId,
    fileName,
    fileName,
  );
}

function normalizeArtifactRow(row: {
  id: string;
  taskId: string;
  fileName: string;
  frontmatterJson: string;
  contentType: string;
  isDeleted: number | boolean;
  currentVersion: number;
  currentSha256: string | null;
  sizeBytes: number | null;
  commentCount: number | null;
  createdAt: number;
  updatedAt: number;
}): ArtifactRow {
  const frontmatter = parseJson<Frontmatter>(row.frontmatterJson, {});
  const type = artifactType(row.fileName, frontmatter);
  return {
    id: row.id,
    taskId: row.taskId,
    fileName: row.fileName,
    frontmatter,
    contentType: row.contentType,
    isDeleted: Boolean(row.isDeleted),
    currentVersion: row.currentVersion,
    currentSha256: row.currentSha256,
    sizeBytes: row.sizeBytes ?? 0,
    type,
    groupType: groupForType(type),
    commentCount: row.commentCount ?? 0,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function listArtifacts(db: Database, taskId: string, options: { includeDeleted?: boolean } = {}) {
  return readRows<Parameters<typeof normalizeArtifactRow>[0]>(
    db,
    `
    SELECT
      artifacts.id,
      artifacts.task_id AS taskId,
      artifacts.file_name AS fileName,
      artifacts.frontmatter_json AS frontmatterJson,
      artifacts.content_type AS contentType,
      artifacts.is_deleted AS isDeleted,
      artifacts.current_version AS currentVersion,
      versions.sha256 AS currentSha256,
      versions.size_bytes AS sizeBytes,
      COUNT(comments.id) AS commentCount,
      artifacts.created_at AS createdAt,
      artifacts.updated_at AS updatedAt
    FROM artifacts
    LEFT JOIN artifact_versions versions
      ON versions.artifact_id = artifacts.id AND versions.version = artifacts.current_version
    LEFT JOIN comments
      ON comments.artifact_id = artifacts.id AND comments.is_deleted = 0 AND comments.is_resolved = 0 AND comments.reply_to_id IS NULL
    WHERE artifacts.task_id = ? ${options.includeDeleted ? "" : "AND artifacts.is_deleted = 0"}
    GROUP BY artifacts.id
    ORDER BY artifacts.file_name ASC
    `,
    taskId,
  ).map(normalizeArtifactRow);
}

export function getArtifact(db: Database, taskId: string, fileName: string) {
  assertSafeArtifactFileName(fileName);
  const row = readRow<Parameters<typeof normalizeArtifactRow>[0]>(
    db,
    `
    SELECT
      artifacts.id,
      artifacts.task_id AS taskId,
      artifacts.file_name AS fileName,
      artifacts.frontmatter_json AS frontmatterJson,
      artifacts.content_type AS contentType,
      artifacts.is_deleted AS isDeleted,
      artifacts.current_version AS currentVersion,
      versions.sha256 AS currentSha256,
      versions.size_bytes AS sizeBytes,
      COUNT(comments.id) AS commentCount,
      artifacts.created_at AS createdAt,
      artifacts.updated_at AS updatedAt
    FROM artifacts
    LEFT JOIN artifact_versions versions
      ON versions.artifact_id = artifacts.id AND versions.version = artifacts.current_version
    LEFT JOIN comments
      ON comments.artifact_id = artifacts.id AND comments.is_deleted = 0 AND comments.is_resolved = 0 AND comments.reply_to_id IS NULL
    WHERE artifacts.task_id = ? AND artifacts.file_name = ?
    GROUP BY artifacts.id
    `,
    taskId,
    fileName,
  );
  return row ? normalizeArtifactRow(row) : null;
}

function normalizeVersion(row: {
  id: string;
  artifactId: string;
  version: number;
  content: Buffer;
  sha256: string;
  sizeBytes: number;
  createdBy: string;
  operation: string | null;
  createdAt: number;
}): ArtifactVersionRow {
  return { ...row, content: Buffer.from(row.content) };
}

export function listArtifactVersions(db: Database, taskId: string, fileName: string) {
  const artifact = getArtifact(db, taskId, fileName);
  if (!artifact) return [];
  return readRows<Parameters<typeof normalizeVersion>[0]>(
    db,
    `
    SELECT
      id,
      artifact_id AS artifactId,
      version,
      content,
      sha256,
      size_bytes AS sizeBytes,
      created_by AS createdBy,
      operation,
      created_at AS createdAt
    FROM artifact_versions
    WHERE artifact_id = ?
    ORDER BY version ASC
    `,
    artifact.id,
  ).map(normalizeVersion);
}

export function getArtifactVersion(db: Database, taskId: string, fileName: string, version?: number | null) {
  const artifact = getArtifact(db, taskId, fileName);
  if (!artifact) return null;
  const row = readRow<Parameters<typeof normalizeVersion>[0]>(
    db,
    `
    SELECT
      id,
      artifact_id AS artifactId,
      version,
      content,
      sha256,
      size_bytes AS sizeBytes,
      created_by AS createdBy,
      operation,
      created_at AS createdAt
    FROM artifact_versions
    WHERE artifact_id = ? AND version = ?
    `,
    artifact.id,
    version ?? artifact.currentVersion,
  );
  return row ? { artifact, version: normalizeVersion(row) } : null;
}

export function upsertArtifact(
  db: Database,
  taskId: string,
  fileName: string,
  content: Buffer | string,
  options: { createdBy: string; operation: string; contentType?: string | null },
) {
  assertSafeArtifactFileName(fileName);
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
  if (buffer.length > ARTIFACT_SIZE_LIMIT_BYTES) throw new Error("artifact exceeds 10 MB limit");
  const contentType = inferContentType(fileName, options.contentType);
  const frontmatter = isTextArtifact(fileName, contentType) ? parseFrontmatter(buffer) : {};
  const digest = sha256(buffer);
  const save = transaction(db, () => {
    const timestamp = nowMs();
    const collision = activeNameCollision(db, taskId, fileName);
    if (collision) throw new Error(`artifact file name collides with existing artifact ${collision.fileName}`);
    let artifact = getArtifact(db, taskId, fileName);
    if (!artifact) {
      const id = randomUUID();
      writeRow(
        db,
        `
        INSERT INTO artifacts (id, task_id, file_name, frontmatter_json, content_type, is_deleted, current_version, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?)
        `,
        id,
        taskId,
        fileName,
        stringifyJson(frontmatter),
        contentType,
        timestamp,
        timestamp,
      );
      artifact = getArtifact(db, taskId, fileName);
    }
    if (!artifact) throw new Error("failed to create artifact");
    if (artifact.isDeleted) throw new Error("artifact is deleted; restore before saving");
    if (artifact.currentSha256 === digest) {
      return { artifact, version: artifact.currentVersion, changed: false };
    }
    const version = artifact.currentVersion + 1;
    writeRow(
      db,
      `
      INSERT INTO artifact_versions (id, artifact_id, version, content, sha256, size_bytes, created_by, operation, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      randomUUID(),
      artifact.id,
      version,
      buffer,
      digest,
      buffer.length,
      options.createdBy,
      options.operation,
      timestamp,
    );
    writeRow(
      db,
      `
      UPDATE artifacts
      SET frontmatter_json = ?, content_type = ?, is_deleted = 0, current_version = ?, updated_at = ?
      WHERE id = ?
      `,
      stringifyJson(frontmatter),
      contentType,
      version,
      timestamp,
      artifact.id,
    );
    return { artifact: getArtifact(db, taskId, fileName)!, version, changed: true };
  });
  return save();
}

export function deleteArtifact(db: Database, taskId: string, fileName: string) {
  assertSafeArtifactFileName(fileName);
  writeRow(db, "UPDATE artifacts SET is_deleted = 1, updated_at = ? WHERE task_id = ? AND file_name = ?", nowMs(), taskId, fileName);
  return getArtifact(db, taskId, fileName);
}

export function restoreArtifact(db: Database, taskId: string, fileName: string) {
  assertSafeArtifactFileName(fileName);
  return transaction(db, () => {
    if (activeNameCollision(db, taskId, fileName)) {
      return { outcome: "conflict" as const, artifact: getArtifact(db, taskId, fileName) };
    }
    writeRow(db, "UPDATE artifacts SET is_deleted = 0, updated_at = ? WHERE task_id = ? AND file_name = ?", nowMs(), taskId, fileName);
    return { outcome: "restored" as const, artifact: getArtifact(db, taskId, fileName) };
  })();
}

export function nextArtifactNumber(db: Database, taskId: string) {
  const max = listArtifacts(db, taskId)
    .map((artifact) => parseArtifactNumber(artifact.fileName))
    .filter((value): value is number => value !== null)
    .reduce((highest, value) => Math.max(highest, value), 0);
  return String(max + 1).padStart(2, "0");
}

export function artifactPermalink(taskId: string, fileName: string) {
  assertSafeArtifactFileName(fileName);
  return `::rpi-artifact{task="${taskId}" file="${fileName}"}`;
}

export function artifactPanelPath(taskId: string, fileName: string) {
  assertSafeArtifactFileName(fileName);
  return `/plugins/rpi/tasks/${encodeURIComponent(taskId)}/artifacts/${encodeURIComponent(fileName)}`;
}
