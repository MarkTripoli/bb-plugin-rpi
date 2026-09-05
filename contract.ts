import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const workflowTypeSchema = z.enum(["rpi", "outline_only", "prd_tdd", "oneshot", "freeform"]);
export type WorkflowType = z.infer<typeof workflowTypeSchema>;

export const composerWorkflowTypeSchema = z.enum(["rpi", "prd_tdd", "oneshot", "freeform"]);

export const worktreeTimingSchema = z.enum(["now", "later", "never"]);
export const permissionModeSchema = z.enum(["default", "accept_edits", "auto", "bypass"]);
const ARTIFACT_TEXT_LIMIT = 10 * 1024 * 1024;

export const taskRowSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    name: z.string(),
    slug: z.string(),
    draftPrompt: z.string(),
    workflowType: workflowTypeSchema,
    worktreeTiming: worktreeTimingSchema,
    isDraft: z.boolean(),
    archived: z.boolean(),
    hostId: z.string().nullable(),
    baseEnvironmentId: z.string().nullable(),
    worktreeEnvironmentId: z.string().nullable(),
    defaultDirectory: z.string().nullable(),
    providerId: z.string().nullable(),
    model: z.string().nullable(),
    reasoningLevel: z.string().nullable(),
    serviceTier: z.string().nullable(),
    permissionMode: permissionModeSchema.nullable(),
    autoAdvance: z.boolean(),
    aa_questions_to_research: z.boolean(),
    aa_research_to_design: z.boolean(),
    aa_plan_to_worktree: z.boolean(),
    aa_worktree_to_implementation: z.boolean(),
    aa_implementation_to_pr: z.boolean(),
    currentLabel: z.string().nullable(),
    stepLabel: z.string(),
    boardColumn: z.enum(["todo_draft", "research_design", "planning", "implementation"]),
    sessionCount: z.number().int().nonnegative(),
    createdAt: z.number().int(),
    updatedAt: z.number().int(),
  })
  .strict();
export type TaskRow = z.infer<typeof taskRowSchema>;

export const taskRecordSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    name: z.string(),
    slug: z.string(),
    draftPrompt: z.string(),
    workflowType: workflowTypeSchema,
    worktreeTiming: worktreeTimingSchema,
    isDraft: z.boolean(),
    archived: z.boolean(),
    hostId: z.string().nullable(),
    baseEnvironmentId: z.string().nullable(),
    worktreeEnvironmentId: z.string().nullable(),
    defaultDirectory: z.string().nullable(),
    providerId: z.string().nullable(),
    model: z.string().nullable(),
    reasoningLevel: z.string().nullable(),
    serviceTier: z.string().nullable(),
    permissionMode: permissionModeSchema.nullable(),
    autoAdvance: z.boolean(),
    aa_questions_to_research: z.boolean(),
    aa_research_to_design: z.boolean(),
    aa_plan_to_worktree: z.boolean(),
    aa_worktree_to_implementation: z.boolean(),
    aa_implementation_to_pr: z.boolean(),
    createdAt: z.number().int(),
    updatedAt: z.number().int(),
  })
  .strict();
export type TaskRecord = z.infer<typeof taskRecordSchema>;

export const sessionRowSchema = z
  .object({
    threadId: z.string(),
    taskId: z.string(),
    label: z.string().nullable(),
    skillId: z.string().nullable(),
    launchedBy: z.string(),
    forkedFromThreadId: z.string().nullable(),
    hlStatus: z.string(),
    hlStatusAt: z.number().int(),
    hadTurn: z.boolean(),
    interrupted: z.boolean(),
    blockedReason: z.enum(["question", "plugin"]).nullable(),
    nextStepJson: z.string().nullable(),
    summaryJson: z.string().nullable(),
    advancedAt: z.number().int().nullable(),
    hydratedAt: z.number().int().nullable(),
    lastReconcileSeq: z.number().int(),
    lastSummarizedTurnKey: z.string().nullable(),
    completedTurnKey: z.string().nullable(),
    createdAt: z.number().int(),
    updatedAt: z.number().int(),
  })
  .strict();
