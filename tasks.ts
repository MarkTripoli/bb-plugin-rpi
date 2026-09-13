import { randomUUID } from "node:crypto";
import type * as BetterSqlite3 from "better-sqlite3";
import { z } from "zod";
import { nowMs, parseJson, readRow, readRows, stringifyJson, transaction, writeRow } from "./db";
import { mimeFor, upsertArtifact } from "./artifacts";
import { deriveBoardColumn, labelToStepLabel } from "./transitions";
import { DEFAULT_CONTEXT_THRESHOLD } from "./context-threshold";
import { attentionCountForTask } from "./status";
import { LIVE_SESSION_CLAUSE, listSessions } from "./sessions";
import {
  DEFAULT_E2E_PREFS,
  createThreadEnvironmentSchema,
  phaseModelsSchema,
  type Prefs,
  type PhaseModels,
  type SessionRow,
  type TaskRecord,
  type TaskRow,
  type TaskWorkspaceState,
  type WorkflowType,
} from "./contract";

type Database = BetterSqlite3.Database;

type RawTaskRecord = {
  id: string;
  projectId: string;
  name: string;
  slug: string;
  draftPrompt: string;
  workflowType: WorkflowType;
  worktreeTiming: "now" | "later" | "never";
  isDraft: number | boolean;
  archived: number | boolean;
  completed: number | boolean;
  hostId: string | null;
  baseEnvironmentId: string | null;
  worktreeEnvironmentId: string | null;
  defaultDirectory: string | null;
  providerId: string | null;
  model: string | null;
  reasoningLevel: string | null;
  serviceTier: string | null;
  permissionMode: "default" | "accept_edits" | "auto" | "bypass" | null;
  autoAdvance: number | boolean;
  aa_questions_to_research: number | boolean;
  aa_research_to_design: number | boolean;
  aa_plan_to_worktree: number | boolean;
  aa_worktree_to_implementation: number | boolean;
  aa_implementation_to_pr: number | boolean;
  e2eMode: number | boolean;
  phaseModelsJson: string | null;
  composerEnvironmentJson: string | null;
  parentTaskId: string | null;
  dependsOnJson: string | null;
  position: number | null;
  epicPaused: number | boolean;
  maxParallel: number | null;
  createdAt: number;
  updatedAt: number;
};

// One column list for every task SELECT so a new column cannot land in one read path and not the
// others (readTaskRecord, listTasks, listChildren all normalize through normalizeTaskRecord).
const TASK_SELECT = `
    SELECT
      id,
      project_id AS projectId,
      name,
      slug,
      draft_prompt AS draftPrompt,
      workflow_type AS workflowType,
      worktree_timing AS worktreeTiming,
      is_draft AS isDraft,
      archived,
      completed,
      host_id AS hostId,
      base_environment_id AS baseEnvironmentId,
      worktree_environment_id AS worktreeEnvironmentId,
      default_directory AS defaultDirectory,
      provider_id AS providerId,
      model,
      reasoning_level AS reasoningLevel,
      service_tier AS serviceTier,
      permission_mode AS permissionMode,
      auto_advance AS autoAdvance,
      aa_questions_to_research,
      aa_research_to_design,
      aa_plan_to_worktree,
      aa_worktree_to_implementation,
      aa_implementation_to_pr,
      e2e_mode AS e2eMode,
      phase_models AS phaseModelsJson,
      composer_environment_json AS composerEnvironmentJson,
      parent_task_id AS parentTaskId,
      depends_on_json AS dependsOnJson,
      position,
      epic_paused AS epicPaused,
      max_parallel AS maxParallel,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM tasks
`;

// Persisted phase_models JSON is untrusted: an invalid or corrupt value reads back as {} instead
// of failing every task read.
export function parsePhaseModels(json: string | null): PhaseModels {
  const parsed = phaseModelsSchema.safeParse(parseJson(json, {}));
  return parsed.success ? parsed.data : {};
}

// Same trust boundary as phase_models: a corrupt persisted environment reads back as null (task
// launches fall back to the host/directory resolution) instead of failing every task read.
export function parseComposerEnvironment(json: string | null): TaskRecord["composerEnvironment"] {
  const parsed = createThreadEnvironmentSchema.safeParse(parseJson<unknown>(json, null));
  return parsed.success ? parsed.data : null;
}

