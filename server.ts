import { readFileSync } from "node:fs";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { prefsSchema, prefsUpdateSchema, proceedInputSchema, rpcContract, taskUiStateSchema, taskUpdateInputSchema } from "./contract";
import { openPluginDatabase, parseJson, readRow, writeRow } from "./db";
import {
  artifactPermalink,
  deleteArtifact,
  getArtifact,
  getArtifactVersion,
  isTextArtifact,
  listArtifactVersions,
  listArtifacts,
  mimeFor,
  restoreArtifact,
  upsertArtifact,
} from "./artifacts";
import {
  createComment,
  type CommentThread,
  editComment,
  listComments,
  replyToComment,
  resolveTruncatedId,
  sendCommentsToSession,
  setCommentsResolved,
  softDeleteComments,
  sweepOldSendReceipts,
} from "./comments";
import { markdownBlocks } from "./blocks";
import {
  iterateInFreshSession,
  latestLaunchAttemptLabel,
  launchSkill,
  onCompletedTurn,
  proceed,
} from "./advance";
import {
  forkSession,
  interruptSession,
  launchDraft,
  listLaunchAdoptionCandidates,
  listLaunchAttempts,
  promoteStalePendingLaunchAttempts,
  resolveLaunchAttempt,
} from "./launch";
import { hydrate, ingest, latestTaskThread, mirrorDeletedArtifact, mirrorRestoredArtifact, type MirrorFileOutcome } from "./mirror";
import {
  bindPendingThread,
  createLaunchBindingMirror,
  loadChildThreadMirror,
  listSessions,
  loadSessionMirror,
  readSession,
  registerSessionRuntime,
  taskInstructions,
} from "./sessions";
import {
  approvalsFromInteractions,
  decideAndPublishNotification,
  listNotificationRecords,
  normalizeNotificationPrefs,
  notificationSummaryFromSession,
  publishSyntheticTestNotification,
  recoverReadyAfterFailedAdvance,
  sweepOldNotifications,
  sweepOldSuppressions,
} from "./notify";
import { z } from "zod";

// .strict() runs on the raw parsed CLI options (every flag the user passed, including --json)
// before projecting to the fields the command actually uses, so an unrecognized flag fails
// instead of silently being dropped by the projection.
const notificationsListRawArgsSchema = z.object({
  limit: z.string().optional(),
  json: z.string().optional(),
}).strict();
const notificationsListArgsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(20),
});
const notificationsTestRawArgsSchema = z.object({
  thread: z.string().optional(),
  json: z.string().optional(),
}).strict();
const notificationsTestArgsSchema = z.object({
  thread: z.string().min(1),
});
import {
  archiveTask,
  createDraftTask,
  defaultTaskPrefs,
  getTask,
  listTasks,
  updateTask,
} from "./tasks";
import { ARTIFACT_TOOL_NAMES, registerArtifactTools } from "./tools";
import { RPI_AGENT_SKILL_IDS, SKILLS } from "./transitions";
import { getWorkspaceView, rerunWorkspaceSetup, validateWorkspaceForWorktreeLaunch } from "./workspace";

const PREFS_KEY = "prefs:structured-defaults";
const RPI_SKILL_NAMES = SKILLS.map(([, skillId]) => `rpi-${skillId}`);
const RPI_AGENT_SKILL_NAMES = RPI_AGENT_SKILL_IDS.map((skillId) => `rpi-agent-${skillId}`);
const NOTIFICATION_SOUND = readFileSync(new URL("./assets/notification.mp3", import.meta.url));
const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "cache-control": "no-store",
  "content-security-policy": "sandbox; default-src 'none'",
};

function publishArtifacts(bb: BbPluginApi, taskId: string) {
  bb.realtime.publish("artifacts", { taskId });
  bb.realtime.publish("hl:artifacts", { taskId });
}

type CommentEventKind = "created" | "replied" | "edited" | "resolved" | "deleted";

function publishComments(bb: BbPluginApi, taskId: string, artifactId: string, commentId: string | null, createdByAgent: boolean, kind: CommentEventKind) {
  bb.realtime.publish("hl:comments", { taskId, artifactId, commentId, createdByAgent, kind });
  bb.realtime.publish("hl:artifacts", { taskId });
}

function isInlineSafeContentType(contentType: string) {
  return ["image/png", "image/jpeg", "image/gif", "image/webp", "text/plain", "text/markdown"].includes(contentType.toLowerCase());
}

function attachmentFileName(fileName: string) {
  return fileName.replaceAll("\\", "_").replaceAll("\"", "_").replaceAll("\r", "_").replaceAll("\n", "_");
}

function readArtifactTask(db: ReturnType<typeof openPluginDatabase>, artifactId: string) {
  const artifact = readRow<{ taskId: string; fileName: string }>(db, "SELECT task_id AS taskId, file_name AS fileName FROM artifacts WHERE id = ?", artifactId);
  if (!artifact) throw new Error("artifact not found");
  return artifact;
}

function readArtifactVersionForComment(db: ReturnType<typeof openPluginDatabase>, artifactId: string, versionId: string) {
  const version = readRow<{ id: string; content: Buffer }>(
    db,
    "SELECT id, content FROM artifact_versions WHERE id = ? AND artifact_id = ?",
    versionId,
    artifactId,
  );
  if (!version) throw new Error("version does not belong to artifact");
  return version;
}

function assertRootCommentForArtifact(db: ReturnType<typeof openPluginDatabase>, artifactId: string, commentId: string) {
  const comment = readRow<{ id: string; replyToId: string | null; isDeleted: number | boolean }>(
    db,
    "SELECT id, reply_to_id AS replyToId, is_deleted AS isDeleted FROM comments WHERE id = ? AND artifact_id = ?",
    commentId,
    artifactId,
  );
  if (!comment || Boolean(comment.isDeleted)) throw new Error("comment not found");
  if (comment.replyToId !== null) throw new Error("not_a_root");
}

function assertAnchorInVersion(content: Buffer, blockIndex: number) {
  if (!markdownBlocks(content.toString("utf8"))[blockIndex]) throw new Error("anchor blockIndex out of range");
}

function stripCommentPage(page: ReturnType<typeof listComments>) {
  return { threads: page.threads, total: page.total, nextOffset: page.nextOffset };
}

function readTaskUiState(db: ReturnType<typeof openPluginDatabase>, taskId: string) {
  const row = readRow<{ json: string }>(db, "SELECT json FROM task_ui_state WHERE task_id = ?", taskId);
  const parsed = taskUiStateSchema.safeParse(parseJson<unknown>(row?.json, {}));
  return parsed.success ? parsed.data : {};
}

function writeTaskUiState(db: ReturnType<typeof openPluginDatabase>, taskId: string, state: { dismissedTips?: Record<string, boolean> }) {
  writeRow(
    db,
    "INSERT INTO task_ui_state (task_id, json) VALUES (?, ?) ON CONFLICT(task_id) DO UPDATE SET json = excluded.json",
    taskId,
    JSON.stringify({ dismissedTips: state.dismissedTips ?? {} }),
  );
}

