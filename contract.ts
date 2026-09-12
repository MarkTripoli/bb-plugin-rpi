import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const workflowTypeSchema = z.enum(["rpi", "outline_only", "prd_tdd", "oneshot", "freeform", "epic"]);
export type WorkflowType = z.infer<typeof workflowTypeSchema>;

export const composerWorkflowTypeSchema = workflowTypeSchema;

export const worktreeTimingSchema = z.enum(["now", "later", "never"]);
export const permissionModeSchema = z.enum(["default", "accept_edits", "auto", "bypass"]);
const ARTIFACT_TEXT_LIMIT = 10 * 1024 * 1024;

const boundedId = z.string().min(1).max(256);
const boundedLabel = z.string().min(1).max(512);
const boundedModel = z.string().min(1).max(512);
const boundedPath = z.string().min(1).max(4096);
const boundedUrl = z.string().min(1).max(8192);
const agentOnlyVisibilitySchema = z.literal("agent-only").optional();
export const MANUAL_LAUNCH_TEXT_LIMIT = 10_000;
export const MANUAL_LAUNCH_REQUEST_BYTES_LIMIT = 256 * 1024;

export const reasoningLevelSchema = z.enum(["none", "low", "medium", "high", "xhigh", "max", "ultra", "ultracode"]);

// One-shot model choice made at launch time (launch prompt dialog). Omitted means "use the
// task's defaults"; present means spawn with exactly these values without touching the task
// record. reasoningLevel is optional so a provider that reports no levels can still be chosen.
export const modelOverrideSchema = z
  .object({
    providerId: boundedModel,
    model: boundedModel,
    reasoningLevel: reasoningLevelSchema.optional(),
  })
  .strict();
export type ModelOverride = z.infer<typeof modelOverrideSchema>;

// Per-phase model overrides for a task, keyed by phase label (AUTO_ADVANCE keys). Stored as
// tasks.phase_models JSON; an empty record means no per-phase entries.
export const phaseModelsSchema = z.record(z.string().min(1).max(64), modelOverrideSchema);
export type PhaseModels = z.infer<typeof phaseModelsSchema>;
export const serviceTierSchema = z.enum(["default", "fast"]);
export const sdkPermissionModeSchema = z.enum(["accept-edits", "auto", "full"]);
const executionInputSourceSchema = z.enum(["client-preference", "explicit"]);

export const executionInputSourcesSchema = z.object({
  model: executionInputSourceSchema.optional(),
  permissionMode: executionInputSourceSchema.optional(),
  providerId: executionInputSourceSchema.optional(),
  reasoningLevel: executionInputSourceSchema.optional(),
  serviceTier: executionInputSourceSchema.optional(),
}).strict();

const threadMentionResourceSchema = z.object({
  kind: z.literal("thread"),
  label: boundedLabel,
  projectId: boundedId.optional(),
  threadId: boundedId,
}).strict();
const projectMentionResourceSchema = z.object({
  kind: z.literal("project"),
  label: boundedLabel,
  projectId: boundedId,
}).strict();
const sectionMentionResourceSchema = z.object({
  kind: z.literal("section"),
  label: boundedLabel,
  sectionId: boundedId,
}).strict();
const pathMentionResourceSchema = z.object({
  entryKind: z.enum(["directory", "file"]),
  kind: z.literal("path"),
  label: boundedLabel,
  path: boundedPath,
  source: z.enum(["thread-storage", "workspace"]),
}).strict();
const commandMentionResourceSchema = z.object({
  argumentHint: z.string().max(512).nullable(),
  kind: z.literal("command"),
  label: boundedLabel,
  name: boundedId,
  origin: z.enum(["builtin", "project", "user"]),
  source: z.enum(["command", "skill"]),
  trigger: z.literal("/"),
}).strict();
const pluginMentionResourceSchema = z.object({
  icon: z.string().max(512).nullable().optional(),
  itemId: boundedId,
  kind: z.literal("plugin"),
  label: boundedLabel,
  pluginId: boundedId,
}).strict();

export const mentionResourceSchema = z.discriminatedUnion("kind", [
  threadMentionResourceSchema,
  projectMentionResourceSchema,
  sectionMentionResourceSchema,
  pathMentionResourceSchema,
  commandMentionResourceSchema,
  pluginMentionResourceSchema,
]);

