import path from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type * as BetterSqlite3 from "better-sqlite3";
import { z } from "zod";
import { readRow, readRows } from "./db";
import type { TaskRecord } from "./contract";

type Database = BetterSqlite3.Database;

type WorkspaceRepoConfig = {
  localPath?: string;
  description?: string;
  primary?: boolean;
  sourceRef?: string;
  setupCommand?: string;
  copyGlobs?: string[];
  $patch?: "delete";
};

type WorkspaceConfig = {
  disabled?: boolean;
  pathTemplate?: string;
  branchTemplate?: string;
  sourceRef?: string;
  setupCommand?: string;
  copyGlobs?: string[];
  repos?: WorkspaceRepoConfig[];
};

const boundedString = z.string().trim().min(1).max(512);
const copyGlobsSchema = z.array(boundedString).max(64).optional();
const sharedRepoSchema = z.object({
  localPath: boundedString.optional(),
  description: boundedString.optional(),
  primary: z.boolean().optional(),
  sourceRef: boundedString.optional(),
  setupCommand: boundedString.optional(),
  copyGlobs: copyGlobsSchema,
}).strict();
const localRepoSchema = sharedRepoSchema.extend({ $patch: z.literal("delete").optional() }).strict();
const sharedConfigSchema = z.object({
  disabled: z.boolean().optional(),
  pathTemplate: boundedString.optional(),
  branchTemplate: boundedString.optional(),
  sourceRef: boundedString.optional(),
  setupCommand: boundedString.optional(),
  copyGlobs: copyGlobsSchema,
  repos: z.array(sharedRepoSchema).max(32).optional(),
}).strict();
const localConfigSchema = sharedConfigSchema.extend({
  repos: z.array(localRepoSchema).max(32).optional(),
}).strict();

export type WorkspaceRepoView = {
  localPath: string | null;
  description: string | null;
  primary: boolean;
  sourceRef: string | null;
  setupCommand: string | null;
  copyGlobs: string[];
};

export type WorkspaceView = {
  taskId: string;
  environment: {
    id: string | null;
    status: string | null;
    path: string | null;
    branch: string | null;
    baseBranch: string | null;
    kind: string | null;
  };
  worktreeThreadId: string | null;
  repos: WorkspaceRepoView[];
  primary: WorkspaceRepoView | null;
  pathTemplate: { requested: string | null; resolved: string | null };
  branchTemplate: { requested: string | null; resolved: string | null };
  sourceRef: string | null;
  setupCommand: string | null;
  copyGlobs: string[];
  disabled: boolean;
  warnings: string[];
  error: string | null;
  provisioningEvents: Array<{
    seq: number;
    createdAt: number;
    status: string | null;
    kind: string;
    text: string;
  }>;
  provisioningEventKinds: string[];
};

export function mapSourceRefToBaseBranch(sourceRef: string | null | undefined) {
  const ref = sourceRef?.trim();
  if (!ref || ref === "HEAD") return { kind: "default" as const };
  if (/^[a-f0-9]{7,40}$/i.test(ref)) throw new Error(`sourceRef ${ref} cannot be a SHA`);
  const name = ref.startsWith("origin/") ? ref.slice("origin/".length) : ref;
  if (!/^[A-Za-z0-9._/-]+$/.test(name) || name.includes("..") || name.startsWith("/") || name.endsWith("/") || name.startsWith("refs/")) {
    throw new Error(`sourceRef ${ref} is not a branch name`);
  }
  return { kind: "named" as const, name };
}

export function mergeWorkspaceConfigs(shared: WorkspaceConfig, local: WorkspaceConfig): WorkspaceConfig {
  const merged: WorkspaceConfig = {
    ...shared,
    ...Object.fromEntries(Object.entries(local).filter(([key]) => key !== "repos" && key !== "copyGlobs")),
    copyGlobs: dedupe([...(shared.copyGlobs ?? []), ...(local.copyGlobs ?? [])]),
  };
  const repos = new Map<string, WorkspaceRepoConfig>();
  for (const repo of shared.repos ?? []) {
    if (repo.localPath) repos.set(repo.localPath, { ...repo, copyGlobs: [...(repo.copyGlobs ?? [])] });
  }
  for (const repo of local.repos ?? []) {
    if (!repo.localPath) continue;
    if (repo.$patch === "delete") {
      repos.delete(repo.localPath);
      continue;
    }
    const prior = repos.get(repo.localPath) ?? {};
    repos.set(repo.localPath, {
      ...prior,
      ...Object.fromEntries(Object.entries(repo).filter(([key]) => key !== "copyGlobs" && key !== "$patch")),
      copyGlobs: dedupe([...(prior.copyGlobs ?? []), ...(repo.copyGlobs ?? [])]),
    });
  }
  merged.repos = [...repos.values()];
  return merged;
}