export type SessionRow = z.infer<typeof sessionRowSchema>;

export const launchAttemptRowSchema = z
  .object({
    id: z.string(),
    taskId: z.string(),
    fromThreadId: z.string().nullable(),
    skillId: z.string().nullable(),
    status: z.enum(["pending", "spawned", "uncertain", "failed"]),
    threadId: z.string().nullable(),
    createdAt: z.number().int(),
  })
  .strict();
export type LaunchAttemptRecord = z.infer<typeof launchAttemptRowSchema>;

export const sessionViewSchema = sessionRowSchema
  .extend({
    title: z.string().nullable(),
    workingDirectory: z.string().nullable(),
    threadUpdatedAt: z.number().int().nullable(),
  })
  .strict();
export type SessionView = z.infer<typeof sessionViewSchema>;

export const workspaceStateSchema = z
  .object({
    taskId: z.string(),
    projectId: z.string(),
    hostId: z.string().nullable(),
    baseEnvironmentId: z.string().nullable(),
    worktreeEnvironmentId: z.string().nullable(),
    defaultDirectory: z.string().nullable(),
    workflowType: workflowTypeSchema,
    worktreeTiming: worktreeTimingSchema,
    permissionMode: permissionModeSchema.nullable(),
    autoAdvance: z.boolean(),
    hydratedAt: z.number().int().nullable(),
    setupStatus: z.enum(["pending", "in_progress", "completed", "failed"]),
    setupDetails: z.record(z.string(), z.any()),
    launchAttempts: z.array(launchAttemptRowSchema),
    currentLabel: z.string().nullable(),
  })
  .strict();
export type TaskWorkspaceState = z.infer<typeof workspaceStateSchema>;

export const artifactGroupSchema = z.enum([
  "research-questions",
  "research",
  "design-discussion",
  "prd",
  "tdd",
  "structure-outline",
  "plan",
  "pr-description",
  "other",
]);

export const artifactRowSchema = z
  .object({
    id: z.string(),
    taskId: z.string(),
    fileName: z.string(),
    frontmatter: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
    contentType: z.string(),
    isDeleted: z.boolean(),
    currentVersion: z.number().int().nonnegative(),
    currentSha256: z.string().nullable(),
    sizeBytes: z.number().int().nonnegative(),
    type: z.string(),
    groupType: artifactGroupSchema,
    commentCount: z.number().int().nonnegative(),
    createdAt: z.number().int(),
    updatedAt: z.number().int(),
  })
  .strict();
export type ArtifactRecord = z.infer<typeof artifactRowSchema>;

export const artifactVersionSchema = z
  .object({
    id: z.string(),
    artifactId: z.string(),
    version: z.number().int().positive(),
    sha256: z.string(),
    sizeBytes: z.number().int().nonnegative(),
    createdBy: z.string(),
    operation: z.string().nullable(),
    createdAt: z.number().int(),
  })
  .strict();
export type ArtifactVersionRecord = z.infer<typeof artifactVersionSchema>;

export const taskCreateRequestSchema = z
  .object({
    text: z.string().trim().max(10000),
    projectId: z.string().min(1),
    hostId: z.string().min(1).nullable().optional(),
    defaultDirectory: z.string().trim().min(1).nullable().optional(),
    workflowType: composerWorkflowTypeSchema.default("rpi"),
    worktreeTiming: worktreeTimingSchema.default("later"),
    permissionMode: permissionModeSchema.default("default"),
    autoAdvance: z.boolean().default(false),
  })
  .strict();

export const taskCreateInputSchema = z
  .object({
    request: taskCreateRequestSchema,
    name: z.string().trim().min(1).max(200).optional(),
    draft: z.boolean().default(true),
  })
  .strict();

