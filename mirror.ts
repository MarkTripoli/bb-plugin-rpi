import path from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type * as BetterSqlite3 from "better-sqlite3";
import {
  ARTIFACT_SIZE_LIMIT_BYTES,
  assertSafeArtifactFileName,
  getArtifact,
  getArtifactVersion,
  isTextArtifact,
  listArtifacts,
  mimeFor,
  upsertArtifact,
} from "./artifacts";
import { nowMs, readRow, writeRow } from "./db";
import { getTask } from "./tasks";

type Database = BetterSqlite3.Database;

type FileRead = {
  content?: string | Uint8Array | ArrayBuffer;
  contentEncoding?: string | null;
  sha256?: string | null;
  sizeBytes?: number | null;
};

type MirrorLocation = {
  taskId: string;
  taskSlug: string;
  workspacePath: string;
  hostId: string | null;
  rootPath: string;
  taskDir: string;
};

export type MirrorFileOutcome = "moved" | "skipped" | "conflict";
const STABILITY_ATTEMPTS = 3;
const FILE_CONCURRENCY = 8;

function readBuffer(file: FileRead) {
  const content = file.content ?? "";
  if (content instanceof Uint8Array) return Buffer.from(content);
  if (content instanceof ArrayBuffer) return Buffer.from(content);
  if (file.contentEncoding === "base64") return Buffer.from(content, "base64");
  return Buffer.from(content, "utf8");
}

function isNotFound(error: unknown) {
  const text = String(error instanceof Error ? error.message : error).toLowerCase();
  return text.includes("not found") || text.includes("enoent") || text.includes("404");
}

function isConflict(resultOrError: unknown) {
  if (typeof resultOrError === "object" && resultOrError !== null && "outcome" in resultOrError) {
    return (resultOrError as { outcome?: string }).outcome === "conflict";
  }
  return String(resultOrError instanceof Error ? resultOrError.message : resultOrError).toLowerCase().includes("conflict");
}

function isExists(error: unknown) {
  const text = String(error instanceof Error ? error.message : error).toLowerCase();
  return text.includes("exists") || text.includes("eexist");
}

function artifactPath(location: MirrorLocation, fileName: string) {
  return path.join(location.taskDir, assertSafeArtifactFileName(fileName));
}