const promptMentionSchema = z.object({
  end: z.number().int().nonnegative(),
  resource: mentionResourceSchema,
  start: z.number().int().nonnegative(),
}).strict();

const textPromptInputSchema = z.object({
  mentions: z.array(promptMentionSchema).max(64).default([]),
  text: z.string().max(MANUAL_LAUNCH_TEXT_LIMIT),
  type: z.literal("text"),
  visibility: agentOnlyVisibilitySchema,
}).strict().superRefine((input, ctx) => {
  for (const [index, mention] of input.mentions.entries()) {
    if (mention.start >= mention.end || mention.end > input.text.length) {
      ctx.addIssue({
        code: "custom",
        message: "Mention offsets must select a non-empty range within the text.",
        path: ["mentions", index],
      });
    }
  }
});

export const promptInputSchema = z.discriminatedUnion("type", [
  textPromptInputSchema,
  z.object({ type: z.literal("image"), url: boundedUrl, visibility: agentOnlyVisibilitySchema }).strict(),
  z.object({ type: z.literal("localImage"), path: boundedPath, visibility: agentOnlyVisibilitySchema }).strict(),
  z.object({
    mimeType: z.string().min(1).max(255).optional(),
    name: z.string().min(1).max(512).optional(),
    path: boundedPath,
    sizeBytes: z.number().int().nonnegative().max(25 * 1024 * 1024).optional(),
    type: z.literal("localFile"),
    visibility: agentOnlyVisibilitySchema,
  }).strict(),
]);

const unmanagedBranchSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("existing"), name: boundedLabel }).strict(),
  z.object({ baseBranch: boundedLabel, kind: z.literal("new") }).strict(),
]);
const baseBranchSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("named"), name: boundedLabel }).strict(),
  z.object({ kind: z.literal("default") }).strict(),
]);

export const createThreadEnvironmentSchema = z.discriminatedUnion("type", [
  z.object({ environmentId: boundedId, type: z.literal("reuse") }).strict(),
  z.object({
    hostId: boundedId.optional(),
    type: z.literal("host"),
    workspace: z.discriminatedUnion("type", [
      z.object({ branch: unmanagedBranchSchema.optional(), path: boundedPath.nullable(), type: z.literal("unmanaged") }).strict(),
      z.object({ baseBranch: baseBranchSchema, type: z.literal("managed-worktree") }).strict(),
      z.object({ type: z.literal("personal") }).strict(),
    ]),
  }).strict(),
  z.object({ type: z.literal("project-default") }).strict(),
  // bb 0.43.0+ lets the composer express an environment through a provider plugin
  // ("personal-workspace", "git-worktree", cloud sandboxes) instead of a plain host. Accept it so
  // the composer submission parses; the launch still resolves its own host/worktree from the task
  // (the provider selection only contributes the machine, per composerEnvironmentToTaskLocation).
  z.object({
    environmentProviderId: boundedId,
    inputs: z.json().nullable().default(null),
    machine: z.discriminatedUnion("type", [
      z.object({ hostId: boundedId, type: z.literal("existing") }).strict(),
      z.object({ inputs: z.json().nullable().default(null), machineProviderId: boundedId, type: z.literal("new") }).strict(),
    ]).optional(),
    type: z.literal("provider"),
  }).strict(),
]);

export const manualLaunchRequestSchema = z.object({
  projectId: boundedId,
  providerId: boundedId,
  model: boundedModel,
  reasoningLevel: reasoningLevelSchema,
  permissionMode: sdkPermissionModeSchema,
  serviceTier: serviceTierSchema.optional(),
  executionInputSources: executionInputSourcesSchema,
  environment: createThreadEnvironmentSchema,
  input: z.array(promptInputSchema).min(1).max(64),
  sendAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
}).strict().superRefine((request, ctx) => {
  const totalText = request.input.reduce((total, input) => total + (input.type === "text" ? input.text.length : 0), 0);
  if (totalText > MANUAL_LAUNCH_TEXT_LIMIT) {
    ctx.addIssue({ code: "custom", message: `Editable text must not exceed ${MANUAL_LAUNCH_TEXT_LIMIT} characters.`, path: ["input"] });
  }
  if (new TextEncoder().encode(JSON.stringify(request)).byteLength > MANUAL_LAUNCH_REQUEST_BYTES_LIMIT) {
    ctx.addIssue({ code: "custom", message: `Serialized request must not exceed ${MANUAL_LAUNCH_REQUEST_BYTES_LIMIT} bytes.` });
  }
});
export type ManualLaunchRequest = z.infer<typeof manualLaunchRequestSchema>;

