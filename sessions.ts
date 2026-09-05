import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type * as BetterSqlite3 from "better-sqlite3";
import { nowMs, parseJson, readRow, readRows, stringifyJson, writeRow } from "./db";
import type { SessionRow } from "./contract";

type Database = BetterSqlite3.Database;
type ThreadLike = {
  id: string;
  status: "pending" | "starting" | "active" | "stopping" | "idle" | "error";
  runtime?: { displayStatus?: string } | null;
  updatedAt?: number;
  title?: string | null;
  environment?: { status?: string; path?: string | null } | null;
};
type InteractionLike = {
  status?: string;
  payload?: { kind?: string } | null;
  resolution?: unknown;
};

export type HlStatus =
  | "ready_for_launch"
  | "waiting_for_workspace"
  | "launching"
  | "running"
  | "failed"
  | "ready_for_input"
  | "needs_approval"
  | "interrupt_requested"
  | "interrupted"
  | "resuming"
  | "lost";

export type StatusDerivation = {
  hlStatus: HlStatus;
  blockedReason: "question" | "plugin" | null;
};

export type SessionMirrorRow = SessionRow & {
  taskName: string;
  taskSlug: string;
  workflowType: string;
};

export const HYDRATION_ENABLED = false;

const RELEVANT_THREAD_CHANGES = new Set([
  "status-changed",
  "interactions-changed",
  "queue-changed",
  "environment-changed",
]);

function isPendingInteraction(interaction: InteractionLike) {
  return interaction.status === "pending" || (interaction.status === undefined && interaction.resolution == null);
}

function pendingInteractionKind(interactions: readonly InteractionLike[], kind: string) {
  return interactions.some((interaction) => isPendingInteraction(interaction) && interaction.payload?.kind === kind);
}

export function deriveStatus(
  thread: ThreadLike,
  interactions: readonly InteractionLike[],
  row: Pick<SessionRow, "hadTurn" | "interrupted">,
): StatusDerivation {
  const displayStatus = thread.runtime?.displayStatus;
  const blockedReason = pendingInteractionKind(interactions, "user_question")
    ? "question"
    : pendingInteractionKind(interactions, "plugin")
      ? "plugin"
      : null;

  if (displayStatus === "waiting-for-host" || displayStatus === "host-reconnecting") {
    return { hlStatus: "lost", blockedReason };
  }
  if (displayStatus === "provisioning" || thread.environment?.status === "provisioning") {
    return { hlStatus: "waiting_for_workspace", blockedReason };
  }
  if (thread.status === "pending") return { hlStatus: "ready_for_launch", blockedReason };
  if (thread.status === "starting" && !row.hadTurn) return { hlStatus: "launching", blockedReason };
  if (thread.status === "starting" && row.hadTurn) return { hlStatus: "resuming", blockedReason };
  if (pendingInteractionKind(interactions, "approval")) return { hlStatus: "needs_approval", blockedReason };
  if (blockedReason !== null) return { hlStatus: "ready_for_input", blockedReason };
  if (thread.status === "active") return { hlStatus: "running", blockedReason };
  if (thread.status === "stopping") return { hlStatus: "interrupt_requested", blockedReason };
  if (thread.status === "error") return { hlStatus: "failed", blockedReason };
  if (thread.status === "idle" && row.interrupted) return { hlStatus: "interrupted", blockedReason };
  return { hlStatus: "ready_for_input", blockedReason };
}

export function normalizeSessionRow(row: {
  threadId: string;
  taskId: string;
  label: string | null;
  skillId: string | null;
  launchedBy: string;
  forkedFromThreadId: string | null;
  hlStatus: string;
  hlStatusAt: number;
  hadTurn: number | boolean;
  interrupted: number | boolean;
  blockedReason: string | null;
  nextStepJson: string | null;
  summaryJson: string | null;
  advancedAt: number | null;
  hydratedAt: number | null;
  createdAt: number;
  updatedAt: number;
}): SessionRow {
  return {
    ...row,
    hadTurn: Boolean(row.hadTurn),
    interrupted: Boolean(row.interrupted),
    blockedReason: row.blockedReason === "question" || row.blockedReason === "plugin" ? row.blockedReason : null,
  };
}

export function readSession(db: Database, threadId: string) {
  const row = readRow<Parameters<typeof normalizeSessionRow>[0]>(
    db,
    `
    SELECT
      thread_id AS threadId,
      task_id AS taskId,
      label,
      skill_id AS skillId,
      launched_by AS launchedBy,
      forked_from_thread_id AS forkedFromThreadId,
      hl_status AS hlStatus,
      hl_status_at AS hlStatusAt,
      had_turn AS hadTurn,
      interrupted,
      blocked_reason AS blockedReason,
      next_step_json AS nextStepJson,
      summary_json AS summaryJson,
      advanced_at AS advancedAt,
      hydrated_at AS hydratedAt,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM sessions
    WHERE thread_id = ?
    `,
    threadId,
  );
  return row ? normalizeSessionRow(row) : null;
}

