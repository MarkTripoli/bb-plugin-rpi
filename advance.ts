import { randomUUID } from "node:crypto";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type * as BetterSqlite3 from "better-sqlite3";
import { parseJson, readRow, writeRow } from "./db";
import type { SessionRow, TaskRecord } from "./contract";
import type { NextStepSuggestions } from "./extraction";
import { activeLaunchAttempt, environmentRoleForAttempt, insertAttempt, LaunchRejectedError, launchPhase, withTaskLock } from "./launch";
import { getTask } from "./tasks";
import { AUTO_ADVANCE, ITERATE_SKILL_BY_LABEL, autoAdvanceAccepts, autoAdvanceTransition, normalizePhaseLabel, skillInfo, type PhaseLabel } from "./transitions";
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
      forked_from_thread_id AS forkedFromThreadId, rpi_status AS rpiStatus, rpi_status_at AS rpiStatusAt,
      had_turn AS hadTurn, interrupted, blocked_reason AS blockedReason, next_step_json AS nextStepJson,
      summary_json AS summaryJson, advanced_at AS advancedAt, advanced_attempt_id AS advancedAttemptId, hydrated_at AS hydratedAt,
      last_reconcile_seq AS lastReconcileSeq, last_summarized_turn_key AS lastSummarizedTurnKey,
      completed_turn_key AS completedTurnKey, next_step_turn_key AS nextStepTurnKey, ingest_error AS ingestError,
      created_at AS createdAt, updated_at AS updatedAt
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
  // Same per-task mutex as proceed/auto-advance/retry (Phase 5, launch.ts withTaskLock): keeps
  // this call's read-check-then-insert of the task's launch_attempts state from interleaving with
  // another in-flight call for the same task (retry/adopt/proceed already run under this lock;
  // the plain "launch a skill" entry point did not). launchPhase's own activeLaunchAttempt check
  // still does the actual rejection: "disable while a launch_attempt for that task is pending"
  // (item 5's Suggested-next button), whenever a prior attempt for this task has not yet
  // resolved to spawned/failed.
  return withTaskLock(taskId, async () => {
    const task = taskRecord(db, taskId);
    const result = await launchPhase(bb, db, mirror, bindings, task, {
      skillId,
      commandLine: commandLine ?? info.command,
      launchedBy: "user",
      fromThreadId: null,
    });
    writeRow(db, "UPDATE tasks SET is_draft = 0, updated_at = ? WHERE id = ?", Date.now(), taskId);
    return finishLaunchSkill(bb, taskId, result);
  });
}

