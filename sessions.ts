import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type * as BetterSqlite3 from "better-sqlite3";
import { nowMs, parseJson, readRow, readRows, stringifyJson, writeRow } from "./db";
import { extractNextStep } from "./extraction";
import { hydrate, ingest } from "./mirror";
import type { SessionRow } from "./contract";
import { TASK_CONTEXT_FIRST_ACTION } from "./instructions";
import { RPI_AGENT_SKILL_IDS, skillInfo } from "./transitions";

type Database = BetterSqlite3.Database;
export type ThreadLike = {
  id: string;
  status: "pending" | "starting" | "active" | "stopping" | "idle" | "error";
  runtime?: { displayStatus?: string } | null;
  updatedAt?: number;
  numEvents?: number;
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
  providerId: string | null;
  model: string | null;
};

export type ChildThreadMirrorRow = {
  threadId: string;
  taskId: string;
  parentThreadId: string;
  role: string;
};

export const HYDRATION_ENABLED = true;
export const LAUNCH_MARKER_PREFIX = "<!-- hl:launch:";
const LAUNCH_MARKER_RE = /<!--\s*hl:launch:([A-Za-z0-9_-]+)\s*-->/;

const RELEVANT_THREAD_CHANGES = new Set([
  "status-changed",
  "interactions-changed",
  "queue-changed",
  "environment-changed",
]);

type PendingBinding = {
  token: string;
  taskId: string;
  fromThreadId: string | null;
  skillId: string | null;
  launchedBy: string;
  threadId: string | null;
};

type BufferedLifecycle =
  | { kind: "active"; thread: ThreadLike }
  | { kind: "idle"; thread: ThreadLike; lastAssistantText: string | null }
  | { kind: "failed"; thread: ThreadLike }
  | { kind: "changed"; threadId: string };

export type LaunchBindingMirror = {
  pendingByToken: Map<string, PendingBinding>;
  pendingByThread: Map<string, PendingBinding>;
  bufferedByThread: Map<string, BufferedLifecycle[]>;
  onBound?: (threadId: string) => void | Promise<void>;
};

export function createLaunchBindingMirror(): LaunchBindingMirror {
  return {
    pendingByToken: new Map(),
    pendingByThread: new Map(),
    bufferedByThread: new Map(),
  };
}

export function registerPendingLaunch(bindings: LaunchBindingMirror, binding: PendingBinding) {
  bindings.pendingByToken.set(binding.token, binding);
  if (binding.threadId) bindings.pendingByThread.set(binding.threadId, binding);
}

export function notePendingLaunchThread(bindings: LaunchBindingMirror, token: string, threadId: string) {
  const binding = bindings.pendingByToken.get(token);
  if (!binding) return null;
  binding.threadId = threadId;
  bindings.pendingByThread.set(threadId, binding);
  return binding;
}

export function clearPendingLaunch(bindings: LaunchBindingMirror, token: string) {
  bindings.pendingByToken.delete(token);
  for (const [threadId, binding] of bindings.pendingByThread) {
    if (binding.token === token) bindings.pendingByThread.delete(threadId);
  }
}

export function bindPendingLaunch(
  db: Database,
  mirror: Map<string, SessionMirrorRow>,
  bindings: LaunchBindingMirror,
  token: string,
  threadId: string,
) {
  const binding = bindings.pendingByToken.get(token);
  if (!binding) return mirror.get(threadId) ?? null;
  const timestamp = nowMs();
  let claimed = false;
  db.transaction(() => {
    const claim = writeRow(
      db,
      "UPDATE launch_attempts SET status = 'spawned', thread_id = ? WHERE id = ? AND status IN ('pending', 'uncertain')",
      threadId,
      token,
    );
    claimed = claim.changes === 1;
    if (!claimed) return;
    const existing = readRow<{ threadId: string }>(db, "SELECT thread_id AS threadId FROM sessions WHERE thread_id = ?", threadId);
    if (!existing) {
      writeRow(
        db,
        `
        INSERT INTO sessions (
          thread_id, task_id, label, skill_id, launched_by, forked_from_thread_id,
          hl_status, hl_status_at, had_turn, interrupted, blocked_reason,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'launching', ?, 0, 0, NULL, ?, ?)
        `,
        threadId,
        binding.taskId,
        binding.skillId ? skillInfo(binding.skillId)?.label ?? null : null,
        binding.skillId,
        binding.launchedBy,
        binding.fromThreadId,
        timestamp,
        timestamp,
        timestamp,
      );
    }
  })();
  clearPendingLaunch(bindings, token);
  if (!claimed) return null;
  const row = mirrorSession(db, mirror, threadId);
  void bindings.onBound?.(threadId);
  return row;
}

export function bindPendingThread(db: Database, mirror: Map<string, SessionMirrorRow>, bindings: LaunchBindingMirror, threadId: string) {
  const binding = bindings.pendingByThread.get(threadId);
  return binding ? bindPendingLaunch(db, mirror, bindings, binding.token, threadId) : (mirror.get(threadId) ?? null);
}

export function launchMarker(token: string) {
  return `${LAUNCH_MARKER_PREFIX}${token} -->`;
}

export function extractLaunchToken(text: string | null | undefined) {
  return LAUNCH_MARKER_RE.exec(text ?? "")?.[1] ?? null;
}

function isPendingInteraction(interaction: InteractionLike) {
  return interaction.status === "pending" || (interaction.status === undefined && interaction.resolution == null);
}