export function listSessions(db: Database, taskId?: string | null) {
  const params: string[] = [];
  const where = taskId ? "WHERE task_id = ?" : "";
  if (taskId) params.push(taskId);
  return readRows<Parameters<typeof normalizeSessionRow>[0]>(
    db,
    `
    SELECT
      thread_id AS threadId,
      task_id AS taskId,
      label,
      skill_id AS skillId,
      launched_by AS launchedBy,
      forked_from_thread_id AS forkedFromThreadId,
      hl_status AS hlStatus,
      hl_status_at AS hlStatusAt,
      had_turn AS hadTurn,
      interrupted,
      blocked_reason AS blockedReason,
      next_step_json AS nextStepJson,
      summary_json AS summaryJson,
      advanced_at AS advancedAt,
      hydrated_at AS hydratedAt,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM sessions
    ${where}
    ORDER BY updated_at DESC, created_at DESC
    `,
    ...params,
  ).map(normalizeSessionRow);
}

export function loadSessionMirror(db: Database) {
  const mirror = new Map<string, SessionMirrorRow>();
  refreshSessionMirror(db, mirror);
  return mirror;
}

export function refreshSessionMirror(db: Database, mirror: Map<string, SessionMirrorRow>) {
  mirror.clear();
  const rows = readRows<Parameters<typeof normalizeSessionRow>[0] & {
    taskName: string;
    taskSlug: string;
    workflowType: string;
  }>(
    db,
    `
    SELECT
      sessions.thread_id AS threadId,
      sessions.task_id AS taskId,
      sessions.label,
      sessions.skill_id AS skillId,
      sessions.launched_by AS launchedBy,
      sessions.forked_from_thread_id AS forkedFromThreadId,
      sessions.hl_status AS hlStatus,
      sessions.hl_status_at AS hlStatusAt,
      sessions.had_turn AS hadTurn,
      sessions.interrupted,
      sessions.blocked_reason AS blockedReason,
      sessions.next_step_json AS nextStepJson,
      sessions.summary_json AS summaryJson,
      sessions.advanced_at AS advancedAt,
      sessions.hydrated_at AS hydratedAt,
      sessions.created_at AS createdAt,
      sessions.updated_at AS updatedAt,
      tasks.name AS taskName,
      tasks.slug AS taskSlug,
      tasks.workflow_type AS workflowType
    FROM sessions
    JOIN tasks ON tasks.id = sessions.task_id
    `,
  );
  for (const row of rows) {
    mirror.set(row.threadId, { ...normalizeSessionRow(row), taskName: row.taskName, taskSlug: row.taskSlug, workflowType: row.workflowType });
  }
  return mirror;
}

export function mirrorSession(db: Database, mirror: Map<string, SessionMirrorRow>, threadId: string) {
  const rows = readRows<Parameters<typeof normalizeSessionRow>[0] & {
    taskName: string;
    taskSlug: string;
    workflowType: string;
  }>(
    db,
    `
    SELECT
      sessions.thread_id AS threadId,
      sessions.task_id AS taskId,
      sessions.label,
      sessions.skill_id AS skillId,
      sessions.launched_by AS launchedBy,
      sessions.forked_from_thread_id AS forkedFromThreadId,
      sessions.hl_status AS hlStatus,
      sessions.hl_status_at AS hlStatusAt,
      sessions.had_turn AS hadTurn,
      sessions.interrupted,
      sessions.blocked_reason AS blockedReason,
      sessions.next_step_json AS nextStepJson,
      sessions.summary_json AS summaryJson,
      sessions.advanced_at AS advancedAt,
      sessions.hydrated_at AS hydratedAt,
      sessions.created_at AS createdAt,
      sessions.updated_at AS updatedAt,
      tasks.name AS taskName,
      tasks.slug AS taskSlug,
      tasks.workflow_type AS workflowType
    FROM sessions
    JOIN tasks ON tasks.id = sessions.task_id
    WHERE sessions.thread_id = ?
    `,
    threadId,
  );
  if (!rows[0]) {
    mirror.delete(threadId);
    return null;
  }
  const next = { ...normalizeSessionRow(rows[0]), taskName: rows[0].taskName, taskSlug: rows[0].taskSlug, workflowType: rows[0].workflowType };
  mirror.set(threadId, next);
  return next;
}

export function applyStatusDerivation(
  db: Database,
  mirror: Map<string, SessionMirrorRow>,
  thread: ThreadLike,
  interactions: readonly InteractionLike[],
) {
  const row = readSession(db, thread.id);
  if (!row) return null;
  const derived = deriveStatus(thread, interactions, row);
  const timestamp = nowMs();
  const changed = row.hlStatus !== derived.hlStatus || row.blockedReason !== derived.blockedReason;
  if (changed) {
    writeRow(
      db,
      `
      UPDATE sessions
      SET hl_status = ?, hl_status_at = ?, blocked_reason = ?, updated_at = ?
      WHERE thread_id = ?
      `,
      derived.hlStatus,
      timestamp,
      derived.blockedReason,
      timestamp,
      thread.id,
    );
  }
  return { row: mirrorSession(db, mirror, thread.id), changed };
}