export async function getWorkspaceView(bb: BbPluginApi, db: Database, task: TaskRecord): Promise<WorkspaceView> {
  const env = await currentEnvironment(bb, task);
  const rootPath = baseRoot(env, task);
  const { config, warnings, error } = rootPath ? await readWorkspaceConfig(bb, rootPath, task.hostId) : { config: {} as WorkspaceConfig, warnings: ["No workspace root is available yet."], error: null };
  const disabled = Boolean(config.disabled);
  const repos = repoViews(config, rootPath);
  const primary = repos.find((repo) => repo.primary) ?? null;
  const primaryCount = repos.filter((repo) => repo.primary).length;
  const primaryError = repos.length > 0 && primaryCount !== 1 ? "Workspace config must mark exactly one primary repo." : null;
  if (primaryError) warnings.push(primaryError);
  for (const ref of [config.sourceRef, ...repos.map((repo) => repo.sourceRef)]) {
    if (!ref) continue;
    try {
      mapSourceRefToBaseBranch(ref);
    } catch (error) {
      warnings.push(String(error instanceof Error ? error.message : error));
    }
  }
  const worktreeThreadId = latestWorktreeThread(db, task.id);
  const provisioning = worktreeThreadId ? await provisioningEvents(bb, worktreeThreadId) : { events: [], kinds: [] };
  return {
    taskId: task.id,
    environment: {
      id: env?.id ?? null,
      status: env?.status ?? null,
      path: env?.path ?? null,
      branch: env?.branchName ?? null,
      baseBranch: env?.baseBranch ?? null,
      kind: env?.workspaceProvisionType ?? null,
    },
    worktreeThreadId,
    repos,
    primary,
    pathTemplate: { requested: config.pathTemplate ?? null, resolved: env?.path ?? task.defaultDirectory ?? null },
    branchTemplate: { requested: config.branchTemplate ?? null, resolved: env?.branchName ?? null },
    sourceRef: config.sourceRef ?? null,
    setupCommand: config.setupCommand ?? null,
    copyGlobs: config.copyGlobs ?? [],
    disabled,
    warnings,
    error: error ?? primaryError,
    provisioningEvents: provisioning.events,
    provisioningEventKinds: provisioning.kinds,
  };
}

export async function workspaceBaseBranch(bb: BbPluginApi, task: TaskRecord) {
  const env = await currentEnvironment(bb, task);
  const rootPath = baseRoot(env, task);
  if (!rootPath) return { kind: "default" as const };
  const { config, error } = await readWorkspaceConfig(bb, rootPath, task.hostId);
  if (error) return { kind: "default" as const };
  if (config.disabled) return { kind: "default" as const };
  const repos = repoViews(config, rootPath);
  if (repos.length > 0 && repos.filter((repo) => repo.primary).length !== 1) throw new Error("Workspace config must mark exactly one primary repo.");
  const primary = repos.find((repo) => repo.primary);
  return mapSourceRefToBaseBranch(primary?.sourceRef ?? config.sourceRef);
}

export async function workspaceDisabled(bb: BbPluginApi, task: TaskRecord) {
  const env = await currentEnvironment(bb, task);
  const rootPath = baseRoot(env, task);
  if (!rootPath) return false;
  const { config } = await readWorkspaceConfig(bb, rootPath, task.hostId);
  return Boolean(config.disabled);
}

export async function validateWorkspaceForWorktreeLaunch(bb: BbPluginApi, task: TaskRecord | { hostId: string | null; defaultDirectory: string | null; worktreeTiming: "now" | "later" | "never" }) {
  if (task.worktreeTiming === "never") return;
  const rootPath = "defaultDirectory" in task ? task.defaultDirectory : null;
  if (!rootPath) return;
  const { config, error } = await readWorkspaceConfig(bb, rootPath, task.hostId);
  if (error) return;
  const repos = repoViews(config, rootPath);
  if (repos.length > 0 && repos.filter((repo) => repo.primary).length !== 1) throw new Error("Workspace config must mark exactly one primary repo.");
  for (const ref of [config.sourceRef, ...repos.map((repo) => repo.sourceRef)]) {
    if (ref) mapSourceRefToBaseBranch(ref);
  }
}

export async function rerunWorkspaceSetup(bb: BbPluginApi, db: Database, task: TaskRecord) {
  const view = await getWorkspaceView(bb, db, task);
  if (!view.worktreeThreadId) throw new Error("No worktree setup session is available.");
  if (!task.worktreeEnvironmentId) throw new Error("No worktree environment is available.");
  const thread = await bb.sdk.threads.get({ threadId: view.worktreeThreadId, include: "environment" });
  if (thread.environmentId !== task.worktreeEnvironmentId) throw new Error("Workspace setup rerun must target the worktree session.");
  const primary = view.primary;
  if (!primary) throw new Error("No primary repo is available.");
  await bb.sdk.threads.send({
    threadId: view.worktreeThreadId,
    mode: "auto",
    input: [{
      type: "text",
      text: `Re-run HumanLayer workspace setup for ${task.slug}.\nPrimary repo config:\n${JSON.stringify(primary, null, 2)}\nReport each provisioning/setup event kind you observe.`,
      mentions: [],
    }],
  });
  return { threadId: view.worktreeThreadId };
}