// Same trust boundary again: a corrupt depends_on_json reads back as [] (no dependencies) rather
// than failing every task read.
export function parseDependsOn(json: string | null): string[] {
  const parsed = z.array(z.string()).safeParse(parseJson<unknown>(json, []));
  return parsed.success ? parsed.data : [];
}

function normalizeTaskRecord(row: RawTaskRecord): TaskRecord {
  const { phaseModelsJson, composerEnvironmentJson, dependsOnJson, ...rest } = row;
  return {
    ...rest,
    dependsOn: parseDependsOn(dependsOnJson),
    epicPaused: Boolean(row.epicPaused),
    isDraft: Boolean(row.isDraft),
    archived: Boolean(row.archived),
    completed: Boolean(row.completed),
    autoAdvance: Boolean(row.autoAdvance),
    aa_questions_to_research: Boolean(row.aa_questions_to_research),
    aa_research_to_design: Boolean(row.aa_research_to_design),
    aa_plan_to_worktree: Boolean(row.aa_plan_to_worktree),
    aa_worktree_to_implementation: Boolean(row.aa_worktree_to_implementation),
    aa_implementation_to_pr: Boolean(row.aa_implementation_to_pr),
    e2eMode: Boolean(row.e2eMode),
    phaseModels: parsePhaseModels(row.phaseModelsJson),
    composerEnvironment: parseComposerEnvironment(row.composerEnvironmentJson),
  };
}

function normalizeSlugPart(name: string) {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug === "" ? "task" : slug;
}

function cleanName(input: string | undefined | null) {
  const trimmed = (input ?? "").trim();
  if (trimmed.length === 0) return "Untitled task";
  return trimmed.slice(0, 200);
}

function draftPromptFrom(input: string) {
  return input.trim();
}

function defaultTaskNameFromPrompt(prompt: string) {
  const line = prompt.split(/\r?\n/, 1)[0]?.trim() ?? "";
  return line.length > 0 ? line.slice(0, 120) : "Untitled task";
}

function readTaskRecord(db: Database, taskId: string): TaskRecord | undefined {
  const row = readRow<RawTaskRecord>(db, `${TASK_SELECT} WHERE id = ?`, taskId);
  return row ? normalizeTaskRecord(row) : undefined;
}

// Same live-session rule as listSessions: a session whose thread was archived neither counts nor
// decides the task's current phase (dismissing a failed re-run of an earlier step must not leave
// the task pointing at that step).
function readSessionCount(db: Database, taskId: string) {
  const row = readRow<{ count: number }>(db, `SELECT COUNT(*) AS count FROM sessions WHERE task_id = ? AND ${LIVE_SESSION_CLAUSE}`, taskId);
  return row?.count ?? 0;
}

function readLatestLabel(db: Database, taskId: string) {
  const row = readRow<{ label: string | null }>(
    db,
    `SELECT label FROM sessions WHERE task_id = ? AND ${LIVE_SESSION_CLAUSE} ORDER BY created_at DESC, thread_id DESC LIMIT 1`,
    taskId,
  );
  return row?.label ?? null;
}

function hasChildren(db: Database, taskId: string) {
  return readRow(db, "SELECT 1 FROM tasks WHERE parent_task_id = ?", taskId) !== undefined;
}

// An epic in delivery has no session of its own: once children exist its current phase is
// "delivery" regardless of which epic-level session ran last.
function currentLabelFor(db: Database, record: Pick<TaskRecord, "id" | "workflowType">) {
  if (record.workflowType === "epic" && hasChildren(db, record.id)) return "delivery";
  return readLatestLabel(db, record.id);
}

// Live finding (phase B.1): counting raw rpi_status IN ('ready_for_input','needs_approval') over-
// counts every session that finished its turn hours ago and whose phase has since moved on (see
// status.ts effectiveStatus). Reads the task's sessions the same way listSessions's own RPC does
// (sessions.ts's listSessions) and lets attentionCountForTask apply the same supersession rule the
// UI's needs-you band uses, so the server's count and the panel's band never disagree.
function readAttentionCount(db: Database, task: Pick<TaskRecord, "id" | "workflowType" | "worktreeTiming">) {
  return attentionCountForTask(listSessions(db, task.id), task);
}