async function finishLaunchSkill(bb: BbPluginApi, taskId: string, result: { threadId: string }) {
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
      sessions.rpi_status AS rpiStatus, sessions.rpi_status_at AS rpiStatusAt, sessions.had_turn AS hadTurn,
      sessions.interrupted, sessions.blocked_reason AS blockedReason, sessions.next_step_json AS nextStepJson,
      sessions.summary_json AS summaryJson, sessions.advanced_at AS advancedAt, sessions.advanced_attempt_id AS advancedAttemptId, sessions.hydrated_at AS hydratedAt,
      sessions.last_reconcile_seq AS lastReconcileSeq, sessions.last_summarized_turn_key AS lastSummarizedTurnKey,
      sessions.completed_turn_key AS completedTurnKey, sessions.next_step_turn_key AS nextStepTurnKey, sessions.ingest_error AS ingestError,
      sessions.created_at AS createdAt, sessions.updated_at AS updatedAt,
      tasks.slug AS taskSlug, tasks.name AS taskName, tasks.workflow_type AS workflowType
    FROM sessions JOIN tasks ON tasks.id = sessions.task_id WHERE sessions.thread_id = ?
    `,
    threadId,
  );
  if (!session) throw new Error(`No session found for thread ${threadId}`);
  const label = normalizePhaseLabel(session.label) as PhaseLabel | null;
  const skillId = iterateSkillForLabel(label);
  const task = taskRecord(db, session.taskId);
  // A label with no ITERATE_SKILL_BY_LABEL entry (freeform, oneshot, describe-pr, review,
  // worktree-setup) has no dedicated phase skill to re-run, but a fresh session still helps: it
  // resets context usage and gives the agent a clean turn to re-read the task artifacts from.
  // launchPhase already supports skillId: null with a prompt (see launchDraft) and always prepends
  // TASK_CONTEXT_FIRST_ACTION, so the artifact directory instruction still carries over.
  if (!skillId) {
    return launchPhase(bb, db, mirror, bindings, task, {
      skillId: null,
      prompt: UNLABELED_ITERATE_PROMPT,
      launchedBy: "iterate",
      fromThreadId: threadId,
    });
  }
  return launchPhase(bb, db, mirror, bindings, task, {
    skillId,
    commandLine: skillInfo(skillId)!.command,
    launchedBy: "iterate",
    fromThreadId: threadId,
  });
}

export const UNLABELED_ITERATE_PROMPT =
  "Continue this task in a fresh session. Read the task artifacts first, then pick up where the previous session left off.";

// Resolves a session's label to its iterate skill, or null when the label has no dedicated
// iterate skill (freeform, oneshot, describe-pr, review, worktree-setup) or is unrecognized. Pure;
// covered by tests/advance.test.ts.
export function iterateSkillForLabel(label: PhaseLabel | null) {
  const skillId = label ? ITERATE_SKILL_BY_LABEL[label] ?? null : null;
  return skillId && skillInfo(skillId) ? skillId : null;
}

function advanceSession(
  bb: BbPluginApi,
  db: Database,
  mirror: Map<string, SessionMirrorRow>,
  bindings: LaunchBindingMirror,
  session: SessionRow,
  mode: AdvanceMode,
) {
  return withTaskLock(session.taskId, async () => {
    const fresh = readSessionForAdvance(db, session.threadId) ?? session;
    const task = taskRecord(db, fresh.taskId);
    const existing = successorFor(db, fresh.threadId);
    if (fresh.advancedAt !== null && existing) return { threadId: existing };
    const validation = await validateAdvance(bb, db, task, fresh, mode);
    if (!validation.ok) {
      if (mode === "proceed") throw validation.error;
      return { threadId: existing };
    }
    const transition = validation.transition;
    const nextStep = validation.nextStep;
    if (mode === "auto_advance") {
      if (!transition || transition.flag === null) return { threadId: existing };
      if (!autoAdvanceAccepts(normalizePhaseLabel(fresh.label) as PhaseLabel, task.workflowType, nextStep.extraction.nextStepType)) return { threadId: existing };
      if (!task.autoAdvance || !task[transition.flag as keyof TaskRecord]) return { threadId: existing };
    }
    const attempted = claimAdvanceAndAttempt(db, task, fresh, nextStep, mode);
    if (!attempted) return { threadId: successorFor(db, fresh.threadId) };
    return launchPhase(bb, db, mirror, bindings, task, {
      skillId: nextStep.extraction.nextStepType,
      commandLine: nextStep.extraction.nextStepPrompt,
      launchedBy: mode,
      fromThreadId: fresh.threadId,
      attemptId: attempted.attemptId,
    });
  });
}

async function validateAdvance(
  bb: BbPluginApi,
  db: Database,
  task: TaskRecord,
  session: SessionRow,
  mode: AdvanceMode,
): Promise<
  | { ok: true; nextStep: NextStepSuggestions & { extraction: { type: "next_step_found"; nextStepType: string; nextStepPrompt: string } }; transition: ReturnType<typeof autoAdvanceTransition> }
  | { ok: false; error: LaunchRejectedError }
> {
  const existing = successorFor(db, session.threadId);
  if (session.advancedAt !== null && existing) return { ok: false, error: new LaunchRejectedError("launch_blocked", "Session already advanced.") };
  if (session.rpiStatus !== "ready_for_input") return { ok: false, error: new LaunchRejectedError("session_running", "session running") };
  if (task.archived) return { ok: false, error: new LaunchRejectedError("task_archived", "Task is archived.") };
  if (session.blockedReason) return { ok: false, error: new LaunchRejectedError("pending_interaction", "Session has pending interactions.") };
  if (await hasPendingInteractions(bb, session.threadId)) return { ok: false, error: new LaunchRejectedError("pending_interaction", "Session has pending interactions.") };
  if (!session.completedTurnKey) return { ok: false, error: new LaunchRejectedError("missing_completed_turn", "No completed turn is available.") };
  if (session.nextStepTurnKey !== session.completedTurnKey) return { ok: false, error: new LaunchRejectedError("stale_extraction", "stale extraction") };
  const nextStep = parseJson<NextStepSuggestions | null>(session.nextStepJson, null);
  if (nextStep?.extraction.type !== "next_step_found") return { ok: false, error: new LaunchRejectedError("invalid_next_step", "No next step is available.") };
  const label = normalizePhaseLabel(session.label) as PhaseLabel | null;
  const transition = label ? autoAdvanceTransition(label, task.workflowType) : undefined;
  if (activeLaunchAttempt(db, task.id)) return { ok: false, error: new LaunchRejectedError("launch_blocked", "A launch attempt is already pending.") };
  return { ok: true, nextStep: nextStep as NextStepSuggestions & { extraction: { type: "next_step_found"; nextStepType: string; nextStepPrompt: string } }, transition };
}

async function hasPendingInteractions(bb: BbPluginApi, threadId: string) {
  const interactions = await bb.sdk.threads.interactions.list({ threadId });
  return (interactions as Array<{ status?: string; resolution?: unknown }>).some((interaction) =>
    interaction.status === "pending" || (interaction.status === undefined && interaction.resolution == null)
  );
}

function claimAdvanceAndAttempt(
  db: Database,
  task: TaskRecord,
  session: SessionRow,
  nextStep: NextStepSuggestions & { extraction: { type: "next_step_found"; nextStepType: string; nextStepPrompt: string } },
  mode: AdvanceMode,
) {
  const timestamp = Date.now();
  return db.transaction(() => {
    const attemptId = randomUUID();
    const claim = writeRow(
      db,
      "UPDATE sessions SET advanced_at = ?, advanced_attempt_id = ?, updated_at = ? WHERE thread_id = ? AND advanced_at IS NULL",
      timestamp,
      attemptId,
      timestamp,
      session.threadId,
    );
    if (claim.changes !== 1) return null;
    insertAttempt(db, task, {
      id: attemptId,
      fromThreadId: session.threadId,
      skillId: nextStep.extraction.nextStepType,
      commandLine: nextStep.extraction.nextStepPrompt,
      label: skillInfo(nextStep.extraction.nextStepType)?.label ?? null,
      environmentRole: environmentRoleForAttempt(task, nextStep.extraction.nextStepType),
      launchedBy: mode,
    });
    if (mode === "auto_advance" && session.completedTurnKey) {
      writeRow(
        db,
        `
        INSERT OR IGNORE INTO notification_suppressions (thread_id, completed_turn_key, reason, created_at, consumed_at)
        VALUES (?, ?, 'auto_advance', ?, NULL)
        `,
        session.threadId,
        session.completedTurnKey,
        timestamp,
      );
    }
    return { attemptId };
  })();
}

function readSessionForAdvance(db: Database, threadId: string) {
  const row = readRow<SessionRow & { hadTurn: number | boolean; interrupted: number | boolean }>(
    db,
    `
    SELECT thread_id AS threadId, task_id AS taskId, label, skill_id AS skillId, launched_by AS launchedBy,
      forked_from_thread_id AS forkedFromThreadId, rpi_status AS rpiStatus, rpi_status_at AS rpiStatusAt,
      had_turn AS hadTurn, interrupted, blocked_reason AS blockedReason, next_step_json AS nextStepJson,
      summary_json AS summaryJson, advanced_at AS advancedAt, advanced_attempt_id AS advancedAttemptId, hydrated_at AS hydratedAt,
      last_reconcile_seq AS lastReconcileSeq, last_summarized_turn_key AS lastSummarizedTurnKey,
      completed_turn_key AS completedTurnKey, next_step_turn_key AS nextStepTurnKey, ingest_error AS ingestError,
      created_at AS createdAt, updated_at AS updatedAt
    FROM sessions WHERE thread_id = ?
    `,
    threadId,
  );
  if (!row) return null;
  return { ...row, hadTurn: Boolean(row.hadTurn), interrupted: Boolean(row.interrupted) };
}

export function suppressReadyToast(db: Database, threadId: string, completedTurnKey = "") {
  writeRow(
    db,
    `
    INSERT OR IGNORE INTO notification_suppressions (thread_id, completed_turn_key, reason, created_at, consumed_at)
    VALUES (?, ?, 'auto_advance', ?, NULL)
    `,
    threadId,
    completedTurnKey,
    Date.now(),
  );
}

// Looks up the skill/label of the most recent launch attempt from this thread, used to name
// the failed skill in the ready_after_failed_advance recovery notification (see sessions.ts).
export function latestLaunchAttemptLabel(db: Database, threadId: string) {
  const attempt = readRow<{ skillId: string | null; label: string | null }>(
    db,
    "SELECT skill_id AS skillId, label FROM launch_attempts WHERE from_thread_id = ? ORDER BY created_at DESC LIMIT 1",
    threadId,
  );
  return attempt?.label ?? attempt?.skillId ?? null;
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
