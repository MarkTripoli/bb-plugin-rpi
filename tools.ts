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
import { ingest, hydrate } from "./mirror";
import { mirrorSession, type SessionMirrorRow } from "./sessions";

type Database = BetterSqlite3.Database;

export const ARTIFACT_TOOL_NAMES = ["hl_task_context", "hl_artifact_save", "hl_next_artifact_number"] as const;

function taskSession(mirror: Map<string, SessionMirrorRow>, threadId: string | null | undefined) {
  const row = threadId ? mirror.get(threadId) : null;
  if (!row) throw new Error("not a HumanLayer task session");
  return row;
}

function trimToolContent(value: string) {
  return value.length > 20_000 ? `${value.slice(0, 20_000)}\n[truncated]` : value;
}

export function registerArtifactTools(bb: BbPluginApi, db: Database, mirror: Map<string, SessionMirrorRow>) {
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
        await hydrate(bb, db, row.taskId, threadId);
        mirrorSession(db, mirror, threadId);
      }
      const artifacts = listArtifacts(db, row.taskId).map((artifact) => ({
        fileName: artifact.fileName,
        type: artifact.type,
        groupType: artifact.groupType,
        version: artifact.currentVersion,
        permalink: artifactPermalink(row.taskId, artifact.fileName),
        path: artifactPanelPath(row.taskId, artifact.fileName),
      }));
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
}