async function readFileAt(bb: BbPluginApi, location: Pick<MirrorLocation, "hostId">, filePath: string, rootPath: string) {
  try {
    return await bb.sdk.files.read({ path: filePath, rootPath, ...(location.hostId ? { hostId: location.hostId } : {}) }) as FileRead;
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

async function readFile(bb: BbPluginApi, location: MirrorLocation, filePath: string) {
  return readFileAt(bb, location, filePath, location.rootPath);
}

async function resolveLocation(bb: BbPluginApi, db: Database, taskId: string, threadId: string) {
  const taskResult = getTask(db, taskId);
  if (!taskResult) throw new Error(`No task found for id ${taskId}`);
  const thread = await bb.sdk.threads.get({ threadId, include: "environment" }) as {
    environment?: { path?: string | null; hostId?: string | null } | null;
    host?: { id?: string | null } | null;
    hostId?: string | null;
  };
  const workspacePath = thread.environment?.path ?? null;
  if (!workspacePath) return null;
  const hostId = thread.environment?.hostId ?? thread.host?.id ?? thread.hostId ?? null;
  assertSafeArtifactFileName(taskResult.task.slug);
  const rootPath = path.join(workspacePath, ".humanlayer", "tasks", taskResult.task.slug);
  return {
    taskId,
    taskSlug: taskResult.task.slug,
    workspacePath,
    hostId,
    rootPath,
    taskDir: rootPath,
  };
}

async function mkdir(bb: BbPluginApi, location: Pick<MirrorLocation, "hostId">, dirPath: string, rootPath?: string) {
  try {
    await bb.sdk.files.mkdir({
      path: dirPath,
      recursive: true,
      ...(rootPath ? { rootPath } : {}),
      ...(location.hostId ? { hostId: location.hostId } : {}),
    } as never);
  } catch (error) {
    if (!isExists(error)) throw error;
  }
}

async function ensureGitExclude(bb: BbPluginApi, location: MirrorLocation) {
  const dotGitPath = path.join(location.workspacePath, ".git");
  let gitDir = dotGitPath;
  try {
    const dotGit = await readFileAt(bb, location, dotGitPath, location.workspacePath);
    const dotGitText = dotGit ? readBuffer(dotGit).toString("utf8").trim() : "";
    if (dotGitText.startsWith("gitdir:")) {
      const raw = dotGitText.slice("gitdir:".length).trim();
      gitDir = path.isAbsolute(raw) ? raw : path.resolve(location.workspacePath, raw);
    }
  } catch (error) {
    const text = String(error instanceof Error ? error.message : error).toLowerCase();
    if (!text.includes("is a directory") && !text.includes("eisdir")) throw error;
  }
  const commondir = await readFileAt(bb, location, path.join(gitDir, "commondir"), gitDir).catch((error) => {
    if (isNotFound(error)) return null;
    throw error;
  });
  const commonText = commondir ? readBuffer(commondir).toString("utf8").trim() : "";
  const metadataRoot = commonText ? (path.isAbsolute(commonText) ? commonText : path.resolve(gitDir, commonText)) : gitDir;
  const home = hostHomeFromPath(location.workspacePath);
  if (!home || !isWithin(metadataRoot, home)) {
    bb.log.warn(`HumanLayer skipped .git/info/exclude update outside trusted home: ${metadataRoot}`);
    return;
  }
  const head = await readFileAt(bb, location, path.join(metadataRoot, "HEAD"), metadataRoot);
  if (!head) {
    bb.log.warn(`HumanLayer skipped .git/info/exclude update without trusted HEAD: ${metadataRoot}`);
    return;
  }
  const excludePath = path.join(metadataRoot, "info", "exclude");
  const existing = await readFileAt(bb, location, excludePath, metadataRoot);
  const text = existing ? readBuffer(existing).toString("utf8") : "";
  if (text.split(/\r?\n/).includes(".humanlayer/")) return;
  const next = `${text}${text.endsWith("\n") || text.length === 0 ? "" : "\n"}.humanlayer/\n`;
  await bb.sdk.files.write({
    path: excludePath,
    rootPath: metadataRoot,
    content: next,
    expectedSha256: existing?.sha256 ?? null,
    createParents: true,
    ...(location.hostId ? { hostId: location.hostId } : {}),
  } as never);
}

function hostHomeFromPath(input: string) {
  const parts = input.split(path.sep).filter(Boolean);
  if (parts[0] === "Users" && parts[1]) return `${path.sep}${parts[0]}${path.sep}${parts[1]}`;
  if (parts[0] === "home" && parts[1]) return `${path.sep}${parts[0]}${path.sep}${parts[1]}`;
  return null;
}

function isWithin(child: string, parent: string) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function mirrorState(db: Database, taskId: string, fileName: string) {
  return readRow<{ lastWrittenSha: string | null; lastSeenSha: string | null }>(
    db,
    "SELECT last_written_sha AS lastWrittenSha, last_seen_sha AS lastSeenSha FROM mirror_state WHERE task_id = ? AND file_name = ?",
    taskId,
    fileName,
  ) ?? { lastWrittenSha: null, lastSeenSha: null };
}

function writeMirrorState(db: Database, taskId: string, fileName: string, patch: { lastWrittenSha?: string | null; lastSeenSha?: string | null }) {
  const current = mirrorState(db, taskId, fileName);
  writeRow(
    db,
    `
    INSERT INTO mirror_state (task_id, file_name, last_written_sha, last_seen_sha, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(task_id, file_name) DO UPDATE SET
      last_written_sha = excluded.last_written_sha,
      last_seen_sha = excluded.last_seen_sha,
      updated_at = excluded.updated_at
    `,
    taskId,
    fileName,
    patch.lastWrittenSha === undefined ? current.lastWrittenSha : patch.lastWrittenSha,
    patch.lastSeenSha === undefined ? current.lastSeenSha : patch.lastSeenSha,
    nowMs(),
  );
}

function writePayload(current: NonNullable<ReturnType<typeof getArtifactVersion>>) {
  const text = isTextArtifact(current.artifact.fileName, current.artifact.contentType);
  return {
    content: text ? current.version.content.toString("utf8") : current.version.content.toString("base64"),
    contentEncoding: text ? "utf8" as const : "base64" as const,
  };
}

async function writeOne(bb: BbPluginApi, db: Database, location: MirrorLocation, threadId: string, fileName: string, retried = false): Promise<"written" | "skipped"> {
  const current = getArtifactVersion(db, location.taskId, fileName);
  if (!current) return "skipped";
  const target = artifactPath(location, fileName);
  const existing = await readFile(bb, location, target);
  writeMirrorState(db, location.taskId, fileName, { lastSeenSha: existing?.sha256 ?? null });
  const state = mirrorState(db, location.taskId, fileName);
  if (existing?.sha256 === current.version.sha256) {
    writeMirrorState(db, location.taskId, fileName, { lastSeenSha: existing.sha256 });
    return "skipped";
  }
  if (existing?.sha256 && existing.sha256 !== state.lastWrittenSha) {
    if (!await ingestStableFile(bb, db, location, fileName, threadId, "hydrate-ingest")) return "skipped";
    const latest = getArtifactVersion(db, location.taskId, fileName);
    if (!latest || latest.version.version > current.version.version) return "skipped";
  }
  const latest = getArtifactVersion(db, location.taskId, fileName);
  if (!latest) return "skipped";
  const payload = writePayload(latest);
  const result = await bb.sdk.files.write({
    path: target,
    rootPath: location.rootPath,
    content: payload.content,
    contentEncoding: payload.contentEncoding,
    createParents: true,
    expectedSha256: existing?.sha256 ?? null,
    ...(location.hostId ? { hostId: location.hostId } : {}),
  } as never);
  if (isConflict(result)) {
    if (retried) throw new Error(`CAS conflict writing ${fileName}`);
    const nextExisting = await readFile(bb, location, target);
    writeMirrorState(db, location.taskId, fileName, { lastSeenSha: nextExisting?.sha256 ?? null });
    if (nextExisting?.sha256 && nextExisting.sha256 !== mirrorState(db, location.taskId, fileName).lastWrittenSha) {
      if (!await ingestStableFile(bb, db, location, fileName, threadId, "hydrate-ingest")) return "skipped";
      const afterIngest = getArtifactVersion(db, location.taskId, fileName);
      if (!afterIngest || afterIngest.version.version > latest.version.version) return "skipped";
    }
    const retryCurrent = getArtifactVersion(db, location.taskId, fileName);
    if (!retryCurrent) return "skipped";
    const retryPayload = writePayload(retryCurrent);
    const retry = await bb.sdk.files.write({
      path: target,
      rootPath: location.rootPath,
      content: retryPayload.content,
      contentEncoding: retryPayload.contentEncoding,
      createParents: true,
      expectedSha256: nextExisting?.sha256 ?? null,
      ...(location.hostId ? { hostId: location.hostId } : {}),
    } as never);
    if (isConflict(retry)) throw new Error(`CAS conflict writing ${fileName}`);
    writeMirrorState(db, location.taskId, fileName, { lastWrittenSha: retryCurrent.version.sha256, lastSeenSha: retryCurrent.version.sha256 });
    return "written";
  }
  writeMirrorState(db, location.taskId, fileName, { lastWrittenSha: latest.version.sha256, lastSeenSha: latest.version.sha256 });
  return "written";
}

async function moveDeleted(bb: BbPluginApi, location: MirrorLocation, fileName: string, version: number): Promise<MirrorFileOutcome> {
  const from = artifactPath(location, fileName);
  const existing = await readFile(bb, location, from);
  if (!existing) return "skipped";
  await mkdir(bb, location, path.join(location.taskDir, ".trash"), location.rootPath);
  try {
    await bb.sdk.files.move({
      sourcePath: from,
      destinationPath: path.join(location.taskDir, ".trash", `${fileName}.${version}.${Date.now()}`),
      rootPath: location.rootPath,
      ...(location.hostId ? { hostId: location.hostId } : {}),
    } as never);
    return "moved";
  } catch (error) {
    if (isConflict(error)) return "conflict";
    throw error;
  }
}

export async function mirrorDeletedArtifact(bb: BbPluginApi, db: Database, taskId: string, threadId: string, fileName: string): Promise<MirrorFileOutcome> {
  const location = await resolveLocation(bb, db, taskId, threadId);
  if (!location) return "skipped";
  const current = getArtifactVersion(db, taskId, fileName);
  return moveDeleted(bb, location, fileName, current?.version.version ?? 0);
}

export async function mirrorRestoredArtifact(bb: BbPluginApi, db: Database, taskId: string, threadId: string, fileName: string): Promise<MirrorFileOutcome> {
  const location = await resolveLocation(bb, db, taskId, threadId);
  if (!location) return "skipped";
  const target = artifactPath(location, fileName);
  const existing = await readFile(bb, location, target);
  if (existing) return "conflict";
  const trash = await bb.sdk.files.listPaths({
    path: path.join(location.taskDir, ".trash"),
    rootPath: location.rootPath,
    includeFiles: true,
    includeDirectories: false,
    ...(location.hostId ? { hostId: location.hostId } : {}),
  } as never).catch((error) => {
    if (isNotFound(error)) return { paths: [] };
    throw error;
  }) as unknown;
  const entries = listedEntries(trash)
    .map(normalizeListedPath)
    .filter((entry): entry is NonNullable<ReturnType<typeof normalizeListedPath>> => Boolean(entry))
    .map((entry) => ({ entry, parsed: parseTrashCopy(fileName, path.basename(relativeListedPath(entry.path, location))) }))
    .filter((item): item is { entry: NonNullable<ReturnType<typeof normalizeListedPath>>; parsed: { version: number; timestamp: number } } => (
      item.entry.kind === "file" && item.parsed !== null
    ))
    .sort((left, right) => right.parsed.version - left.parsed.version || right.parsed.timestamp - left.parsed.timestamp);
  const newest = entries[0]?.entry;
  if (!newest) return "skipped";
  const sourceRelative = relativeListedPath(newest.path, location);
  await bb.sdk.files.move({
    sourcePath: path.join(location.taskDir, sourceRelative.startsWith(".trash/") ? sourceRelative : path.posix.join(".trash", sourceRelative)),
    destinationPath: target,
    rootPath: location.rootPath,
    ...(location.hostId ? { hostId: location.hostId } : {}),
  } as never);
  return "moved";
}

export async function hydrate(bb: BbPluginApi, db: Database, taskId: string, threadId: string) {
  const location = await resolveLocation(bb, db, taskId, threadId);
  if (!location) {
    bb.log.info(`HumanLayer hydration skipped for ${threadId}: no workspace path`);
    return { written: 0, skipped: 0, trashed: 0 };
  }
  await mkdir(bb, location, path.dirname(location.taskDir), location.workspacePath);
  await mkdir(bb, location, location.taskDir, path.dirname(location.taskDir));
  await ensureGitExclude(bb, location).catch((error) => bb.log.warn(`HumanLayer could not update .git/info/exclude: ${String(error)}`));
  const results = await mapConcurrent(listArtifacts(db, taskId, { includeDeleted: true }), FILE_CONCURRENCY, async (artifact) => {
    if (artifact.isDeleted) {
      const existing = await readFile(bb, location, artifactPath(location, artifact.fileName));
      if (existing && existing.sha256 === artifact.currentSha256) {
        return (await moveDeleted(bb, location, artifact.fileName, artifact.currentVersion)) === "moved" ? "trashed" : "skipped";
      } else if (existing) {
        bb.log.warn(`HumanLayer left tombstoned artifact on disk with local edits: ${artifact.fileName}`);
      }
      return "skipped";
    }
    const result = await writeOne(bb, db, location, threadId, artifact.fileName);
    return result;
  });
  const written = results.filter((result) => result === "written").length;
  const skipped = results.filter((result) => result === "skipped").length;
  const trashed = results.filter((result) => result === "trashed").length;
  const timestamp = nowMs();
  writeRow(db, "UPDATE sessions SET hydrated_at = ?, updated_at = ? WHERE thread_id = ?", timestamp, timestamp, threadId);
  bb.realtime.publish("artifacts", { taskId });
  bb.realtime.publish("hl:artifacts", { taskId });
  bb.realtime.publish("hl:sessions", { taskId, threadId });
  bb.log.info(`Hydrated HumanLayer session ${threadId}: ${written} written, ${skipped} skipped`);
  return { written, skipped, trashed };
}

function normalizeListedPath(entry: unknown) {
  if (typeof entry === "string") return { path: entry, kind: "file", isSymlink: false, sizeBytes: null };
  if (!entry || typeof entry !== "object") return null;
  const row = entry as { path?: string; relativePath?: string; name?: string; kind?: string; type?: string; isSymbolicLink?: boolean; isSymlink?: boolean; symlink?: boolean; sizeBytes?: number };
  return {
    path: row.path ?? row.relativePath ?? row.name ?? "",
    kind: row.kind ?? row.type ?? "file",
    isSymlink: Boolean(row.isSymbolicLink ?? row.isSymlink ?? row.symlink ?? false),
    sizeBytes: row.sizeBytes ?? null,
  };
}

function listedEntries(listed: unknown) {
  if (Array.isArray(listed)) return listed;
  if (listed && typeof listed === "object" && "paths" in listed) return (listed as { paths: unknown[] }).paths;
  if (listed && typeof listed === "object" && "files" in listed) return (listed as { files: unknown[] }).files;
  return [];
}

function relativeListedPath(input: string, location: MirrorLocation) {
  const normalized = input.replaceAll("\\", "/");
  if (path.isAbsolute(input)) return path.relative(location.taskDir, input).replaceAll("\\", "/");
  return normalized;
}

async function stableRead(bb: BbPluginApi, location: MirrorLocation, fileName: string, loggedBy: string) {
  const target = artifactPath(location, fileName);
  for (let attempt = 1; attempt <= STABILITY_ATTEMPTS; attempt += 1) {
    const first = await readFile(bb, location, target);
    if (!first) return null;
    await new Promise((resolve) => setTimeout(resolve, 200));
    const second = await readFile(bb, location, target);
    if (!second) return null;
    if (first.sha256 === second.sha256 && first.sizeBytes === second.sizeBytes) return second;
    if (attempt < STABILITY_ATTEMPTS) await new Promise((resolve) => setTimeout(resolve, 200));
  }
  bb.log.warn(`HumanLayer skipped unstable artifact write from ${loggedBy}: ${fileName}`);
  return null;
}

async function ingestStableFile(bb: BbPluginApi, db: Database, location: MirrorLocation, fileName: string, createdBy: string, operation: string) {
  assertSafeArtifactFileName(fileName);
  const file = await stableRead(bb, location, fileName, createdBy);
  if (!file) return false;
  const buffer = readBuffer(file);
  if ((file.sizeBytes ?? buffer.length) > ARTIFACT_SIZE_LIMIT_BYTES || buffer.length > ARTIFACT_SIZE_LIMIT_BYTES) {
    bb.log.warn(`HumanLayer skipped oversized artifact: ${fileName}`);
    return false;
  }
  const artifact = getArtifact(db, location.taskId, fileName);
  if (artifact?.isDeleted) {
    if (file.sha256 === artifact.currentSha256) {
      await moveDeleted(bb, location, fileName, artifact.currentVersion);
    } else {
      bb.log.warn(`HumanLayer ignored tombstoned artifact with local edits: ${fileName}`);
    }
    return false;
  }
  const saved = upsertArtifact(db, location.taskId, fileName, buffer, {
    createdBy,
    operation,
    contentType: mimeFor(fileName),
  });
  writeMirrorState(db, location.taskId, fileName, { lastSeenSha: file.sha256 ?? saved.artifact.currentSha256 });
  return saved.changed;
}

export async function ingest(
  bb: BbPluginApi,
  db: Database,
  taskId: string,
  createdBy: string,
  options: { threadId: string; fileName?: string | null; operation?: string } ,
) {
  const location = await resolveLocation(bb, db, taskId, options.threadId);
  if (!location) {
    bb.log.info(`HumanLayer ingest skipped for ${options.threadId}: no workspace path`);
    return { ingested: 0, skipped: 0 };
  }
  const listed = options.fileName
    ? []
      : await bb.sdk.files.listPaths({
          path: location.taskDir,
          rootPath: location.rootPath,
          includeFiles: true,
          includeDirectories: true,
          ...(location.hostId ? { hostId: location.hostId } : {}),
        } as never) as unknown;
  let listedSkipped = 0;
  const names = options.fileName
    ? [assertSafeArtifactFileName(options.fileName)]
    : listedEntries(listed)
        .map(normalizeListedPath)
        .filter((entry): entry is NonNullable<ReturnType<typeof normalizeListedPath>> => Boolean(entry))
        .map((entry) => ({ ...entry, path: relativeListedPath(entry.path, location) }))
        .filter((entry) => {
          if (entry.path.startsWith(".trash/") || entry.path.includes("/.trash/")) return false;
          if (entry.kind !== "file" || entry.isSymlink) {
            bb.log.warn(`HumanLayer skipped non-file artifact entry: ${entry.path}`);
            listedSkipped += 1;
            return false;
          }
          if (entry.path.includes("/")) {
            bb.log.warn(`HumanLayer skipped nested artifact entry: ${entry.path}`);
            listedSkipped += 1;
            return false;
          }
          try {
            assertSafeArtifactFileName(entry.path);
            return true;
          } catch {
            bb.log.warn(`HumanLayer skipped unsafe artifact entry: ${entry.path}`);
            listedSkipped += 1;
            return false;
          }
        })
        .filter((entry) => {
          if (entry.sizeBytes !== null && entry.sizeBytes > ARTIFACT_SIZE_LIMIT_BYTES) {
            bb.log.warn(`HumanLayer skipped oversized artifact metadata: ${entry.path}`);
            listedSkipped += 1;
            return false;
          }
          return true;
        })
        .map((entry) => entry.path);

  const results = await mapConcurrent(names, FILE_CONCURRENCY, async (fileName) => (
    await ingestStableFile(bb, db, location, fileName, createdBy, options.operation ?? "ingest") ? "ingested" : "skipped"
  ));
  const ingested = results.filter((result) => result === "ingested").length;
  const skipped = listedSkipped + results.filter((result) => result === "skipped").length;
  if (ingested > 0) {
    bb.realtime.publish("artifacts", { taskId });
    bb.realtime.publish("hl:artifacts", { taskId });
  }
  return { ingested, skipped };
}

function parseTrashCopy(fileName: string, basename: string) {
  const prefix = `${fileName}.`;
  if (!basename.startsWith(prefix)) return null;
  const match = /^(\d+)\.(\d+)$/.exec(basename.slice(prefix.length));
  if (!match) return null;
  return { version: Number.parseInt(match[1]!, 10), timestamp: Number.parseInt(match[2]!, 10) };
}

async function mapConcurrent<T, U>(items: T[], limit: number, fn: (item: T) => Promise<U>) {
  const results = new Array<U>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await fn(items[index]!);
    }
  }));
  return results;
}

export function latestTaskThread(db: Database, taskId: string) {
  return readRow<{ threadId: string }>(
    db,
    "SELECT thread_id AS threadId FROM sessions WHERE task_id = ? ORDER BY updated_at DESC, created_at DESC LIMIT 1",
    taskId,
  )?.threadId ?? null;
}
