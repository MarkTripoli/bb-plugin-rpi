import { randomUUID } from "node:crypto";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type * as BetterSqlite3 from "better-sqlite3";
import type { TaskRecord } from "./contract";
import { nowMs, readRow, readRows, writeRow } from "./db";
import { getTask } from "./tasks";
import { FIRST_SKILL_BY_WORKFLOW, skillInfo, type SkillId } from "./transitions";
import { workspaceBaseBranch, workspaceDisabled } from "./workspace";
import {
  bindPendingLaunch,
  clearPendingLaunch,
  launchMarker,
  mirrorSession,
  notePendingLaunchThread,
  reconcileSession,
  registerPendingLaunch,
  type LaunchBindingMirror,
  type SessionMirrorRow,
} from "./sessions";
import { TASK_CONTEXT_FIRST_ACTION } from "./instructions";

type Database = BetterSqlite3.Database;

export type LaunchAttemptStatus = "pending" | "spawned" | "uncertain" | "failed";
export type LaunchAttemptRow = {
  id: string;
  taskId: string;
  fromThreadId: string | null;
  skillId: string | null;
  commandLine: string | null;
  label: string | null;
  environmentRole: "base" | "worktree";
  launchedBy: string;
  status: LaunchAttemptStatus;
  threadId: string | null;
  createdAt: number;
};

function readTaskOrThrow(db: Database, taskId: string) {
  const result = getTask(db, taskId);
  if (!result) throw new Error(`No task found for id ${taskId}`);
  return result.task;
}

export function activeLaunchAttempt(db: Database, taskId: string) {
  return readRow<LaunchAttemptRow>(
    db,
    `
    SELECT
      id,
      task_id AS taskId,
      from_thread_id AS fromThreadId,
      skill_id AS skillId,
      command_line AS commandLine,
      label,
      environment_role AS environmentRole,
      launched_by AS launchedBy,
      status,
      thread_id AS threadId,
      created_at AS createdAt
    FROM launch_attempts
    WHERE task_id = ? AND status IN ('pending', 'uncertain')
    ORDER BY created_at DESC
    LIMIT 1
    `,
    taskId,
  );
}

export function environmentRoleForAttempt(task: TaskRecord, skillId: string | null): "base" | "worktree" {
  if (task.worktreeTiming === "never") return "base";
  if (task.worktreeEnvironmentId) return "worktree";
  if (task.worktreeTiming === "now") return "worktree";
  const label = labelTitle(skillId);
  return label === "worktree-setup" || label === "implementation" ? "worktree" : "base";
}

export function insertAttempt(
  db: Database,
  task: TaskRecord,
  input: { fromThreadId: string | null; skillId: string | null; commandLine: string | null; label: string | null; environmentRole: "base" | "worktree"; launchedBy: string },
) {
  const id = randomUUID();
  writeRow(
    db,
    `
    INSERT INTO launch_attempts (
      id, task_id, from_thread_id, skill_id, command_line, label,
      environment_role, launched_by, status, thread_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, ?)
    `,
    id,
    task.id,
    input.fromThreadId,
    input.skillId,
    input.commandLine,
    input.label,
    input.environmentRole,
    input.launchedBy,
    nowMs(),
  );
  return id;
}

function claimAttempt(db: Database, id: string, status: LaunchAttemptStatus, threadId: string | null) {
  return writeRow(
    db,
    "UPDATE launch_attempts SET status = ?, thread_id = ? WHERE id = ? AND status IN ('pending', 'uncertain')",
    status,
    threadId,
    id,
  ).changes === 1;
}

export function promoteStalePendingLaunchAttempts(db: Database, olderThanMs = 2 * 60_000) {
  const cutoff = nowMs() - olderThanMs;
  const rows = readRows<{ taskId: string }>(
    db,
    "SELECT DISTINCT task_id AS taskId FROM launch_attempts WHERE status = 'pending' AND created_at < ?",
    cutoff,
  );
  writeRow(db, "UPDATE launch_attempts SET status = 'uncertain' WHERE status = 'pending' AND created_at < ?", cutoff);
  return rows.map((row) => row.taskId);
}

