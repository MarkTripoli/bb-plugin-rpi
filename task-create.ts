// Pure mapping from bb's `experimental_NewThreadComposer` submission (NewThreadRequest) to this
// plugin's createTask request. Used by NewTaskPage, whose creation box is bb's own compose
// surface plus a plugin-owned extras row (workflow type, worktree timing, auto-advance,
// Save as draft). Decisions bound by the user, 2026-09-11:
// - The extras row's worktree-timing select is the source of truth for worktree policy; the
//   composer's environment picker contributes host and directory only.
// - A managed-worktree pick in the composer does not force timing; RPI's timing select governs
//   when implementation gets its own worktree, and workspaceBaseBranch picks the base branch.
// Extension, 2026-09-12: a `provider` environment (bb 0.43.0+) cannot be reduced to host and
// directory, so its full args are persisted and replayed for the base-role launch. Worktree policy
// still belongs to the extras row.
import type { ManualLaunchRequest, WorkflowType } from "./contract";

export type TaskCreateExtras = {
  workflowType: WorkflowType;
  worktreeTiming: "now" | "later" | "never";
  autoAdvance: boolean;
  e2eMode: boolean;
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
  // Omitted when the composer reports no tier: an `undefined` value is not JSON and the RPC
  // transport rejects the whole submit before the schema can treat it as absent.
  serviceTier?: string;
  baseEnvironmentId: string | null;
  // Set only for a provider environment; host/reuse picks stay captured by the location fields.
  composerEnvironment: ManualLaunchRequest["environment"] | null;
  autoAdvance: boolean;
  e2eMode: boolean;
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
  // A provider environment names a machine only when it reuses an existing host; a provider that
  // provisions its own machine ("new") has no host yet, so the project default source resolves it.
  if (environment.type === "provider") {
    return {
      hostId: environment.machine?.type === "existing" ? environment.machine.hostId : null,
      defaultDirectory: null,
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
    ...(request.serviceTier === undefined ? {} : { serviceTier: request.serviceTier }),
    composerEnvironment: request.environment.type === "provider" ? request.environment : null,
    autoAdvance: extras.autoAdvance,
    e2eMode: extras.e2eMode,
  };
}
