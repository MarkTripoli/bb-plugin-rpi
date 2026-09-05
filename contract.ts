import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const workflowTypeSchema = z.enum(["rpi", "outline_only", "prd_tdd", "oneshot", "freeform"]);
export type WorkflowType = z.infer<typeof workflowTypeSchema>;

export const composerWorkflowTypeSchema = z.enum(["rpi", "outline_only", "prd_tdd", "oneshot", "freeform"]);

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
    attentionCount: z.number().int().nonnegative(),
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
    advancedAttemptId: z.string().nullable(),
    hydratedAt: z.number().int().nullable(),
    lastReconcileSeq: z.number().int(),
    lastSummarizedTurnKey: z.string().nullable(),
    completedTurnKey: z.string().nullable(),
    nextStepTurnKey: z.string().nullable(),
    ingestError: z.string().nullable(),
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
    commandLine: z.string().nullable(),
    label: z.string().nullable(),
    environmentRole: z.enum(["base", "worktree"]),
    launchedBy: z.string(),
    status: z.enum(["pending", "spawned", "uncertain", "failed", "retrying"]),
    threadId: z.string().nullable(),
    retriedFrom: z.string().nullable(),
    retryMarker: z.string().nullable(),
    createdAt: z.number().int(),
    adoptionCandidates: z.array(z.object({
      threadId: z.string(),
      title: z.string().nullable(),
      createdAt: z.number().int(),
      strong: z.boolean(),
    }).strict()).optional(),
  })
  .strict();
export type LaunchAttemptRecord = z.infer<typeof launchAttemptRowSchema>;

export const nextStepExtractionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("next_step_found"),
    nextStepPrompt: z.string(),
    nextStepSummary: z.string(),
    nextStepType: z.string(),
    taskReference: z.string().nullable(),
    suggestedDirectory: z.null(),
  }).strict(),
  z.object({ type: z.literal("no_next_step"), reason: z.string() }).strict(),
]);
export const nextStepSuggestionsSchema = z.object({
  parsedAt: z.number().int(),
  extraction: nextStepExtractionSchema,
  extractionError: z.string().optional(),
}).strict();
export type NextStepSuggestionsRecord = z.infer<typeof nextStepSuggestionsSchema>;

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

export const workspaceRepoViewSchema = z.object({
  localPath: z.string().nullable(),
  description: z.string().nullable(),
  primary: z.boolean(),
  sourceRef: z.string().nullable(),
  setupCommand: z.string().nullable(),
  copyGlobs: z.array(z.string()),
}).strict();

export const workspaceViewSchema = z.object({
  taskId: z.string(),
  environment: z.object({
    id: z.string().nullable(),
    status: z.string().nullable(),
    path: z.string().nullable(),
    branch: z.string().nullable(),
    baseBranch: z.string().nullable(),
    kind: z.string().nullable(),
  }).strict(),
  worktreeThreadId: z.string().nullable(),
  repos: z.array(workspaceRepoViewSchema),
  primary: workspaceRepoViewSchema.nullable(),
  pathTemplate: z.object({ requested: z.string().nullable(), resolved: z.string().nullable() }).strict(),
  branchTemplate: z.object({ requested: z.string().nullable(), resolved: z.string().nullable() }).strict(),
  sourceRef: z.string().nullable(),
  setupCommand: z.string().nullable(),
  copyGlobs: z.array(z.string()),
  disabled: z.boolean(),
  warnings: z.array(z.string()),
  error: z.string().nullable(),
  provisioningEvents: z.array(z.object({
    seq: z.number().int(),
    createdAt: z.number().int(),
    status: z.string().nullable(),
    kind: z.string(),
    text: z.string(),
  }).strict()),
  provisioningEventKinds: z.array(z.string()),
}).strict();
export type WorkspaceViewRecord = z.infer<typeof workspaceViewSchema>;

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

export const commentAnchorSchema = z
  .object({
    v: z.literal(1),
    blockIndex: z.number().int().nonnegative(),
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
    selectedText: z.string(),
    orphaned: z.boolean().optional(),
    rewritten: z.boolean().optional(),
  })
  .strict();
export type CommentAnchorRecord = z.infer<typeof commentAnchorSchema>;

