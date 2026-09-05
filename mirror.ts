import path from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type * as BetterSqlite3 from "better-sqlite3";
import {
  ARTIFACT_SIZE_LIMIT_BYTES,
  assertSafeArtifactFileName,
  getArtifactVersion,
  isTextArtifact,
  listArtifacts,
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

async function readFile(bb: BbPluginApi, location: Pick<MirrorLocation, "hostId">, filePath: string) {
  try {
    return await bb.sdk.files.read({ path: filePath, ...(location.hostId ? { hostId: location.hostId } : {}) }) as FileRead;
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
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
  const rootPath = path.join(workspacePath, ".humanlayer");
  return {
    taskId,
    taskSlug: taskResult.task.slug,
    workspacePath,
    hostId,
    rootPath,
    taskDir: path.join(rootPath, "tasks", taskResult.task.slug),
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
  const excludePath = path.join(location.workspacePath, ".git", "info", "exclude");
  const existing = await readFile(bb, location, excludePath);
  if (!existing) return;
  const text = readBuffer(existing).toString("utf8");
  if (text.split(/\r?\n/).includes(".humanlayer/")) return;
  const next = `${text}${text.endsWith("\n") || text.length === 0 ? "" : "\n"}.humanlayer/\n`;
  await bb.sdk.files.write({
    path: excludePath,
    rootPath: location.workspacePath,
    content: next,
    expectedSha256: existing.sha256 ?? null,
    ...(location.hostId ? { hostId: location.hostId } : {}),
  } as never);
}

async function writeOne(bb: BbPluginApi, db: Database, location: MirrorLocation, threadId: string, fileName: string, retried = false): Promise<"written" | "skipped"> {
  const current = getArtifactVersion(db, location.taskId, fileName);
  if (!current) return "skipped";
  const target = artifactPath(location, fileName);
  const existing = await readFile(bb, location, target);
  if (existing?.sha256 === current.version.sha256) return "skipped";
  const result = await bb.sdk.files.write({
    path: target,
    rootPath: location.rootPath,
    content: isTextArtifact(current.artifact.fileName, current.artifact.contentType)
      ? current.version.content.toString("utf8")
      : current.version.content.toString("base64"),
    contentEncoding: isTextArtifact(current.artifact.fileName, current.artifact.contentType) ? "utf8" : "base64",
    createParents: true,
    expectedSha256: existing?.sha256 ?? null,
    ...(location.hostId ? { hostId: location.hostId } : {}),
  } as never);
  if (isConflict(result)) {
    if (retried) throw new Error(`CAS conflict writing ${fileName}`);
    await ingest(bb, db, location.taskId, threadId, { fileName, threadId });
    return writeOne(bb, db, location, threadId, fileName, true);
  }
  return "written";
}

async function moveDeleted(bb: BbPluginApi, location: MirrorLocation, fileName: string) {
  const from = artifactPath(location, fileName);
  const existing = await readFile(bb, location, from);
  if (!existing) return false;
  await mkdir(bb, location, path.join(location.taskDir, ".trash"), location.rootPath);
  try {
    await bb.sdk.files.move({
      sourcePath: from,
      destinationPath: path.join(location.taskDir, ".trash", fileName),
      rootPath: location.rootPath,
      ...(location.hostId ? { hostId: location.hostId } : {}),
    } as never);
    return true;
  } catch (error) {
    if (isConflict(error)) return false;
    throw error;
  }
}

export async function hydrate(bb: BbPluginApi, db: Database, taskId: string, threadId: string) {
  const location = await resolveLocation(bb, db, taskId, threadId);
  if (!location) {
    bb.log.info(`HumanLayer hydration skipped for ${threadId}: no workspace path`);
    return { written: 0, skipped: 0, trashed: 0 };
  }
  await mkdir(bb, location, location.rootPath, location.workspacePath);
  await mkdir(bb, location, path.join(location.rootPath, "tasks"), location.rootPath);
  await mkdir(bb, location, location.taskDir, location.rootPath);
  await ensureGitExclude(bb, location).catch((error) => bb.log.warn(`HumanLayer could not update .git/info/exclude: ${String(error)}`));
  let written = 0;
  let skipped = 0;
  let trashed = 0;
  for (const artifact of listArtifacts(db, taskId, { includeDeleted: true })) {
    if (artifact.isDeleted) {
      if (await moveDeleted(bb, location, artifact.fileName)) trashed += 1;
      continue;
    }
    const result = await writeOne(bb, db, location, threadId, artifact.fileName);
    if (result === "written") written += 1;
    else skipped += 1;
  }
  const timestamp = nowMs();
  writeRow(db, "UPDATE sessions SET hydrated_at = ?, updated_at = ? WHERE thread_id = ?", timestamp, timestamp, threadId);
  bb.realtime.publish("artifacts", { taskId });
  bb.realtime.publish("hl:sessions", { taskId, threadId });
  bb.log.info(`Hydrated HumanLayer session ${threadId}: ${written} written, ${skipped} skipped`);
  return { written, skipped, trashed };
}

function normalizeListedPath(entry: unknown) {
  if (typeof entry === "string") return { path: entry, kind: "file", isSymlink: false, sizeBytes: null };
  if (!entry || typeof entry !== "object") return null;
  const row = entry as { path?: string; relativePath?: string; kind?: string; type?: string; isSymlink?: boolean; symlink?: boolean; sizeBytes?: number };
  return {
    path: row.path ?? row.relativePath ?? "",
    kind: row.kind ?? row.type ?? "file",
    isSymlink: Boolean(row.isSymlink ?? row.symlink ?? false),
    sizeBytes: row.sizeBytes ?? null,
  };
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
        includeFiles: true,
        includeDirectories: false,
        ...(location.hostId ? { hostId: location.hostId } : {}),
      } as never) as unknown;
  const listedEntries = Array.isArray(listed) ? listed : (listed && typeof listed === "object" && "paths" in listed ? (listed as { paths: unknown[] }).paths : []);
  const names = options.fileName
    ? [assertSafeArtifactFileName(options.fileName)]
    : listedEntries
        .map(normalizeListedPath)
        .filter((entry): entry is NonNullable<ReturnType<typeof normalizeListedPath>> => Boolean(entry))
        .filter((entry) => entry.kind === "file" && !entry.isSymlink && !entry.path.startsWith(".trash/") && !entry.path.includes("/.trash/"))
        .filter((entry) => entry.sizeBytes === null || entry.sizeBytes <= ARTIFACT_SIZE_LIMIT_BYTES)
        .map((entry) => assertSafeArtifactFileName(path.basename(entry.path)));

  let ingested = 0;
  let skipped = 0;
  for (const fileName of names) {
    const file = await readFile(bb, location, artifactPath(location, fileName));
    if (!file) {
      skipped += 1;
      continue;
    }
    if ((file.sizeBytes ?? 0) > ARTIFACT_SIZE_LIMIT_BYTES) {
      skipped += 1;
      continue;
    }
    const saved = upsertArtifact(db, taskId, fileName, readBuffer(file), {
      createdBy,
      operation: options.operation ?? "ingest",
      contentType: undefined,
    });
    if (saved.changed) ingested += 1;
    else skipped += 1;
  }
  if (ingested > 0) bb.realtime.publish("artifacts", { taskId });
  return { ingested, skipped };
}

export function latestTaskThread(db: Database, taskId: string) {
  return readRow<{ threadId: string }>(
    db,
    "SELECT thread_id AS threadId FROM sessions WHERE task_id = ? ORDER BY updated_at DESC, created_at DESC LIMIT 1",
    taskId,
  )?.threadId ?? null;
}