export const manualLaunchIntentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("draft"), taskId: boundedId }).strict(),
  z.object({ kind: z.literal("skill"), taskId: boundedId, skillId: boundedId }).strict(),
  z.object({ kind: z.literal("proceed"), threadId: boundedId }).strict(),
  z.object({ kind: z.literal("completion"), threadId: boundedId, skillId: boundedId, phase: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional() }).strict(),
  z.object({ kind: z.literal("iterate"), threadId: boundedId }).strict(),
]);
export type ManualLaunchIntent = z.infer<typeof manualLaunchIntentSchema>;

export const manualLaunchRejectionCodeSchema = z.enum([
  "stale_intent",
  "project_mismatch",
  "workspace_mismatch",
]);
export type ManualLaunchRejectionCode = z.infer<typeof manualLaunchRejectionCodeSchema>;

export const prepareManualLaunchInputSchema = z.object({ intent: manualLaunchIntentSchema }).strict();
export const prepareManualLaunchOutputSchema = z.object({
  intent: manualLaunchIntentSchema,
  stateToken: z.string().regex(/^[a-f0-9]{64}$/),
  taskId: boundedId,
  sourceThreadId: boundedId.nullable(),
  displayPrompt: z.string().min(1).max(MANUAL_LAUNCH_TEXT_LIMIT),
  projectId: boundedId,
  environment: createThreadEnvironmentSchema,
  providerId: boundedId.optional(),
  model: boundedModel.optional(),
  reasoningLevel: reasoningLevelSchema.optional(),
  serviceTier: serviceTierSchema.optional(),
  permissionMode: sdkPermissionModeSchema.optional(),
  draftKey: z.string().min(1).max(1024),
  fixedWorkspaceNotice: z.string().max(4608).nullable(),
}).strict();
export type PreparedManualLaunch = z.infer<typeof prepareManualLaunchOutputSchema>;

export const submitManualLaunchInputSchema = z.object({
  intent: manualLaunchIntentSchema,
  stateToken: z.string().regex(/^[a-f0-9]{64}$/),
  request: manualLaunchRequestSchema,
}).strict();
export const submitManualLaunchOutputSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("launched"), threadId: boundedId }).strict(),
  z.object({
    status: z.literal("rejected"),
    rejection: z.object({ code: manualLaunchRejectionCodeSchema, message: z.string().min(1).max(2000) }).strict(),
  }).strict(),
]);

export const launchCompletionInputSchema = z.object({
  intent: z.object({ kind: z.literal("completion"), threadId: boundedId, skillId: boundedId, phase: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional() }).strict(),
  modelOverride: modelOverrideSchema.optional(),
}).strict();
export const launchCompletionOutputSchema = z.object({ threadId: boundedId }).strict();

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
    completed: z.boolean(),
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
    e2eMode: z.boolean(),
    parentTaskId: z.string().nullable(),
    dependsOn: z.array(z.string()),
    position: z.number().int().nullable(),
    epicPaused: z.boolean(),
    maxParallel: z.number().int().min(1).max(20).nullable(),
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
    completed: z.boolean(),
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
    e2eMode: z.boolean(),
    parentTaskId: z.string().nullable(),
    dependsOn: z.array(z.string()),
    position: z.number().int().nullable(),
    epicPaused: z.boolean(),
    maxParallel: z.number().int().min(1).max(20).nullable(),
    phaseModels: phaseModelsSchema,
    composerEnvironment: createThreadEnvironmentSchema.nullable(),
    createdAt: z.number().int(),
    updatedAt: z.number().int(),
  })
  .strict();
export type TaskRecord = z.infer<typeof taskRecordSchema>;