export const commentRecordSchema = z
  .object({
    id: z.string(),
    artifactId: z.string(),
    versionId: z.string(),
    replyToId: z.string().nullable(),
    contentText: z.string(),
    blockText: z.string().nullable(),
    prevBlockText: z.string().nullable(),
    nextBlockText: z.string().nullable(),
    anchorJson: commentAnchorSchema.omit({ orphaned: true }).nullable(),
    kind: z.string(),
    isResolved: z.boolean(),
    isDeleted: z.boolean(),
    createdByAgent: z.boolean(),
    createdByThreadId: z.string().nullable(),
    createdAt: z.number().int(),
    updatedAt: z.number().int(),
    anchor: commentAnchorSchema.nullable(),
  })
  .strict();
export type CommentRecord = z.infer<typeof commentRecordSchema>;

export const commentThreadSchema = z
  .object({
    root: commentRecordSchema,
    replies: z.array(commentRecordSchema),
  })
  .strict();
export type CommentThreadRecord = z.infer<typeof commentThreadSchema>;

export const mirrorOutcomeSchema = z.enum(["moved", "skipped", "conflict"]);

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
    researchModel: z.string().nullable().optional(),
    reasoningLevel: z.string().nullable().optional(),
    serviceTier: z.string().nullable().optional(),
  })
  .strict();

export const notificationPrefsSchema = z.object({
  enabled: z.boolean().default(true),
  sound: z.object({
    ready_for_input: z.boolean().default(true),
    needs_approval: z.boolean().default(true),
    comment: z.boolean().default(true),
  }).strict().default({ ready_for_input: true, needs_approval: true, comment: true }),
  toast: z.object({
    ready_for_input: z.boolean().default(true),
    needs_approval: z.boolean().default(true),
    comment: z.boolean().default(true),
  }).strict().default({ ready_for_input: true, needs_approval: true, comment: true }),
  volume: z.number().min(0).max(1).default(0.2),
  jumpHotkey: z.string().trim().min(1).default("mod+shift+u"),
}).strict();
export type NotificationPrefsRecord = z.infer<typeof notificationPrefsSchema>;

export const prefsSchema = z
  .object({
    defaults: prefsDefaultsSchema,
    notifications: notificationPrefsSchema.default({
      enabled: true,
      sound: { ready_for_input: true, needs_approval: true, comment: true },
      toast: { ready_for_input: true, needs_approval: true, comment: true },
      volume: 0.2,
      jumpHotkey: "mod+shift+u",
    }),
  })
  .strict();
export type Prefs = z.infer<typeof prefsSchema>;