export const taskUpdateInputSchema = z
  .object({
    taskId: z.string().min(1),
    patch: z
      .object({
        name: z.string().trim().min(1).max(200).optional(),
        workflowType: workflowTypeSchema.optional(),
        worktreeTiming: worktreeTimingSchema.optional(),
        permissionMode: permissionModeSchema.nullable().optional(),
        autoAdvance: z.boolean().optional(),
        archived: z.boolean().optional(),
        hostId: z.string().min(1).nullable().optional(),
        defaultDirectory: z.string().trim().min(1).nullable().optional(),
        providerId: z.string().nullable().optional(),
        model: z.string().nullable().optional(),
        reasoningLevel: z.string().nullable().optional(),
        serviceTier: z.string().nullable().optional(),
        draftPrompt: z.string().trim().max(10000).optional(),
        projectId: z.string().min(1).optional(),
        aa_questions_to_research: z.boolean().optional(),
        aa_research_to_design: z.boolean().optional(),
        aa_plan_to_worktree: z.boolean().optional(),
        aa_worktree_to_implementation: z.boolean().optional(),
        aa_implementation_to_pr: z.boolean().optional(),
      })
      .strict(),
  })
  .strict();

const prefsDefaultsSchema = z
  .object({
    providerId: z.string().nullable().optional(),
    model: z.string().nullable().optional(),
    reasoningLevel: z.string().nullable().optional(),
    serviceTier: z.string().nullable().optional(),
  })
  .strict();

export const prefsSchema = z
  .object({
    defaults: prefsDefaultsSchema,
  })
  .strict();
export type Prefs = z.infer<typeof prefsSchema>;

export const prefsUpdateSchema = z
  .object({
    defaults: prefsDefaultsSchema.partial().optional(),
  })
  .strict();

export const projectRowSchema = z
  .object({
    id: z.string(),
    name: z.string(),
  })
  .strict();

export const hostRowSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    status: z.string(),
  })
  .strict();

export const listTasksInputSchema = z
  .object({
    projectId: z.string().nullable().optional(),
    archived: z.boolean().nullable().optional(),
  })
  .strict();

export const getTaskInputSchema = z.object({ taskId: z.string().min(1) }).strict();
export const archiveTaskInputSchema = z.object({ taskId: z.string().min(1) }).strict();
export const launchDraftInputSchema = z.object({ taskId: z.string().min(1) }).strict();
export const listSessionsInputSchema = z.object({ taskId: z.string().min(1).nullable().optional() }).strict();
export const getSessionInputSchema = z.object({ threadId: z.string().min(1) }).strict();
export const forkSessionInputSchema = z
  .object({ threadId: z.string().min(1), text: z.string().max(10000).nullable().optional() })
  .strict();
export const interruptSessionInputSchema = z.object({ threadId: z.string().min(1) }).strict();
export const listLaunchAttemptsInputSchema = z.object({ taskId: z.string().min(1) }).strict();
export const resolveLaunchAttemptInputSchema = z
  .object({
    id: z.string().min(1),
    action: z.discriminatedUnion("type", [
      z.object({ type: z.literal("adopt"), threadId: z.string().min(1) }).strict(),
      z.object({ type: z.literal("retry") }).strict(),
      z.object({ type: z.literal("dismiss") }).strict(),
    ]),
  })
  .strict();
export const artifactFileInputSchema = z.object({ taskId: z.string().min(1), fileName: z.string().min(1) }).strict();
export const getArtifactInputSchema = artifactFileInputSchema.extend({ version: z.number().int().positive().nullable().optional() }).strict();
export const saveArtifactInputSchema = artifactFileInputSchema.extend({ content: z.string().max(ARTIFACT_TEXT_LIMIT) }).strict();
export const listArtifactsInputSchema = z.object({ taskId: z.string().min(1), includeDeleted: z.boolean().optional() }).strict();
export const artifactTaskInputSchema = z.object({ taskId: z.string().min(1) }).strict();