export const sessionRowSchema = z
  .object({
    threadId: z.string(),
    completed: z.boolean(),
    taskId: z.string(),
    label: z.string().nullable(),
    skillId: z.string().nullable(),
    launchedBy: z.string(),
    forkedFromThreadId: z.string().nullable(),
    rpiStatus: z.string(),
    rpiStatusAt: z.number().int(),
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
    targetPhase: z.number().int().positive().nullable(),
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

export const contextUsageSchema = z
  .object({
    usedTokens: z.number().int().nonnegative(),
    modelContextWindow: z.number().int().positive(),
    percent: z.number().min(0),
    estimated: z.boolean(),
  })
  .strict();
export type ContextUsageRecord = z.infer<typeof contextUsageSchema>;

export const sessionViewSchema = sessionRowSchema
  .extend({
    title: z.string().nullable(),
    workingDirectory: z.string().nullable(),
    threadUpdatedAt: z.number().int().nullable(),
    // bb exposes context-window usage from `threads.timeline({summaryOnly:"true"})`; null when the
    // provider bridge has not reported usage yet (e.g. before the first turn) or the lookup failed.
    contextUsage: contextUsageSchema.nullable(),
    // The owning task's workflow type, needed client-side to compute the Suggested-next
    // affordance (autoAdvanceTransition(label, workflowType) is workflow-type-specific).
    workflowType: workflowTypeSchema,
    // Resolved from prefs.contextWarning plus the task's providerId/model (contextThresholdFor,
    // context-threshold.ts), so the gauge/banner never hardcode a single global percentage.
    contextWarnThreshold: z.number().min(0).max(1),
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
  "epic-plan",
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
    // Omitted (undefined) falls through to the workflow-type default then the global default
    // (resolveTaskExecutionDefaults in tasks.ts); explicit null clears any default and always
    // wins, exactly like an explicit value. Precedence: explicit request > workflow default >
    // global default.
    permissionMode: permissionModeSchema.nullable().optional(),
    providerId: z.string().nullable().optional(),
    model: z.string().nullable().optional(),
    reasoningLevel: z.string().nullable().optional(),
    serviceTier: z.string().nullable().optional(),
    // Composer-created tasks only: when the submit-side environment picker resolved to
    // `{type:"reuse", environmentId}`, that environment becomes the task's base environment
    // (tasks.base_environment_id), which selectEnvironment already prefers for base-role
    // launches. Server-side createTask validates it still exists before storing.
    baseEnvironmentId: boundedId.nullable().optional(),
    // Composer-created tasks only: when the submit-side picker resolved to a provider environment,
    // the full args are persisted so a base-role launch can hand them to bb's spawn (a provider
    // provisions its own machine/workspace). Host/reuse picks stay captured by hostId /
    // defaultDirectory / baseEnvironmentId and leave this null.
    composerEnvironment: createThreadEnvironmentSchema.nullable().optional(),
    autoAdvance: z.boolean().default(false),
    e2eMode: z.boolean().default(false),
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
        completed: z.boolean().optional(),
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
        e2eMode: z.boolean().optional(),
        // null clears every per-phase entry.
        phaseModels: phaseModelsSchema.nullable().optional(),
        epicPaused: z.boolean().optional(),
        // null restores the constant default parallel cap.
        maxParallel: z.number().int().min(1).max(20).nullable().optional(),
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

// Per-workflow-type default overrides (Settings → Defaults). Unset fields fall back to
// `prefsDefaultsSchema` above, which stays the workflow-agnostic fallback used at task creation.
const workflowOverrideSchema = z
  .object({
    providerId: z.string().nullable().optional(),
    model: z.string().nullable().optional(),
    reasoningLevel: z.string().nullable().optional(),
    permissionMode: permissionModeSchema.nullable().optional(),
  })
  .strict();
export type WorkflowOverride = z.infer<typeof workflowOverrideSchema>;
const workflowDefaultsSchema = z.partialRecord(workflowTypeSchema, workflowOverrideSchema);

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

// One threshold rule: `pattern` is a case-insensitive glob (`*` only) matched against
// "<providerId>/<model>", e.g. "pi/anthropic/claude-sonnet-5" or "codex/gpt-5.5". `builtin` marks
// a seeded default row (contextThresholdFor, context-threshold.ts) so the settings UI can label it
// and so deleting it records the id in contextWarning.removedBuiltins instead of being re-seeded.
export const contextWarningRuleSchema = z
  .object({
    id: z.string().min(1),
    pattern: z.string(),
    threshold: z.number().min(0.3).max(0.95),
    builtin: z.boolean(),
  })
  .strict();
export type ContextWarningRule = z.infer<typeof contextWarningRuleSchema>;

export const contextWarningPrefsSchema = z
  .object({
    defaultThreshold: z.number().min(0.3).max(0.95).default(0.6),
    rules: z.array(contextWarningRuleSchema).default([]),
    removedBuiltins: z.array(z.string()).default([]),
  })
  .strict();
export type ContextWarningPrefs = z.infer<typeof contextWarningPrefsSchema>;

// Full-auto (e2e) defaults. fastModel/reasoningModel null means no class default (the task's own
// model applies). Caps bound guard counters derived from launch_attempts.
export const e2ePrefsSchema = z
  .object({
    fastModel: modelOverrideSchema.nullable().default(null),
    reasoningModel: modelOverrideSchema.nullable().default(null),
    permissionMode: permissionModeSchema.default("bypass"),
    maxHops: z.number().int().min(1).max(500).default(30),
    maxReviewCycles: z.number().int().min(1).max(50).default(5),
    maxRetries: z.number().int().min(0).max(20).default(3),
  })
  .strict();
export type E2ePrefs = z.infer<typeof e2ePrefsSchema>;
export const DEFAULT_E2E_PREFS: E2ePrefs = e2ePrefsSchema.parse({});

export const prefsSchema = z
  .object({
    defaults: prefsDefaultsSchema,
    workflowDefaults: workflowDefaultsSchema.default({}),
    notifications: notificationPrefsSchema.default({
      enabled: true,
      sound: { ready_for_input: true, needs_approval: true, comment: true },
      toast: { ready_for_input: true, needs_approval: true, comment: true },
      volume: 0.2,
      jumpHotkey: "mod+shift+u",
    }),
    contextWarning: contextWarningPrefsSchema.default({ defaultThreshold: 0.6, rules: [], removedBuiltins: [] }),
    e2e: e2ePrefsSchema.default(DEFAULT_E2E_PREFS),
  })
  .strict();
export type Prefs = z.infer<typeof prefsSchema>;

export const prefsUpdateSchema = z
  .object({
    defaults: prefsDefaultsSchema.partial().optional(),
    workflowDefaults: workflowDefaultsSchema.optional(),
    notifications: notificationPrefsSchema.partial().optional(),
    contextWarning: contextWarningPrefsSchema.partial().optional(),
    e2e: e2ePrefsSchema.partial().optional(),
  })
  .strict();

export const listModelsInputSchema = z.object({ hostId: z.string().min(1).nullable().optional() }).strict();
export const modelCatalogProviderSchema = z
  .object({
    id: z.string(),
    displayName: z.string(),
    available: z.boolean(),
    serviceTiers: z.array(z.object({ id: z.string(), label: z.string() }).strict()).default([]),
  })
  .strict();
export const modelCatalogModelSchema = z
  .object({
    id: z.string(),
    model: z.string(),
    providerId: z.string(),
    displayName: z.string(),
    description: z.string(),
    isDefault: z.boolean(),
    defaultReasoningEffort: z.string(),
    reasoningEfforts: z.array(z.string()),
  })
  .strict();
export const listModelsOutputSchema = z
  .object({
    providers: z.array(modelCatalogProviderSchema).max(50),
    models: z.array(modelCatalogModelSchema).max(1000),
    error: z.object({ code: z.string(), providerId: z.string() }).nullable(),
  })
  .strict();
export type ListModelsOutput = z.infer<typeof listModelsOutputSchema>;

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
    completed: z.boolean().nullable().optional(),
  })
  .strict();

export const getTaskInputSchema = z.object({ taskId: z.string().min(1) }).strict();
export const archiveTaskInputSchema = z.object({ taskId: z.string().min(1) }).strict();
export const launchDraftInputSchema = z.object({ taskId: z.string().min(1) }).strict();
export const proceedInputSchema = z.object({ threadId: z.string().min(1), modelOverride: modelOverrideSchema.optional() }).strict();
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
export const adoptThreadInputSchema = z.object({ threadId: z.string().min(1), taskId: z.string().min(1) }).strict();
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
  // threadId -> dismissed, so dismissing the context-warning banner on one session thread does not
  // hide it on a sibling session thread of the same task.
  contextWarningDismissed: z.record(z.string(), z.boolean()).optional(),
  // Backed by the dedicated `scratch_pads` table (see db.ts), merged in here for the client so one
  // RPC returns every per-task UI state field.
  scratch: z.string().optional(),
  // CAS revision counter for the scratch pad row (0 when no row exists yet). saveScratchPad must
  // echo this back so the client can detect a stale write.
  scratchRevision: z.number().int().nonnegative().optional(),
  // Set once at plugin start (see server.ts's startup legacy-task-dir sweep, workspace.ts
  // `findLegacyTaskDirTaskIds`) when this task's base environment has a pre-rename task-root dir
  // (see `legacyTaskDirName` below) but no current `.rpi/tasks/<slug>` dir yet. The plugin never
  // moves files itself; the banner just tells the user to.
  // Sticky once dismissed (dismissLegacyTaskDirWarning), so it shows exactly once per task.
  legacyTaskDirWarning: z.boolean().optional(),
  // The legacy directory name the banner names in its `git mv` instruction (from the same source
  // as the startup sweep's detection; see workspace.ts `findLegacyTaskDirTaskIds`).
  legacyTaskDirName: z.string().optional(),
  // Set by dismissLegacyTaskDirWarning; the startup sweep never re-sets legacyTaskDirWarning once
  // this is true, even if the legacy directory is still there on the next restart.
  legacyTaskDirWarningDismissed: z.boolean().optional(),
}).strict();
export type TaskUiState = z.infer<typeof taskUiStateSchema>;
export const dismissTaskTipInputSchema = z.object({ taskId: z.string().min(1), label: z.string().min(1) }).strict();
export const viewingSessionInputSchema = z.object({ threadId: z.string().min(1), viewing: z.boolean() }).strict();
export const SCRATCH_PAD_MAX_CHARS = 20000;
export const saveScratchPadInputSchema = z.object({ taskId: z.string().min(1), text: z.string().max(SCRATCH_PAD_MAX_CHARS), expectedRevision: z.number().int().nonnegative() }).strict();
export const saveScratchPadOutputSchema = taskUiStateSchema.extend({ outcome: z.enum(["saved", "conflict"]) });
export const dismissContextWarningInputSchema = z.object({ taskId: z.string().min(1), threadId: z.string().min(1) }).strict();
export const dismissLegacyTaskDirWarningInputSchema = z.object({ taskId: z.string().min(1) }).strict();

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
  saveScratchPad: {
    input: saveScratchPadInputSchema,
    output: saveScratchPadOutputSchema,
  },
  dismissContextWarning: {
    input: dismissContextWarningInputSchema,
    output: taskUiStateSchema,
  },
  dismissLegacyTaskDirWarning: {
    input: dismissLegacyTaskDirWarningInputSchema,
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
  deleteTask: {
    input: getTaskInputSchema,
    output: z.object({ deleted: z.boolean() }).strict(),
  },
  launchDraft: {
    input: launchDraftInputSchema,
    output: z.object({ threadId: z.string() }).strict(),
  },
  prepareManualLaunch: {
    input: prepareManualLaunchInputSchema,
    output: prepareManualLaunchOutputSchema,
  },
  submitManualLaunch: {
    input: submitManualLaunchInputSchema,
    output: submitManualLaunchOutputSchema,
  },
  launchCompletion: {
    input: launchCompletionInputSchema,
    output: launchCompletionOutputSchema,
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
  setSessionCompleted: {
    input: z.object({ threadId: z.string().min(1), completed: z.boolean() }).strict(),
    output: z.object({ session: sessionRowSchema.nullable() }).strict(),
  },
  forkSession: {
    input: forkSessionInputSchema,
    output: z.object({ threadId: z.string() }).strict(),
  },
  interruptSession: {
    input: interruptSessionInputSchema,
    output: z.object({ ok: z.literal(true) }).strict(),
  },
  adoptThread: {
    input: adoptThreadInputSchema,
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
  listModels: {
    input: listModelsInputSchema,
    output: listModelsOutputSchema,
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