function commentCliLines(threads: CommentThread[]) {
  return threads.flatMap((thread) => [
    `${thread.root.id.slice(0, 8)}\t${thread.root.isResolved ? "resolved" : "open"}\tblock ${thread.root.anchor?.orphaned ? "unanchored" : thread.root.anchor?.blockIndex ?? "?"}\t${truncateCliComment(thread.root.contentText)}`,
    ...thread.replies.map((reply) => `  ${reply.id.slice(0, 8)}\treply\t${reply.createdByAgent ? "agent" : "you"}\t${truncateCliComment(reply.contentText)}`),
  ]);
}

function truncateCliComment(value: string) {
  return value.length > 500 ? `${value.slice(0, 500)}[truncated]` : value;
}

export default async function plugin(bb: BbPluginApi) {
  const db = openPluginDatabase(bb);
  const sessionMirror = loadSessionMirror(db);
  const childThreadMirror = loadChildThreadMirror(db);
  const launchBindings = createLaunchBindingMirror();
  const viewingSessions = new Set<string>();
  const initialPrefs = prefsSchema.safeParse(await bb.storage.kv.get<unknown>(PREFS_KEY));
  let researchModelPreference = initialPrefs.success ? initialPrefs.data.defaults.researchModel ?? null : null;
  let notificationPrefs = normalizeNotificationPrefs(initialPrefs.success ? initialPrefs.data.notifications : null);
  for (const taskId of promoteStalePendingLaunchAttempts(db)) {
    bb.realtime.publish("tasks", { taskId });
    bb.realtime.publish("hl:sessions", { taskId, threadId: null });
  }
  const settings = bb.settings.define({
    notificationSoundsEnabled: {
      type: "boolean",
      label: "Notification sounds",
      default: true,
    },
    notificationToastsEnabled: {
      type: "boolean",
      label: "Notification toasts",
      default: true,
    },
    notificationsEnabled: {
      type: "boolean",
      label: "Notifications",
      default: true,
    },
    notificationVolume: {
      type: "string",
      label: "Notification volume",
      default: "0.2",
    },
    defaultWorkflowType: {
      type: "select",
      label: "Default workflow type",
      options: ["rpi", "outline_only", "prd_tdd", "oneshot", "freeform"],
      default: "rpi",
    },
    defaultWorktreeTiming: {
      type: "select",
      label: "Default worktree timing",
      options: ["now", "later", "never"],
      default: "later",
    },
    defaultPermissionMode: {
      type: "select",
      label: "Default permission mode",
      options: ["default", "accept_edits", "auto", "bypass"],
      default: "default",
    },
    autoAdvanceDefault: {
      type: "boolean",
      label: "Auto-advance by default",
      default: false,
    },
    preferBatchQueueDelivery: {
      type: "boolean",
      label: "Prefer batch queue delivery",
      default: false,
    },
    showTaskPhaseLabels: {
      type: "boolean",
      label: "Show task phase labels",
      default: true,
    },
    diffStyle: {
      type: "select",
      label: "Diff style",
      options: ["unified", "split"],
      default: "unified",
    },
    defaultEditor: {
      type: "select",
      label: "Default editor",
      options: ["code", "cursor", "zed", "system"],
      default: "code",
    },
    showPhaseTips: {
      type: "boolean",
      label: "Show phase tips",
      default: true,
    },
    showIterateConfirmation: {
      type: "boolean",
      label: "Show iterate confirmation dialog",
      default: true,
    },
    showBypassPermissionsNudge: {
      type: "boolean",
      label: "Show bypass permissions nudge",
      default: true,
    },
    showFastModeWarning: {
      type: "boolean",
      label: "Show fast mode warning",
      default: true,
    },
    showSessionUiExplainer: {
      type: "boolean",
      label: "Show session UI explainer",
      default: true,
    },
    confirmBeforeInterruptingSubagents: {
      type: "boolean",
      label: "Confirm before interrupting sub-agents",
      default: true,
    },
    jumpHotkey: {
      type: "string",
      label: "Jump hotkey",
      default: "mod+shift+u",
    },
    notificationSoundReady: {
      type: "boolean",
      label: "Sound for ready sessions",
      default: true,
    },
    notificationToastReady: {
      type: "boolean",
      label: "Toast for ready sessions",
      default: true,
    },
    notificationSoundApproval: {
      type: "boolean",
      label: "Sound for approvals",
      default: true,
    },
    notificationToastApproval: {
      type: "boolean",
      label: "Toast for approvals",
      default: true,
    },
    notificationSoundComment: {
      type: "boolean",
      label: "Sound for comments",
      default: true,
    },
    notificationToastComment: {
      type: "boolean",
      label: "Toast for comments",
      default: true,
    },
    sendCommentsMode: {
      type: "select",
      label: "Send comments mode",
      options: ["send", "send-and-resolve"],
      default: "send-and-resolve",
    },
  });

  async function currentNotificationPrefs() {
    const storedPrefs = prefsSchema.safeParse(await bb.storage.kv.get<unknown>(PREFS_KEY));
    if (storedPrefs.success) {
      notificationPrefs = normalizeNotificationPrefs(storedPrefs.data.notifications);
      return notificationPrefs;
    }
    const hostSettings = await settings.get();
    notificationPrefs = normalizeNotificationPrefs({
      enabled: Boolean(hostSettings.notificationsEnabled),
      sound: {
        ready_for_input: Boolean(hostSettings.notificationSoundsEnabled) && Boolean(hostSettings.notificationSoundReady),
        needs_approval: Boolean(hostSettings.notificationSoundsEnabled) && Boolean(hostSettings.notificationSoundApproval),
        comment: Boolean(hostSettings.notificationSoundsEnabled) && Boolean(hostSettings.notificationSoundComment),
      },
      toast: {
        ready_for_input: Boolean(hostSettings.notificationToastsEnabled) && Boolean(hostSettings.notificationToastReady),
        needs_approval: Boolean(hostSettings.notificationToastsEnabled) && Boolean(hostSettings.notificationToastApproval),
        comment: Boolean(hostSettings.notificationToastsEnabled) && Boolean(hostSettings.notificationToastComment),
      },
      volume: Number.parseFloat(String(hostSettings.notificationVolume ?? "0.2")),
      jumpHotkey: String(hostSettings.jumpHotkey ?? "mod+shift+u"),
    });
    return notificationPrefs;
  }

  // Evaluated on every derived snapshot (not just when hlStatus changed), so:
  // - ready_for_input is delivered exactly once from the persisted, final completed_turn_key,
  //   whichever caller (idle completion or a racing reconcile) observes it last.
  // - needs_approval is delivered per pending interaction id, even while hlStatus stays
  //   needs_approval across two different approvals.
  // Both are idempotent via notify.ts dedupe keys.
  async function notifySnapshot(threadId: string, interactions: readonly unknown[]) {
    const row = sessionMirror.get(threadId);
    if (!row) return;
    const prefs = await currentNotificationPrefs();
    const context = { prefs, owner: "unknown" as const, viewing: viewingSessions.has(threadId) };
    // Every pending approval id in the snapshot notifies (deduped per id), not just the first, so
    // two simultaneously pending approvals both surface instead of the second being dropped.
    for (const approval of approvalsFromInteractions(interactions)) {
      await decideAndPublishNotification(bb, db, {
        type: "status_transition",
        threadId,
        previousStatus: null,
        nextStatus: "needs_approval",
        completedTurnKey: null,
        title: row.taskName,
        summary: notificationSummaryFromSession(row),
        approval,
      }, context);
    }
    if (row.hlStatus === "ready_for_input" && !row.blockedReason && row.completedTurnKey) {
      await decideAndPublishNotification(bb, db, {
        type: "status_transition",
        threadId,
        previousStatus: "running",
        nextStatus: "ready_for_input",
        completedTurnKey: row.completedTurnKey,
        title: row.taskName,
        summary: notificationSummaryFromSession(row),
      }, context);
    }
  }

  async function notifyAdvanceFailed(session: NonNullable<ReturnType<typeof sessionMirror.get>>) {
    if (!session.completedTurnKey) return;
    await recoverReadyAfterFailedAdvance(bb, db, await currentNotificationPrefs(), {
      threadId: session.threadId,
      completedTurnKey: session.completedTurnKey,
      failedSkillLabel: latestLaunchAttemptLabel(db, session.threadId),
    });
  }

  async function notifyHumanComment(taskId: string, artifactId: string, commentId: string, commentText: string, createdByAgent: boolean) {
    const threadId = latestTaskThread(db, taskId);
    if (!threadId) return;
    await decideAndPublishNotification(bb, db, {
      type: "comment",
      threadId,
      taskId,
      artifactId,
      commentId,
      commentText,
      createdByAgent,
    }, {
      prefs: await currentNotificationPrefs(),
      owner: "unknown",
      viewing: viewingSessions.has(threadId),
    });
  }

  bb.rpc.register(rpcContract, {
    listTasks: async (input) => ({
      tasks: listTasks(db, {
        projectId: input.projectId ?? null,
        archived: input.archived ?? false,
      }),
    }),
	    getTask: async ({ taskId }) => {
	      const result = getTask(db, taskId);
	      if (result === null) {
	        throw new Error(`No task found for id ${taskId}`);
	      }
	      return { ...result, workspace: { ...result.workspace, launchAttempts: await attemptsWithCandidates(bb, db, result.workspace.launchAttempts) } };
	    },
    getTaskUiState: async ({ taskId }) => readTaskUiState(db, taskId),
    dismissTaskTip: async ({ taskId, label }) => {
      const state = readTaskUiState(db, taskId);
      const next = { ...state, dismissedTips: { ...(state.dismissedTips ?? {}), [label]: true } };
      writeTaskUiState(db, taskId, next);
      bb.realtime.publish("hl:ui-state", { taskId });
      return next;
    },
    setViewingSession: async ({ threadId, viewing }) => {
      if (viewing) viewingSessions.add(threadId);
      else viewingSessions.delete(threadId);
      return { ok: true as const };
    },
    createTask: async ({ request, name, draft }) => {
      const storedPrefs = await bb.storage.kv.get<unknown>(PREFS_KEY);
      const prefs = prefsSchema.parse(storedPrefs ?? defaultTaskPrefs({}));
      await validateWorkspaceForWorktreeLaunch(bb, {
        hostId: request.hostId ?? null,
        defaultDirectory: request.defaultDirectory ?? null,
        worktreeTiming: request.worktreeTiming,
      });
      const result = createDraftTask(db, {
        projectId: request.projectId,
        prompt: request.text,
        name,
        hostId: request.hostId ?? null,
        defaultDirectory: request.defaultDirectory ?? null,
        workflowType: request.workflowType,
        worktreeTiming: request.worktreeTiming,
        permissionMode: request.permissionMode,
        autoAdvance: request.autoAdvance,
        providerId: prefs.defaults.providerId ?? null,
        model: prefs.defaults.model ?? null,
        reasoningLevel: prefs.defaults.reasoningLevel ?? null,
        serviceTier: prefs.defaults.serviceTier ?? null,
      });
      bb.realtime.publish("tasks", { taskId: result.taskId });
      if (!draft) {
        const launched = await launchDraft(bb, db, sessionMirror, launchBindings, result.taskId);
        return { ...result, threadId: launched.threadId };
      }
      return result;
    },
    updateTask: async ({ taskId, patch }) => {
      const task = updateTask(db, taskId, patch);
      bb.realtime.publish("tasks", { taskId });
      return { task };
    },
    archiveTask: async ({ taskId }) => {
      const task = archiveTask(db, taskId);
      bb.realtime.publish("tasks", { taskId });
      return { task };
    },
    launchDraft: async ({ taskId }) => {
      return launchDraft(bb, db, sessionMirror, launchBindings, taskId);
    },
	    proceed: async ({ threadId }) => {
	      return proceed(bb, db, sessionMirror, launchBindings, threadId);
	    },
	    launchSkill: async ({ taskId, skillId, commandLine }) => {
	      return launchSkill(bb, db, sessionMirror, launchBindings, taskId, skillId, commandLine ?? null);
	    },
	    iterateInFreshSession: async ({ threadId }) => {
	      return iterateInFreshSession(bb, db, sessionMirror, launchBindings, threadId);
	    },
    listSessions: async ({ taskId }) => ({
      sessions: await Promise.all(listSessions(db, taskId ?? null).map((session) => sessionView(bb, session))),
    }),
    getSession: async ({ threadId }) => {
      const session = readSession(db, threadId);
      return { session: session ? await sessionView(bb, session) : null };
    },
    forkSession: async ({ threadId, text }) => forkSession(bb, db, sessionMirror, threadId, text),
    interruptSession: async ({ threadId }) => interruptSession(bb, db, sessionMirror, threadId),
	    listLaunchAttempts: async ({ taskId }) => ({ attempts: await attemptsWithCandidates(bb, db, listLaunchAttempts(db, taskId)) }),
    resolveLaunchAttempt: async ({ id, action }) => resolveLaunchAttempt(bb, db, sessionMirror, launchBindings, id, action),
    listArtifacts: async ({ taskId, includeDeleted }) => ({ artifacts: listArtifacts(db, taskId, { includeDeleted }) }),
    getArtifact: async ({ taskId, fileName, version }) => {
      const result = getArtifactVersion(db, taskId, fileName, version ?? null);
      if (!result) return { artifact: null, version: null, content: null, isBinary: false, url: null };
      const contentType = mimeFor(result.artifact.fileName);
      const isBinary = !isTextArtifact(result.artifact.fileName, contentType);
      return {
        artifact: { ...result.artifact, contentType },
        version: versionView(result.version),
        content: isBinary ? null : result.version.content.toString("utf8"),
        isBinary,
        url: `/api/v1/plugins/humanlayer/http/artifact?task=${encodeURIComponent(taskId)}&file=${encodeURIComponent(fileName)}&version=${result.version.version}&inline=1`,
      };
    },
    listArtifactVersions: async ({ taskId, fileName }) => ({
      versions: listArtifactVersions(db, taskId, fileName).map(versionView),
    }),
    saveArtifact: async ({ taskId, fileName, content }) => {
      const result = upsertArtifact(db, taskId, fileName, content, {
        createdBy: "ui",
        operation: "ui",
        contentType: mimeFor(fileName),
      });
      publishArtifacts(bb, taskId);
      return { artifact: result.artifact, version: result.version, permalink: artifactPermalink(taskId, fileName) };
    },
    deleteArtifact: async ({ taskId, fileName }) => {
      const artifact = deleteArtifact(db, taskId, fileName);
      const threadId = latestTaskThread(db, taskId);
      let mirror: MirrorFileOutcome = "skipped";
      if (threadId) mirror = await mirrorDeletedArtifact(bb, db, taskId, threadId, fileName).catch((error) => {
        bb.log.warn(`Failed to move deleted HumanLayer artifact: ${String(error)}`);
        return "conflict" as const;
      });
      publishArtifacts(bb, taskId);
      return { artifact, mirror };
    },
    restoreArtifact: async ({ taskId, fileName }) => {
      const restored = restoreArtifact(db, taskId, fileName);
      if (restored.outcome === "conflict") {
        publishArtifacts(bb, taskId);
        return { artifact: restored.artifact, mirror: "conflict" as const, outcome: restored.outcome };
      }
      const threadId = latestTaskThread(db, taskId);
      let mirror: MirrorFileOutcome = "skipped";
      if (threadId) mirror = await mirrorRestoredArtifact(bb, db, taskId, threadId, fileName).catch((error) => {
        bb.log.warn(`Failed to restore HumanLayer artifact: ${String(error)}`);
        return "conflict" as const;
      });
      publishArtifacts(bb, taskId);
      return { artifact: restored.artifact, mirror, outcome: restored.outcome };
    },
    listComments: async ({ artifactId, includeResolved, limit, offset }) => stripCommentPage(listComments(db, artifactId, { includeResolved, limit, offset })),
    createComment: async (input) => {
      const artifact = readArtifactTask(db, input.artifactId);
      const version = readArtifactVersionForComment(db, input.artifactId, input.versionId);
      assertAnchorInVersion(version.content, input.anchorJson.blockIndex);
      if (input.replyToId) assertRootCommentForArtifact(db, input.artifactId, input.replyToId);
      const comment = createComment(db, input.artifactId, input.versionId, {
        contentText: input.contentText,
        blockText: input.blockText,
        prevBlockText: input.prevBlockText ?? null,
        nextBlockText: input.nextBlockText ?? null,
        anchorJson: input.anchorJson,
        replyToId: input.replyToId ?? null,
        createdByAgent: false,
      });
      publishComments(bb, artifact.taskId, input.artifactId, comment.id, false, input.replyToId ? "replied" : "created");
      await notifyHumanComment(artifact.taskId, input.artifactId, comment.id, comment.contentText, comment.createdByAgent);
      return { comment };
    },
    replyComment: async ({ artifactId, commentId, content }) => {
      const artifact = readArtifactTask(db, artifactId);
      assertRootCommentForArtifact(db, artifactId, commentId);
      const comment = replyToComment(db, artifactId, commentId, content, { createdByAgent: false });
      if (!comment) throw new Error("comment not found");
      publishComments(bb, artifact.taskId, artifactId, comment.id, false, "replied");
      await notifyHumanComment(artifact.taskId, artifactId, comment.id, comment.contentText, comment.createdByAgent);
      return { comment };
    },
    editComment: async ({ commentId, content }) => {
      const existing = readRow<{ createdByAgent: number | boolean }>(db, "SELECT created_by_agent AS createdByAgent FROM comments WHERE id = ? AND is_deleted = 0", commentId);
      if (existing && Boolean(existing.createdByAgent)) throw new Error("cannot edit agent comments");
      const comment = editComment(db, commentId, content);
      if (comment) {
        const artifact = readArtifactTask(db, comment.artifactId);
        publishComments(bb, artifact.taskId, comment.artifactId, comment.id, comment.createdByAgent, "edited");
      }
      return { comment };
    },
    resolveComments: async ({ artifactId, commentIds, resolved }) => {
      const artifact = readArtifactTask(db, artifactId);
      const results = setCommentsResolved(db, commentIds, resolved, artifactId);
      const failed = results.find((result) => !result.ok);
      if (failed) throw new Error(failed.code);
      publishComments(bb, artifact.taskId, artifactId, null, false, "resolved");
      return { ok: true as const };
    },
    deleteComment: async ({ artifactId, commentIds }) => {
      const artifact = readArtifactTask(db, artifactId);
      softDeleteComments(db, commentIds, artifactId);
      publishComments(bb, artifact.taskId, artifactId, null, false, "deleted");
      return { ok: true as const };
    },
    sendCommentsToSession: async ({ threadId, artifactId, commentIds, mode, requestId, includeResolved }) => {
      const result = await sendCommentsToSession(bb, db, threadId, artifactId, commentIds, mode, { requestId, includeResolved });
      const artifact = readArtifactTask(db, artifactId);
      publishComments(bb, artifact.taskId, artifactId, null, false, "resolved");
      return result;
    },
    hydrateNow: async ({ taskId }) => {
      const threadId = latestTaskThread(db, taskId);
      if (!threadId) throw new Error("No task session is available for hydration.");
      return hydrate(bb, db, taskId, threadId);
    },
    ingestNow: async ({ taskId }) => {
      const threadId = latestTaskThread(db, taskId);
      if (!threadId) throw new Error("No task session is available for ingest.");
      return ingest(bb, db, taskId, threadId, { threadId });
    },
    getWorkspace: async ({ taskId }) => {
      const result = getTask(db, taskId);
      if (!result) throw new Error(`No task found for id ${taskId}`);
      return { workspace: await getWorkspaceView(bb, db, result.task) };
    },
    rerunWorkspaceSetup: async ({ taskId }) => {
      const result = getTask(db, taskId);
      if (!result) throw new Error(`No task found for id ${taskId}`);
      return rerunWorkspaceSetup(bb, db, result.task);
    },
    listProjects: async ({ includePersonal }) =>
      bb.sdk.projects.list({ includePersonal: includePersonal ?? true }).then((projects) =>
        projects.map((project) => ({
          id: project.id,
          name: project.name ?? project.id,
        })),
      ),
    listHosts: async () =>
      bb.sdk.hosts.list().then((hosts) =>
        hosts.map((host) => ({
          id: host.id,
          name: host.name ?? host.id,
          status: host.status ?? "unknown",
        })),
      ),
    getPrefs: async () => {
      const storedPrefs = await bb.storage.kv.get<unknown>(PREFS_KEY);
      return prefsSchema.parse(storedPrefs ?? defaultTaskPrefs({}));
    },
    setPrefs: async (input) => {
      const currentPrefs = await bb.storage.kv.get<unknown>(PREFS_KEY);
      const current = prefsSchema.parse(currentPrefs ?? defaultTaskPrefs({}));
      const patch = prefsUpdateSchema.parse(input);
      const next = {
        defaults: {
          providerId: patch.defaults?.providerId ?? current.defaults.providerId ?? null,
          model: patch.defaults?.model ?? current.defaults.model ?? null,
          researchModel: patch.defaults?.researchModel ?? current.defaults.researchModel ?? null,
          reasoningLevel: patch.defaults?.reasoningLevel ?? current.defaults.reasoningLevel ?? null,
          serviceTier: patch.defaults?.serviceTier ?? current.defaults.serviceTier ?? null,
        },
        notifications: normalizeNotificationPrefs({
          ...current.notifications,
          ...patch.notifications,
          sound: { ...current.notifications.sound, ...(patch.notifications?.sound ?? {}) },
          toast: { ...current.notifications.toast, ...(patch.notifications?.toast ?? {}) },
        }),
      };
      researchModelPreference = next.defaults.researchModel;
      notificationPrefs = next.notifications;
      await bb.storage.kv.set(PREFS_KEY, next);
      bb.realtime.publish("prefs", { changed: true });
      return prefsSchema.parse(next);
    },
  });

  bb.cli.register({
    name: "humanlayer",
    summary: "HumanLayer tasks and sessions",
    commands: [
      {
        name: "tasks-create",
        summary: "Create a freeform task, optionally launching it",
        usage: "bb humanlayer tasks create --name <name> --project <projectId> --prompt <text> [--launch] [--host <hostId>] [--directory <path>] [--provider <id>] [--model <id>] [--json]",
      },
      {
        name: "tasks-list",
        summary: "List tasks",
        usage: "bb humanlayer tasks list [--json]",
      },
      {
        name: "sessions-list",
        summary: "List sessions",
        usage: "bb humanlayer sessions list [--task <taskId>] [--json]",
      },
      {
        name: "artifacts-list",
        summary: "List task artifacts",
        usage: "bb humanlayer artifacts list --task <taskId> [--json]",
      },
      {
        name: "artifacts-get",
        summary: "Print a task artifact",
        usage: "bb humanlayer artifacts get --task <taskId> --file <fileName> [--version <n>] [--json]",
      },
      {
        name: "artifacts-versions",
        summary: "List artifact versions",
        usage: "bb humanlayer artifacts versions --task <taskId> --file <fileName> [--json]",
      },
      {
        name: "artifacts-ingest",
        summary: "Ingest task artifacts from the current task thread workspace",
        usage: "bb humanlayer artifacts ingest --task <taskId> [--file <fileName>] [--json]",
      },
      {
        name: "artifacts-save",
        summary: "Save a text artifact version",
        usage: "bb humanlayer artifacts save --task <taskId> --file <fileName> --content <text> [--json]",
      },
      {
        name: "comments-list",
        summary: "List artifact comments",
        usage: "bb humanlayer comments list --task <taskId> --file <fileName> [--resolved] [--json]",
      },
      {
        name: "comments-create",
        summary: "Create an artifact comment on a markdown block",
        usage: "bb humanlayer comments create --task <taskId> --file <fileName> --block <index> --content <text> [--json]",
      },
      {
        name: "comments-resolve",
        summary: "Resolve artifact comments by id prefix",
        usage: "bb humanlayer comments resolve --task <taskId> --file <fileName> --id <prefix> [--json]",
      },
      {
        name: "proceed",
        summary: "Launch the parsed next step for a HumanLayer session",
        usage: "bb humanlayer proceed --thread <threadId> [--json]",
      },
      {
        name: "launch-skill",
        summary: "Launch a HumanLayer task session with an RPI skill",
        usage: "bb humanlayer launch-skill --task <taskId> --skill <skillId> [--command-line <text>] [--provider <id>] [--model <id>] [--json]",
      },
      {
        name: "launch-attempts",
        summary: "List HumanLayer launch attempts for a task",
        usage: "bb humanlayer launch-attempts --task <taskId> [--json] | bb humanlayer launch-attempts dismiss --id <attemptId>",
      },
      {
        name: "suppressions",
        summary: "List HumanLayer notification suppressions for a thread",
        usage: "bb humanlayer suppressions --thread <threadId> [--json]",
      },
      {
        name: "notifications-list",
        summary: "List recent HumanLayer notification decisions",
        usage: "bb humanlayer notifications list [--limit N] [--json]",
      },
      {
        name: "notifications-test",
        summary: "Publish a synthetic ready-for-input notification decision",
        usage: "bb humanlayer notifications test --thread <threadId> [--json]",
      },
      {
        name: "workspace",
        summary: "Show HumanLayer workspace state for a task",
        usage: "bb humanlayer workspace --task <taskId> [--json]",
      },
    ],
    async run(argv) {
      try {
        const json = argv.includes("--json");
        if (argv[0] === "tasks" && argv[1] === "create") {
          const opts = parseArgs(argv.slice(2));
          const projectId = opts.project;
          const prompt = opts.prompt;
          if (!projectId || !prompt) {
            return { exitCode: 2, stderr: "usage: bb humanlayer tasks create --name <name> --project <projectId> --prompt <text> [--launch]\n" };
          }
          const worktreeTiming = worktreeTimingOption(opts.worktree ?? opts.worktreeTiming);
          await validateWorkspaceForWorktreeLaunch(bb, {
            hostId: opts.host ?? null,
            defaultDirectory: opts.directory ?? null,
            worktreeTiming,
          });
          const result = createDraftTask(db, {
            projectId,
            prompt,
            name: opts.name,
            hostId: opts.host ?? null,
            defaultDirectory: opts.directory ?? null,
            workflowType: workflowTypeOption(opts.workflow ?? opts.workflowType),
            worktreeTiming,
            permissionMode: "default",
            autoAdvance: opts.autoAdvance === "true" || opts.auto === "true",
            providerId: opts.provider ?? null,
            model: opts.model ?? null,
            reasoningLevel: opts.effort ?? null,
            serviceTier: null,
          });
          const launched = opts.launch === "true" ? await launchDraft(bb, db, sessionMirror, launchBindings, result.taskId) : null;
          const body = { ...result, ...(launched ?? {}) };
          return { exitCode: 0, stdout: json ? `${JSON.stringify(body)}\n` : `${body.taskId}${launched ? ` ${launched.threadId}` : ""}\n` };
        }
        if (argv[0] === "tasks" && argv[1] === "update") {
          const opts = parseArgs(argv.slice(2));
          if (!opts.task) return { exitCode: 2, stderr: "usage: bb humanlayer tasks update --task <taskId> [--auto true|false] [--aa-research-to-design true|false]\n" };
          const input = taskUpdateInputSchema.parse({
            taskId: opts.task,
            patch: {
              autoAdvance: optionalBool(opts.auto ?? opts.autoAdvance),
              aa_questions_to_research: optionalBool(opts.aaQuestionsToResearch ?? opts["aa-questions-to-research"]),
              aa_research_to_design: optionalBool(opts.aaResearchToDesign ?? opts["aa-research-to-design"]),
              aa_plan_to_worktree: optionalBool(opts.aaPlanToWorktree ?? opts["aa-plan-to-worktree"]),
              aa_worktree_to_implementation: optionalBool(opts.aaWorktreeToImplementation ?? opts["aa-worktree-to-implementation"]),
              aa_implementation_to_pr: optionalBool(opts.aaImplementationToPr ?? opts["aa-implementation-to-pr"]),
            },
          });
          const task = updateTask(db, input.taskId, input.patch);
          if (!task) return { exitCode: 1, stderr: "task not found\n" };
          bb.realtime.publish("tasks", { taskId: input.taskId });
          return { exitCode: 0, stdout: json ? `${JSON.stringify({ task })}\n` : "updated\n" };
        }
        if (argv[0] === "proceed") {
          const opts = parseArgs(argv.slice(1));
          if (!opts.thread) return { exitCode: 2, stderr: "usage: bb humanlayer proceed --thread <threadId> [--json]\n" };
          const input = proceedInputSchema.parse({ threadId: opts.thread });
          const result = await proceed(bb, db, sessionMirror, launchBindings, input.threadId);
          return { exitCode: 0, stdout: json ? `${JSON.stringify(result)}\n` : `${result.threadId ?? ""}\n` };
        }
        if (argv[0] === "launch-skill") {
          const opts = parseArgs(argv.slice(1));
          if (!opts.task || !opts.skill) return { exitCode: 2, stderr: "usage: bb humanlayer launch-skill --task <taskId> --skill <skillId> [--command-line <text>] [--provider <id>] [--model <id>]\n" };
          if (opts.provider || opts.model || opts.effort) {
            updateTask(db, opts.task, {
              providerId: opts.provider ?? undefined,
              model: opts.model ?? undefined,
              reasoningLevel: opts.effort ?? undefined,
            });
          }
          const commandLine = opts.commandLine ?? opts["command-line"] ?? (opts.prompt ? `/rpi-${opts.skill}\n\n${opts.prompt}` : null);
          const result = await launchSkill(bb, db, sessionMirror, launchBindings, opts.task, opts.skill, commandLine);
          return { exitCode: 0, stdout: json ? `${JSON.stringify(result)}\n` : `${result.threadId}\n` };
        }
        if (argv[0] === "launch-attempts") {
          if (argv[1] === "dismiss") {
            const opts = parseArgs(argv.slice(2));
            if (!opts.id) return { exitCode: 2, stderr: "usage: bb humanlayer launch-attempts dismiss --id <attemptId>\n" };
            const result = await resolveLaunchAttempt(bb, db, sessionMirror, launchBindings, opts.id, { type: "dismiss" });
            return { exitCode: 0, stdout: json ? `${JSON.stringify(result)}\n` : "dismissed\n" };
          }
          const opts = parseArgs(argv.slice(1));
          if (!opts.task) return { exitCode: 2, stderr: "usage: bb humanlayer launch-attempts --task <taskId>\n" };
          const attempts = listLaunchAttempts(db, opts.task);
          return { exitCode: 0, stdout: json ? `${JSON.stringify({ attempts })}\n` : attempts.map((attempt) => `${attempt.id}\t${attempt.status}\t${attempt.skillId ?? ""}\t${attempt.threadId ?? ""}`).join("\n") + "\n" };
        }
        if (argv[0] === "suppressions") {
          const opts = parseArgs(argv.slice(1));
          if (!opts.thread) return { exitCode: 2, stderr: "usage: bb humanlayer suppressions --thread <threadId>\n" };
          const rows = db.prepare("SELECT thread_id AS threadId, completed_turn_key AS completedTurnKey, reason, created_at AS createdAt, consumed_at AS consumedAt FROM notification_suppressions WHERE thread_id = ? ORDER BY created_at DESC").all(opts.thread) as Array<{ threadId: string; completedTurnKey: string; reason: string; createdAt: number; consumedAt: number | null }>;
          return { exitCode: 0, stdout: json ? `${JSON.stringify({ suppressions: rows })}\n` : rows.map((row) => `${row.threadId}\t${row.completedTurnKey}\t${row.reason}`).join("\n") + (rows.length ? "\n" : "") };
        }
        if (argv[0] === "notifications" && argv[1] === "list") {
          const opts = parseArgs(argv.slice(2));
          const raw = notificationsListRawArgsSchema.safeParse(opts);
          if (!raw.success) return { exitCode: 2, stderr: "usage: bb humanlayer notifications list [--limit N] [--json]\n" };
          const parsed = notificationsListArgsSchema.safeParse({ limit: raw.data.limit });
          if (!parsed.success) return { exitCode: 2, stderr: "usage: bb humanlayer notifications list [--limit N] [--json]\n" };
          const notifications = listNotificationRecords(db, parsed.data.limit);
          return { exitCode: 0, stdout: json ? `${JSON.stringify({ notifications, limit: parsed.data.limit })}\n` : notifications.map((row) => `${row.createdAt}\t${row.kind}${row.synthetic ? " [test]" : ""}${row.supersededAt ? " [superseded]" : ""}\t${row.threadId}\t${row.reason}`).join("\n") + (notifications.length ? "\n" : "") };
        }
        if (argv[0] === "notifications" && argv[1] === "test") {
          const opts = parseArgs(argv.slice(2));
          const raw = notificationsTestRawArgsSchema.safeParse(opts);
          if (!raw.success) return { exitCode: 2, stderr: "usage: bb humanlayer notifications test --thread <threadId> [--json]\n" };
          const parsed = notificationsTestArgsSchema.safeParse({ thread: raw.data.thread });
          if (!parsed.success) return { exitCode: 2, stderr: "usage: bb humanlayer notifications test --thread <threadId> [--json]\n" };
          const session = readSession(db, parsed.data.thread);
          if (!session) return { exitCode: 1, stderr: "session not found\n" };
          // Synthetic namespace: never touches real ready/approval dedupe keys or suppression rows.
          const decision = publishSyntheticTestNotification(bb, db, await currentNotificationPrefs(), {
            threadId: session.threadId,
            title: notificationSummaryFromSession(session) ?? `Session ${session.threadId.slice(0, 8)}`,
            body: notificationSummaryFromSession(session),
          });
          return { exitCode: 0, stdout: json ? `${JSON.stringify({ decision })}\n` : `${decision.reason}\tsound=${decision.sound}\ttoast=${decision.toast ? "yes" : "no"}\n` };
        }
        if (argv[0] === "workspace") {
          const opts = parseArgs(argv.slice(1));
          if (!opts.task) return { exitCode: 2, stderr: "usage: bb humanlayer workspace --task <taskId> [--json]\n" };
          const result = getTask(db, opts.task);
          if (!result) return { exitCode: 1, stderr: "task not found\n" };
          const workspace = await getWorkspaceView(bb, db, result.task);
          if (json) return { exitCode: 0, stdout: `${JSON.stringify({ workspace })}\n` };
          return {
            exitCode: 0,
            stdout: [
              `environment\t${workspace.environment.id ?? ""}\t${workspace.environment.status ?? ""}\t${workspace.environment.kind ?? ""}`,
              `path\t${workspace.environment.path ?? ""}`,
              `branch\t${workspace.environment.branch ?? ""}`,
              `baseBranch\t${workspace.environment.baseBranch ?? ""}`,
              `events\t${workspace.provisioningEventKinds.join(",")}`,
            ].join("\n") + "\n",
          };
        }
        if (argv[0] === "tasks" && argv[1] === "list") {
          const tasks = listTasks(db, { archived: false });
          return { exitCode: 0, stdout: json ? `${JSON.stringify({ tasks })}\n` : tasks.map((task) => `${task.id}\t${task.stepLabel}\t${task.name}`).join("\n") + "\n" };
        }
        if (argv[0] === "sessions" && argv[1] === "list") {
          const opts = parseArgs(argv.slice(2));
          const limit = parseBoundedInt(opts.limit, 50, 1, 200);
          const offset = parseBoundedInt(opts.offset, 0, 0, 100000);
          const sessions = listSessions(db, opts.task ?? null, { limit, offset }).map(sessionCliView);
          return { exitCode: 0, stdout: json ? `${JSON.stringify({ sessions, limit, offset })}\n` : sessions.map((session) => `${session.threadId}\t${session.hlStatus}\t${session.label ?? ""}`).join("\n") + "\n" };
        }
        if (argv[0] === "artifacts" && argv[1] === "list") {
          const opts = parseArgs(argv.slice(2));
          if (!opts.task) return { exitCode: 2, stderr: "usage: bb humanlayer artifacts list --task <taskId>\n" };
          const artifacts = listArtifacts(db, opts.task, { includeDeleted: opts.deleted === "true" });
          return { exitCode: 0, stdout: json ? `${JSON.stringify({ artifacts })}\n` : artifacts.map((artifact) => `${artifact.fileName}\tv${artifact.currentVersion}\t${artifact.type}`).join("\n") + "\n" };
        }
        if (argv[0] === "artifacts" && argv[1] === "get") {
          const opts = parseArgs(argv.slice(2));
          if (!opts.task || !opts.file) return { exitCode: 2, stderr: "usage: bb humanlayer artifacts get --task <taskId> --file <fileName>\n" };
          const result = getArtifactVersion(db, opts.task, opts.file, opts.version ? Number.parseInt(opts.version, 10) : null);
          if (!result) return { exitCode: 1, stderr: "artifact not found\n" };
          const isBinary = !isTextArtifact(result.artifact.fileName, mimeFor(result.artifact.fileName));
          if (json) {
            return { exitCode: 0, stdout: `${JSON.stringify({ artifact: { ...result.artifact, contentType: mimeFor(result.artifact.fileName) }, version: versionView(result.version), content: isBinary ? null : result.version.content.toString("utf8"), isBinary })}\n` };
          }
          if (isBinary) return { exitCode: 1, stderr: "artifact is binary; use the HTTP route\n" };
          return { exitCode: 0, stdout: result.version.content.toString("utf8") };
        }
        if (argv[0] === "artifacts" && argv[1] === "versions") {
          const opts = parseArgs(argv.slice(2));
          if (!opts.task || !opts.file) return { exitCode: 2, stderr: "usage: bb humanlayer artifacts versions --task <taskId> --file <fileName>\n" };
          const versions = listArtifactVersions(db, opts.task, opts.file).map(versionView);
          return { exitCode: 0, stdout: json ? `${JSON.stringify({ versions })}\n` : versions.map((version) => `v${version.version}\t${version.createdBy}\t${new Date(version.createdAt).toISOString()}`).join("\n") + "\n" };
        }
        if (argv[0] === "artifacts" && argv[1] === "ingest") {
          const opts = parseArgs(argv.slice(2));
          if (!opts.task) return { exitCode: 2, stderr: "usage: bb humanlayer artifacts ingest --task <taskId> [--file <fileName>]\n" };
          const threadId = latestTaskThread(db, opts.task);
          if (!threadId) return { exitCode: 1, stderr: "No task session is available for ingest.\n" };
          const result = await ingest(bb, db, opts.task, "cli", { threadId, fileName: opts.file ?? null, operation: "ingest" });
          return { exitCode: 0, stdout: json ? `${JSON.stringify(result)}\n` : `${result.ingested} ingested, ${result.skipped} skipped\n` };
        }
        if (argv[0] === "artifacts" && argv[1] === "save") {
          const opts = parseArgs(argv.slice(2));
          if (!opts.task || !opts.file || opts.content === undefined) return { exitCode: 2, stderr: "usage: bb humanlayer artifacts save --task <taskId> --file <fileName> --content <text>\n" };
          const result = upsertArtifact(db, opts.task, opts.file, opts.content, {
            createdBy: "cli",
            operation: "cli",
            contentType: mimeFor(opts.file),
          });
          const body = { artifact: result.artifact, version: result.version, permalink: artifactPermalink(opts.task, opts.file) };
          publishArtifacts(bb, opts.task);
          return { exitCode: 0, stdout: json ? `${JSON.stringify(body)}\n` : `v${result.version}\t${body.permalink}\n` };
        }
        if (argv[0] === "comments" && argv[1] === "list") {
          const opts = parseArgs(argv.slice(2));
          if (!opts.task || !opts.file) return { exitCode: 2, stderr: "usage: bb humanlayer comments list --task <taskId> --file <fileName>\n" };
          const artifact = getArtifact(db, opts.task, opts.file);
          if (!artifact) return { exitCode: 1, stderr: "artifact not found\n" };
          const page = stripCommentPage(listComments(db, artifact.id, { includeResolved: opts.resolved === "true", limit: parseBoundedInt(opts.limit, 50, 1, 50), offset: parseBoundedInt(opts.offset, 0, 0, 100000) }));
          if (json) return { exitCode: 0, stdout: `${JSON.stringify(page)}\n` };
          return { exitCode: 0, stdout: commentCliLines(page.threads).join("\n") + "\n" };
        }
        if (argv[0] === "comments" && argv[1] === "create") {
          const opts = parseArgs(argv.slice(2));
          if (!opts.task || !opts.file || opts.block === undefined || opts.content === undefined) {
            return { exitCode: 2, stderr: "usage: bb humanlayer comments create --task <taskId> --file <fileName> --block <index> --content <text>\n" };
          }
          const result = getArtifactVersion(db, opts.task, opts.file);
          if (!result) return { exitCode: 1, stderr: "artifact not found\n" };
          if (result.artifact.isDeleted) return { exitCode: 1, stderr: "artifact is deleted\n" };
          const blocks = markdownBlocks(result.version.content.toString("utf8"));
          const block = blocks[Number.parseInt(opts.block, 10)];
          if (!block) return { exitCode: 1, stderr: "block not found\n" };
          const comment = createComment(db, result.artifact.id, result.version.id, {
            contentText: opts.content,
            blockText: block.text,
            prevBlockText: blocks[block.index - 1]?.text ?? null,
            nextBlockText: blocks[block.index + 1]?.text ?? null,
            anchorJson: { v: 1, blockIndex: block.index, start: block.start, end: block.end, selectedText: block.text },
            createdByAgent: false,
          });
          publishComments(bb, opts.task, result.artifact.id, comment.id, false, "created");
          await notifyHumanComment(opts.task, result.artifact.id, comment.id, comment.contentText, comment.createdByAgent);
          return { exitCode: 0, stdout: json ? `${JSON.stringify({ comment })}\n` : `${comment.id.slice(0, 8)}\tblock ${block.index}\n` };
        }
        if (argv[0] === "comments" && argv[1] === "resolve") {
          const opts = parseArgs(argv.slice(2));
          if (!opts.task || !opts.file || !opts.id) return { exitCode: 2, stderr: "usage: bb humanlayer comments resolve --task <taskId> --file <fileName> --id <prefix>\n" };
          const artifact = getArtifact(db, opts.task, opts.file);
          if (!artifact) return { exitCode: 1, stderr: "artifact not found\n" };
          const match = resolveTruncatedId(db, artifact.id, opts.id);
          if (!match.ok) return { exitCode: 1, stderr: `${match.code}\n` };
          const results = setCommentsResolved(db, [match.id], true, artifact.id);
          const failed = results.find((result) => !result.ok);
          if (failed) return { exitCode: 1, stderr: `${failed.code}\n` };
          publishComments(bb, opts.task, artifact.id, match.id, false, "resolved");
          return { exitCode: 0, stdout: json ? `${JSON.stringify({ id: match.id, resolved: true })}\n` : `${match.id.slice(0, 8)}\tresolved\n` };
        }
        return { exitCode: 2, stderr: "usage: bb humanlayer {tasks|sessions|artifacts|comments|launch-skill|launch-attempts|suppressions|notifications|workspace} ...\n" };
      } catch (error) {
        return { exitCode: 1, stderr: `${String(error instanceof Error ? error.message : error)}\n` };
      }
    },
  });

  bb.http.route("GET", "/artifact", (context) => {
    const taskId = context.req.query("task");
    const fileName = context.req.query("file");
    const versionInput = context.req.query("version");
    if (!taskId || !fileName) return new Response("missing task or file", { status: 400, headers: SECURITY_HEADERS });
    const result = getArtifactVersion(db, taskId, fileName, versionInput ? Number.parseInt(versionInput, 10) : null);
    if (!result) return new Response("not found", { status: 404, headers: SECURITY_HEADERS });
    const contentType = mimeFor(result.artifact.fileName);
    const inline = context.req.query("inline") === "1" && isInlineSafeContentType(contentType);
    return new Response(new Uint8Array(result.version.content), {
      headers: {
        ...SECURITY_HEADERS,
        "content-type": contentType,
        "content-length": String(result.version.sizeBytes),
        ...(inline ? {} : { "content-disposition": `attachment; filename="${attachmentFileName(result.artifact.fileName)}"` }),
      },
    });
  }, { auth: "local" });

  bb.http.route("GET", "/sound/notification.mp3", () => new Response(new Uint8Array(NOTIFICATION_SOUND), {
    headers: {
      ...SECURITY_HEADERS,
      "content-type": "audio/mpeg",
      "content-length": String(NOTIFICATION_SOUND.byteLength),
    },
  }), { auth: "local" });
  bb.http.route("HEAD", "/sound/notification.mp3", () => new Response(null, {
    headers: {
      ...SECURITY_HEADERS,
      "content-type": "audio/mpeg",
      "content-length": String(NOTIFICATION_SOUND.byteLength),
    },
  }), { auth: "local" });

  registerArtifactTools(bb, db, sessionMirror, childThreadMirror, { getResearchModel: () => researchModelPreference });

  bb.agents.configure((context) => {
    bindPendingThread(db, sessionMirror, launchBindings, context.thread.id);
    if (sessionMirror.has(context.thread.id)) return { tools: [...ARTIFACT_TOOL_NAMES], skills: RPI_SKILL_NAMES };
    if (childThreadMirror.has(context.thread.id)) return { tools: [...ARTIFACT_TOOL_NAMES], skills: RPI_AGENT_SKILL_NAMES };
    return { tools: [], skills: [] };
  });
  bb.agents.contributeInstructions(({ threadId }) => {
    const row = sessionMirror.get(threadId) ?? bindPendingThread(db, sessionMirror, launchBindings, threadId);
    return row ? taskInstructions(row, { researchModel: researchModelPreference }) : null;
  });

  registerSessionRuntime(
    bb,
    db,
    sessionMirror,
    launchBindings,
    (row) => onCompletedTurn(bb, db, sessionMirror, launchBindings, row),
    childThreadMirror,
    notifySnapshot,
    notifyAdvanceFailed,
  );

  bb.background.service("launch-attempt-sweep", {
    async start(signal) {
      while (!signal.aborted) {
        sweepOldSendReceipts(db);
        sweepOldNotifications(db);
        sweepOldSuppressions(db);
        for (const taskId of promoteStalePendingLaunchAttempts(db)) {
          bb.realtime.publish("tasks", { taskId });
          bb.realtime.publish("hl:sessions", { taskId, threadId: null });
        }
        await sleep(60_000, signal);
      }
    },
  });

  bb.onDispose(() => {
    db.close();
  });
}

