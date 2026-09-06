import { randomUUID } from "node:crypto";
import type * as BetterSqlite3 from "better-sqlite3";
import { nowMs, readRow, readRows, transaction, writeRow } from "./db";
import { mimeFor, upsertArtifact } from "./artifacts";
import { deriveBoardColumn, labelToStepLabel } from "./transitions";
import { DEFAULT_CONTEXT_THRESHOLD } from "./context-threshold";
import type {
  Prefs,
  SessionRow,
  TaskRecord,
  TaskRow,
  TaskWorkspaceState,
  WorkflowType,
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
  createdAt: number;
  updatedAt: number;
};

function normalizeTaskRecord(row: RawTaskRecord): TaskRecord {
  return {
    ...row,
    isDraft: Boolean(row.isDraft),
    archived: Boolean(row.archived),
    autoAdvance: Boolean(row.autoAdvance),
    aa_questions_to_research: Boolean(row.aa_questions_to_research),
    aa_research_to_design: Boolean(row.aa_research_to_design),
    aa_plan_to_worktree: Boolean(row.aa_plan_to_worktree),
    aa_worktree_to_implementation: Boolean(row.aa_worktree_to_implementation),
    aa_implementation_to_pr: Boolean(row.aa_implementation_to_pr),
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
  const row = readRow<RawTaskRecord>(
    db,
    `
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
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM tasks
    WHERE id = ?
    `,
    taskId,
  );
  return row ? normalizeTaskRecord(row) : undefined;
}

function readSessionCount(db: Database, taskId: string) {
  const row = readRow<{ count: number }>(db, "SELECT COUNT(*) AS count FROM sessions WHERE task_id = ?", taskId);
  return row?.count ?? 0;
}

function readLatestLabel(db: Database, taskId: string) {
  const row = readRow<{ label: string | null }>(
    db,
    "SELECT label FROM sessions WHERE task_id = ? ORDER BY created_at DESC, thread_id DESC LIMIT 1",
    taskId,
  );
  return row?.label ?? null;
}

function readAttentionCount(db: Database, taskId: string) {
  return readRow<{ count: number }>(
    db,
    "SELECT COUNT(*) AS count FROM sessions WHERE task_id = ? AND rpi_status IN ('ready_for_input', 'needs_approval')",
    taskId,
  )?.count ?? 0;
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
    currentLabel: latestLabel,
    stepLabel: record.isDraft ? "Draft" : latestLabel ? labelToStepLabel(latestLabel, false) : record.workflowType,
    attentionCount,
    boardColumn: record.isDraft || latestLabel ? deriveBoardColumn(latestLabel, record.isDraft) : "implementation",
    sessionCount,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function generateTaskSlug(db: Database, name: string) {
  const base = normalizeSlugPart(name);
  const rows = readRows<{ slug: string }>(db, "SELECT slug FROM tasks WHERE slug = ? OR slug LIKE ?", base, `${base}-%`);
  const used = new Set(rows.map((row) => row.slug));
  if (!used.has(base)) return base;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
}

export function listTasks(
  db: Database,
  filters: { projectId?: string | null; archived?: boolean | null } = {},
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
  const sql = `
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
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM tasks
    ${clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : ""}
    ORDER BY updated_at DESC, created_at DESC
  `;
  const records = readRows<RawTaskRecord>(db, sql, ...params).map(normalizeTaskRecord);
  return records.map((record) => taskRowFromRecord(record, readSessionCount(db, record.id), readLatestLabel(db, record.id), readAttentionCount(db, record.id)));
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
      created_at AS createdAt
    FROM launch_attempts
    WHERE task_id = ?
    ORDER BY created_at ASC
    `,
    taskId,
  );
  const latestLabel = readLatestLabel(db, taskId);
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
    providerId?: string | null;
    model?: string | null;
    reasoningLevel?: string | null;
    serviceTier?: string | null;
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
        aa_implementation_to_pr, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 1, 1, 0, ?, ?)
      `,
      taskId,
      input.projectId,
      name,
      slug,
      prompt,
      input.workflowType,
      input.worktreeTiming,
      input.hostId ?? null,
      null,
      null,
      input.defaultDirectory ?? null,
      input.providerId ?? null,
      input.model ?? null,
      input.reasoningLevel ?? null,
      input.serviceTier ?? null,
      input.permissionMode ?? null,
      input.autoAdvance ? 1 : 0,
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
  },
) {
  const task = readTaskRecord(db, taskId);
  if (!task) return null;
  const nextName = patch.name !== undefined ? cleanName(patch.name) : task.name;
  const nextUpdatedAt = nowMs();
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
      project_id = ?,
      updated_at = ?
    WHERE id = ?
    `,
    nextName,
    patch.draftPrompt !== undefined ? draftPromptFrom(patch.draftPrompt) : task.draftPrompt,
    patch.workflowType ?? task.workflowType,
    patch.worktreeTiming ?? task.worktreeTiming,
    patch.archived !== undefined ? (patch.archived ? 1 : 0) : task.archived ? 1 : 0,
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

export function archiveTask(db: Database, taskId: string) {
  return updateTask(db, taskId, { archived: true });
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
  };
}
