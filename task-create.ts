// Pure mapping from bb's `experimental_NewThreadComposer` submission (NewThreadRequest) to this
// plugin's createTask request. Used by NewTaskPage, whose creation box is bb's own compose
// surface plus a plugin-owned extras row (workflow type, worktree timing, auto-advance,
// Save as draft). Decisions bound by the user, 2026-09-11:
// - The extras row's worktree-timing select is the source of truth for worktree policy; the
//   composer's environment picker contributes host and directory only.
// - A managed-worktree pick in the composer does not force timing; RPI's timing select governs
//   when implementation gets its own worktree, and workspaceBaseBranch picks the base branch.
import type { ManualLaunchRequest, WorkflowType } from "./contract";

export type TaskCreateExtras = {
  workflowType: WorkflowType;
  worktreeTiming: "now" | "later" | "never";
  autoAdvance: boolean;
};

export type TaskCreateRequestInput = {
  text: string;
  projectId: string;
  hostId: string | null;
  defaultDirectory: string | null;
  workflowType: WorkflowType;
  worktreeTiming: "now" | "later" | "never";
  permissionMode: "default" | "accept_edits" | "auto" | "bypass";
  providerId: string;
  model: string;
  reasoningLevel: string;
  serviceTier: string | undefined;
  baseEnvironmentId: string | null;
  autoAdvance: boolean;
};

// The composer submits bb's permission vocabulary ("accept-edits"/"auto"/"full"); the task
// record stores this plugin's ("default"/"accept_edits"/"auto"/"bypass"). full is bypass.
export function sdkPermissionModeToTaskPermissionMode(mode: ManualLaunchRequest["permissionMode"]) {
  if (mode === "full") return "bypass" as const;
  if (mode === "accept-edits") return "accept_edits" as const;
  return mode;
}

// The submitted environment decides where research and planning run; per the binding decision
// above it never changes worktree policy. reuse carries no host, so the host resolves later
// from the environment itself (hostIdFromBaseEnvironment) or the project default source.
export function composerEnvironmentToTaskLocation(request: ManualLaunchRequest): {
  hostId: string | null;
  defaultDirectory: string | null;
  baseEnvironmentId: string | null;
} {
  const environment = request.environment;
  if (environment.type === "reuse") {
    return { hostId: null, defaultDirectory: null, baseEnvironmentId: environment.environmentId };
  }
  if (environment.type === "host") {
    return {
      hostId: environment.hostId ?? null,
      defaultDirectory: environment.workspace.type === "unmanaged" ? environment.workspace.path : null,
      baseEnvironmentId: null,
    };
  }
  return { hostId: null, defaultDirectory: null, baseEnvironmentId: null };
}

export function composerRequestToTaskCreate(
  request: ManualLaunchRequest,
  extras: TaskCreateExtras,
): TaskCreateRequestInput {
  const text = request.input
    .filter((input): input is Extract<(typeof request)["input"][number], { type: "text" }> => input.type === "text")
    .map((input) => input.text)
    .join("\n\n")
    .trim();
  return {
    text,
    projectId: request.projectId,
    ...composerEnvironmentToTaskLocation(request),
    ...extras,
    permissionMode: sdkPermissionModeToTaskPermissionMode(request.permissionMode),
    providerId: request.providerId,
    model: request.model,
    reasoningLevel: request.reasoningLevel,
    serviceTier: request.serviceTier,
    autoAdvance: extras.autoAdvance,
  };
}