function pendingInteractionKind(interactions: readonly InteractionLike[], kind: string) {
  return interactions.some((interaction) => isPendingInteraction(interaction) && interaction.payload?.kind === kind);
}

function pendingBlockedReason(interactions: readonly InteractionLike[]) {
  return pendingInteractionKind(interactions, "user_question")
    ? "question"
    : pendingInteractionKind(interactions, "plugin")
      ? "plugin"
      : null;
}

export function deriveStatus(
  thread: ThreadLike,
  interactions: readonly InteractionLike[],
  row: Pick<SessionRow, "hadTurn" | "interrupted">,
): StatusDerivation {
  const displayStatus = thread.runtime?.displayStatus;
  const blockedReason = pendingBlockedReason(interactions);

  if (displayStatus === "waiting-for-host" || displayStatus === "host-reconnecting") {
    return { hlStatus: "lost", blockedReason };
  }
  if (displayStatus === "provisioning" || thread.environment?.status === "provisioning") {
    return { hlStatus: "waiting_for_workspace", blockedReason };
  }
  if (thread.status === "pending") return { hlStatus: "ready_for_launch", blockedReason };
  if (thread.status === "starting" && !row.hadTurn) return { hlStatus: "launching", blockedReason };
  if (thread.status === "starting" && row.hadTurn) return { hlStatus: "resuming", blockedReason };
  if (thread.status === "active" && pendingInteractionKind(interactions, "approval")) return { hlStatus: "needs_approval", blockedReason };
  if ((thread.status === "active" || thread.status === "idle") && blockedReason !== null) return { hlStatus: "ready_for_input", blockedReason };
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
	  advancedAttemptId: string | null;
	  hydratedAt: number | null;
	  lastReconcileSeq: number;
	  lastSummarizedTurnKey: string | null;
	  completedTurnKey: string | null;
	  nextStepTurnKey: string | null;
	  ingestError: string | null;
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
	      advanced_attempt_id AS advancedAttemptId,
	      hydrated_at AS hydratedAt,
	      last_reconcile_seq AS lastReconcileSeq,
	      last_summarized_turn_key AS lastSummarizedTurnKey,
	      completed_turn_key AS completedTurnKey,
	      next_step_turn_key AS nextStepTurnKey,
	      ingest_error AS ingestError,
	      created_at AS createdAt,
	      updated_at AS updatedAt
    FROM sessions
    WHERE thread_id = ?
    `,
    threadId,
  );
  return row ? normalizeSessionRow(row) : null;
}

export function listSessions(db: Database, taskId?: string | null, page?: { limit?: number; offset?: number }) {
  const params: Array<string | number> = [];
  const where = taskId ? "WHERE task_id = ?" : "";
  if (taskId) params.push(taskId);
  const limit = page?.limit;
  const offset = page?.offset ?? 0;
  const pagination = limit === undefined ? "" : "LIMIT ? OFFSET ?";
  if (limit !== undefined) params.push(limit, offset);
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
	      advanced_attempt_id AS advancedAttemptId,
	      hydrated_at AS hydratedAt,
	      last_reconcile_seq AS lastReconcileSeq,
	      last_summarized_turn_key AS lastSummarizedTurnKey,
	      completed_turn_key AS completedTurnKey,
	      next_step_turn_key AS nextStepTurnKey,
	      ingest_error AS ingestError,
	      created_at AS createdAt,
	      updated_at AS updatedAt
	    FROM sessions
	    ${where}
	    ORDER BY updated_at DESC, created_at DESC
	    ${pagination}
	    `,
    ...params,
  ).map(normalizeSessionRow);
}

export function loadSessionMirror(db: Database) {
  const mirror = new Map<string, SessionMirrorRow>();
  refreshSessionMirror(db, mirror);
  return mirror;
}

export function loadChildThreadMirror(db: Database) {
  const mirror = new Map<string, ChildThreadMirrorRow>();
  for (const row of readRows<ChildThreadMirrorRow>(
    db,
    "SELECT thread_id AS threadId, task_id AS taskId, parent_thread_id AS parentThreadId, role FROM child_threads",
  )) {
    mirror.set(row.threadId, row);
  }
  return mirror;
}

function parseAgentRole(text: string | null | undefined) {
  const role = /^\s*\/rpi-agent-([a-z0-9-]+)(?:\s|$)/.exec(text ?? "")?.[1] ?? null;
  return role && (RPI_AGENT_SKILL_IDS as readonly string[]).includes(role) ? role : null;
}

function recordChildThread(db: Database, mirror: Map<string, ChildThreadMirrorRow>, threadId: string, parentThreadId: string, role: string) {
  const parent = readRow<{ taskId: string }>(db, "SELECT task_id AS taskId FROM sessions WHERE thread_id = ?", parentThreadId);
  if (!parent) return null;
  writeRow(
    db,
    `
    INSERT OR IGNORE INTO child_threads (thread_id, task_id, parent_thread_id, role, created_at)
    VALUES (?, ?, ?, ?, ?)
    `,
    threadId,
    parent.taskId,
    parentThreadId,
    role,
    nowMs(),
  );
  const row = readRow<ChildThreadMirrorRow>(
    db,
    "SELECT thread_id AS threadId, task_id AS taskId, parent_thread_id AS parentThreadId, role FROM child_threads WHERE thread_id = ?",
    threadId,
  );
  if (row) mirror.set(threadId, row);
  return row ?? null;
}

