import { z } from "zod";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type * as BetterSqlite3 from "better-sqlite3";
import {
  artifactPanelPath,
  artifactPermalink,
  getArtifact,
  getArtifactVersion,
  listArtifacts,
  nextArtifactNumber,
} from "./artifacts";
import {
  boundedAgentXml,
  listComments,
  replyToComment,
  resolveTruncatedId,
  restoreComments,
  setCommentsResolved,
  softDeleteComments,
} from "./comments";
import { TASK_ROOT_DIR } from "./constants";
import { ingest, hydrate } from "./mirror";
import { mirrorSession, resolveResearchModel, type ChildThreadMirrorRow, type SessionMirrorRow } from "./sessions";

type Database = BetterSqlite3.Database;

export const ARTIFACT_TOOL_NAMES = [
  "rpi_task_context",
  "rpi_artifact_save",
  "rpi_next_artifact_number",
  "rpi_get_artifact_comments",
  "rpi_update_artifact_comments",
  "rpi_reply_to_artifact_comment",
] as const;

function taskSession(
  mirror: Map<string, SessionMirrorRow>,
  childThreads: Map<string, ChildThreadMirrorRow>,
  threadId: string | null | undefined,
) {
  if (!threadId) throw new Error("not an RPI task session");
  const row = threadId ? mirror.get(threadId) : null;
  if (row) return { row, sessionThreadId: threadId };
  const child = threadId ? childThreads.get(threadId) : null;
  const parent = child ? mirror.get(child.parentThreadId) : null;
  if (child && parent && child.taskId === parent.taskId) return { row: parent, sessionThreadId: child.parentThreadId };
  throw new Error("not an RPI task session");
}

function trimToolContent(value: string) {
  return value.length > 20_000 ? `${value.slice(0, 20_000)}\n[truncated]` : value;
}

function artifactForTool(db: Database, taskId: string, fileName: string) {
  const artifact = getArtifact(db, taskId, fileName);
  if (!artifact || artifact.isDeleted) throw new Error(`artifact not found: ${fileName}`);
  return artifact;
}

function toolError(error: unknown) {
  return { content: [{ type: "text" as const, text: String(error instanceof Error ? error.message : error) }], isError: true };
}

function toolJson(value: unknown, isError = false) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }], isError };
}

export const hlTaskContextOutputSchema = z.object({
  task: z.object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    workflow: z.string(),
    currentLabel: z.string().nullable(),
    artifactDir: z.string(),
  }).strict(),
  workspace: z.object({
    worktreeTiming: z.string().nullable(),
    defaultDirectory: z.string().nullable(),
    baseEnvironmentId: z.string().nullable(),
    worktreeEnvironmentId: z.string().nullable(),
    currentEnvironmentId: z.string().nullable(),
    currentPath: z.string().nullable(),
    currentBranch: z.string().nullable(),
    sessionThreadId: z.string(),
    currentThreadId: z.string(),
  }).strict(),
  prefs: z.object({
    researchModel: z.string(),
    researchSubagentModel: z.string(),
    providerId: z.string().nullable(),
    model: z.string().nullable(),
  }).strict(),
  artifacts: z.array(z.object({
    name: z.string(),
    type: z.string(),
    version: z.number().int(),
  }).strict()),
  taskMd: z.string().nullable(),
}).strict();