function sdkPermissionMode(mode: TaskRecord["permissionMode"]): "accept-edits" | "auto" | "full" | undefined {
  if (mode === "accept_edits") return "accept-edits";
  if (mode === "auto") return "auto";
  if (mode === "bypass") return "full";
  return undefined;
}

function optionalExecution(task: TaskRecord) {
  return {
    ...(task.providerId ? { providerId: task.providerId } : {}),
    ...(task.model ? { model: task.model } : {}),
    ...(task.reasoningLevel ? { reasoningLevel: task.reasoningLevel as "none" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra" | "ultracode" } : {}),
    ...(task.serviceTier ? { serviceTier: task.serviceTier as "default" | "fast" } : {}),
    ...(sdkPermissionMode(task.permissionMode) ? { permissionMode: sdkPermissionMode(task.permissionMode) } : {}),
  };
}

function canonicalSkill(skillId: string | null) {
  if (skillId === null) return null;
  const info = skillInfo(skillId);
  if (!info) throw new Error(`Unknown skill ${skillId}`);
  return info;
}

function labelTitle(skillId: string | null) {
  const info = canonicalSkill(skillId);
  return info?.label ?? "freeform";
}

function commandFor(skillId: string | null, commandLine?: string | null) {
  if (commandLine?.trim()) return commandLine.trim();
  const info = canonicalSkill(skillId);
  return info ? info.command : null;
}

function shouldCreateWorktree(task: TaskRecord, skillId: string | null, disabled: boolean) {
  if (disabled || task.worktreeTiming === "never") return false;
  if (task.worktreeTiming === "now") return task.worktreeEnvironmentId === null;
  const label = labelTitle(skillId);
  return task.worktreeEnvironmentId === null && (label === "worktree-setup" || label === "implementation");
}

async function selectEnvironment(bb: BbPluginApi, task: TaskRecord, skillId: string | null, role: "base" | "worktree") {
  const disabled = await workspaceDisabled(bb, task);
  if (role === "worktree" && disabled) throw new Error("Workspace config disables worktree launch.");
  if (task.worktreeEnvironmentId && !disabled && task.worktreeTiming !== "never") {
    return { environment: { type: "reuse" as const, environmentId: task.worktreeEnvironmentId }, stores: "none" as const, role: "worktree" as const };
  }
  if (shouldCreateWorktree(task, skillId, disabled)) {
    const hostId = task.hostId ?? await hostIdFromBaseEnvironment(bb, task);
    if (!hostId) throw new Error("hostId is required to create a managed worktree");
    return {
      environment: {
        type: "host" as const,
        hostId,
        workspace: { type: "managed-worktree" as const, baseBranch: await workspaceBaseBranch(bb, task) },
      },
      stores: "worktree" as const,
      role: "worktree" as const,
    };
  }
  if (task.baseEnvironmentId) return { environment: { type: "reuse" as const, environmentId: task.baseEnvironmentId }, stores: "none" as const, role: "base" as const };
  if (task.hostId && task.defaultDirectory) {
    return {
      environment: { type: "host" as const, hostId: task.hostId, workspace: { type: "unmanaged" as const, path: task.defaultDirectory } },
      stores: "base" as const,
      role: "base" as const,
    };
  }
  return { environment: { type: "project-default" as const }, stores: "base" as const, role: "base" as const };
}

async function hostIdFromBaseEnvironment(bb: BbPluginApi, task: TaskRecord) {
  if (!task.baseEnvironmentId) return null;
  try {
    return (await bb.sdk.environments.get({ environmentId: task.baseEnvironmentId })).hostId ?? null;
  } catch {
    return null;
  }
}

function promptFor(task: TaskRecord, input: { skillId: string | null; prompt?: string; commandLine?: string | null }) {
  const command = commandFor(input.skillId, input.commandLine);
  const body = command ?? input.prompt ?? task.draftPrompt;
  const suffix = `Task artifact directory: .humanlayer/tasks/${task.slug}`;
  return `${body}\n\n${suffix}`;
}

export function listLaunchAttempts(db: Database, taskId: string) {
  return readRows<LaunchAttemptRow>(
    db,
    `
    SELECT
      id,
      task_id AS taskId,
      from_thread_id AS fromThreadId,
      skill_id AS skillId,
      command_line AS commandLine,
      label,
      environment_role AS environmentRole,
      launched_by AS launchedBy,
      status,
      thread_id AS threadId,
      created_at AS createdAt
    FROM launch_attempts
    WHERE task_id = ?
    ORDER BY created_at DESC
    `,
    taskId,
  );
}

export async function launchPhase(
  bb: BbPluginApi,
  db: Database,
  mirror: Map<string, SessionMirrorRow>,
  bindings: LaunchBindingMirror,
  task: TaskRecord,
  input: { skillId: string | null; prompt?: string; commandLine?: string | null; launchedBy: string; fromThreadId: string | null; attemptId?: string },
) {
  canonicalSkill(input.skillId);
  if (task.archived) throw new Error("Task is archived.");
  const commandLine = commandFor(input.skillId, input.commandLine);
  const label = labelTitle(input.skillId);
  const environmentRole = environmentRoleForAttempt(task, input.skillId);
  const attemptId = input.attemptId ?? (() => {
    const existing = activeLaunchAttempt(db, task.id);
    if (existing) throw new Error(`Resolve launch attempt ${existing.id} before launching again.`);
    return insertAttempt(db, task, {
      fromThreadId: input.fromThreadId,
      skillId: input.skillId,
      commandLine,
      label,
      environmentRole,
      launchedBy: input.launchedBy,
    });
  })();

  registerPendingLaunch(bindings, {
    token: attemptId,
    taskId: task.id,
    fromThreadId: input.fromThreadId,
    skillId: input.skillId,
    launchedBy: input.launchedBy,
    threadId: null,
  });
  let selected: Awaited<ReturnType<typeof selectEnvironment>>;
  try {
    selected = await selectEnvironment(bb, task, input.skillId, environmentRole);
  } catch (error) {
    failPreSpawnAttempt(db, attemptId, input.fromThreadId);
    clearPendingLaunch(bindings, attemptId);
    bb.realtime.publish("hl:sessions", { taskId: task.id, threadId: null });
    throw error;
  }
  try {
    const thread = await bb.sdk.threads.spawn({
      projectId: task.projectId,
      environment: selected.environment,
      prompt: `${launchMarker(attemptId)}\n${TASK_CONTEXT_FIRST_ACTION}\n${promptFor(task, input)}`,
      title: `${labelTitle(input.skillId)}: ${task.name}`,
      visibility: "visible",
      executionInputSources: {
        providerId: task.providerId ? "explicit" : undefined,
        model: task.model ? "explicit" : undefined,
        reasoningLevel: task.reasoningLevel ? "explicit" : undefined,
        serviceTier: task.serviceTier ? "explicit" : undefined,
        permissionMode: task.permissionMode && task.permissionMode !== "default" ? "explicit" : undefined,
      },
      ...optionalExecution(task),
    });
    notePendingLaunchThread(bindings, attemptId, thread.id);
    const bound = bindPendingLaunch(db, mirror, bindings, attemptId, thread.id);
    if (!bound) {
      bb.log.warn(`HumanLayer launch attempt ${attemptId} returned thread ${thread.id} after it was resolved; leaving thread unbound.`);
      return { threadId: thread.id };
    }
    const hydratedThread = await bb.sdk.threads.get({ threadId: thread.id, include: "environment" });
    const environmentId = hydratedThread.environmentId ?? thread.environmentId ?? null;
    const timestamp = nowMs();
    if (selected.stores === "base" && !task.baseEnvironmentId && environmentId) {
      writeRow(db, "UPDATE tasks SET base_environment_id = ?, updated_at = ? WHERE id = ?", environmentId, timestamp, task.id);
    } else if (selected.stores === "worktree" && environmentId) {
      writeRow(db, "UPDATE tasks SET worktree_environment_id = ?, updated_at = ? WHERE id = ?", environmentId, timestamp, task.id);
    }
    mirrorSession(db, mirror, thread.id);
    bb.realtime.publish("hl:sessions", { taskId: task.id, threadId: thread.id });
    bb.realtime.publish("tasks", { taskId: task.id });
    return { threadId: thread.id };
  } catch (error) {
    claimAttempt(db, attemptId, "uncertain", null);
    clearPendingLaunch(bindings, attemptId);
    bb.realtime.publish("hl:sessions", { taskId: task.id, threadId: null });
    throw error;
  }
}

export async function launchDraft(bb: BbPluginApi, db: Database, mirror: Map<string, SessionMirrorRow>, bindings: LaunchBindingMirror, taskId: string) {
  const task = readTaskOrThrow(db, taskId);
  const firstSkill = FIRST_SKILL_BY_WORKFLOW[task.workflowType] as SkillId | null;
  const result = await launchPhase(bb, db, mirror, bindings, task, {
    skillId: firstSkill,
    prompt: firstSkill ? undefined : task.draftPrompt,
    launchedBy: "user",
    fromThreadId: null,
  });
  writeRow(db, "UPDATE tasks SET is_draft = 0, updated_at = ? WHERE id = ?", nowMs(), taskId);
  bb.realtime.publish("tasks", { taskId });
  return result;
}

function failPreSpawnAttempt(db: Database, attemptId: string, fromThreadId: string | null) {
  db.transaction(() => {
    claimAttempt(db, attemptId, "failed", null);
    if (fromThreadId) writeRow(db, "UPDATE sessions SET advanced_at = NULL, updated_at = ? WHERE thread_id = ?", nowMs(), fromThreadId);
  })();
}

export async function forkSession(
  bb: BbPluginApi,
  db: Database,
  mirror: Map<string, SessionMirrorRow>,
  threadId: string,
  text?: string | null,
) {
  const source = mirror.get(threadId);
  if (!source) throw new Error(`No session found for thread ${threadId}`);
  const fork = await bb.sdk.threads.fork({
    sourceThreadId: threadId,
    workspace: "reuse",
    title: source.taskName,
    ...(text?.trim()
      ? { agentContextSeed: [{ type: "text" as const, text: text.trim(), mentions: [], visibility: "agent-only" as const }] }
      : {}),
  });
  const timestamp = nowMs();
  writeRow(
    db,
    `
    INSERT INTO sessions (
      thread_id, task_id, label, skill_id, launched_by, forked_from_thread_id,
      hl_status, hl_status_at, had_turn, interrupted, blocked_reason,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'fork', ?, 'launching', ?, 0, 0, NULL, ?, ?)
    `,
    fork.id,
    source.taskId,
    source.label,
    source.skillId,
    threadId,
    timestamp,
    timestamp,
    timestamp,
  );
  mirrorSession(db, mirror, fork.id);
  bb.realtime.publish("hl:sessions", { taskId: source.taskId, threadId: fork.id });
  bb.realtime.publish("tasks", { taskId: source.taskId });
  return { threadId: fork.id };
}

export async function interruptSession(bb: BbPluginApi, db: Database, mirror: Map<string, SessionMirrorRow>, threadId: string) {
  const source = mirror.get(threadId);
  if (!source) throw new Error(`No session found for thread ${threadId}`);
  await bb.sdk.threads.stop({ threadId });
  bb.realtime.publish("hl:sessions", { taskId: source.taskId, threadId });
  return { ok: true as const };
}

export async function resolveLaunchAttempt(
  bb: BbPluginApi,
  db: Database,
  mirror: Map<string, SessionMirrorRow>,
  bindings: LaunchBindingMirror,
  id: string,
  action: { type: "adopt"; threadId: string } | { type: "retry" } | { type: "dismiss" },
) {
  const attempt = readRow<LaunchAttemptRow>(
    db,
    `
    SELECT
      id,
      task_id AS taskId,
      from_thread_id AS fromThreadId,
      skill_id AS skillId,
      command_line AS commandLine,
      label,
      environment_role AS environmentRole,
      launched_by AS launchedBy,
      status,
      thread_id AS threadId,
      created_at AS createdAt
    FROM launch_attempts
    WHERE id = ?
    `,
    id,
  );
  if (!attempt) throw new Error(`No launch attempt found for id ${id}`);
  if (attempt.status !== "pending" && attempt.status !== "uncertain") return { threadId: attempt.threadId };
  if (action.type === "dismiss") {
    claimAttempt(db, id, "failed", attempt.threadId);
    clearPendingLaunch(bindings, id);
    return { threadId: attempt.threadId };
  }
  if (action.type === "adopt") {
    const candidates = await bb.sdk.threads.list({
      originPluginId: bb.pluginId,
      limit: 100,
    });
    const found = candidates.find((thread) => thread.id === action.threadId && thread.createdAt >= attempt.createdAt);
    if (!found) throw new Error("Thread is not an adopt candidate for this attempt.");
    const task = readTaskOrThrow(db, attempt.taskId);
    const hydratedThread = await bb.sdk.threads.get({ threadId: action.threadId, include: "environment" });
    const environmentId = hydratedThread.environmentId ?? null;
    const timestamp = nowMs();
    const result = db.transaction(() => {
      if (!claimAttempt(db, id, "spawned", action.threadId)) {
        const current = readRow<{ threadId: string | null }>(db, "SELECT thread_id AS threadId FROM launch_attempts WHERE id = ?", id);
        return { claimed: false, threadId: current?.threadId ?? null };
      }
      const existing = readRow<{ threadId: string }>(db, "SELECT thread_id AS threadId FROM sessions WHERE thread_id = ?", action.threadId);
      if (existing) throw new Error("Thread is already bound to a HumanLayer session.");
      writeRow(
        db,
        `
        INSERT INTO sessions (
          thread_id, task_id, label, skill_id, launched_by, forked_from_thread_id,
          hl_status, hl_status_at, had_turn, interrupted, blocked_reason,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'launching', ?, 0, 0, NULL, ?, ?)
        `,
        action.threadId,
        task.id,
        attempt.label,
        attempt.skillId,
        attempt.launchedBy,
        attempt.fromThreadId,
        timestamp,
        timestamp,
        timestamp,
      );
      return { claimed: true, threadId: action.threadId };
    })();
    clearPendingLaunch(bindings, id);
    if (!result.claimed) return { threadId: result.threadId };
    if (attempt.environmentRole === "worktree" && environmentId) {
      writeRow(db, "UPDATE tasks SET worktree_environment_id = ?, updated_at = ? WHERE id = ?", environmentId, timestamp, task.id);
    } else if (attempt.environmentRole === "base" && !task.baseEnvironmentId && environmentId) {
      writeRow(db, "UPDATE tasks SET base_environment_id = ?, updated_at = ? WHERE id = ?", environmentId, timestamp, task.id);
    }
    mirrorSession(db, mirror, action.threadId);
    await reconcileSession(bb, db, mirror, action.threadId);
    return { threadId: action.threadId };
  }
  if (!writeRow(db, "UPDATE launch_attempts SET status = 'pending', thread_id = NULL WHERE id = ? AND status IN ('pending', 'uncertain')", id).changes) {
    const current = readRow<{ threadId: string | null }>(db, "SELECT thread_id AS threadId FROM launch_attempts WHERE id = ?", id);
    clearPendingLaunch(bindings, id);
    return { threadId: current?.threadId ?? null };
  }
  clearPendingLaunch(bindings, id);
  const task = readTaskOrThrow(db, attempt.taskId);
  return launchPhase(bb, db, mirror, bindings, task, {
    skillId: attempt.skillId,
    commandLine: attempt.commandLine,
    launchedBy: attempt.launchedBy,
    fromThreadId: attempt.fromThreadId,
    attemptId: id,
  });
}
