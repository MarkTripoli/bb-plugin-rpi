import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const workflowTypeSchema = z.enum(["rpi", "outline_only", "prd_tdd", "oneshot", "freeform"]);
export type WorkflowType = z.infer<typeof workflowTypeSchema>;

export const composerWorkflowTypeSchema = z.enum(["rpi", "prd_tdd", "freeform"]);

export const worktreeTimingSchema = z.enum(["now", "later", "never"]);
export const permissionModeSchema = z.enum(["default", "accept_edits", "auto", "bypass"]);

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
    nextStepJson: z.string().nullable(),
    summaryJson: z.string().nullable(),
    advancedAt: z.number().int().nullable(),
    hydratedAt: z.number().int().nullable(),
    createdAt: z.number().int(),
    updatedAt: z.number().int(),
  })
  .strict();
export type SessionRow = z.infer<typeof sessionRowSchema>;

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
    launchAttempts: z.array(
      z
        .object({
          id: z.string(),
          taskId: z.string(),
          fromThreadId: z.string().nullable(),
          skillId: z.string().nullable(),
          status: z.enum(["pending", "spawned", "uncertain", "failed"]),
          threadId: z.string().nullable(),
          createdAt: z.number().int(),
        })
        .strict(),
    ),
    currentLabel: z.string().nullable(),
  })
  .strict();
export type TaskWorkspaceState = z.infer<typeof workspaceStateSchema>;

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
    output: z.object({ taskId: z.string(), note: z.string().optional() }).strict(),
  },
  updateTask: {
    input: taskUpdateInputSchema,
    output: z.object({ task: taskRecordSchema.nullable() }).strict(),
  },
  archiveTask: {
    input: archiveTaskInputSchema,
    output: z.object({ task: taskRecordSchema.nullable() }).strict(),
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