export function registerArtifactTools(
  bb: BbPluginApi,
  db: Database,
  mirror: Map<string, SessionMirrorRow>,
  childThreads = new Map<string, ChildThreadMirrorRow>(),
  options: { getResearchModel?: () => string | null } = {},
) {
  const hydrationByTask = new Map<string, Promise<void>>();

  bb.agents.registerTool({
    name: "rpi_task_context",
    description: "Return the current RPI task context and artifact manifest.",
    presentation: {
      label: { pending: "Loading task context", completed: "Loaded task context" },
      icon: { glyph: "Folder" },
    },
    parameters: z.object({}).strict(),
    async execute(_input, { threadId }) {
      const { row, sessionThreadId } = taskSession(mirror, childThreads, threadId);
      if (row.hydratedAt === null) {
        let hydration = hydrationByTask.get(row.taskId);
        if (!hydration) {
          hydration = hydrate(bb, db, row.taskId, threadId)
            .then(() => {
              mirrorSession(db, mirror, sessionThreadId);
            })
            .finally(() => {
              hydrationByTask.delete(row.taskId);
            });
          hydrationByTask.set(row.taskId, hydration);
        }
        await hydration;
        mirrorSession(db, mirror, sessionThreadId);
      }
      const allArtifacts = listArtifacts(db, row.taskId);
      const artifacts = allArtifacts.slice(0, 200).map((artifact) => ({
        name: artifact.fileName,
        type: artifact.type,
        version: artifact.currentVersion,
      }));
      if (allArtifacts.length > artifacts.length) {
        artifacts.push({ name: "[truncated]", type: "other", version: 0 });
      }
      const task = getArtifactVersion(db, row.taskId, "task.md");
      const taskWorkspace = db.prepare(`
        SELECT default_directory AS defaultDirectory, base_environment_id AS baseEnvironmentId,
          worktree_environment_id AS worktreeEnvironmentId, worktree_timing AS worktreeTiming
        FROM tasks WHERE id = ?
      `).get(row.taskId) as { defaultDirectory: string | null; baseEnvironmentId: string | null; worktreeEnvironmentId: string | null; worktreeTiming: string } | undefined;
      const thread = await bb.sdk.threads.get({ threadId, include: "environment" }).catch(() => null) as { environment?: { id?: string | null; path?: string | null; branchName?: string | null } | null; environmentId?: string | null } | null;
      const researchModel = resolveResearchModel(row, options.getResearchModel?.() ?? null);
      const output = hlTaskContextOutputSchema.parse({
        task: {
          id: row.taskId,
          name: row.taskName,
          slug: row.taskSlug,
          workflow: row.workflowType,
          currentLabel: row.label,
          artifactDir: `${TASK_ROOT_DIR}/tasks/${row.taskSlug}`,
        },
        workspace: {
          worktreeTiming: taskWorkspace?.worktreeTiming ?? null,
          defaultDirectory: taskWorkspace?.defaultDirectory ?? null,
          baseEnvironmentId: taskWorkspace?.baseEnvironmentId ?? null,
          worktreeEnvironmentId: taskWorkspace?.worktreeEnvironmentId ?? null,
          currentEnvironmentId: thread?.environment?.id ?? thread?.environmentId ?? null,
          currentPath: thread?.environment?.path ?? null,
          currentBranch: thread?.environment?.branchName ?? null,
          sessionThreadId,
          currentThreadId: threadId,
        },
        prefs: {
          researchModel,
          researchSubagentModel: researchModel,
          providerId: row.providerId,
          model: row.model,
        },
        artifacts,
        taskMd: task ? trimToolContent(task.version.content.toString("utf8")) : null,
      });
      return JSON.stringify(output, null, 2);
    },
  });

  bb.agents.registerTool({
    name: "rpi_artifact_save",
    description: "Ingest one task artifact file from the workspace and return its RPI permalink.",
    presentation: {
      label: { pending: "Saving artifact", completed: "Saved artifact" },
      icon: { glyph: "Code" },
    },
    parameters: z.object({ file_name: z.string().min(1) }).strict(),
    async execute({ file_name }, { threadId }) {
      const { row } = taskSession(mirror, childThreads, threadId);
      let fileName = file_name;
      let result = await ingest(bb, db, row.taskId, threadId, { threadId, fileName, operation: "ingest" });
      let artifact = getArtifact(db, row.taskId, fileName);
      if (!artifact && !fileName.includes(".")) {
        fileName = `${fileName}.md`;
        result = await ingest(bb, db, row.taskId, threadId, { threadId, fileName, operation: "ingest" });
        artifact = getArtifact(db, row.taskId, fileName);
      }
      if (!artifact) throw new Error(`artifact not found: ${file_name}`);
      return JSON.stringify({
        version: artifact.currentVersion,
        ingested: result.ingested,
        permalink: artifactPermalink(row.taskId, artifact.fileName),
        path: artifactPanelPath(row.taskId, artifact.fileName),
      }, null, 2);
    },
  });

  bb.agents.registerTool({
    name: "rpi_next_artifact_number",
    description: "Return the next zero-padded artifact number for this RPI task.",
    presentation: {
      label: { pending: "Allocating artifact number", completed: "Allocated artifact number" },
      icon: { glyph: "ListTodo" },
    },
    parameters: z.object({}).strict(),
    async execute(_input, { threadId }) {
      const { row } = taskSession(mirror, childThreads, threadId);
      return JSON.stringify({ next: nextArtifactNumber(db, row.taskId) });
    },
  });

  bb.agents.registerTool({
    name: "rpi_get_artifact_comments",
    description: "Return threaded RPI artifact comments as XML.",
    presentation: {
      label: { pending: "Loading comments", completed: "Loaded comments" },
      icon: { glyph: "MessageSquare" },
    },
    parameters: z.object({
      artifact_filename: z.string().min(1),
      include_resolved: z.boolean().optional().default(false),
      limit: z.number().int().positive().max(100).optional().default(50),
      offset: z.number().int().nonnegative().optional().default(0),
    }).strict(),
    async execute({ artifact_filename, include_resolved, limit, offset }, { threadId }) {
      try {
        const { row } = taskSession(mirror, childThreads, threadId);
        const artifact = artifactForTool(db, row.taskId, artifact_filename);
        return boundedAgentXml(listComments(db, artifact.id, { includeResolved: include_resolved, limit, offset }));
      } catch (error) {
        return toolError(error);
      }
    },
  });

  bb.agents.registerTool({
    name: "rpi_update_artifact_comments",
    description: "Resolve, unresolve, or delete RPI artifact comments by id prefix.",
    presentation: {
      label: { pending: "Updating comments", completed: "Updated comments" },
      icon: { glyph: "Check" },
    },
    parameters: z.object({
      artifact_filename: z.string().min(1),
      comment_ids: z.array(z.string().min(1)).min(1).max(100),
      resolved: z.boolean().optional(),
      deleted: z.boolean().optional(),
    }).strict(),
    async execute({ artifact_filename, comment_ids, resolved, deleted }, { threadId }) {
      try {
        const { row } = taskSession(mirror, childThreads, threadId);
        const artifact = artifactForTool(db, row.taskId, artifact_filename);
        if (resolved === undefined && deleted === undefined) throw new Error("resolved or deleted is required");
        const results = comment_ids.map((input) => {
          const match = resolveTruncatedId(db, artifact.id, input, { includeDeleted: deleted === false });
          if (!match.ok) return { input, ok: false as const, code: match.code };
          const comment = db.prepare("SELECT reply_to_id AS replyToId FROM comments WHERE id = ?").get(match.id) as { replyToId: string | null } | undefined;
          if (resolved !== undefined && comment?.replyToId !== null) return { input, ok: false as const, code: "not_a_root" as const };
          return { input, id: match.id, ok: true as const };
        });
        const ids = results.filter((result): result is { input: string; id: string; ok: true } => result.ok).map((result) => result.id);
        if (results.some((result) => !result.ok && (result.code === "ambiguous" || result.code === "not_found"))) return toolJson({ results }, true);
        if (resolved !== undefined) {
          const resolvedResults = setCommentsResolved(db, ids, resolved, artifact.id);
          for (const result of resolvedResults) {
            if (!result.ok) {
              const index = results.findIndex((item) => item.ok && item.id === result.input);
              if (index >= 0) results[index] = { input: results[index]!.input, ok: false, code: result.code };
            }
          }
        }
        if (deleted === true) softDeleteComments(db, ids, artifact.id);
        if (deleted === false) restoreComments(db, ids, artifact.id);
        if (ids.length > 0) {
          bb.realtime.publish("rpi:comments", { taskId: row.taskId, artifactId: artifact.id, commentId: null, createdByAgent: true, kind: deleted === undefined ? "resolved" : "deleted" });
          bb.realtime.publish("rpi:artifacts", { taskId: row.taskId });
        }
        return toolJson({ results }, results.some((result) => !result.ok));
      } catch (error) {
        return toolError(error);
      }
    },
  });

  bb.agents.registerTool({
    name: "rpi_reply_to_artifact_comment",
    description: "Reply to an RPI artifact comment by id prefix.",
    presentation: {
      label: { pending: "Replying to comment", completed: "Replied to comment" },
      icon: { glyph: "MessageSquare" },
    },
    parameters: z.object({
      artifact_filename: z.string().min(1),
      comment_id: z.string().min(1),
      content: z.string().min(1).max(10000),
    }).strict(),
    async execute({ artifact_filename, comment_id, content }, { threadId }) {
      try {
        const { row } = taskSession(mirror, childThreads, threadId);
        const artifact = artifactForTool(db, row.taskId, artifact_filename);
        const match = resolveTruncatedId(db, artifact.id, comment_id);
        if (!match.ok) return toolJson({ ok: false, code: match.code }, true);
        const comment = replyToComment(db, artifact.id, match.id, content, { createdByAgent: true, createdByThreadId: threadId });
        if (!comment) return toolJson({ ok: false, code: "not_a_root" }, true);
        bb.realtime.publish("rpi:comments", { taskId: row.taskId, artifactId: artifact.id, commentId: comment.id, createdByAgent: true, kind: "replied" });
        bb.realtime.publish("rpi:artifacts", { taskId: row.taskId });
        return toolJson({ ok: true, comment_id: comment.id.slice(0, 8) });
      } catch (error) {
        return toolError(error);
      }
    },
  });
}