function taskRowFromRecord(record: TaskRecord, sessionCount: number, latestLabel: string | null, attentionCount: number): TaskRow {
  return {
    id: record.id,
    projectId: record.projectId,
    name: record.name,
    slug: record.slug,
    draftPrompt: record.draftPrompt,
    workflowType: record.workflowType,
    worktreeTiming: record.worktreeTiming,
    isDraft: record.isDraft,
    archived: record.archived,
    completed: record.completed,
    hostId: record.hostId,
    baseEnvironmentId: record.baseEnvironmentId,
    worktreeEnvironmentId: record.worktreeEnvironmentId,
    defaultDirectory: record.defaultDirectory,
    providerId: record.providerId,
    model: record.model,
    reasoningLevel: record.reasoningLevel,
    serviceTier: record.serviceTier,
    permissionMode: record.permissionMode,
    autoAdvance: record.autoAdvance,
    aa_questions_to_research: record.aa_questions_to_research,
    aa_research_to_design: record.aa_research_to_design,
    aa_plan_to_worktree: record.aa_plan_to_worktree,
    aa_worktree_to_implementation: record.aa_worktree_to_implementation,
    aa_implementation_to_pr: record.aa_implementation_to_pr,
    e2eMode: record.e2eMode,
    parentTaskId: record.parentTaskId,
    dependsOn: record.dependsOn,
    position: record.position,
    epicPaused: record.epicPaused,
    maxParallel: record.maxParallel,
    currentLabel: latestLabel,
    stepLabel: record.isDraft ? "Draft" : latestLabel ? labelToStepLabel(latestLabel, false) : record.workflowType,
    attentionCount: record.completed ? 0 : attentionCount,
    boardColumn: record.isDraft || latestLabel ? deriveBoardColumn(latestLabel, record.isDraft) : "implementation",
    sessionCount,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function generateTaskSlug(db: Database, name: string) {
  const base = normalizeSlugPart(name);
  const rows = readRows<{ slug: string }>(db, "SELECT slug FROM (SELECT slug FROM tasks UNION ALL SELECT slug FROM deleted_task_slugs) WHERE slug = ? OR slug LIKE ?", base, `${base}-%`);
  const used = new Set(rows.map((row) => row.slug));
  if (!used.has(base)) return base;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
}

export function listTasks(
  db: Database,
  filters: { projectId?: string | null; archived?: boolean | null; completed?: boolean | null } = {},
): TaskRow[] {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (filters.projectId) {
    clauses.push("project_id = ?");
    params.push(filters.projectId);
  }
  if (filters.archived !== null && filters.archived !== undefined) {
    clauses.push("archived = ?");
    params.push(filters.archived ? 1 : 0);
  } else {
    clauses.push("archived = 0");
  }
  // Omitted means active tasks; null explicitly includes both active and manually done tasks.
  if (filters.completed !== null) {
    clauses.push("completed = ?");
    params.push(filters.completed ? 1 : 0);
  }
  const sql = `
    ${TASK_SELECT}
    ${clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : ""}
    ORDER BY updated_at DESC, created_at DESC
  `;
  return readRows<RawTaskRecord>(db, sql, ...params).map(normalizeTaskRecord).map((record) => rowFor(db, record));
}

function rowFor(db: Database, record: TaskRecord) {
  return taskRowFromRecord(record, readSessionCount(db, record.id), currentLabelFor(db, record), readAttentionCount(db, record));
}

// Children of one epic in plan order; archived children drop out the same way listTasks hides them.
export function listChildren(db: Database, epicId: string): TaskRow[] {
  return readRows<RawTaskRecord>(db, `${TASK_SELECT} WHERE parent_task_id = ? AND archived = 0 ORDER BY position, created_at`, epicId)
    .map(normalizeTaskRecord)
    .map((record) => rowFor(db, record));
}

// Epics the scheduler may launch children for: live, not paused, and already materialized.
export function listDeliveringEpics(db: Database): string[] {
  return readRows<{ id: string }>(
    db,
    `SELECT id FROM tasks WHERE workflow_type = 'epic' AND archived = 0 AND completed = 0 AND epic_paused = 0
       AND EXISTS (SELECT 1 FROM tasks AS child WHERE child.parent_task_id = tasks.id)
     ORDER BY created_at`,
  ).map((row) => row.id);
}

export function getTask(db: Database, taskId: string) {
  const task = readTaskRecord(db, taskId);
  if (!task) return null;
  const sessionRows = readRows<{
    threadId: string;
    taskId: string;
    label: string | null;
    skillId: string | null;
    launchedBy: string;
    forkedFromThreadId: string | null;
    completed: number | boolean;
    rpiStatus: string;
    rpiStatusAt: number;
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
  }>(
    db,
    `
    SELECT
      thread_id AS threadId,
      task_id AS taskId,
      label,
      skill_id AS skillId,
      launched_by AS launchedBy,
      forked_from_thread_id AS forkedFromThreadId,
      completed,
      rpi_status AS rpiStatus,
      rpi_status_at AS rpiStatusAt,
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
    WHERE task_id = ?
    ORDER BY created_at ASC
    `,
    taskId,
  );
  const sessions: SessionRow[] = sessionRows.map((row) => ({
    ...row,
    completed: Boolean(row.completed),
    hadTurn: Boolean(row.hadTurn),
    interrupted: Boolean(row.interrupted),
    blockedReason: row.blockedReason === "question" || row.blockedReason === "plugin" ? row.blockedReason : null,
  }));
  const launchAttempts = readRows<{
    id: string;
    taskId: string;
    fromThreadId: string | null;
    skillId: string | null;
    commandLine: string | null;
    label: string | null;
    environmentRole: "base" | "worktree";
    launchedBy: string;
    status: "pending" | "spawned" | "uncertain" | "failed" | "retrying";
    threadId: string | null;
    retriedFrom: string | null;
    retryMarker: string | null;
    targetPhase: number | null;
    createdAt: number;
  }>(
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
      retried_from AS retriedFrom,
      retry_marker AS retryMarker,
      target_phase AS targetPhase,
      created_at AS createdAt
    FROM launch_attempts
    WHERE task_id = ?
    ORDER BY created_at ASC
    `,
    taskId,
  );
  const latestLabel = currentLabelFor(db, task);
  const workspace: TaskWorkspaceState = {
    taskId: task.id,
    projectId: task.projectId,
    hostId: task.hostId,
    baseEnvironmentId: task.baseEnvironmentId,
    worktreeEnvironmentId: task.worktreeEnvironmentId,
    defaultDirectory: task.defaultDirectory,
    workflowType: task.workflowType,
    worktreeTiming: task.worktreeTiming,
    permissionMode: task.permissionMode,
    autoAdvance: task.autoAdvance,
    hydratedAt: null,
    setupStatus: "pending",
    setupDetails: {},
    launchAttempts,
    currentLabel: latestLabel,
  };
  return { task, sessions, workspace };
}

export function createDraftTask(
  db: Database,
  input: {
    projectId: string;
    prompt: string;
    name?: string;
    hostId?: string | null;
    defaultDirectory?: string | null;
    workflowType: WorkflowType;
    worktreeTiming: "now" | "later" | "never";
    permissionMode?: string | null;
    autoAdvance: boolean;
    e2eMode?: boolean;
    providerId?: string | null;
    model?: string | null;
    reasoningLevel?: string | null;
    serviceTier?: string | null;
    baseEnvironmentId?: string | null;
    composerEnvironment?: TaskRecord["composerEnvironment"];
    parentTaskId?: string | null;
    position?: number | null;
  },
) {
  const createdAt = nowMs();
  const prompt = draftPromptFrom(input.prompt);
  const name = cleanName(input.name ?? defaultTaskNameFromPrompt(prompt));
  const create = transaction(db, () => {
    const slug = generateTaskSlug(db, name);
    const taskId = randomUUID();
    writeRow(
      db,
      `
      INSERT INTO tasks (
        id, project_id, name, slug, draft_prompt, workflow_type, worktree_timing,
        is_draft, archived, host_id, base_environment_id, worktree_environment_id,
        default_directory, provider_id, model, reasoning_level, service_tier,
        permission_mode, auto_advance, aa_questions_to_research,
        aa_research_to_design, aa_plan_to_worktree, aa_worktree_to_implementation,
        aa_implementation_to_pr, e2e_mode, composer_environment_json, parent_task_id, position,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 1, 1, 0, ?, ?, ?, ?, ?, ?)
      `,
      taskId,
      input.projectId,
      name,
      slug,
      prompt,
      input.workflowType,
      input.worktreeTiming,
      input.hostId ?? null,
      input.baseEnvironmentId ?? null,
      null,
      input.defaultDirectory ?? null,
      input.providerId ?? null,
      input.model ?? null,
      input.reasoningLevel ?? null,
      input.serviceTier ?? null,
      input.permissionMode ?? null,
      input.autoAdvance ? 1 : 0,
      input.e2eMode ? 1 : 0,
      input.composerEnvironment ? stringifyJson(input.composerEnvironment) : null,
      input.parentTaskId ?? null,
      input.position ?? null,
      createdAt,
      createdAt,
    );
    return taskId;
  });
  const taskId = create();
  upsertArtifact(db, taskId, "task.md", prompt, {
    createdBy: "task:create",
    operation: "create",
    contentType: mimeFor("task.md"),
  });
  return { taskId };
}

export function updateTask(
  db: Database,
  taskId: string,
  patch: {
    name?: string;
    workflowType?: WorkflowType;
    worktreeTiming?: "now" | "later" | "never";
    permissionMode?: string | null;
    autoAdvance?: boolean;
    archived?: boolean;
    completed?: boolean;
    hostId?: string | null;
    defaultDirectory?: string | null;
    providerId?: string | null;
    model?: string | null;
    reasoningLevel?: string | null;
    serviceTier?: string | null;
    draftPrompt?: string;
    projectId?: string;
    aa_questions_to_research?: boolean;
    aa_research_to_design?: boolean;
    aa_plan_to_worktree?: boolean;
    aa_worktree_to_implementation?: boolean;
    aa_implementation_to_pr?: boolean;
    e2eMode?: boolean;
    phaseModels?: PhaseModels | null;
    epicPaused?: boolean;
    maxParallel?: number | null;
    dependsOn?: string[];
  },
) {
  const task = readTaskRecord(db, taskId);
  if (!task) return null;
  const nextName = patch.name !== undefined ? cleanName(patch.name) : task.name;
  const nextUpdatedAt = nowMs();
  // undefined keeps the stored JSON, null clears every entry, an object replaces it wholesale.
  const nextPhaseModelsJson =
    patch.phaseModels === undefined
      ? stringifyJson(task.phaseModels)
      : patch.phaseModels === null
        ? null
        : stringifyJson(patch.phaseModels);
  // An explicit host or directory edit overrides the composer's environment intent; otherwise the
  // stored intent rides along untouched.
  const nextComposerEnvironmentJson =
    patch.hostId !== undefined || patch.defaultDirectory !== undefined
      ? null
      : task.composerEnvironment
        ? stringifyJson(task.composerEnvironment)
        : null;
  writeRow(
    db,
    `
    UPDATE tasks
    SET
      name = ?,
      draft_prompt = ?,
      workflow_type = ?,
      worktree_timing = ?,
      archived = ?,
      completed = ?,
      host_id = ?,
      default_directory = ?,
      provider_id = ?,
      model = ?,
      reasoning_level = ?,
      service_tier = ?,
      permission_mode = ?,
      auto_advance = ?,
      aa_questions_to_research = ?,
      aa_research_to_design = ?,
      aa_plan_to_worktree = ?,
      aa_worktree_to_implementation = ?,
      aa_implementation_to_pr = ?,
      e2e_mode = ?,
      phase_models = ?,
      composer_environment_json = ?,
      epic_paused = ?,
      max_parallel = ?,
      depends_on_json = ?,
      project_id = ?,
      updated_at = ?
    WHERE id = ?
    `,
    nextName,
    patch.draftPrompt !== undefined ? draftPromptFrom(patch.draftPrompt) : task.draftPrompt,
    patch.workflowType ?? task.workflowType,
    patch.worktreeTiming ?? task.worktreeTiming,
    patch.archived !== undefined ? (patch.archived ? 1 : 0) : task.archived ? 1 : 0,
    patch.completed !== undefined ? (patch.completed ? 1 : 0) : task.completed ? 1 : 0,
    patch.hostId !== undefined ? patch.hostId : task.hostId,
    patch.defaultDirectory !== undefined ? patch.defaultDirectory : task.defaultDirectory,
    patch.providerId !== undefined ? patch.providerId : task.providerId,
    patch.model !== undefined ? patch.model : task.model,
    patch.reasoningLevel !== undefined ? patch.reasoningLevel : task.reasoningLevel,
    patch.serviceTier !== undefined ? patch.serviceTier : task.serviceTier,
    patch.permissionMode !== undefined ? patch.permissionMode : task.permissionMode,
    patch.autoAdvance !== undefined ? (patch.autoAdvance ? 1 : 0) : task.autoAdvance ? 1 : 0,
    patch.aa_questions_to_research !== undefined ? (patch.aa_questions_to_research ? 1 : 0) : task.aa_questions_to_research ? 1 : 0,
    patch.aa_research_to_design !== undefined ? (patch.aa_research_to_design ? 1 : 0) : task.aa_research_to_design ? 1 : 0,
    patch.aa_plan_to_worktree !== undefined ? (patch.aa_plan_to_worktree ? 1 : 0) : task.aa_plan_to_worktree ? 1 : 0,
    patch.aa_worktree_to_implementation !== undefined ? (patch.aa_worktree_to_implementation ? 1 : 0) : task.aa_worktree_to_implementation ? 1 : 0,
    patch.aa_implementation_to_pr !== undefined ? (patch.aa_implementation_to_pr ? 1 : 0) : task.aa_implementation_to_pr ? 1 : 0,
    patch.e2eMode !== undefined ? (patch.e2eMode ? 1 : 0) : task.e2eMode ? 1 : 0,
    nextPhaseModelsJson,
    nextComposerEnvironmentJson,
    patch.epicPaused !== undefined ? (patch.epicPaused ? 1 : 0) : task.epicPaused ? 1 : 0,
    patch.maxParallel !== undefined ? patch.maxParallel : task.maxParallel,
    patch.dependsOn !== undefined ? stringifyJson(patch.dependsOn) : task.dependsOn.length > 0 ? stringifyJson(task.dependsOn) : null,
    patch.projectId ?? task.projectId,
    nextUpdatedAt,
    taskId,
  );
  return readTaskRecord(db, taskId) ?? null;
}

function updateTaskDraftState(db: Database, taskId: string, isDraft: boolean) {
  writeRow(
    db,
    `
    UPDATE tasks
    SET is_draft = ?, updated_at = ?
    WHERE id = ?
    `,
    isDraft ? 1 : 0,
    nowMs(),
    taskId,
  );
}

// An epic's children archive with it: a child under an archived epic has no table, board, or
// sidebar group left to appear in.
export function archiveTask(db: Database, taskId: string) {
  return db.transaction(() => {
    for (const child of readRows<{ id: string }>(db, "SELECT id FROM tasks WHERE parent_task_id = ? AND archived = 0", taskId)) {
      updateTask(db, child.id, { archived: true });
    }
    return updateTask(db, taskId, { archived: true });
  })();
}

export function deleteTask(db: Database, taskId: string) {
  return db.transaction(() => {
    const task = readTaskRecord(db, taskId);
    if (!task) return false;
    if (readRow(db, "SELECT 1 FROM launch_attempts WHERE task_id = ? AND status IN ('pending', 'uncertain', 'retrying')", taskId)) {
      throw new Error("Resolve pending task launches before deleting the task.");
    }
    if (readRow(db, "SELECT 1 FROM sessions WHERE task_id = ? AND thread_archived_at IS NULL AND rpi_status IN ('running', 'launching', 'resuming', 'waiting_for_workspace', 'interrupt_requested')", taskId)) {
      throw new Error("Stop running sessions before deleting the task.");
    }
    if (hasChildren(db, taskId)) {
      throw new Error("Delete the epic's child tasks first, or archive the epic instead.");
    }
    for (const table of ["send_receipts", "comments", "artifact_versions"]) {
      writeRow(db, `DELETE FROM ${table} WHERE artifact_id IN (SELECT id FROM artifacts WHERE task_id = ?)`, taskId);
    }
    for (const table of ["notifications", "notification_suppressions"]) {
      writeRow(db, `DELETE FROM ${table} WHERE thread_id IN (SELECT thread_id FROM sessions WHERE task_id = ? UNION SELECT thread_id FROM child_threads WHERE task_id = ?)`, taskId, taskId);
    }
    for (const table of ["artifacts", "mirror_state", "scratch_pads", "task_ui_state", "child_threads", "launch_attempts", "sessions"]) {
      writeRow(db, `DELETE FROM ${table} WHERE task_id = ?`, taskId);
    }
    writeRow(db, "INSERT OR IGNORE INTO deleted_task_slugs (slug) VALUES (?)", task.slug);
    writeRow(db, "DELETE FROM tasks WHERE id = ?", taskId);
    return true;
  })();
}

export function taskColumnForRow(row: Pick<TaskRow, "currentLabel" | "isDraft">) {
  return deriveBoardColumn(row.currentLabel, row.isDraft);
}

export function listRecentDrafts(db: Database, limit = 5) {
  return listTasks(db, { archived: false }).filter((task) => task.isDraft).slice(0, limit);
}

// Precedence for one execution field at task creation: an explicit request value (including an
// explicit `null`, i.e. "clear this") always wins; an omitted (`undefined`) request field falls
// through to that workflow type's stored default, then to the workflow-agnostic global default.
// serviceTier and permissionMode's workflow tier only cover the fields workflowOverrideSchema
// actually declares (permissionMode has no global-default counterpart, so it stops at the
// fallback argument instead).
function resolveField<T>(explicit: T | null | undefined, workflowValue: T | null | undefined, globalValue: T | null | undefined, fallback: T | null = null): T | null {
  if (explicit !== undefined) return explicit;
  if (workflowValue !== undefined) return workflowValue;
  return globalValue ?? fallback;
}

export function resolveTaskExecutionDefaults(
  request: {
    providerId?: string | null;
    model?: string | null;
    reasoningLevel?: string | null;
    serviceTier?: string | null;
    permissionMode?: string | null;
  },
  workflowType: WorkflowType,
  prefs: Prefs,
): {
  providerId: string | null;
  model: string | null;
  reasoningLevel: string | null;
  serviceTier: string | null;
  permissionMode: string | null;
} {
  const workflowDefault = prefs.workflowDefaults[workflowType] ?? {};
  return {
    providerId: resolveField(request.providerId, workflowDefault.providerId, prefs.defaults.providerId),
    model: resolveField(request.model, workflowDefault.model, prefs.defaults.model),
    reasoningLevel: resolveField(request.reasoningLevel, workflowDefault.reasoningLevel, prefs.defaults.reasoningLevel),
    // workflowOverrideSchema has no serviceTier override; only the global default applies.
    serviceTier: resolveField(request.serviceTier, undefined, prefs.defaults.serviceTier),
    // permissionMode has no global default in prefsDefaultsSchema; the resolved fallback is
    // "default" (no override) rather than null so a freshly created task never lands on a
    // meaningless bare null.
    permissionMode: resolveField(request.permissionMode, workflowDefault.permissionMode, undefined, "default"),
  };
}

export function defaultTaskPrefs(input: {
  providerId?: string | null;
  model?: string | null;
  researchModel?: string | null;
  reasoningLevel?: string | null;
  serviceTier?: string | null;
}): Prefs {
  return {
    defaults: {
      providerId: input.providerId ?? null,
      model: input.model ?? null,
      researchModel: input.researchModel ?? null,
      reasoningLevel: input.reasoningLevel ?? null,
      serviceTier: input.serviceTier ?? null,
    },
    workflowDefaults: {},
    notifications: {
      enabled: true,
      sound: { ready_for_input: true, needs_approval: true, comment: true },
      toast: { ready_for_input: true, needs_approval: true, comment: true },
      volume: 0.2,
      jumpHotkey: "mod+shift+u",
    },
    contextWarning: { defaultThreshold: DEFAULT_CONTEXT_THRESHOLD, rules: [], removedBuiltins: [] },
    e2e: DEFAULT_E2E_PREFS,
  };
}