export const rpcContract = defineRpcContract({
  listTasks: {
    input: listTasksInputSchema,
    output: z.object({ tasks: z.array(taskRowSchema) }).strict(),
  },
  getTask: {
    input: getTaskInputSchema,
    output: z.object({ task: taskRecordSchema, sessions: z.array(sessionRowSchema), workspace: workspaceStateSchema }).strict(),
  },
  createTask: {
    input: taskCreateInputSchema,
    output: z.object({ taskId: z.string(), threadId: z.string().optional(), note: z.string().optional() }).strict(),
  },
  updateTask: {
    input: taskUpdateInputSchema,
    output: z.object({ task: taskRecordSchema.nullable() }).strict(),
  },
  archiveTask: {
    input: archiveTaskInputSchema,
    output: z.object({ task: taskRecordSchema.nullable() }).strict(),
  },
  launchDraft: {
    input: launchDraftInputSchema,
    output: z.object({ threadId: z.string() }).strict(),
  },
  listSessions: {
    input: listSessionsInputSchema,
    output: z.object({ sessions: z.array(sessionViewSchema) }).strict(),
  },
  getSession: {
    input: getSessionInputSchema,
    output: z.object({ session: sessionViewSchema.nullable() }).strict(),
  },
  forkSession: {
    input: forkSessionInputSchema,
    output: z.object({ threadId: z.string() }).strict(),
  },
  interruptSession: {
    input: interruptSessionInputSchema,
    output: z.object({ ok: z.literal(true) }).strict(),
  },
  listLaunchAttempts: {
    input: listLaunchAttemptsInputSchema,
    output: z.object({ attempts: z.array(launchAttemptRowSchema) }).strict(),
  },
  resolveLaunchAttempt: {
    input: resolveLaunchAttemptInputSchema,
    output: z.object({ threadId: z.string().nullable().optional() }).strict(),
  },
  listArtifacts: {
    input: listArtifactsInputSchema,
    output: z.object({ artifacts: z.array(artifactRowSchema) }).strict(),
  },
  getArtifact: {
    input: getArtifactInputSchema,
    output: z
      .object({
        artifact: artifactRowSchema.nullable(),
        version: artifactVersionSchema.nullable(),
        content: z.string().nullable(),
        isBinary: z.boolean(),
        url: z.string().nullable(),
      })
      .strict(),
  },
  listArtifactVersions: {
    input: artifactFileInputSchema,
    output: z.object({ versions: z.array(artifactVersionSchema) }).strict(),
  },
  saveArtifact: {
    input: saveArtifactInputSchema,
    output: z.object({ artifact: artifactRowSchema, version: z.number().int().positive(), permalink: z.string() }).strict(),
  },
  deleteArtifact: {
    input: artifactFileInputSchema,
    output: z.object({ artifact: artifactRowSchema.nullable() }).strict(),
  },
  restoreArtifact: {
    input: artifactFileInputSchema,
    output: z.object({ artifact: artifactRowSchema.nullable() }).strict(),
  },
  hydrateNow: {
    input: artifactTaskInputSchema,
    output: z.object({ written: z.number().int().nonnegative(), skipped: z.number().int().nonnegative(), trashed: z.number().int().nonnegative() }).strict(),
  },
  ingestNow: {
    input: artifactTaskInputSchema,
    output: z.object({ ingested: z.number().int().nonnegative(), skipped: z.number().int().nonnegative() }).strict(),
  },
  listProjects: {
    input: z
      .object({
        includePersonal: z.boolean().optional(),
      })
      .strict(),
    output: z.array(projectRowSchema),
  },
  listHosts: {
    input: z.object({}).strict(),
    output: z.array(hostRowSchema),
  },
  getPrefs: {
    input: z.object({}).strict(),
    output: prefsSchema,
  },
  setPrefs: {
    input: prefsUpdateSchema,
    output: prefsSchema,
  },
});

export type RpcContract = typeof rpcContract;
