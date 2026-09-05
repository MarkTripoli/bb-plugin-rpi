import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import type * as BetterSqlite3 from "better-sqlite3";
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

export function assertSafeArtifactFileName(fileName: string) {
  if (fileName.trim() !== fileName || fileName.length === 0) throw new Error("invalid artifact file name");
  if (path.isAbsolute(fileName) || fileName.includes("\\") || fileName.includes("/")) throw new Error("invalid artifact file name");
  if (fileName === "." || fileName === ".." || fileName.includes("..")) throw new Error("invalid artifact file name");
  return fileName;
}

export function parseFrontmatter(input: string | Buffer): Frontmatter {
  const text = Buffer.isBuffer(input) ? input.toString("utf8") : input;
  if (!text.startsWith("---\n") && !text.startsWith("---\r\n")) return {};
  const newline = text.startsWith("---\r\n") ? "\r\n" : "\n";
  const end = text.indexOf(`${newline}---${newline}`, 4);
  if (end === -1) return {};
  const body = text.slice(4, end);
  const result: Frontmatter = {};
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const colon = trimmed.indexOf(":");
    if (colon <= 0) continue;
    const key = trimmed.slice(0, colon).trim();
    let raw: string | number | boolean = trimmed.slice(colon + 1).trim().replace(/^["']|["']$/g, "");
    if (raw === "true") raw = true;
    else if (raw === "false") raw = false;
    else if (/^-?\d+(\.\d+)?$/.test(raw)) raw = Number(raw);
    result[key] = raw;
  }
  return result;
}

export function artifactType(fileName: string, frontmatter: Frontmatter) {
  const fromFrontmatter = frontmatter.type;
  if (typeof fromFrontmatter === "string" && fromFrontmatter.trim() !== "") return fromFrontmatter.trim();
  const match = /^(\d{2})-([a-z0-9]+(?:-[a-z0-9]+)*)-.+\.md$/i.exec(fileName);
  return match?.[2]?.toLowerCase() ?? "other";
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
  return CONTENT_TYPES[path.extname(fileName).toLowerCase()] ?? "application/octet-stream";
}

export function isTextArtifact(fileName: string, contentType: string) {
  const normalized = contentType.toLowerCase();
  return normalized.startsWith("text/") || normalized.includes("json") || normalized.includes("xml") || TEXT_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

function sha256(content: Buffer) {
  return createHash("sha256").update(content).digest("hex");
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
      ON comments.artifact_id = artifacts.id AND comments.is_deleted = 0 AND comments.is_resolved = 0
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
      ON comments.artifact_id = artifacts.id AND comments.is_deleted = 0 AND comments.is_resolved = 0
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
  writeRow(db, "UPDATE artifacts SET is_deleted = 0, updated_at = ? WHERE task_id = ? AND file_name = ?", nowMs(), taskId, fileName);
  return getArtifact(db, taskId, fileName);
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
  return `::hl-artifact{task="${taskId}" file="${fileName}"}`;
}

export function artifactPanelPath(taskId: string, fileName: string) {
  assertSafeArtifactFileName(fileName);
  return `/plugins/humanlayer/tasks/${encodeURIComponent(taskId)}/artifacts/${encodeURIComponent(fileName)}`;
}
