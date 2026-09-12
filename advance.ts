import { createHash, randomUUID } from "node:crypto";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type * as BetterSqlite3 from "better-sqlite3";
import { parseJson, readRow, writeRow } from "./db";
import { getArtifactVersion, listArtifacts, parseArtifactNumber } from "./artifacts";
import { derivePhaseHandoff, latestPhaseArtifact, parsePrimaryReviewArtifact, type PhaseHandoff } from "./plan-phases";
import { DEFAULT_E2E_PREFS, manualLaunchRequestSchema, type E2ePrefs, type ManualLaunchIntent, type ManualLaunchRequest, type ModelOverride, type PreparedManualLaunch, type SessionRow, type TaskRecord } from "./contract";
import type { NextStepSuggestions } from "./extraction";
import { e2eGuardState, phaseModelFor } from "./e2e";
import {
  activeLaunchAttempt,
  environmentRoleForAttempt,
  insertAttempt,
  LaunchRejectedError,
  launchDraft,
  launchPhase,
  listLaunchAttempts,
  resolveDraftLaunch,
  resolveSkillLaunch,
  selectEnvironment,
  taskExecutionSeeds,
  withTaskLock,
} from "./launch";
import { createDraftTask, getTask, listChildren, updateTask } from "./tasks";
import { childWorktreeTiming, parseEpicChildren, readyChildren, RUNNING_SESSION_STATUSES } from "./epic";
import { listSessions } from "./sessions";
import { AUTO_ADVANCE, ITERATE_SKILL_BY_LABEL, autoAdvanceAccepts, autoAdvanceTransition, completedTurnIsProcessed, completionActionsForSession, e2eTransition, isNumericImplementationSkill, isReviewEntrySkill, normalizePhaseLabel, phaseImplementationSkill, skillInfo, type PhaseLabel } from "./transitions";
import type { LaunchBindingMirror, SessionMirrorRow } from "./sessions";

type Database = BetterSqlite3.Database;
type AdvanceMode = "auto_advance" | "proceed" | "completion";

export type AdvanceOptions = { e2e?: () => E2ePrefs };

export async function onCompletedTurn(
  bb: BbPluginApi,
  db: Database,
  mirror: Map<string, SessionMirrorRow>,
  bindings: LaunchBindingMirror,
  session: SessionRow,
  options: AdvanceOptions = {},
) {
  return advanceSession(bb, db, mirror, bindings, session, "auto_advance", undefined, options);
}