async function currentEnvironment(bb: BbPluginApi, task: TaskRecord) {
  const environmentId = task.worktreeEnvironmentId ?? task.baseEnvironmentId;
  if (!environmentId) return null;
  try {
    return await bb.sdk.environments.get({ environmentId });
  } catch {
    return null;
  }
}

function baseRoot(env: Awaited<ReturnType<typeof currentEnvironment>>, task: TaskRecord) {
  return env?.path ?? task.defaultDirectory ?? null;
}

async function readWorkspaceConfig(bb: BbPluginApi, rootPath: string, hostId: string | null) {
  const configRoot = path.posix.join(rootPath, ".humanlayer");
  const shared = await readJsonFile(bb, configRoot, "workspace.json", hostId, sharedConfigSchema);
  const local = await readJsonFile(bb, configRoot, ".local.json", hostId, localConfigSchema);
  const warnings: string[] = [];
  if (shared.status === "missing") warnings.push("No workspace config found.");
  const malformed = [shared, local].find((result) => result.status === "invalid");
  if (malformed) {
    return { config: {} as WorkspaceConfig, warnings, error: `${malformed.path}: ${malformed.message}` };
  }
  return { config: mergeWorkspaceConfigs(shared.config ?? {}, local.config ?? {}), warnings, error: null };
}

async function readJsonFile<T>(bb: BbPluginApi, rootPath: string, filePath: string, hostId: string | null, schema: z.ZodType<T>) {
  try {
    const file = await bb.sdk.files.read({ rootPath, path: filePath, ...(hostId ? { hostId } : {}) });
    const text = typeof file.content === "string" ? file.content : Buffer.from(file.content).toString("utf8");
    const parsed = JSON.parse(text) as unknown;
    const result = schema.safeParse(parsed);
    if (!result.success) return { status: "invalid" as const, path: path.posix.join(rootPath, filePath), message: z.prettifyError(result.error) };
    return { status: "ok" as const, path: path.posix.join(rootPath, filePath), config: result.data as WorkspaceConfig };
  } catch (error) {
    if (error instanceof SyntaxError) return { status: "invalid" as const, path: path.posix.join(rootPath, filePath), message: error.message };
    return { status: "missing" as const, path: path.posix.join(rootPath, filePath) };
  }
}

function repoViews(config: WorkspaceConfig, rootPath: string | null): WorkspaceRepoView[] {
  const repos: WorkspaceRepoConfig[] = config.repos?.length ? config.repos : [{ localPath: rootPath ?? undefined, primary: true }];
  return repos.map((repo) => ({
    localPath: repo.localPath ?? null,
    description: repo.description ?? null,
    primary: Boolean(repo.primary),
    sourceRef: repo.sourceRef ?? config.sourceRef ?? null,
    setupCommand: repo.setupCommand ?? config.setupCommand ?? null,
    copyGlobs: dedupe([...(config.copyGlobs ?? []), ...(repo.copyGlobs ?? [])]),
  }));
}

async function provisioningEvents(bb: BbPluginApi, threadId: string) {
  const rows = await bb.sdk.threads.events.list({
    threadId,
    order: "asc",
    limit: "100",
    types: ["system/thread-provisioning"],
  });
  const events: WorkspaceView["provisioningEvents"] = [];
  const kinds = new Set<string>();
  for (const row of rows as Array<{ seq: number; createdAt: number; data?: { status?: string; entries?: Array<{ key?: string; type?: string; text?: string; status?: string }> } }>) {
    kinds.add("system/thread-provisioning");
    const entries = row.data?.entries ?? [];
    for (const entry of entries) {
      const kind = [entry.type, entry.key, entry.status].filter(Boolean).join(":") || "system/thread-provisioning";
      kinds.add(kind);
      events.push({ seq: row.seq, createdAt: row.createdAt, status: row.data?.status ?? entry.status ?? null, kind, text: entry.text ?? "" });
    }
  }
  return { events, kinds: [...kinds] };
}

function latestWorktreeThread(db: Database, taskId: string) {
  return readRow<{ threadId: string }>(
    db,
    "SELECT thread_id AS threadId FROM sessions WHERE task_id = ? AND label IN ('worktree-setup', 'implementation') ORDER BY created_at DESC LIMIT 1",
    taskId,
  )?.threadId ?? null;
}

function dedupe(items: string[]) {
  return [...new Set(items.filter((item) => typeof item === "string" && item.trim() !== "").map((item) => item.trim()))];
}