function versionView(version: NonNullable<ReturnType<typeof getArtifactVersion>>["version"]) {
  return {
    id: version.id,
    artifactId: version.artifactId,
    version: version.version,
    sha256: version.sha256,
    sizeBytes: version.sizeBytes,
    createdBy: version.createdBy,
    operation: version.operation,
    createdAt: version.createdAt,
  };
}

function parseArgs(argv: string[]) {
  const result: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      result.json = "true";
      continue;
    }
    if (arg === "--launch") {
      result.launch = "true";
      continue;
    }
    if (arg === "--resolved") {
      result.resolved = "true";
      continue;
    }
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const value = argv[index + 1];
      if (value && (key === "content" || !value.startsWith("--"))) {
        result[key] = value;
        index += 1;
      }
    }
  }
  return result;
}

function parseBoundedInt(input: string | undefined, fallback: number, min: number, max: number) {
  const value = input === undefined ? fallback : Number.parseInt(input, 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function optionalBool(input: string | undefined) {
  if (input === undefined) return undefined;
  if (input === "true" || input === "1" || input === "yes") return true;
  if (input === "false" || input === "0" || input === "no") return false;
  throw new Error(`invalid boolean: ${input}`);
}

function workflowTypeOption(input: string | undefined) {
  return input === "rpi" || input === "outline_only" || input === "prd_tdd" || input === "oneshot" || input === "freeform" ? input : "freeform";
}

async function attemptsWithCandidates(bb: BbPluginApi, db: ReturnType<typeof openPluginDatabase>, attempts: ReturnType<typeof listLaunchAttempts>) {
  return Promise.all(attempts.map(async (attempt) => {
    if (attempt.status !== "pending" && attempt.status !== "uncertain" && attempt.status !== "retrying") return attempt;
    return { ...attempt, adoptionCandidates: await listLaunchAdoptionCandidates(bb, db, attempt).catch(() => []) };
  }));
}

function worktreeTimingOption(input: string | undefined) {
  return input === "now" || input === "later" || input === "never" ? input : "never";
}

function sessionCliView(session: ReturnType<typeof readSession> extends infer T ? NonNullable<T> : never) {
  const summary = parseJson<{ summaryHistory?: string[] }>(session.summaryJson, {});
  const summaryHistory = Array.isArray(summary.summaryHistory)
    ? summary.summaryHistory.slice(-3).map((entry) => String(entry).slice(0, 200))
    : [];
  return { ...session, summaryJson: JSON.stringify({ ...summary, summaryHistory }) };
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

async function sessionView(bb: BbPluginApi, session: ReturnType<typeof readSession> extends infer T ? NonNullable<T> : never) {
  try {
    const thread = await bb.sdk.threads.get({ threadId: session.threadId, include: "environment" });
    const environment = "environment" in thread ? thread.environment : null;
    return {
      ...session,
      title: thread.title ?? thread.titleFallback ?? null,
      workingDirectory: environment?.path ?? null,
      threadUpdatedAt: thread.updatedAt ?? null,
    };
  } catch {
    return {
      ...session,
      title: null,
      workingDirectory: null,
      threadUpdatedAt: null,
    };
  }
}