async function actualParentThreadId(bb: BbPluginApi, threadId: string) {
  const thread = await bb.sdk.threads.get({ threadId }).catch(() => null) as { parentThreadId?: string | null } | null;
  return thread?.parentThreadId ?? null;
}

export function refreshSessionMirror(db: Database, mirror: Map<string, SessionMirrorRow>) {
  mirror.clear();
  const rows = readRows<Parameters<typeof normalizeSessionRow>[0] & {
    taskName: string;
    taskSlug: string;
    workflowType: string;
    providerId: string | null;
    model: string | null;
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
	      sessions.advanced_attempt_id AS advancedAttemptId,
	      sessions.hydrated_at AS hydratedAt,
	      sessions.last_reconcile_seq AS lastReconcileSeq,
	      sessions.last_summarized_turn_key AS lastSummarizedTurnKey,
	      sessions.completed_turn_key AS completedTurnKey,
	      sessions.next_step_turn_key AS nextStepTurnKey,
	      sessions.ingest_error AS ingestError,
	      sessions.created_at AS createdAt,
	      sessions.updated_at AS updatedAt,
      tasks.name AS taskName,
      tasks.slug AS taskSlug,
      tasks.workflow_type AS workflowType,
      tasks.provider_id AS providerId,
      tasks.model
    FROM sessions
    JOIN tasks ON tasks.id = sessions.task_id
    `,
  );
  for (const row of rows) {
    mirror.set(row.threadId, { ...normalizeSessionRow(row), taskName: row.taskName, taskSlug: row.taskSlug, workflowType: row.workflowType, providerId: row.providerId, model: row.model });
  }
  return mirror;
}

export function mirrorSession(db: Database, mirror: Map<string, SessionMirrorRow>, threadId: string) {
  const rows = readRows<Parameters<typeof normalizeSessionRow>[0] & {
    taskName: string;
    taskSlug: string;
    workflowType: string;
    providerId: string | null;
    model: string | null;
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
	      sessions.advanced_attempt_id AS advancedAttemptId,
	      sessions.hydrated_at AS hydratedAt,
	      sessions.last_reconcile_seq AS lastReconcileSeq,
	      sessions.last_summarized_turn_key AS lastSummarizedTurnKey,
	      sessions.completed_turn_key AS completedTurnKey,
	      sessions.next_step_turn_key AS nextStepTurnKey,
	      sessions.ingest_error AS ingestError,
	      sessions.created_at AS createdAt,
	      sessions.updated_at AS updatedAt,
      tasks.name AS taskName,
      tasks.slug AS taskSlug,
      tasks.workflow_type AS workflowType,
      tasks.provider_id AS providerId,
      tasks.model
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
  const next = { ...normalizeSessionRow(rows[0]), taskName: rows[0].taskName, taskSlug: rows[0].taskSlug, workflowType: rows[0].workflowType, providerId: rows[0].providerId, model: rows[0].model };
  mirror.set(threadId, next);
  return next;
}

export function applyStatusDerivation(
  db: Database,
  mirror: Map<string, SessionMirrorRow>,
  thread: ThreadLike,
  interactions: readonly InteractionLike[],
  sequence?: number,
) {
  const row = readSession(db, thread.id);
  if (!row) return null;
  if (sequence !== undefined && sequence < row.lastReconcileSeq) {
    return { row: mirror.get(thread.id) ?? row, previous: row, changed: false, stale: true };
  }
  const derived = deriveStatus(thread, interactions, row);
  const timestamp = nowMs();
  const changed = row.hlStatus !== derived.hlStatus || row.blockedReason !== derived.blockedReason;
  if (changed || (sequence !== undefined && sequence > row.lastReconcileSeq)) {
    writeRow(
      db,
      `
      UPDATE sessions
      SET hl_status = ?, hl_status_at = CASE WHEN ? THEN ? ELSE hl_status_at END, blocked_reason = ?, last_reconcile_seq = ?, updated_at = ?
      WHERE thread_id = ?
      `,
      derived.hlStatus,
      changed ? 1 : 0,
      timestamp,
      derived.blockedReason,
      sequence ?? row.lastReconcileSeq,
      timestamp,
      thread.id,
    );
  }
  return { row: mirrorSession(db, mirror, thread.id), previous: row, changed, stale: false };
}

function turnKey(thread: ThreadLike) {
  return `${thread.numEvents ?? "events"}:${thread.updatedAt ?? nowMs()}`;
}

export function appendSessionSummary(
  db: Database,
  mirror: Map<string, SessionMirrorRow>,
  thread: ThreadLike,
  lastAssistantText: string | null,
) {
  if (!lastAssistantText?.trim()) return false;
  const row = mirror.get(thread.id) ?? mirrorSession(db, mirror, thread.id) ?? readSession(db, thread.id);
  if (!row) return false;
  const key = turnKey(thread);
  if (row.lastSummarizedTurnKey === key) return false;
  const summary = parseJson<{ summaryHistory?: string[] }>(row.summaryJson, {});
  const summaryHistory = Array.isArray(summary.summaryHistory) ? summary.summaryHistory : [];
  summaryHistory.push(lastAssistantText.slice(0, 600));
  const liveArtifactNames = liveArtifacts(db, row.taskId);
  const taskSlug = (row as Partial<SessionMirrorRow>).taskSlug ?? null;
  const nextStep = extractNextStep(lastAssistantText, { liveArtifactNames, taskSlug });
  const relevantRPIDocuments = relevantDocuments(lastAssistantText, row.taskId, taskSlug, liveArtifactNames);
  writeRow(
    db,
    "UPDATE sessions SET summary_json = ?, next_step_json = ?, last_summarized_turn_key = ?, completed_turn_key = ?, next_step_turn_key = ?, ingest_error = NULL, updated_at = ? WHERE thread_id = ?",
    stringifyJson({ ...summary, summaryHistory, ...(relevantRPIDocuments.length > 0 ? { relevantRPIDocuments } : {}) }),
    stringifyJson(nextStep),
    key,
    key,
    key,
    nowMs(),
    thread.id,
  );
  mirrorSession(db, mirror, thread.id);
  return true;
}

async function initiatingMessageIsSystemInjected(bb: BbPluginApi, threadId: string, lastAssistantText: string) {
  const timeline = await bb.sdk.threads.timeline({ threadId, segmentLimit: "40", summaryOnly: "false" });
  const rows = (timeline.rows ?? []) as Array<{
    kind?: string;
    role?: string;
    text?: string;
    turnId?: string | null;
    sourceSeqStart?: number;
    senderThreadId?: string | null;
    systemMessageKind?: string | null;
  }>;
  let matchingAssistantIndex = -1;
  let lastAssistantIndex = -1;
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (row?.kind !== "conversation" || row.role !== "assistant") continue;
    if (lastAssistantIndex === -1) lastAssistantIndex = index;
    if (row.text === lastAssistantText) {
      matchingAssistantIndex = index;
      break;
    }
  }
  const assistant = rows[matchingAssistantIndex >= 0 ? matchingAssistantIndex : lastAssistantIndex];
  if (!assistant) return false;
  const before = rows.filter((row) => row.kind === "conversation" && row.role === "user" && (assistant.sourceSeqStart === undefined || (row.sourceSeqStart ?? 0) <= assistant.sourceSeqStart));
  let user = before.at(-1);
  if (assistant.turnId) {
    for (let index = before.length - 1; index >= 0; index -= 1) {
      if (before[index]?.turnId === assistant.turnId) {
        user = before[index];
        break;
      }
    }
  }
  return Boolean((user?.systemMessageKind && user.systemMessageKind !== "unlabeled") || user?.senderThreadId);
}

function liveArtifacts(db: Database, taskId: string) {
  return readRows<{ fileName: string }>(
    db,
    "SELECT file_name AS fileName FROM artifacts WHERE task_id = ? AND is_deleted = 0",
    taskId,
  ).map((artifact) => artifact.fileName);
}

function relevantDocuments(text: string, taskId: string, taskSlug: string | null, liveArtifactNames: string[]) {
  if (!taskSlug) return [];
  const live = new Set(liveArtifactNames);
  const found = new Set<string>();
  const prefix = `.humanlayer/tasks/${escapeRegExp(taskSlug)}/`;
  for (const match of text.matchAll(new RegExp(`${prefix}([^\\s),;:"']+)`, "g"))) {
    const fileName = match[1]!;
    if (live.has(fileName)) found.add(fileName);
  }
  return [...found].map((fileName) => ({
    localpath: `.humanlayer/tasks/${taskSlug}/${fileName}`,
    permalink: `::hl-artifact{task="${taskId}" file="${fileName}"}`,
  }));
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readProcessedTurnKey(db: Database, threadId: string) {
  return readRow<{ processedTurnKey: string | null }>(
    db,
    "SELECT processed_turn_key AS processedTurnKey FROM sessions WHERE thread_id = ?",
    threadId,
  )?.processedTurnKey ?? null;
}

function markProcessedTurnKey(db: Database, threadId: string, key: string) {
  writeRow(db, "UPDATE sessions SET processed_turn_key = ?, updated_at = ? WHERE thread_id = ?", key, nowMs(), threadId);
}

/**
 * The single completion pipeline for a finished turn: ingest task artifacts, extract the summary
 * and next step, then mark the turn processed. Called identically by the idle handler (with the
 * real lastAssistantText from thread.idle) and by reconcile (with its own reconstructed
 * lastAssistantText, see reconstructMissingCompletedTurnKey below). Idempotent per turn key via
 * the dedicated `processed_turn_key` column: whichever caller reaches a given key first runs the
 * pipeline, the other is a no-op. This replaces the old design where `last_summarized_turn_key`
 * (a narrower "summary was written" marker) doubled as the "already handled" guard: a reconcile
 * that stamped only the summary for a turn made the idle handler's later real completion for that
 * same turn silently no-op too, so its ingest/extract/advance-claim/notify pipeline never ran.
 */
export async function recordIdleCompletion(
  bb: BbPluginApi,
  db: Database,
  mirror: Map<string, SessionMirrorRow>,
  thread: ThreadLike,
  lastAssistantText: string | null,
) {
  const key = turnKey(thread);
  if (readProcessedTurnKey(db, thread.id) === key) return false;
  const interactions = await bb.sdk.threads.interactions.list({ threadId: thread.id });
  const blockedReason = pendingBlockedReason(interactions as InteractionLike[]);
  if (blockedReason !== null) {
    writeRow(db, "UPDATE sessions SET blocked_reason = ?, updated_at = ? WHERE thread_id = ?", blockedReason, nowMs(), thread.id);
    mirrorSession(db, mirror, thread.id);
    return false;
  }
  if (!lastAssistantText?.trim()) return false;
  if (await initiatingMessageIsSystemInjected(bb, thread.id, lastAssistantText).catch(() => false)) {
    const row = mirror.get(thread.id) ?? mirrorSession(db, mirror, thread.id) ?? readSession(db, thread.id);
    if (!row) return false;
    if (row.lastSummarizedTurnKey === key) return false;
    const summary = parseJson<{ summaryHistory?: string[] }>(row.summaryJson, {});
    const summaryHistory = Array.isArray(summary.summaryHistory) ? summary.summaryHistory : [];
    summaryHistory.push(lastAssistantText.slice(0, 600));
    writeRow(
      db,
      "UPDATE sessions SET summary_json = ?, last_summarized_turn_key = ?, processed_turn_key = ?, updated_at = ? WHERE thread_id = ?",
      stringifyJson({ ...summary, summaryHistory }),
      key,
      key,
      nowMs(),
      thread.id,
    );
    mirrorSession(db, mirror, thread.id);
    return false;
  }
  const row = mirror.get(thread.id) ?? mirrorSession(db, mirror, thread.id);
  if (row) {
    try {
      await ingest(bb, db, row.taskId, thread.id, { threadId: thread.id });
    } catch (error) {
      const message = String(error instanceof Error ? error.message : error);
      writeRow(db, "UPDATE sessions SET ingest_error = ?, updated_at = ? WHERE thread_id = ?", message, nowMs(), thread.id);
      mirrorSession(db, mirror, thread.id);
      bb.log?.warn(`Failed to ingest HumanLayer artifacts for ${thread.id}: ${message}`);
      return false;
    }
  }
  const appended = appendSessionSummary(db, mirror, thread, lastAssistantText);
  if (appended) {
    markProcessedTurnKey(db, thread.id, key);
  } else if ((mirror.get(thread.id) ?? readSession(db, thread.id))?.lastSummarizedTurnKey === key) {
    // Data written by a pre-processed_turn_key build: the summary was already stamped for this
    // exact key, so back-fill the marker without re-running advance (advance's own idempotency,
    // e.g. advanced_at, already covers whatever ran the first time).
    markProcessedTurnKey(db, thread.id, key);
  }
  return appended;
}

function turnKeyEventCount(key: string | null) {
  if (!key) return null;
  const parsed = Number(key.split(":")[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

// Fetches the most recent assistant message from the thread's conversation history. Used by
// reconstructMissingCompletedTurnKey to recover a completed_turn_key when the thread.idle event
// that would normally have recorded it was dropped (e.g. a restart between idle and reconcile).
async function lastAssistantMessageText(bb: BbPluginApi, threadId: string) {
  const timeline = await bb.sdk.threads.timeline({ threadId, segmentLimit: "40", summaryOnly: "false" });
  const rows = (timeline.rows ?? []) as Array<{ kind?: string; role?: string; text?: string }>;
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const candidate = rows[index];
    if (candidate?.kind === "conversation" && candidate.role === "assistant" && candidate.text?.trim()) return candidate.text;
  }
  return null;
}

/**
 * Reconciliation (thread:changed, or the startup replay) never receives thread.idle's
 * lastAssistantText, so if the idle event that would have triggered recordIdleCompletion was
 * ever dropped (crash/restart between idle firing and the handler running), the turn would
 * otherwise never go through the completion pipeline at all: not just a missing
 * completed_turn_key, but ingest, extraction, the auto-advance claim, and the notification
 * decision would all silently never run for it. When the derived status is ready_for_input and
 * the thread's current event count is ahead of the persisted processed_turn_key, this
 * reconstructs the last assistant message the same way the idle handler does and runs it through
 * the exact same pipeline (recordIdleCompletion), so reconcile and idle can never disagree about
 * whether a turn was actually processed.
 */
export async function reconstructMissingCompletedTurnKey(
  bb: BbPluginApi,
  db: Database,
  mirror: Map<string, SessionMirrorRow>,
  thread: ThreadLike,
) {
  const currentEventCount = thread.numEvents ?? null;
  if (currentEventCount === null) return false;
  const processedEventCount = turnKeyEventCount(readProcessedTurnKey(db, thread.id));
  if (processedEventCount !== null && processedEventCount >= currentEventCount) return false;
  const lastAssistantText = await lastAssistantMessageText(bb, thread.id).catch(() => null);
  if (!lastAssistantText) return false;
  return recordIdleCompletion(bb, db, mirror, thread, lastAssistantText);
}

export async function hydrateSession(bb: BbPluginApi, db: Database, mirror: Map<string, SessionMirrorRow>, threadId: string) {
  const row = mirror.get(threadId) ?? mirrorSession(db, mirror, threadId);
  if (!row) return;
  await hydrate(bb, db, row.taskId, threadId);
  mirrorSession(db, mirror, threadId);
}

async function idleWasInterrupted(bb: BbPluginApi, threadId: string) {
  const events = await bb.sdk.threads.events.list({
    threadId,
    order: "desc",
    limit: "20",
    types: ["system/thread/interrupted", "turn/completed", "turn/started", "client/turn/start"],
  });
  for (const event of events as Array<{ type: string; data?: { status?: string } }>) {
    if (event.type === "turn/started" || event.type === "client/turn/start") return false;
    if (event.type === "system/thread/interrupted") return true;
    if (event.type === "turn/completed" && event.data?.status === "interrupted") return true;
  }
  return false;
}

/**
 * The single post-completion decision for a finished turn, run identically after idle's and
 * reconcile's completion pipeline (recordIdleCompletion / reconstructMissingCompletedTurnKey) so
 * neither caller can auto-advance a turn the other would have refused. Interruption is derived
 * fresh from the ordered event log here (idleWasInterrupted), not passed in by the caller: a
 * system/thread/interrupted event racing in after the pipeline ran still suppresses the
 * auto-advance and flips the session to interrupted instead of firing onCompletedTurn.
 */
async function processCompletedTurn(
  bb: BbPluginApi,
  db: Database,
  mirror: Map<string, SessionMirrorRow>,
  thread: ThreadLike,
  interactions: readonly InteractionLike[],
  completedNewTurn: boolean,
  onCompletedTurn?: (row: SessionMirrorRow) => Promise<unknown>,
  onAdvanceFailed?: (session: SessionMirrorRow) => Promise<unknown>,
) {
  if (!completedNewTurn) return;
  let interrupted = false;
  try {
    interrupted = await idleWasInterrupted(bb, thread.id);
  } catch (error) {
    bb.log.warn(`Failed to inspect HumanLayer idle events ${thread.id}: ${String(error)}`);
  }
  if (interrupted) {
    writeRow(db, "UPDATE sessions SET interrupted = 1, updated_at = ? WHERE thread_id = ?", nowMs(), thread.id);
    applyStatusDerivation(db, mirror, thread, interactions);
    return;
  }
  const completed = mirror.get(thread.id);
  if (completed?.hlStatus === "ready_for_input" && !completed.blockedReason) {
    try {
      await onCompletedTurn?.(completed);
    } catch (error) {
      bb.log.warn(`HumanLayer auto-advance failed for ${thread.id}: ${String(error)}`);
      await onAdvanceFailed?.(completed).catch((recoveryError) =>
        bb.log.warn(`HumanLayer advance-failure recovery notification failed for ${thread.id}: ${String(recoveryError)}`),
      );
    }
  }
}

export async function reconcileSession(
  bb: BbPluginApi,
  db: Database,
  mirror: Map<string, SessionMirrorRow>,
  threadId: string,
  sequence?: number,
) {
  const thread = await bb.sdk.threads.get({ threadId, include: "environment" });
  const interactions = await bb.sdk.threads.interactions.list({ threadId });
  return applyStatusDerivation(db, mirror, thread as ThreadLike, interactions as InteractionLike[], sequence);
}

export function registerSessionRuntime(
  bb: BbPluginApi,
  db: Database,
  mirror: Map<string, SessionMirrorRow>,
  bindings: LaunchBindingMirror,
  onCompletedTurn?: (row: SessionMirrorRow) => Promise<unknown>,
  childThreads?: Map<string, ChildThreadMirrorRow>,
  // Called after every derived snapshot (not gated on hlStatus having changed) so ready_for_input
  // and needs_approval notifications are evaluated from the persisted, final mirror row instead of
  // a possibly-stale transition snapshot. Idempotent via dedupe in notify.ts.
  onSnapshot?: (threadId: string, interactions: readonly unknown[]) => Promise<unknown>,
  // Called when an auto-advance launch attempt for a completed turn fails or throws, so the
  // suppressed ready_for_input notification for that turn is recovered instead of lost silently.
  onAdvanceFailed?: (session: SessionMirrorRow) => Promise<unknown>,
  // Fired with the freshest `threads.get` snapshot every time a real `thread:changed` reconcile
  // fetches one, so a caller-owned cache (title/workingDirectory/contextUsage for listSessions,
  // perf item: listSessions must not make a per-session SDK call) can stay current without
  // listSessions ever calling the SDK itself. Fire-and-forget: never awaited here.
  onThreadSnapshot?: (threadId: string, thread: ThreadLike) => void,
) {
  const maxSeq = readRow<{ maxSeq: number }>(db, "SELECT COALESCE(MAX(last_reconcile_seq), 0) + 1 AS maxSeq FROM sessions")?.maxSeq ?? 1;
  let nextSeq = maxSeq;
  const reconcileState = new Map<string, Promise<void>>();
  const retiredThreads = new Set<string>();
  const hydrationWaited = new Set<string>();
  const hydrating = new Set<string>();

  const publish = (threadId: string) => {
    const row = mirror.get(threadId);
    if (row) bb.realtime.publish("hl:sessions", { taskId: row.taskId, threadId });
  };

  const enqueueThreadWork = (threadId: string, work: () => Promise<void>) => {
    const previous = reconcileState.get(threadId) ?? Promise.resolve();
    const chain = previous
      .catch(() => undefined)
      .then(async () => {
        if (!mirror.has(threadId) || retiredThreads.has(threadId)) return;
        await work();
      })
      .catch((error) => bb.log.warn(`Failed to process HumanLayer session ${threadId}: ${String(error)}`))
      .finally(() => {
        if (reconcileState.get(threadId) === chain) reconcileState.delete(threadId);
      });
    reconcileState.set(threadId, chain);
    return chain;
  };

  const reconcileAndPublish = (threadId: string) => {
    if (!mirror.has(threadId)) return;
    const sequence = nextSeq;
    nextSeq += 1;
    return enqueueThreadWork(threadId, async () => {
      const thread = await bb.sdk.threads.get({ threadId, include: "environment" });
      onThreadSnapshot?.(threadId, thread as ThreadLike);
      const interactions = await bb.sdk.threads.interactions.list({ threadId });
      if (!mirror.has(threadId) || retiredThreads.has(threadId)) return;
      const result = applyStatusDerivation(db, mirror, thread as ThreadLike, interactions as InteractionLike[], sequence);
      let completedNewTurn = false;
      if (result?.row?.hlStatus === "ready_for_input" && !result.row.blockedReason) {
        completedNewTurn = await reconstructMissingCompletedTurnKey(bb, db, mirror, thread as ThreadLike).catch((error) => {
          bb.log.warn(`Failed to reconstruct completed turn key for ${threadId}: ${String(error)}`);
          return false;
        });
      }
      await processCompletedTurn(bb, db, mirror, thread as ThreadLike, interactions as InteractionLike[], completedNewTurn, onCompletedTurn, onAdvanceFailed);
      await onSnapshot?.(threadId, interactions);
      if (result?.changed || completedNewTurn) publish(threadId);
    });
  };

  const replayBuffered = async (threadId: string) => {
    const buffered = bindings.bufferedByThread.get(threadId);
    if (!buffered) return;
    bindings.bufferedByThread.delete(threadId);
    for (const event of buffered) {
      if (event.kind === "active") await handleActive(event.thread);
      if (event.kind === "idle") await handleIdle(event.thread, event.lastAssistantText);
      if (event.kind === "failed") await reconcileAndPublish(event.thread.id);
      if (event.kind === "changed") await reconcileAndPublish(event.threadId);
    }
  };

  bindings.onBound = replayBuffered;

  const maybeBindPluginThread = (thread: ThreadLike & { originPluginId?: string | null }) => {
    if (mirror.has(thread.id)) return true;
    bindPendingThread(db, mirror, bindings, thread.id);
    if (mirror.has(thread.id)) return true;
    if (thread.originPluginId !== bb.pluginId) return false;
    const pending = bindings.pendingByThread.get(thread.id);
    if (pending) bindPendingLaunch(db, mirror, bindings, pending.token, thread.id);
    return mirror.has(thread.id);
  };

  const buffer = (threadId: string, event: BufferedLifecycle) => {
    const list = bindings.bufferedByThread.get(threadId) ?? [];
    list.push(event);
    bindings.bufferedByThread.set(threadId, list.slice(-10));
  };

  const handleActive = (thread: ThreadLike) => {
    onThreadSnapshot?.(thread.id, thread);
    return enqueueThreadWork(thread.id, async () => {
      writeRow(db, "UPDATE sessions SET had_turn = 1, interrupted = 0, updated_at = ? WHERE thread_id = ?", nowMs(), thread.id);
      mirrorSession(db, mirror, thread.id);
      const activeRow = mirror.get(thread.id);
      if (HYDRATION_ENABLED && activeRow?.hydratedAt === null) {
        await hydrateSession(bb, db, mirror, thread.id).catch((error) => bb.log.warn(`Failed to hydrate HumanLayer session ${thread.id}: ${String(error)}`));
      }
      const interactions = await bb.sdk.threads.interactions.list({ threadId: thread.id });
      if (!mirror.has(thread.id) || retiredThreads.has(thread.id)) return;
      const sequence = nextSeq;
      nextSeq += 1;
      const result = applyStatusDerivation(db, mirror, thread, interactions as InteractionLike[], sequence);
      await onSnapshot?.(thread.id, interactions);
      if (result?.changed) publish(thread.id);
    });
  };

  const handleIdle = (thread: ThreadLike, lastAssistantText: string | null) => {
    onThreadSnapshot?.(thread.id, thread);
    return enqueueThreadWork(thread.id, async () => {
      let completedNewTurn = false;
      let interrupted = false;
      try {
        interrupted = await idleWasInterrupted(bb, thread.id);
      } catch (error) {
        bb.log.warn(`Failed to inspect HumanLayer idle events ${thread.id}: ${String(error)}`);
      }
      if (!mirror.has(thread.id) || retiredThreads.has(thread.id)) return;
      if (interrupted) {
        writeRow(db, "UPDATE sessions SET interrupted = 1, updated_at = ? WHERE thread_id = ?", nowMs(), thread.id);
        mirrorSession(db, mirror, thread.id);
      } else {
        const interactions = await bb.sdk.threads.interactions.list({ threadId: thread.id });
        if (!mirror.has(thread.id) || retiredThreads.has(thread.id)) return;
        const blockedReason = pendingBlockedReason(interactions as InteractionLike[]);
        if (blockedReason !== null) {
          writeRow(db, "UPDATE sessions SET blocked_reason = ?, updated_at = ? WHERE thread_id = ?", blockedReason, nowMs(), thread.id);
          mirrorSession(db, mirror, thread.id);
        } else {
          completedNewTurn = await recordIdleCompletion(bb, db, mirror, thread, lastAssistantText);
        }
      }
      if (!mirror.has(thread.id) || retiredThreads.has(thread.id)) return;
      const sequence = nextSeq;
      nextSeq += 1;
      const interactions = await bb.sdk.threads.interactions.list({ threadId: thread.id });
      if (!mirror.has(thread.id) || retiredThreads.has(thread.id)) return;
      applyStatusDerivation(db, mirror, thread, interactions as InteractionLike[], sequence);
      await processCompletedTurn(bb, db, mirror, thread, interactions as InteractionLike[], completedNewTurn, onCompletedTurn, onAdvanceFailed);
      await onSnapshot?.(thread.id, interactions);
      publish(thread.id);
    });
  };

  // Stamped once so the retention sweep can identify individually-archived-or-deleted sessions
  // even while their owning task stays open (the sessions row itself is never deleted).
  const forgetThread = (threadId: string) => {
    retiredThreads.add(threadId);
    mirror.delete(threadId);
    reconcileState.delete(threadId);
    bindings.bufferedByThread.delete(threadId);
    for (const [token, binding] of bindings.pendingByToken) {
      if (binding.threadId === threadId) bindings.pendingByToken.delete(token);
    }
    bindings.pendingByThread.delete(threadId);
    writeRow(db, "UPDATE sessions SET thread_archived_at = COALESCE(thread_archived_at, ?) WHERE thread_id = ?", nowMs(), threadId);
  };

  const unsubscribe = bb.sdk.subscribe({
    event: "thread:changed",
    callback(event) {
      if (!event.id) return;
      if (!event.changes.some((change) => RELEVANT_THREAD_CHANGES.has(change))) return;
      if (!mirror.has(event.id)) {
        if (bindings.pendingByThread.has(event.id)) buffer(event.id, { kind: "changed", threadId: event.id });
        return;
      }
      reconcileAndPublish(event.id);
    },
  });
  bb.onDispose(unsubscribe);

  bb.events.on("thread.active", ({ thread }) => {
    if (!maybeBindPluginThread(thread as ThreadLike & { originPluginId?: string | null })) {
      if ((thread as { originPluginId?: string | null }).originPluginId === bb.pluginId) buffer(thread.id, { kind: "active", thread: thread as ThreadLike });
      return;
    }
    void handleActive(thread as ThreadLike);
  });

  bb.events.on("thread.idle", ({ thread, lastAssistantText }) => {
    if (!maybeBindPluginThread(thread as ThreadLike & { originPluginId?: string | null })) {
      if ((thread as { originPluginId?: string | null }).originPluginId === bb.pluginId) buffer(thread.id, { kind: "idle", thread: thread as ThreadLike, lastAssistantText });
      return;
    }
    void handleIdle(thread as ThreadLike, lastAssistantText);
  });

  bb.events.on("thread.failed", ({ thread }) => {
    if (!maybeBindPluginThread(thread as ThreadLike & { originPluginId?: string | null })) {
      if ((thread as { originPluginId?: string | null }).originPluginId === bb.pluginId) buffer(thread.id, { kind: "failed", thread: thread as ThreadLike });
      return;
    }
    reconcileAndPublish(thread.id);
  });

  bb.events.on("thread.archived", ({ thread }) => {
    forgetThread(thread.id);
  });

  bb.events.on("thread.deleted", ({ thread }) => {
    forgetThread(thread.id);
  });

  bb.experimental_hooks.on("message.dispatch", async (ctx) => {
    const agentRole = parseAgentRole(ctx.input.text ?? "");
    if (agentRole && childThreads) {
      const parentThreadId = await actualParentThreadId(bb, ctx.thread.id);
      if (parentThreadId) recordChildThread(db, childThreads, ctx.thread.id, parentThreadId, agentRole);
    }
    let row = mirror.get(ctx.thread.id);
    if (!row && ctx.originPluginId === bb.pluginId) {
      const token = extractLaunchToken(ctx.input.text);
      if (token) row = bindPendingLaunch(db, mirror, bindings, token, ctx.thread.id) ?? undefined;
    }
    if (!row) row = bindPendingThread(db, mirror, bindings, ctx.thread.id) ?? undefined;
    if (!row) return { action: "proceed" };
    if (!row.label && !row.skillId) {
      mirrorSession(db, mirror, ctx.thread.id);
    }
    if (HYDRATION_ENABLED && ctx.environment && row.hydratedAt === null) {
      if (hydrationWaited.has(ctx.thread.id)) return { action: "proceed" };
      hydrationWaited.add(ctx.thread.id);
      bb.log.info(`HumanLayer dispatch waiting for hydration: ${ctx.thread.id}`);
      setTimeout(() => {
        if (hydrating.has(ctx.thread.id)) return;
        hydrating.add(ctx.thread.id);
        void hydrateSession(bb, db, mirror, ctx.thread.id)
          .catch((error) => bb.log.warn(`Failed to hydrate HumanLayer session ${ctx.thread.id}: ${String(error)}`))
          .finally(() => {
            hydrating.delete(ctx.thread.id);
            void bb.experimental_hooks.recheck("message.dispatch");
          });
      }, 0);
      return { action: "wait", reason: "hydrating task artifacts" };
    }
    return { action: "proceed" };
  });

  for (const threadId of mirror.keys()) reconcileAndPublish(threadId);
}

export function taskInstructions(row: SessionMirrorRow, options: { researchModel?: string | null } = {}) {
  const researchModel = resolveResearchModel(row, options.researchModel ?? null);
  return [
    TASK_CONTEXT_FIRST_ACTION,
    `HumanLayer task: ${row.taskName} (slug ${row.taskSlug}). Task artifact directory: .humanlayer/tasks/${row.taskSlug} (relative to the workspace root; a real directory, not a symlink).`,
    `Current phase: ${row.label ?? "none"}. Current skill command: ${row.skillId ? skillInfo(row.skillId)?.command ?? `/rpi-${row.skillId}` : "none"}. Workflow: ${row.workflowType}.`,
    "After writing or editing any file in the task artifact directory, call hl_artifact_save with its file name and include the returned permalink line in your final answer.",
    `Research subagents model hint: ${researchModel}.`,
  ].join("\n");
}

export function resolveResearchModel(row: Pick<SessionMirrorRow, "providerId" | "model">, preference: string | null | undefined) {
  const taskModel = row.providerId && row.model ? `${row.providerId} ${row.model}` : null;
  return preference ?? taskModel ?? "use the task's current provider/model unless hl_task_context says otherwise";
}
