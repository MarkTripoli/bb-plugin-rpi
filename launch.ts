import { randomUUID } from "node:crypto";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type * as BetterSqlite3 from "better-sqlite3";
import type { TaskRecord } from "./contract";
import { nowMs, readRow, readRows, writeRow } from "./db";
import { getTask } from "./tasks";
import {
  bindPendingLaunch,
  launchMarker,
  mirrorSession,
  notePendingLaunchThread,
  reconcileSession,
  registerPendingLaunch,
  type LaunchBindingMirror,
  type SessionMirrorRow,
} from "./sessions";

type Database = BetterSqlite3.Database;

export type LaunchAttemptStatus = "pending" | "spawned" | "uncertain" | "failed";
export type LaunchAttemptRow = {
  id: string;
  taskId: string;
  fromThreadId: string | null;
  skillId: string | null;
  status: LaunchAttemptStatus;
  threadId: string | null;
  createdAt: number;
};

function readTaskOrThrow(db: Database, taskId: string) {
  const result = getTask(db, taskId);
  if (!result) throw new Error(`No task found for id ${taskId}`);
  return result.task;
}

function assertLaunchableTask(task: TaskRecord, skillId: string | null) {
  if (task.worktreeTiming !== "never") {
    throw new Error("Only worktree_timing=never launches are available in this phase.");
  }
  if (skillId !== null || (task.workflowType !== "freeform" && task.workflowType !== "oneshot")) {
    throw new Error("available in a later release");
  }
}

function activeAttempt(db: Database, taskId: string) {
  return readRow<LaunchAttemptRow>(
    db,
    `
    SELECT
      id,
      task_id AS taskId,
      from_thread_id AS fromThreadId,
      skill_id AS skillId,
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

function insertAttempt(db: Database, task: TaskRecord, fromThreadId: string | null, skillId: string | null) {
  const id = randomUUID();
  writeRow(
    db,
    `
    INSERT INTO launch_attempts (id, task_id, from_thread_id, skill_id, status, thread_id, created_at)
    VALUES (?, ?, ?, ?, 'pending', NULL, ?)
    `,
    id,
    task.id,
    fromThreadId,
    skillId,
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

export function listLaunchAttempts(db: Database, taskId: string) {
  return readRows<LaunchAttemptRow>(
    db,
    `
    SELECT
      id,
      task_id AS taskId,
      from_thread_id AS fromThreadId,
      skill_id AS skillId,
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
  input: { skillId: string | null; prompt: string; launchedBy: string; fromThreadId: string | null },
) {
  assertLaunchableTask(task, input.skillId);
  const existing = activeAttempt(db, task.id);
  if (existing) throw new Error(`Resolve launch attempt ${existing.id} before launching again.`);

  const attemptId = insertAttempt(db, task, input.fromThreadId, input.skillId);
  registerPendingLaunch(bindings, {
    token: attemptId,
    taskId: task.id,
    fromThreadId: input.fromThreadId,
    skillId: input.skillId,
    launchedBy: input.launchedBy,
    threadId: null,
  });
  try {
    const thread = await bb.sdk.threads.spawn({
      projectId: task.projectId,
      environment: task.baseEnvironmentId
        ? { type: "reuse", environmentId: task.baseEnvironmentId }
        : { type: "project-default" },
      prompt: `${launchMarker(attemptId)}\n${input.prompt}`,
      title: task.name,
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
    bindPendingLaunch(db, mirror, bindings, attemptId, thread.id);
    const hydratedThread = await bb.sdk.threads.get({ threadId: thread.id, include: "environment" });
    const environmentId = hydratedThread.environmentId ?? thread.environmentId ?? null;
    const timestamp = nowMs();
    if (!task.baseEnvironmentId && environmentId) {
      writeRow(db, "UPDATE tasks SET base_environment_id = ?, updated_at = ? WHERE id = ?", environmentId, timestamp, task.id);
    }
    mirrorSession(db, mirror, thread.id);
    bb.realtime.publish("hl:sessions", { taskId: task.id, threadId: thread.id });
    bb.realtime.publish("tasks", { taskId: task.id });
    return { threadId: thread.id };
  } catch (error) {
    claimAttempt(db, attemptId, "uncertain", null);
    bindings.pendingByToken.delete(attemptId);
    for (const [threadId, binding] of bindings.pendingByThread) {
      if (binding.token === attemptId) bindings.pendingByThread.delete(threadId);
    }
    bb.realtime.publish("hl:sessions", { taskId: task.id, threadId: null });
    throw error;
  }
}

export async function launchDraft(bb: BbPluginApi, db: Database, mirror: Map<string, SessionMirrorRow>, bindings: LaunchBindingMirror, taskId: string) {
  const task = readTaskOrThrow(db, taskId);
  const result = await launchPhase(bb, db, mirror, bindings, task, {
    skillId: null,
    prompt: task.draftPrompt,
    launchedBy: "user",
    fromThreadId: null,
  });
  writeRow(db, "UPDATE tasks SET is_draft = 0, updated_at = ? WHERE id = ?", nowMs(), taskId);
  bb.realtime.publish("tasks", { taskId });
  return result;
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
    return { threadId: attempt.threadId };
  }
  if (action.type === "adopt") {
    const candidates = await bb.sdk.threads.list({
      originPluginId: bb.pluginId,
      ...(attempt.fromThreadId ? { parentThreadId: attempt.fromThreadId } : {}),
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
        ) VALUES (?, ?, NULL, ?, 'user', ?, 'launching', ?, 0, 0, NULL, ?, ?)
        `,
        action.threadId,
        task.id,
        attempt.skillId,
        attempt.fromThreadId,
        timestamp,
        timestamp,
        timestamp,
      );
      return { claimed: true, threadId: action.threadId };
    })();
    if (!result.claimed) return { threadId: result.threadId };
    if (!task.baseEnvironmentId && environmentId) {
      writeRow(db, "UPDATE tasks SET base_environment_id = ?, updated_at = ? WHERE id = ?", environmentId, timestamp, task.id);
    }
    mirrorSession(db, mirror, action.threadId);
    await reconcileSession(bb, db, mirror, action.threadId);
    return { threadId: action.threadId };
  }
  if (!claimAttempt(db, id, "failed", attempt.threadId)) {
    const current = readRow<{ threadId: string | null }>(db, "SELECT thread_id AS threadId FROM launch_attempts WHERE id = ?", id);
    return { threadId: current?.threadId ?? null };
  }
  return launchDraft(bb, db, mirror, bindings, attempt.taskId);
}
