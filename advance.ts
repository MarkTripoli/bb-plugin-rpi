import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type * as BetterSqlite3 from "better-sqlite3";
import { parseJson, readRow, writeRow } from "./db";
import type { SessionRow, TaskRecord } from "./contract";
import type { NextStepSuggestions } from "./extraction";
import { activeLaunchAttempt, launchPhase } from "./launch";
import { getTask } from "./tasks";
import { AUTO_ADVANCE, ITERATE_SKILL_BY_LABEL, normalizePhaseLabel, skillInfo, type PhaseLabel } from "./transitions";
import type { LaunchBindingMirror, SessionMirrorRow } from "./sessions";

type Database = BetterSqlite3.Database;
type AdvanceMode = "auto_advance" | "proceed";

export async function onCompletedTurn(
  bb: BbPluginApi,
  db: Database,
  mirror: Map<string, SessionMirrorRow>,
  bindings: LaunchBindingMirror,
  session: SessionRow,
) {
  return advanceSession(bb, db, mirror, bindings, session, "auto_advance");
}

export async function proceed(
  bb: BbPluginApi,
  db: Database,
  mirror: Map<string, SessionMirrorRow>,
  bindings: LaunchBindingMirror,
  threadId: string,
) {
  const session = readRow<SessionRow>(
    db,
    `
    SELECT thread_id AS threadId, task_id AS taskId, label, skill_id AS skillId, launched_by AS launchedBy,
      forked_from_thread_id AS forkedFromThreadId, hl_status AS hlStatus, hl_status_at AS hlStatusAt,
      had_turn AS hadTurn, interrupted, blocked_reason AS blockedReason, next_step_json AS nextStepJson,
      summary_json AS summaryJson, advanced_at AS advancedAt, hydrated_at AS hydratedAt,
      last_reconcile_seq AS lastReconcileSeq, last_summarized_turn_key AS lastSummarizedTurnKey,
      completed_turn_key AS completedTurnKey, created_at AS createdAt, updated_at AS updatedAt
    FROM sessions WHERE thread_id = ?
    `,
    threadId,
  );
  if (!session) throw new Error(`No session found for thread ${threadId}`);
  return advanceSession(bb, db, mirror, bindings, session, "proceed");
}

export async function launchSkill(
  bb: BbPluginApi,
  db: Database,
  mirror: Map<string, SessionMirrorRow>,
  bindings: LaunchBindingMirror,
  taskId: string,
  skillId: string,
  commandLine?: string | null,
) {
  const info = skillInfo(skillId);
  if (!info) throw new Error(`Unknown skill ${skillId}`);
  const task = taskRecord(db, taskId);
  const result = await launchPhase(bb, db, mirror, bindings, task, {
    skillId,
    commandLine: commandLine ?? info.command,
    launchedBy: "user",
    fromThreadId: null,
  });
  writeRow(db, "UPDATE tasks SET is_draft = 0, updated_at = ? WHERE id = ?", Date.now(), taskId);
  bb.realtime.publish("tasks", { taskId });
  return result;
}

