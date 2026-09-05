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
  setCommentsResolved,
  softDeleteComments,
} from "./comments";
import { ingest, hydrate } from "./mirror";
import { mirrorSession, type SessionMirrorRow } from "./sessions";

type Database = BetterSqlite3.Database;

export const ARTIFACT_TOOL_NAMES = [
  "hl_task_context",
  "hl_artifact_save",
  "hl_next_artifact_number",
  "hl_get_artifact_comments",
  "hl_update_artifact_comments",
  "hl_reply_to_artifact_comment",
] as const;

function taskSession(mirror: Map<string, SessionMirrorRow>, threadId: string | null | undefined) {
  const row = threadId ? mirror.get(threadId) : null;
  if (!row) throw new Error("not a HumanLayer task session");
  return row;
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

export function registerArtifactTools(bb: BbPluginApi, db: Database, mirror: Map<string, SessionMirrorRow>) {
  const hydrationByTask = new Map<string, Promise<void>>();

  bb.agents.registerTool({
    name: "hl_task_context",
    description: "Return the current HumanLayer task context and artifact manifest.",
    presentation: {
      label: { pending: "Loading task context", completed: "Loaded task context" },
      icon: { glyph: "Folder" },
    },
    parameters: z.object({}).strict(),
    async execute(_input, { threadId }) {
      const row = taskSession(mirror, threadId);
      if (row.hydratedAt === null) {
        let hydration = hydrationByTask.get(row.taskId);
        if (!hydration) {
          hydration = hydrate(bb, db, row.taskId, threadId)
            .then(() => {
              mirrorSession(db, mirror, threadId);
            })
            .finally(() => {
              hydrationByTask.delete(row.taskId);
            });
          hydrationByTask.set(row.taskId, hydration);
        }
        await hydration;
        mirrorSession(db, mirror, threadId);
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
      return JSON.stringify({
        task: {
          id: row.taskId,
          name: row.taskName,
          slug: row.taskSlug,
          workflow: row.workflowType,
          currentLabel: row.label,
          artifactDir: `.humanlayer/tasks/${row.taskSlug}`,
        },
        artifacts,
        taskMd: task ? trimToolContent(task.version.content.toString("utf8")) : null,
      }, null, 2);
    },
  });

  bb.agents.registerTool({
    name: "hl_artifact_save",
    description: "Ingest one task artifact file from the workspace and return its HumanLayer permalink.",
    presentation: {
      label: { pending: "Saving artifact", completed: "Saved artifact" },
      icon: { glyph: "Code" },
    },
    parameters: z.object({ file_name: z.string().min(1) }).strict(),
    async execute({ file_name }, { threadId }) {
      const row = taskSession(mirror, threadId);
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
    name: "hl_next_artifact_number",
    description: "Return the next zero-padded artifact number for this HumanLayer task.",
    presentation: {
      label: { pending: "Allocating artifact number", completed: "Allocated artifact number" },
      icon: { glyph: "ListTodo" },
    },
    parameters: z.object({}).strict(),
    async execute(_input, { threadId }) {
      const row = taskSession(mirror, threadId);
      return JSON.stringify({ next: nextArtifactNumber(db, row.taskId) });
    },
  });

  bb.agents.registerTool({
    name: "hl_get_artifact_comments",
    description: "Return threaded HumanLayer artifact comments as XML.",
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
        const row = taskSession(mirror, threadId);
        const artifact = artifactForTool(db, row.taskId, artifact_filename);
        return boundedAgentXml(listComments(db, artifact.id, { includeResolved: include_resolved, limit, offset }));
      } catch (error) {
        return toolError(error);
      }
    },
  });

  bb.agents.registerTool({
    name: "hl_update_artifact_comments",
    description: "Resolve, unresolve, or delete HumanLayer artifact comments by id prefix.",
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
        const row = taskSession(mirror, threadId);
        const artifact = artifactForTool(db, row.taskId, artifact_filename);
        if (resolved === undefined && deleted === undefined) throw new Error("resolved or deleted is required");
        const results = comment_ids.map((input) => {
          const match = resolveTruncatedId(db, artifact.id, input);
          return match.ok ? { input, id: match.id, ok: true as const } : { input, ok: false as const, code: match.code };
        });
        const ids = results.filter((result): result is { input: string; id: string; ok: true } => result.ok).map((result) => result.id);
        if (resolved !== undefined) setCommentsResolved(db, ids, resolved);
        if (deleted !== undefined) softDeleteComments(db, ids);
        if (ids.length > 0) {
          bb.realtime.publish("hl:comments", { taskId: row.taskId, artifactId: artifact.id, commentId: null, createdByAgent: true });
          bb.realtime.publish("hl:artifacts", { taskId: row.taskId });
        }
        return JSON.stringify({ results }, null, 2);
      } catch (error) {
        return toolError(error);
      }
    },
  });

  bb.agents.registerTool({
    name: "hl_reply_to_artifact_comment",
    description: "Reply to a HumanLayer artifact comment by id prefix.",
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
        const row = taskSession(mirror, threadId);
        const artifact = artifactForTool(db, row.taskId, artifact_filename);
        const match = resolveTruncatedId(db, artifact.id, comment_id);
        if (!match.ok) return JSON.stringify({ ok: false, code: match.code });
        const comment = replyToComment(db, artifact.id, match.id, content, { createdByAgent: true, createdByThreadId: threadId });
        if (!comment) return JSON.stringify({ ok: false, code: "not_found" });
        bb.realtime.publish("hl:comments", { taskId: row.taskId, artifactId: artifact.id, commentId: comment.id, createdByAgent: true });
        bb.realtime.publish("hl:artifacts", { taskId: row.taskId });
        return JSON.stringify({ ok: true, comment_id: comment.id.slice(0, 8) });
      } catch (error) {
        return toolError(error);
      }
    },
  });
}
