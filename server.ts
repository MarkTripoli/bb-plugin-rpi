import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { prefsSchema, prefsUpdateSchema, rpcContract } from "./contract";
import { openPluginDatabase } from "./db";
import {
  forkSession,
  interruptSession,
  launchDraft,
  listLaunchAttempts,
  resolveLaunchAttempt,
} from "./launch";
import {
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

const PREFS_KEY = "prefs:structured-defaults";

export default async function plugin(bb: BbPluginApi) {
  const db = openPluginDatabase(bb);
  const sessionMirror = loadSessionMirror(db);
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
        const launched = await launchDraft(bb, db, sessionMirror, result.taskId);
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
    launchDraft: async ({ taskId }) => launchDraft(bb, db, sessionMirror, taskId),
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
    resolveLaunchAttempt: async ({ id, action }) => resolveLaunchAttempt(bb, db, sessionMirror, id, action),
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
        usage: "bb humanlayer tasks create --name <name> --project <projectId> --prompt <text> [--launch] [--provider <id>] [--model <id>] [--json]",
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
            workflowType: "freeform",
            worktreeTiming: "never",
            permissionMode: "default",
            autoAdvance: false,
            providerId: opts.provider ?? null,
            model: opts.model ?? null,
            reasoningLevel: opts.effort ?? null,
            serviceTier: null,
          });
          const launched = opts.launch === "true" ? await launchDraft(bb, db, sessionMirror, result.taskId) : null;
          const body = { ...result, ...(launched ?? {}) };
          return { exitCode: 0, stdout: json ? `${JSON.stringify(body)}\n` : `${body.taskId}${launched ? ` ${launched.threadId}` : ""}\n` };
        }
        if (argv[0] === "tasks" && argv[1] === "list") {
          const tasks = listTasks(db, { archived: false });
          return { exitCode: 0, stdout: json ? `${JSON.stringify({ tasks })}\n` : tasks.map((task) => `${task.id}\t${task.stepLabel}\t${task.name}`).join("\n") + "\n" };
        }
        if (argv[0] === "sessions" && argv[1] === "list") {
          const opts = parseArgs(argv.slice(2));
          const sessions = listSessions(db, opts.task ?? null);
          return { exitCode: 0, stdout: json ? `${JSON.stringify({ sessions })}\n` : sessions.map((session) => `${session.threadId}\t${session.hlStatus}\t${session.label ?? ""}`).join("\n") + "\n" };
        }
        return { exitCode: 2, stderr: "usage: bb humanlayer {tasks|sessions} ...\n" };
      } catch (error) {
        return { exitCode: 1, stderr: `${String(error instanceof Error ? error.message : error)}\n` };
      }
    },
  });

  bb.agents.configure((context) => (sessionMirror.has(context.thread.id) ? { tools: [], skills: [] } : { tools: [], skills: [] }));
  bb.agents.contributeInstructions(({ threadId }) => {
    const row = sessionMirror.get(threadId);
    return row ? taskInstructions(row) : null;
  });

  registerSessionRuntime(bb, db, sessionMirror);

  bb.onDispose(() => {
    db.close();
  });
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
      if (value && !value.startsWith("--")) {
        result[key] = value;
        index += 1;
      }
    }
  }
  return result;
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