export async function iterateInFreshSession(
  bb: BbPluginApi,
  db: Database,
  mirror: Map<string, SessionMirrorRow>,
  bindings: LaunchBindingMirror,
  threadId: string,
) {
  const session = mirror.get(threadId) ?? readRow<SessionRow & { taskSlug: string; taskName: string; workflowType: string }>(
    db,
    `
    SELECT sessions.thread_id AS threadId, sessions.task_id AS taskId, sessions.label, sessions.skill_id AS skillId,
      sessions.launched_by AS launchedBy, sessions.forked_from_thread_id AS forkedFromThreadId,
      sessions.hl_status AS hlStatus, sessions.hl_status_at AS hlStatusAt, sessions.had_turn AS hadTurn,
      sessions.interrupted, sessions.blocked_reason AS blockedReason, sessions.next_step_json AS nextStepJson,
      sessions.summary_json AS summaryJson, sessions.advanced_at AS advancedAt, sessions.hydrated_at AS hydratedAt,
      sessions.last_reconcile_seq AS lastReconcileSeq, sessions.last_summarized_turn_key AS lastSummarizedTurnKey,
      sessions.completed_turn_key AS completedTurnKey, sessions.created_at AS createdAt, sessions.updated_at AS updatedAt,
      tasks.slug AS taskSlug, tasks.name AS taskName, tasks.workflow_type AS workflowType
    FROM sessions JOIN tasks ON tasks.id = sessions.task_id WHERE sessions.thread_id = ?
    `,
    threadId,
  );
  if (!session) throw new Error(`No session found for thread ${threadId}`);
  const label = normalizePhaseLabel(session.label) as PhaseLabel | null;
  const skillId = label ? ITERATE_SKILL_BY_LABEL[label] ?? null : null;
  if (!skillId || !skillInfo(skillId)) throw new Error("No iterate skill is available for this session.");
  const task = taskRecord(db, session.taskId);
  return launchPhase(bb, db, mirror, bindings, task, {
    skillId,
    commandLine: skillInfo(skillId)!.command,
    launchedBy: "iterate",
    fromThreadId: threadId,
  });
}

function advanceSession(
  bb: BbPluginApi,
  db: Database,
  mirror: Map<string, SessionMirrorRow>,
  bindings: LaunchBindingMirror,
  session: SessionRow,
  mode: AdvanceMode,
) {
  const existing = successorFor(db, session.threadId);
  if (session.advancedAt !== null && existing) return Promise.resolve({ threadId: existing });
  if (session.blockedReason) return Promise.resolve({ threadId: existing });
  const nextStep = parseJson<NextStepSuggestions | null>(session.nextStepJson, null);
  if (nextStep?.extraction.type !== "next_step_found") return Promise.resolve({ threadId: existing });
  const label = normalizePhaseLabel(session.label) as PhaseLabel | null;
  const transition = label ? AUTO_ADVANCE[label as keyof typeof AUTO_ADVANCE] : undefined;
  if (!transition && mode === "auto_advance") return Promise.resolve({ threadId: existing });
  const task = taskRecord(db, session.taskId);
  if (activeLaunchAttempt(db, task.id)) return Promise.resolve({ threadId: existing });
  if (mode === "auto_advance") {
    if (!transition || transition.flag === null) return Promise.resolve({ threadId: existing });
    if (transition.next !== nextStep.extraction.nextStepType) return Promise.resolve({ threadId: existing });
    if (!task.autoAdvance || !task[transition.flag as keyof TaskRecord]) return Promise.resolve({ threadId: existing });
  }
  if (claimAdvanced(db, session.threadId) !== 1) return Promise.resolve({ threadId: successorFor(db, session.threadId) });
  return launchPhase(bb, db, mirror, bindings, task, {
    skillId: nextStep.extraction.nextStepType,
    commandLine: nextStep.extraction.nextStepPrompt,
    launchedBy: mode,
    fromThreadId: session.threadId,
  }).then((result) => {
    if (mode === "auto_advance") suppressReadyToast(db, session.threadId);
    return result;
  });
}

export function suppressReadyToast(db: Database, threadId: string) {
  writeRow(
    db,
    "INSERT OR IGNORE INTO notification_suppressions (thread_id, reason, created_at) VALUES (?, 'auto_advance', ?)",
    threadId,
    Date.now(),
  );
}

function claimAdvanced(db: Database, threadId: string) {
  return writeRow(db, "UPDATE sessions SET advanced_at = ?, updated_at = ? WHERE thread_id = ? AND advanced_at IS NULL", Date.now(), Date.now(), threadId).changes;
}

function successorFor(db: Database, threadId: string) {
  return readRow<{ threadId: string }>(
    db,
    "SELECT thread_id AS threadId FROM launch_attempts WHERE from_thread_id = ? AND status = 'spawned' AND thread_id IS NOT NULL ORDER BY created_at DESC LIMIT 1",
    threadId,
  )?.threadId ?? null;
}

function taskRecord(db: Database, taskId: string) {
  const result = getTask(db, taskId);
  if (!result) throw new Error(`No task found for id ${taskId}`);
  return result.task;
}