export const prefsUpdateSchema = z
  .object({
    defaults: prefsDefaultsSchema.partial().optional(),
    notifications: notificationPrefsSchema.partial().optional(),
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
export const proceedInputSchema = z.object({ threadId: z.string().min(1) }).strict();
export const launchSkillInputSchema = z.object({
  taskId: z.string().min(1),
  skillId: z.string().min(1),
  commandLine: z.string().trim().min(1).max(10000).nullable().optional(),
}).strict();
export const rerunWorkspaceSetupInputSchema = z.object({ taskId: z.string().min(1) }).strict();
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
export const listCommentsInputSchema = z.object({ artifactId: z.string().min(1), includeResolved: z.boolean().optional(), limit: z.number().int().positive().max(100).optional(), offset: z.number().int().nonnegative().optional() }).strict();
export const createCommentInputSchema = z
  .object({
    artifactId: z.string().min(1),
    versionId: z.string().min(1),
    contentText: z.string().trim().min(1).max(10000),
    blockText: z.string().max(100000),
    prevBlockText: z.string().max(100000).nullable().optional(),
    nextBlockText: z.string().max(100000).nullable().optional(),
    anchorJson: commentAnchorSchema.omit({ orphaned: true }),
    replyToId: z.string().min(1).nullable().optional(),
  })
  .strict();
export const commentReplyInputSchema = z.object({ artifactId: z.string().min(1), commentId: z.string().min(1), content: z.string().trim().min(1).max(10000) }).strict();
export const commentEditInputSchema = z.object({ commentId: z.string().min(1), content: z.string().trim().min(1).max(10000) }).strict();
export const commentIdsInputSchema = z.object({ artifactId: z.string().min(1), commentIds: z.array(z.string().min(1)).min(1).max(100) }).strict();
export const resolveCommentsInputSchema = commentIdsInputSchema.extend({ resolved: z.boolean() }).strict();
export const sendCommentsInputSchema = commentIdsInputSchema.extend({
  threadId: z.string().min(1),
  mode: z.enum(["send", "send-and-resolve"]),
  requestId: z.string().min(1).max(100).optional(),
  includeResolved: z.boolean().optional(),
}).strict();
export const taskUiStateSchema = z.object({
  dismissedTips: z.record(z.string(), z.boolean()).optional(),
}).strict();
export type TaskUiState = z.infer<typeof taskUiStateSchema>;
export const dismissTaskTipInputSchema = z.object({ taskId: z.string().min(1), label: z.string().min(1) }).strict();
export const viewingSessionInputSchema = z.object({ threadId: z.string().min(1), viewing: z.boolean() }).strict();

export const rpcContract = defineRpcContract({
  listTasks: {
    input: listTasksInputSchema,
    output: z.object({ tasks: z.array(taskRowSchema) }).strict(),
  },
  getTask: {
    input: getTaskInputSchema,
    output: z.object({ task: taskRecordSchema, sessions: z.array(sessionRowSchema), workspace: workspaceStateSchema }).strict(),
  },
  getTaskUiState: {
    input: getTaskInputSchema,
    output: taskUiStateSchema,
  },
  dismissTaskTip: {
    input: dismissTaskTipInputSchema,
    output: taskUiStateSchema,
  },
  setViewingSession: {
    input: viewingSessionInputSchema,
    output: z.object({ ok: z.literal(true) }).strict(),
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
  proceed: {
    input: proceedInputSchema,
    output: z.object({ threadId: z.string().nullable().optional() }).strict(),
  },
  launchSkill: {
    input: launchSkillInputSchema,
    output: z.object({ threadId: z.string() }).strict(),
  },
  iterateInFreshSession: {
    input: proceedInputSchema,
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
    output: z.object({ artifact: artifactRowSchema.nullable(), mirror: mirrorOutcomeSchema }).strict(),
  },
  restoreArtifact: {
    input: artifactFileInputSchema,
    output: z.object({ artifact: artifactRowSchema.nullable(), mirror: mirrorOutcomeSchema, outcome: z.enum(["restored", "conflict"]) }).strict(),
  },
  listComments: {
    input: listCommentsInputSchema,
    output: z.object({ threads: z.array(commentThreadSchema), total: z.number().int().nonnegative(), nextOffset: z.number().int().nonnegative().nullable() }).strict(),
  },
  createComment: {
    input: createCommentInputSchema,
    output: z.object({ comment: commentRecordSchema }).strict(),
  },
  replyComment: {
    input: commentReplyInputSchema,
    output: z.object({ comment: commentRecordSchema }).strict(),
  },
  editComment: {
    input: commentEditInputSchema,
    output: z.object({ comment: commentRecordSchema.nullable() }).strict(),
  },
  resolveComments: {
    input: resolveCommentsInputSchema,
    output: z.object({ ok: z.literal(true) }).strict(),
  },
  deleteComment: {
    input: commentIdsInputSchema,
    output: z.object({ ok: z.literal(true) }).strict(),
  },
  sendCommentsToSession: {
    input: sendCommentsInputSchema,
    output: z.object({ sent: z.number().int().nonnegative(), status: z.enum(["pending", "done"]).optional() }).strict(),
  },
  hydrateNow: {
    input: artifactTaskInputSchema,
    output: z.object({ written: z.number().int().nonnegative(), skipped: z.number().int().nonnegative(), trashed: z.number().int().nonnegative() }).strict(),
  },
  ingestNow: {
    input: artifactTaskInputSchema,
    output: z.object({ ingested: z.number().int().nonnegative(), skipped: z.number().int().nonnegative() }).strict(),
  },
  getWorkspace: {
    input: artifactTaskInputSchema,
    output: z.object({ workspace: workspaceViewSchema }).strict(),
  },
  rerunWorkspaceSetup: {
    input: rerunWorkspaceSetupInputSchema,
    output: z.object({ threadId: z.string() }).strict(),
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
