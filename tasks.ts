import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { nowMs, readRow, readRows, transaction, writeRow } from "./db";
import { deriveBoardColumn, labelToStepLabel } from "./transitions";
import type {
  Prefs,
  SessionRow,
  TaskRecord,
  TaskRow,
  TaskWorkspaceState,
  WorkflowType,
} from "./contract";

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
  defaultDirectory: string | null;
  providerId: string | null;
  model: string | null;
  reasoningLevel: string | null;
  serviceTier: string | null;
  permissionMode: string | null;
  autoAdvance: number | boolean;
  createdAt: number;
  updatedAt: number;
};

function normalizeTaskRecord(row: RawTaskRecord): TaskRecord {
  return {
    ...row,
    isDraft: Boolean(row.isDraft),
    archived: Boolean(row.archived),
    autoAdvance: Boolean(row.autoAdvance),
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
      default_directory AS defaultDirectory,
      provider_id AS providerId,
      model,
      reasoning_level AS reasoningLevel,
      service_tier AS serviceTier,
      permission_mode AS permissionMode,
      auto_advance AS autoAdvance,
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

function taskRowFromRecord(record: TaskRecord, sessionCount: number, latestLabel: string | null): TaskRow {
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
    defaultDirectory: record.defaultDirectory,
    providerId: record.providerId,
    model: record.model,
    reasoningLevel: record.reasoningLevel,
    serviceTier: record.serviceTier,
    permissionMode: record.permissionMode,
    autoAdvance: record.autoAdvance,
    currentLabel: latestLabel,
    stepLabel: labelToStepLabel(latestLabel, record.isDraft),
    boardColumn: deriveBoardColumn(latestLabel, record.isDraft),
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
      default_directory AS defaultDirectory,
      provider_id AS providerId,
      model,
      reasoning_level AS reasoningLevel,
      service_tier AS serviceTier,
      permission_mode AS permissionMode,
      auto_advance AS autoAdvance,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM tasks
    ${clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : ""}
    ORDER BY updated_at DESC, created_at DESC
  `;
  const records = readRows<RawTaskRecord>(db, sql, ...params).map(normalizeTaskRecord);
  return records.map((record) => taskRowFromRecord(record, readSessionCount(db, record.id), readLatestLabel(db, record.id)));
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
    hlStatus: string;
    hlStatusAt: number;
    hadTurn: number | boolean;
    interrupted: number | boolean;
    nextStepJson: string | null;
    summaryJson: string | null;
    advancedAt: number | null;
    hydratedAt: number | null;
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
      hl_status AS hlStatus,
      hl_status_at AS hlStatusAt,
      had_turn AS hadTurn,
      interrupted,
      next_step_json AS nextStepJson,
      summary_json AS summaryJson,
      advanced_at AS advancedAt,
      hydrated_at AS hydratedAt,
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
  }));
  const latestLabel = readLatestLabel(db, taskId);
  const workspace: TaskWorkspaceState = {
    taskId: task.id,
    projectId: task.projectId,
    hostId: task.hostId,
    defaultDirectory: task.defaultDirectory,
    workflowType: task.workflowType,
    worktreeTiming: task.worktreeTiming,
    permissionMode: task.permissionMode,
    autoAdvance: task.autoAdvance,
    hydratedAt: null,
    setupStatus: "pending",
    setupDetails: {},
    worktreeEnvironmentId: null,
    launchAttempts: [],
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
        is_draft, archived, host_id, default_directory, provider_id, model,
        reasoning_level, service_tier, permission_mode, auto_advance,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      taskId,
      input.projectId,
      name,
      slug,
      prompt,
      input.workflowType,
      input.worktreeTiming,
      input.hostId ?? null,
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
  return { taskId: create() };
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
    isDraft?: boolean;
  },
) {
  const task = readTaskRecord(db, taskId);
  if (!task) return null;
  const nextName = patch.name !== undefined ? cleanName(patch.name) : task.name;
  const nextSlug = patch.name !== undefined ? generateTaskSlug(db, nextName) : task.slug;
  const nextUpdatedAt = nowMs();
  writeRow(
    db,
    `
    UPDATE tasks
    SET
      name = ?,
      slug = ?,
      draft_prompt = ?,
      workflow_type = ?,
      worktree_timing = ?,
      is_draft = ?,
      archived = ?,
      host_id = ?,
      default_directory = ?,
      provider_id = ?,
      model = ?,
      reasoning_level = ?,
      service_tier = ?,
      permission_mode = ?,
      auto_advance = ?,
      project_id = ?,
      updated_at = ?
    WHERE id = ?
    `,
    nextName,
    nextSlug,
    patch.draftPrompt !== undefined ? draftPromptFrom(patch.draftPrompt) : task.draftPrompt,
    patch.workflowType ?? task.workflowType,
    patch.worktreeTiming ?? task.worktreeTiming,
    patch.isDraft !== undefined ? (patch.isDraft ? 1 : 0) : task.isDraft ? 1 : 0,
    patch.archived !== undefined ? (patch.archived ? 1 : 0) : task.archived ? 1 : 0,
    patch.hostId !== undefined ? patch.hostId : task.hostId,
    patch.defaultDirectory !== undefined ? patch.defaultDirectory : task.defaultDirectory,
    patch.providerId !== undefined ? patch.providerId : task.providerId,
    patch.model !== undefined ? patch.model : task.model,
    patch.reasoningLevel !== undefined ? patch.reasoningLevel : task.reasoningLevel,
    patch.serviceTier !== undefined ? patch.serviceTier : task.serviceTier,
    patch.permissionMode !== undefined ? patch.permissionMode : task.permissionMode,
    patch.autoAdvance !== undefined ? (patch.autoAdvance ? 1 : 0) : task.autoAdvance ? 1 : 0,
    patch.projectId ?? task.projectId,
    nextUpdatedAt,
    taskId,
  );
  return readTaskRecord(db, taskId) ?? null;
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

export function defaultTaskPrefs(input: {
  providerId?: string | null;
  model?: string | null;
  reasoningLevel?: string | null;
  serviceTier?: string | null;
}): Prefs {
  return {
    defaults: {
      providerId: input.providerId ?? null,
      model: input.model ?? null,
      reasoningLevel: input.reasoningLevel ?? null,
      serviceTier: input.serviceTier ?? null,
    },
  };
}