export async function proceed(
  bb: BbPluginApi,
  db: Database,
  mirror: Map<string, SessionMirrorRow>,
  bindings: LaunchBindingMirror,
  threadId: string,
  modelOverride?: ModelOverride,
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
  return advanceSession(bb, db, mirror, bindings, session, "proceed", modelOverride);
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
  // Same per-task mutex as proceed/auto-advance/retry (Phase 5, launch.ts withTaskLock): keeps
  // this call's read-check-then-insert of the task's launch_attempts state from interleaving with
  // another in-flight call for the same task (retry/adopt/proceed already run under this lock;
  // the plain "launch a skill" entry point did not). launchPhase's own activeLaunchAttempt check
  // still does the actual rejection: "disable while a launch_attempt for that task is pending"
  // (item 5's Suggested-next button), whenever a prior attempt for this task has not yet
  // resolved to spawned/failed.
  return withTaskLock(taskId, async () => {
    const task = taskRecord(db, taskId);
    const resolved = resolveSkillLaunch(task, skillId, commandLine);
    const result = await launchPhase(bb, db, mirror, bindings, task, {
      skillId: resolved.skillId,
      commandLine: resolved.commandLine,
      launchedBy: resolved.launchedBy,
      fromThreadId: resolved.fromThreadId,
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
  modelOverride?: ModelOverride,
) {
  const resolved = resolveIterateLaunch(db, mirror, threadId);
  return launchPhase(bb, db, mirror, bindings, resolved.task, {
    skillId: resolved.skillId,
    commandLine: resolved.commandLine,
    prompt: resolved.prompt,
    launchedBy: resolved.launchedBy,
    fromThreadId: resolved.fromThreadId,
    modelOverride,
  });
}

function resolveIterateLaunch(db: Database, mirror: Map<string, SessionMirrorRow>, threadId: string) {
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
    return {
      task,
      skillId: null,
      commandLine: null,
      prompt: UNLABELED_ITERATE_PROMPT,
      displayPrompt: UNLABELED_ITERATE_PROMPT,
      launchedBy: "iterate",
      fromThreadId: threadId,
    };
  }
  const commandLine = skillInfo(skillId)!.command;
  return {
    task,
    skillId,
    commandLine,
    prompt: undefined,
    displayPrompt: commandLine,
    launchedBy: "iterate",
    fromThreadId: threadId,
  };
}

export const UNLABELED_ITERATE_PROMPT =
  "Continue this task in a fresh session. Start from the selected revisions and checkpoint returned by rpi_task_context, then verify the current repository state before resuming.";

// Resolves a session's label to its iterate skill, or null when the label has no dedicated
// iterate skill (freeform, oneshot, describe-pr, review, worktree-setup) or is unrecognized. Pure;
// covered by tests/advance.test.ts.
export function iterateSkillForLabel(label: PhaseLabel | null) {
  const skillId = label ? ITERATE_SKILL_BY_LABEL[label] ?? null : null;
  return skillId && skillInfo(skillId) ? skillId : null;
}

type ValidNextStep = NextStepSuggestions & {
  extraction: { type: "next_step_found"; nextStepType: string; nextStepPrompt: string };
};

type ResolvedManualLaunch = {
  task: TaskRecord;
  skillId: string | null;
  commandLine: string | null;
  prompt?: string;
  displayPrompt: string;
  launchedBy: string;
  fromThreadId: string | null;
  advance?: { session: SessionRow; target: { skillId: string; commandLine: string; phase?: number } };
};

export async function prepareManualLaunch(
  bb: BbPluginApi,
  db: Database,
  intent: ManualLaunchIntent,
): Promise<PreparedManualLaunch> {
  const resolved = await resolveManualIntent(bb, db, intent);
  const selected = await selectEnvironment(
    bb,
    resolved.task,
    resolved.skillId,
    environmentRoleForAttempt(resolved.task, resolved.skillId),
  );
  return {
    intent,
    stateToken: manualLaunchStateToken(db, intent, resolved),
    taskId: resolved.task.id,
    sourceThreadId: resolved.fromThreadId,
    displayPrompt: resolved.displayPrompt,
    projectId: resolved.task.projectId,
    environment: selected.environment,
    ...taskExecutionSeeds(resolved.task),
    draftKey: draftKeyForIntent(intent),
    fixedWorkspaceNotice: fixedWorkspaceNotice(selected.environment),
  };
}

export async function submitManualLaunch(
  bb: BbPluginApi,
  db: Database,
  mirror: Map<string, SessionMirrorRow>,
  bindings: LaunchBindingMirror,
  intent: ManualLaunchIntent,
  stateToken: string,
  request: ManualLaunchRequest,
) {
  const validatedRequest = manualLaunchRequestSchema.parse(request);
  const taskId = taskIdForManualIntent(db, intent);
  return withTaskLock(taskId, async () => {
    const resolved = await resolveManualIntent(bb, db, intent);
    const selected = await selectEnvironment(
      bb,
      resolved.task,
      resolved.skillId,
      environmentRoleForAttempt(resolved.task, resolved.skillId),
    );
    const freshTask = manualTaskRecord(db, resolved.task.id);
    if (freshTask.archived) throw new LaunchRejectedError("task_archived", "Task is archived.");
    const authorized = { ...resolved, task: freshTask };
    assertManualTaskContext(freshTask, selected.environment, validatedRequest);
    if (stateToken !== manualLaunchStateToken(db, intent, authorized)) {
      throw new LaunchRejectedError("stale_intent", "This prepared launch is stale. Prepare it again before submitting.");
    }

    let attemptId: string | undefined;
    if (authorized.advance) {
      const attempted = claimAdvanceAndAttempt(db, freshTask, authorized.advance.session, authorized.advance.target, authorized.launchedBy === "completion" ? "completion" : "proceed", validatedRequest);
      if (!attempted) throw new LaunchRejectedError("stale_intent", "This phase action is stale. Reopen it from the source session.");
      attemptId = attempted.attemptId;
    }

    const result = await launchPhase(bb, db, mirror, bindings, freshTask, {
      skillId: authorized.skillId,
      commandLine: authorized.commandLine,
      prompt: authorized.prompt,
      request: validatedRequest,
      launchedBy: authorized.launchedBy,
      fromThreadId: authorized.fromThreadId,
      attemptId,
      selectedEnvironment: selected,
    });
    if (freshTask.isDraft) {
      writeRow(db, "UPDATE tasks SET is_draft = 0, updated_at = ? WHERE id = ?", Date.now(), freshTask.id);
      bb.realtime.publish("tasks", { taskId: freshTask.id });
    }
    return result;
  });
}

// One-click launch behind the phase-complete banner's actions (Implement Phase N, Review code,
// Create pull request): same resolution and advance claim as submitManualLaunch, but the spawn
// uses the task's own execution defaults instead of a composer-submitted request. Per-task lock
// and launch-attempt guards are identical to the other launch entry points.
export async function launchCompletion(
  bb: BbPluginApi,
  db: Database,
  mirror: Map<string, SessionMirrorRow>,
  bindings: LaunchBindingMirror,
  intent: Extract<ManualLaunchIntent, { kind: "completion" }>,
  modelOverride?: ModelOverride,
) {
  const taskId = taskIdForManualIntent(db, intent);
  return withTaskLock(taskId, async () => {
    const resolved = await resolveManualIntent(bb, db, intent);
    const freshTask = manualTaskRecord(db, resolved.task.id);
    if (freshTask.archived) throw new LaunchRejectedError("task_archived", "Task is archived.");
    const authorized = { ...resolved, task: freshTask };
    let attemptId: string | undefined;
    if (authorized.advance) {
      const attempted = claimAdvanceAndAttempt(db, freshTask, authorized.advance.session, authorized.advance.target, "completion");
      if (!attempted) throw new LaunchRejectedError("stale_intent", "This phase action is stale. Reopen it from the source session.");
      attemptId = attempted.attemptId;
    }
    return launchPhase(bb, db, mirror, bindings, freshTask, {
      skillId: authorized.skillId,
      commandLine: authorized.commandLine,
      prompt: authorized.prompt,
      launchedBy: authorized.launchedBy,
      fromThreadId: authorized.fromThreadId,
      modelOverride,
      attemptId,
    }).then((result) => {
      if (freshTask.isDraft) {
        writeRow(db, "UPDATE tasks SET is_draft = 0, updated_at = ? WHERE id = ?", Date.now(), freshTask.id);
        bb.realtime.publish("tasks", { taskId: freshTask.id });
      }
      return result;
    });
  });
}

export function manualLaunchRejection(error: unknown) {
  if (!(error instanceof LaunchRejectedError)) return null;
  const code = error.code === "project_mismatch" || error.code === "workspace_mismatch"
    ? error.code
    : "stale_intent" as const;
  return { code, message: error.message };
}

async function resolveManualIntent(bb: BbPluginApi, db: Database, intent: ManualLaunchIntent): Promise<ResolvedManualLaunch> {
  if (intent.kind === "proceed") {
    const session = readSessionForAdvance(db, intent.threadId);
    if (!session) throw new LaunchRejectedError("stale_intent", `No RPI session found for thread ${intent.threadId}.`);
    const task = manualTaskRecord(db, session.taskId);
    const validation = await validateAdvance(bb, db, task, session, "proceed");
    if (!validation.ok) throw validation.error;
    return {
      task,
      skillId: validation.nextStep.extraction.nextStepType,
      commandLine: validation.nextStep.extraction.nextStepPrompt,
      displayPrompt: validation.nextStep.extraction.nextStepPrompt,
      launchedBy: "proceed",
      fromThreadId: session.threadId,
      advance: {
        session,
        target: {
          skillId: validation.nextStep.extraction.nextStepType,
          commandLine: validation.nextStep.extraction.nextStepPrompt,
        },
      },
    };
  }

  let resolved: ResolvedManualLaunch;
  if (intent.kind === "draft") {
    const task = manualTaskRecord(db, intent.taskId);
    if (!task.isDraft) throw new LaunchRejectedError("stale_intent", "This draft has already been launched.");
    resolved = resolveDraftLaunch(task);
  } else if (intent.kind === "skill") {
    const task = manualTaskRecord(db, intent.taskId);
    try {
      resolved = resolveSkillLaunch(task, intent.skillId);
    } catch {
      throw new LaunchRejectedError("stale_intent", `Unknown RPI skill ${intent.skillId}.`);
    }
  } else if (intent.kind === "completion") {
    const session = readSessionForAdvance(db, intent.threadId);
    if (!session) throw new LaunchRejectedError("stale_intent", `No RPI session found for thread ${intent.threadId}.`);
    const task = manualTaskRecord(db, session.taskId);
    const sourceError = await validateCompletionSource(bb, db, task, session);
    if (sourceError) throw sourceError;
    const reviewEntry = isReviewEntrySkill(intent.skillId);
    if (!reviewEntry) requirePrimaryReviewArtifact(db, session);
    const needsNumericPhaseHandoff = requiresNumericPhaseHandoff(task, session) && !reviewEntry;
    const handoff = needsNumericPhaseHandoff ? phaseHandoffForSession(db, session, task.workflowType) : null;
    const nextPlanPhase = handoff?.ok ? handoff.nextPhase : null;
    if (needsNumericPhaseHandoff) {
      if (!handoff || !handoff.ok) {
        throw new LaunchRejectedError("stale_intent", "Phase review metadata is unavailable.");
      }
      if (intent.skillId === phaseImplementationSkill(task.workflowType) && intent.phase !== handoff.nextPhase?.phase) {
        throw new LaunchRejectedError("stale_intent", "This phase action is no longer available.");
      }
    }
    const projection = completionActionsForSession({ ...session, workflowType: task.workflowType }, { activeAttempt: false, successorThreadId: successorFor(db, session.threadId), nextPlanPhase });
    const action = projection?.actions.find((candidate) =>
      candidate.intent.kind === "completion"
      && candidate.intent.skillId === intent.skillId
      && candidate.intent.phase === intent.phase,
    );
    const info = skillInfo(intent.skillId);
    if (!action || !info) throw new LaunchRejectedError("stale_intent", "This phase action is no longer available.");
    resolved = {
      task,
      skillId: info.skillId,
      commandLine: info.command,
      displayPrompt: info.command,
      launchedBy: "completion",
      fromThreadId: session.threadId,
      advance: {
        session,
        target: {
          skillId: info.skillId,
          commandLine: info.command,
          ...(intent.phase !== undefined ? { phase: intent.phase } : {}),
        },
      },
    };
  } else {
    try {
      resolved = resolveIterateLaunch(db, new Map(), intent.threadId);
    } catch {
      throw new LaunchRejectedError("stale_intent", `No RPI session found for thread ${intent.threadId}.`);
    }
    const source = readSessionForAdvance(db, intent.threadId);
    if (!source) throw new LaunchRejectedError("stale_intent", `No RPI session found for thread ${intent.threadId}.`);
    if (successorFor(db, source.threadId)) {
      throw new LaunchRejectedError("stale_intent", "This Iterate action is stale because the source session already has a successor.");
    }
    if (source.blockedReason || await hasPendingInteractions(bb, source.threadId)) {
      throw new LaunchRejectedError("pending_interaction", "The source session has pending interactions.");
    }
  }

  if (resolved.task.archived) throw new LaunchRejectedError("task_archived", "Task is archived.");
  if (activeLaunchAttempt(db, resolved.task.id)) {
    throw new LaunchRejectedError("launch_blocked", "A launch attempt is already pending.");
  }
  return resolved;
}

function taskIdForManualIntent(db: Database, intent: ManualLaunchIntent) {
  if (intent.kind === "draft" || intent.kind === "skill") return intent.taskId;
  const session = readRow<{ taskId: string }>(db, "SELECT task_id AS taskId FROM sessions WHERE thread_id = ?", intent.threadId);
  if (!session) throw new LaunchRejectedError("stale_intent", `No RPI session found for thread ${intent.threadId}.`);
  return session.taskId;
}

function manualTaskRecord(db: Database, taskId: string) {
  const result = getTask(db, taskId);
  if (!result) throw new LaunchRejectedError("stale_intent", "This RPI task no longer exists. Reopen the action from the task list.");
  return result.task;
}

export function phaseHandoffForSession(
  db: Database,
  session: Pick<SessionRow, "taskId" | "summaryJson">,
  workflowType: string,
): PhaseHandoff {
  try {
    const artifacts = listArtifacts(db, session.taskId);
    const phaseArtifact = latestPhaseArtifact(artifacts, workflowType);
    if (!phaseArtifact) return { ok: false, error: "phase_not_in_plan" };
    const phaseContent = getArtifactVersion(db, session.taskId, phaseArtifact.fileName)?.version.content.toString("utf8");
    if (phaseContent === undefined) return { ok: false, error: "phase_not_in_plan" };
    return derivePhaseHandoff(phaseContent, parsePrimaryReviewArtifact(session.summaryJson), artifacts);
  } catch {
    return { ok: false, error: "missing_review_artifact" };
  }
}

function requirePrimaryReviewArtifact(db: Database, session: Pick<SessionRow, "taskId" | "label" | "summaryJson">) {
  if (!session.label) return;
  const primary = parsePrimaryReviewArtifact(session.summaryJson);
  if (!primary || !listArtifacts(db, session.taskId).some((artifact) => artifact.fileName === primary.fileName)) {
    throw new LaunchRejectedError("stale_intent", "Phase review metadata is unavailable.");
  }
}

function requiresNumericPhaseHandoff(task: Pick<TaskRecord, "workflowType">, session: Pick<SessionRow, "label" | "skillId">) {
  return normalizePhaseLabel(session.label) === "implementation"
    && isNumericImplementationSkill(session.skillId)
    && phaseImplementationSkill(task.workflowType) !== null;
}

function manualLaunchStateToken(db: Database, intent: ManualLaunchIntent, resolved: ResolvedManualLaunch) {
  const source = resolved.fromThreadId ? readSessionForAdvance(db, resolved.fromThreadId) : null;
  const latestAttempt = readRow<{
    rowId: number;
    id: string;
    status: string;
    threadId: string | null;
    retryMarker: string | null;
  }>(
    db,
    `SELECT rowid AS rowId, id, status, thread_id AS threadId, retry_marker AS retryMarker
    FROM launch_attempts
    WHERE task_id = ?
    ORDER BY created_at DESC, rowid DESC
    LIMIT 1`,
    resolved.task.id,
  );
  return createHash("sha256")
    .update(JSON.stringify({ intent, task: resolved.task, source, latestAttempt: latestAttempt ?? null }))
    .digest("hex");
}

function draftKeyForIntent(intent: ManualLaunchIntent) {
  if (intent.kind === "draft") return `rpi:manual:draft:${intent.taskId}`;
  if (intent.kind === "skill") return `rpi:manual:skill:${intent.taskId}:${intent.skillId}`;
  return `rpi:manual:${intent.kind}:${intent.threadId}`;
}

function fixedWorkspaceNotice(environment: ManualLaunchRequest["environment"]) {
  if (environment.type !== "host" || environment.workspace.type !== "unmanaged" || environment.workspace.path === null) return null;
  return `This launch stays in the task workspace at ${environment.workspace.path}. The composer may normalize an unmanaged path, but submission keeps the task workspace fixed.`;
}

function assertManualTaskContext(
  task: TaskRecord,
  environment: ManualLaunchRequest["environment"],
  request: ManualLaunchRequest,
) {
  if (request.projectId !== task.projectId) {
    throw new LaunchRejectedError("project_mismatch", "This RPI task belongs to a different project. Restore the task project and submit again.");
  }
  if (!sameManualEnvironment(environment, request.environment)) {
    throw new LaunchRejectedError("workspace_mismatch", "This RPI task has a fixed workspace. Restore the task host and workspace and submit again.");
  }
}

function sameManualEnvironment(expected: ManualLaunchRequest["environment"], actual: ManualLaunchRequest["environment"]) {
  if (expected.type !== actual.type) return false;
  if (expected.type === "reuse") return actual.type === "reuse" && expected.environmentId === actual.environmentId;
  if (expected.type === "project-default") return actual.type === "project-default";
  if (expected.type === "provider") {
    return actual.type === "provider"
      && expected.environmentProviderId === actual.environmentProviderId
      && JSON.stringify(expected.machine ?? null) === JSON.stringify(actual.machine ?? null)
      && JSON.stringify(expected.inputs ?? null) === JSON.stringify(actual.inputs ?? null);
  }
  if (actual.type !== "host" || (expected.hostId ?? null) !== (actual.hostId ?? null)) return false;
  if (expected.workspace.type !== actual.workspace.type) return false;
  if (expected.workspace.type === "personal") return actual.workspace.type === "personal";
  if (expected.workspace.type === "managed-worktree") {
    return actual.workspace.type === "managed-worktree" && JSON.stringify(expected.workspace.baseBranch) === JSON.stringify(actual.workspace.baseBranch);
  }
  if (actual.workspace.type !== "unmanaged") return false;
  const pathMatches = expected.workspace.path === actual.workspace.path
    || (expected.workspace.path !== null && actual.workspace.path === null);
  return pathMatches && JSON.stringify(expected.workspace.branch ?? null) === JSON.stringify(actual.workspace.branch ?? null);
}

function advanceSession(
  bb: BbPluginApi,
  db: Database,
  mirror: Map<string, SessionMirrorRow>,
  bindings: LaunchBindingMirror,
  session: SessionRow,
  mode: AdvanceMode,
  modelOverride?: ModelOverride,
  options: AdvanceOptions = {},
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
    let target: { skillId: string; commandLine: string; phase?: number } = {
      skillId: nextStep.extraction.nextStepType,
      commandLine: nextStep.extraction.nextStepPrompt,
    };
    if (target.skillId === "start-epic-delivery") {
      if (task.workflowType !== "epic") throw new LaunchRejectedError("invalid_next_step", "Only an epic can start delivery.");
      return startEpicDelivery(bb, db, mirror, bindings, task, fresh);
    }
    let e2eHop = false;
    if (mode === "auto_advance") {
      const label = normalizePhaseLabel(fresh.label) as PhaseLabel | null;
      const prefs = options.e2e?.() ?? DEFAULT_E2E_PREFS;
      const row = task.e2eMode ? e2eTransition(label, task.workflowType, nextStep.extraction.nextStepType) : undefined;
      // listLaunchAttempts returns newest-first; e2eGuardState anchors by scanning the tail for
      // the newest human launch, so feed it oldest-first.
      const guards = row ? e2eGuardState([...listLaunchAttempts(db, task.id)].reverse(), prefs) : null;
      const flagPath = Boolean(transition && transition.flag !== null
        && label && autoAdvanceAccepts(label, task.workflowType, nextStep.extraction.nextStepType)
        && task.autoAdvance && task[transition.flag as keyof TaskRecord]);
      if (row && guards && !guards.pausedReason) {
        if (row.chain === "phase") {
          const handoff = phaseHandoffForSession(db, fresh, task.workflowType);
          if (!handoff.ok || !handoff.nextPhase) {
            if (!flagPath) return { threadId: existing };
          } else {
            target = { skillId: row.next, commandLine: nextStep.extraction.nextStepPrompt, phase: handoff.nextPhase.phase };
            e2eHop = true;
          }
        } else {
          target = { skillId: row.next, commandLine: row.next === nextStep.extraction.nextStepType ? nextStep.extraction.nextStepPrompt : skillInfo(row.next)!.command };
          e2eHop = true;
        }
      }
      if (!e2eHop && !flagPath) return { threadId: existing };
    }
    const attempted = claimAdvanceAndAttempt(db, task, fresh, target, mode);
    if (!attempted) return { threadId: successorFor(db, fresh.threadId) };
    const phaseModel = mode === "auto_advance" ? phaseModelFor(task, skillInfo(target.skillId)?.label ?? null, options.e2e?.() ?? DEFAULT_E2E_PREFS) : undefined;
    return launchPhase(bb, db, mirror, bindings, task, {
      skillId: target.skillId,
      commandLine: target.commandLine,
      launchedBy: mode,
      fromThreadId: fresh.threadId,
      modelOverride: modelOverride ?? phaseModel,
      attemptId: attempted.attemptId,
      e2ePermissionMode: (options.e2e?.() ?? DEFAULT_E2E_PREFS).permissionMode,
    });
  });
}

// The epic gate: the plan session's advanced_at is the one-shot claim, so a second Proceed on
// the same session creates no second child set. Runs inside the epic's task lock (advanceSession).
async function startEpicDelivery(
  bb: BbPluginApi,
  db: Database,
  mirror: Map<string, SessionMirrorRow>,
  bindings: LaunchBindingMirror,
  epic: TaskRecord,
  session: SessionRow,
): Promise<{ threadId: null }> {
  if (listChildren(db, epic.id).length === 0) {
    const plan = latestEpicPlan(db, epic.id);
    if (!plan) throw new LaunchRejectedError("stale_intent", "No epic plan artifact is saved.");
    const parsed = parseEpicChildren(plan.content);
    if (!parsed.ok) throw new LaunchRejectedError("stale_intent", `Epic plan children block: ${parsed.issues.join("; ")}`);
    const now = Date.now();
    // createDraftTask's own transaction becomes a savepoint inside this one (better-sqlite3 nests).
    const created = db.transaction(() => {
      const claim = writeRow(db, "UPDATE sessions SET advanced_at = ?, updated_at = ? WHERE thread_id = ? AND advanced_at IS NULL", now, now, session.threadId);
      if (claim.changes !== 1) return false;
      const ids = new Map<string, string>();
      parsed.children.forEach((child, index) => {
        const { taskId } = createDraftTask(db, {
          projectId: epic.projectId,
          prompt: child.prompt,
          name: child.name,
          parentTaskId: epic.id,
          position: index,
          workflowType: child.workflow,
          worktreeTiming: childWorktreeTiming(child),
          hostId: epic.hostId,
          defaultDirectory: epic.defaultDirectory,
          baseEnvironmentId: epic.baseEnvironmentId,
          composerEnvironment: epic.composerEnvironment,
          permissionMode: epic.permissionMode,
          providerId: epic.providerId,
          model: epic.model,
          reasoningLevel: epic.reasoningLevel,
          serviceTier: epic.serviceTier,
          autoAdvance: epic.autoAdvance,
          e2eMode: epic.e2eMode,
        });
        ids.set(child.name, taskId);
      });
      for (const child of parsed.children) {
        updateTask(db, ids.get(child.name)!, { dependsOn: child.depends_on.map((name) => ids.get(name)!) });
      }
      return true;
    })();
    if (!created) return { threadId: null };
  }
  await scheduleEpic(bb, db, mirror, bindings, epic.id);
  bb.realtime.publish("tasks", { taskId: epic.id });
  return { threadId: null };
}

// Newest live epic-plan artifact by updatedAt, then artifact number.
function latestEpicPlan(db: Database, taskId: string) {
  const plan = listArtifacts(db, taskId)
    .filter((artifact) => artifact.type === "epic-plan" && !artifact.isDeleted)
    .sort((left, right) =>
      right.updatedAt - left.updatedAt
      || (parseArtifactNumber(right.fileName) ?? 0) - (parseArtifactNumber(left.fileName) ?? 0))[0];
  if (!plan) return null;
  const content = getArtifactVersion(db, taskId, plan.fileName)?.version.content.toString("utf8");
  return content === undefined ? null : { fileName: plan.fileName, content };
}

// Lock-free on purpose: withTaskLock is a promise chain and not re-entrant, and startEpicDelivery
// already runs inside the epic's lock. External triggers use scheduleEpicLocked.
export async function scheduleEpic(
  bb: BbPluginApi,
  db: Database,
  mirror: Map<string, SessionMirrorRow>,
  bindings: LaunchBindingMirror,
  epicId: string,
) {
  const epic = getTask(db, epicId)?.task;
  if (!epic || epic.workflowType !== "epic" || epic.archived) return;
  const children = listChildren(db, epicId);
  if (children.length === 0) return;
  const running = new Set(children.filter((child) =>
    activeLaunchAttempt(db, child.id) !== undefined
    || listSessions(db, child.id).some((session) => RUNNING_SESSION_STATUSES.has(session.rpiStatus)),
  ).map((child) => child.id));
  for (const child of readyChildren(epic, children, running)) {
    try {
      await launchDraft(bb, db, mirror, bindings, child.id);
    } catch (error) {
      // The failed attempt shows on the child's page; the other ready children still launch.
      bb.log.warn(`RPI epic ${epicId}: launching child ${child.id} failed: ${String(error)}`);
    }
  }
  if (!epic.completed && children.every((child) => child.completed)) {
    updateTask(db, epicId, { completed: true });
    bb.realtime.publish("tasks", { taskId: epicId });
  }
}

export function scheduleEpicLocked(
  bb: BbPluginApi,
  db: Database,
  mirror: Map<string, SessionMirrorRow>,
  bindings: LaunchBindingMirror,
  epicId: string,
) {
  return withTaskLock(epicId, () => scheduleEpic(bb, db, mirror, bindings, epicId));
}

// The epic a task write concerns: the task itself when it is an epic, else its parent.
export function epicIdForTask(task: Pick<TaskRecord, "id" | "workflowType" | "parentTaskId">): string | null {
  if (task.workflowType === "epic") return task.id;
  return task.parentTaskId;
}

async function validateAdvance(
  bb: BbPluginApi,
  db: Database,
  task: TaskRecord,
  session: SessionRow,
  mode: AdvanceMode,
): Promise<
  | { ok: true; nextStep: ValidNextStep; transition: ReturnType<typeof autoAdvanceTransition> }
  | { ok: false; error: LaunchRejectedError }
> {
  const sourceError = await validateCompletionSource(bb, db, task, session, false);
  if (sourceError) return { ok: false, error: sourceError };
  if (session.nextStepTurnKey !== session.completedTurnKey) return { ok: false, error: new LaunchRejectedError("stale_extraction", "stale extraction") };
  const nextStep = parseJson<NextStepSuggestions | null>(session.nextStepJson, null);
  if (nextStep?.extraction.type !== "next_step_found") return { ok: false, error: new LaunchRejectedError("invalid_next_step", "No next step is available.") };
  if (mode === "proceed") {
    const nextSkillId = nextStep.extraction.nextStepType;
    try {
      if (!isReviewEntrySkill(nextSkillId)) requirePrimaryReviewArtifact(db, session);
    } catch (error) {
      return { ok: false, error: error as LaunchRejectedError };
    }
    if (requiresNumericPhaseHandoff(task, session) && !isReviewEntrySkill(nextSkillId)) {
      const handoff = phaseHandoffForSession(db, session, task.workflowType);
      if (!handoff.ok) return { ok: false, error: new LaunchRejectedError("stale_intent", "Phase review metadata is unavailable.") };
      if (nextSkillId === phaseImplementationSkill(task.workflowType)) {
        return { ok: false, error: new LaunchRejectedError("stale_intent", "This phase action is no longer available.") };
      }
    }
  }
  const label = normalizePhaseLabel(session.label) as PhaseLabel | null;
  const transition = label ? autoAdvanceTransition(label, task.workflowType) : undefined;
  return { ok: true, nextStep: nextStep as ValidNextStep, transition };
}

async function validateCompletionSource(
  bb: BbPluginApi,
  db: Database,
  task: TaskRecord,
  session: SessionRow,
  requireProcessed = true,
) {
  const existing = successorFor(db, session.threadId);
  if (existing) return new LaunchRejectedError("launch_blocked", "Session already advanced.");
  if (session.rpiStatus !== "ready_for_input") return new LaunchRejectedError("session_running", "session running");
  if (task.archived) return new LaunchRejectedError("task_archived", "Task is archived.");
  if (session.blockedReason) return new LaunchRejectedError("pending_interaction", "Session has pending interactions.");
  if (await hasPendingInteractions(bb, session.threadId)) return new LaunchRejectedError("pending_interaction", "Session has pending interactions.");
  if (!session.completedTurnKey) return new LaunchRejectedError("missing_completed_turn", "No completed turn is available.");
  if (requireProcessed && !completedTurnIsProcessed(session)) return new LaunchRejectedError("stale_extraction", "The completed turn is still being processed.");
  if (activeLaunchAttempt(db, task.id)) return new LaunchRejectedError("launch_blocked", "A launch attempt is already pending.");
  return null;
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
  target: { skillId: string; commandLine: string; phase?: number },
  mode: AdvanceMode,
  request?: ManualLaunchRequest,
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
      skillId: target.skillId,
      commandLine: target.commandLine,
      label: skillInfo(target.skillId)?.label ?? null,
      environmentRole: environmentRoleForAttempt(task, target.skillId),
      launchedBy: mode,
      request,
      targetPhase: target.phase,
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
