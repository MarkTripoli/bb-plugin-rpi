import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { prefsSchema, prefsUpdateSchema, rpcContract } from "./contract";
import { openPluginDatabase, parseJson } from "./db";
import {
  artifactPermalink,
  deleteArtifact,
  getArtifactVersion,
  isTextArtifact,
  listArtifactVersions,
  listArtifacts,
  mimeFor,
  restoreArtifact,
  upsertArtifact,
} from "./artifacts";
import {
  forkSession,
  interruptSession,
  launchDraft,
  listLaunchAttempts,
  promoteStalePendingLaunchAttempts,
  resolveLaunchAttempt,
} from "./launch";
import { hydrate, ingest, latestTaskThread, mirrorDeletedArtifact, mirrorRestoredArtifact, type MirrorFileOutcome } from "./mirror";
import {
  bindPendingThread,
  createLaunchBindingMirror,
  listSessions,
  loadSessionMirror,
  readSession,
  registerSessionRuntime,
  taskInstructions,
} from "./sessions";
import {
  archiveTask,
  createDraftTask,
  defaultTaskPrefs,
  getTask,
  listTasks,
  updateTask,
} from "./tasks";
import { ARTIFACT_TOOL_NAMES, registerArtifactTools } from "./tools";

const PREFS_KEY = "prefs:structured-defaults";
const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "cache-control": "no-store",
  "content-security-policy": "sandbox; default-src 'none'",
};

function publishArtifacts(bb: BbPluginApi, taskId: string) {
  bb.realtime.publish("artifacts", { taskId });
  bb.realtime.publish("hl:artifacts", { taskId });
}

function isInlineSafeContentType(contentType: string) {
  return ["image/png", "image/jpeg", "image/gif", "image/webp", "text/plain", "text/markdown"].includes(contentType.toLowerCase());
}

function attachmentFileName(fileName: string) {
  return fileName.replaceAll("\\", "_").replaceAll("\"", "_").replaceAll("\r", "_").replaceAll("\n", "_");
}

export default async function plugin(bb: BbPluginApi) {
  const db = openPluginDatabase(bb);
  const sessionMirror = loadSessionMirror(db);
  const launchBindings = createLaunchBindingMirror();
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
    notificationVolume: {
      type: "string",
      label: "Notification volume",
      default: "0.2",
    },
    defaultWorkflowType: {
      type: "select",
      label: "Default workflow type",
      options: ["rpi", "prd_tdd", "oneshot", "freeform"],
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
    jumpHotkey: {
      type: "string",
      label: "Jump hotkey",
      default: "mod+shift+u",
    },
  });

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
      return result;
    },
    createTask: async ({ request, name, draft }) => {
      const storedPrefs = await bb.storage.kv.get<unknown>(PREFS_KEY);
      const prefs = prefsSchema.parse(storedPrefs ?? defaultTaskPrefs({}));
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
        if (request.workflowType !== "freeform" && request.workflowType !== "oneshot") {
          return { ...result, note: "available in a later release" };
        }
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
    launchDraft: async ({ taskId }) => launchDraft(bb, db, sessionMirror, launchBindings, taskId),
    listSessions: async ({ taskId }) => ({
      sessions: await Promise.all(listSessions(db, taskId ?? null).map((session) => sessionView(bb, session))),
    }),
    getSession: async ({ threadId }) => {
      const session = readSession(db, threadId);
      return { session: session ? await sessionView(bb, session) : null };
    },
    forkSession: async ({ threadId, text }) => forkSession(bb, db, sessionMirror, threadId, text),
    interruptSession: async ({ threadId }) => interruptSession(bb, db, sessionMirror, threadId),
    listLaunchAttempts: async ({ taskId }) => ({ attempts: listLaunchAttempts(db, taskId) }),
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
      const threadId = latestTaskThread(db, taskId);
      let mirror: MirrorFileOutcome = "skipped";
      if (threadId) mirror = await mirrorRestoredArtifact(bb, db, taskId, threadId, fileName).catch((error) => {
        bb.log.warn(`Failed to restore HumanLayer artifact: ${String(error)}`);
        return "conflict" as const;
      });
      const artifact = restoreArtifact(db, taskId, fileName);
      publishArtifacts(bb, taskId);
      return { artifact, mirror };
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
          reasoningLevel: patch.defaults?.reasoningLevel ?? current.defaults.reasoningLevel ?? null,
          serviceTier: patch.defaults?.serviceTier ?? current.defaults.serviceTier ?? null,
        },
      };
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
          const result = createDraftTask(db, {
            projectId,
            prompt,
            name: opts.name,
            hostId: opts.host ?? null,
            defaultDirectory: opts.directory ?? null,
            workflowType: "freeform",
            worktreeTiming: "never",
            permissionMode: "default",
            autoAdvance: false,
            providerId: opts.provider ?? null,
            model: opts.model ?? null,
            reasoningLevel: opts.effort ?? null,
            serviceTier: null,
          });
          const launched = opts.launch === "true" ? await launchDraft(bb, db, sessionMirror, launchBindings, result.taskId) : null;
          const body = { ...result, ...(launched ?? {}) };
          return { exitCode: 0, stdout: json ? `${JSON.stringify(body)}\n` : `${body.taskId}${launched ? ` ${launched.threadId}` : ""}\n` };
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
        return { exitCode: 2, stderr: "usage: bb humanlayer {tasks|sessions|artifacts} ...\n" };
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

  registerArtifactTools(bb, db, sessionMirror);

  bb.agents.configure((context) => {
    bindPendingThread(db, sessionMirror, launchBindings, context.thread.id);
    return sessionMirror.has(context.thread.id) ? { tools: [...ARTIFACT_TOOL_NAMES], skills: [] } : { tools: [], skills: [] };
  });
  bb.agents.contributeInstructions(({ threadId }) => {
    const row = sessionMirror.get(threadId) ?? bindPendingThread(db, sessionMirror, launchBindings, threadId);
    return row ? taskInstructions(row) : null;
  });

  registerSessionRuntime(bb, db, sessionMirror, launchBindings);

  bb.background.service("launch-attempt-sweep", {
    async start(signal) {
      while (!signal.aborted) {
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