export function appendSessionSummary(
  db: Database,
  mirror: Map<string, SessionMirrorRow>,
  threadId: string,
  lastAssistantText: string | null,
) {
  if (!lastAssistantText) return;
  const row = readSession(db, threadId);
  if (!row) return;
  const summary = parseJson<{ summaryHistory?: string[] }>(row.summaryJson, {});
  const summaryHistory = Array.isArray(summary.summaryHistory) ? summary.summaryHistory : [];
  summaryHistory.push(lastAssistantText.slice(0, 600));
  writeRow(
    db,
    "UPDATE sessions SET summary_json = ?, updated_at = ? WHERE thread_id = ?",
    stringifyJson({ ...summary, summaryHistory }),
    nowMs(),
    threadId,
  );
  mirrorSession(db, mirror, threadId);
}

export async function reconcileSession(
  bb: BbPluginApi,
  db: Database,
  mirror: Map<string, SessionMirrorRow>,
  threadId: string,
) {
  const thread = await bb.sdk.threads.get({ threadId, include: "environment" });
  const interactions = await bb.sdk.threads.interactions.list({ threadId });
  return applyStatusDerivation(db, mirror, thread as ThreadLike, interactions as InteractionLike[]);
}

export function registerSessionRuntime(bb: BbPluginApi, db: Database, mirror: Map<string, SessionMirrorRow>) {
  const publish = (threadId: string) => {
    const row = mirror.get(threadId);
    if (row) bb.realtime.publish("hl:sessions", { taskId: row.taskId, threadId });
  };

  const reconcileAndPublish = (threadId: string) => {
    if (!mirror.has(threadId)) return;
    void reconcileSession(bb, db, mirror, threadId)
      .then((result) => {
        if (result?.changed) publish(threadId);
      })
      .catch((error) => bb.log.warn(`Failed to derive HumanLayer session ${threadId}: ${String(error)}`));
  };

  const unsubscribe = bb.sdk.subscribe({
    event: "thread:changed",
    callback(event) {
      if (!event.id || !mirror.has(event.id)) return;
      if (!event.changes.some((change) => RELEVANT_THREAD_CHANGES.has(change))) return;
      reconcileAndPublish(event.id);
    },
  });
  bb.onDispose(unsubscribe);

  bb.events.on("thread.active", ({ thread }) => {
    if (!mirror.has(thread.id)) return;
    writeRow(db, "UPDATE sessions SET had_turn = 1, interrupted = 0, updated_at = ? WHERE thread_id = ?", nowMs(), thread.id);
    mirrorSession(db, mirror, thread.id);
    reconcileAndPublish(thread.id);
  });

  bb.events.on("thread.idle", ({ thread, lastAssistantText }) => {
    if (!mirror.has(thread.id)) return;
    appendSessionSummary(db, mirror, thread.id, lastAssistantText);
    const current = mirror.get(thread.id);
    if (current?.hlStatus === "interrupt_requested") {
      writeRow(db, "UPDATE sessions SET interrupted = 1, updated_at = ? WHERE thread_id = ?", nowMs(), thread.id);
      mirrorSession(db, mirror, thread.id);
    }
    reconcileAndPublish(thread.id);
    publish(thread.id);
  });

  bb.events.on("thread.failed", ({ thread }) => reconcileAndPublish(thread.id));

  bb.experimental_hooks.on("message.dispatch", (ctx) => {
    const row = mirror.get(ctx.thread.id);
    if (!row) return { action: "proceed" };
    if (!row.label && !row.skillId) {
      mirrorSession(db, mirror, ctx.thread.id);
    }
    if (HYDRATION_ENABLED && ctx.environment && row.hydratedAt === null) {
      setTimeout(() => {
        void bb.experimental_hooks.recheck("message.dispatch");
      }, 0);
      return { action: "wait", reason: "hydrating task artifacts" };
    }
    return { action: "proceed" };
  });

  for (const threadId of mirror.keys()) reconcileAndPublish(threadId);
}

export function taskInstructions(row: SessionMirrorRow) {
  return [
    `HumanLayer task: ${row.taskName} (slug ${row.taskSlug}). Task artifact directory: .humanlayer/tasks/${row.taskSlug} (relative to the workspace root; a real directory, not a symlink).`,
    `Current phase: ${row.label ?? "none"}. Workflow: ${row.workflowType}.`,
    "After writing or editing any file in the task artifact directory, call hl_artifact_save with its file name and include the returned permalink line in your final answer.",
    "Research subagent model preference: none.",
  ].join("\n");
}
