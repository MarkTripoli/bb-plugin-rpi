import { z } from "zod";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type * as BetterSqlite3 from "better-sqlite3";
import {
  artifactPanelPath,
  artifactPermalink,
  artifactSummary,
  getArtifact,
  getArtifactVersion,
  isTextArtifact,
  listArtifacts,
  markdownHeadings,
  markdownSection,
  nextArtifactNumber,
  selectContextArtifacts,
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
import { DEFAULT_E2E_PREFS, type E2ePrefs } from "./contract";
import { parseJson, readRow } from "./db";
import { phaseModelFor } from "./e2e";
import { parseEpicChildren } from "./epic";
import { parsePhaseModels } from "./tasks";
import { ingest, hydrate } from "./mirror";
import { mirrorSession, resolveResearchModel, type ChildThreadMirrorRow, type SessionMirrorRow } from "./sessions";
import { lintWriting } from "./writing";

type Database = BetterSqlite3.Database;

export const ARTIFACT_TOOL_NAMES = [
  "rpi_task_context",
  "rpi_artifacts_list",
  "rpi_artifact_read",
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

function measuredJson<T extends { metrics: { emittedBytes: number } }>(value: T) {
  let output = JSON.stringify(value, null, 2);
  for (let index = 0; index < 3; index += 1) {
    value.metrics.emittedBytes = Buffer.byteLength(output, "utf8");
    const next = JSON.stringify(value, null, 2);
    if (next === output) break;
    output = next;
  }
  return output;
}

type SessionSummary = {
  summaryHistory?: string[];
  relevantRPIDocuments?: Array<{ localpath?: string }>;
  primaryReviewArtifact?: { fileName?: unknown } | null;
};

function primaryReviewArtifactName(summary: SessionSummary) {
  const fileName = summary.primaryReviewArtifact?.fileName;
  return typeof fileName === "string" && fileName.length > 0 && fileName.length <= 255 ? fileName : null;
}

function artifactNamesFromSummary(summaryJson: string | null | undefined) {
  const summary = parseJson<SessionSummary>(summaryJson, {});
  const primary = primaryReviewArtifactName(summary);
  return [primary, ...(summary.relevantRPIDocuments ?? [])
    .map((document) => document.localpath?.split("/").pop())
  ]
    .filter((fileName): fileName is string => Boolean(fileName));
}

function assignmentContext(db: Database, sessionThreadId: string) {
  const attempt = readRow<{ commandLine: string | null; fromThreadId: string | null; targetPhase: number | null }>(
    db,
    "SELECT command_line AS commandLine, from_thread_id AS fromThreadId, target_phase AS targetPhase FROM launch_attempts WHERE thread_id = ? ORDER BY created_at DESC LIMIT 1",
    sessionThreadId,
  );
  const previous = attempt?.fromThreadId
    ? readRow<{ summaryJson: string | null }>(db, "SELECT summary_json AS summaryJson FROM sessions WHERE thread_id = ?", attempt.fromThreadId)
    : undefined;
  const previousAttempt = attempt?.fromThreadId
    ? readRow<{ commandLine: string | null }>(db, "SELECT command_line AS commandLine FROM launch_attempts WHERE thread_id = ? ORDER BY created_at DESC LIMIT 1", attempt.fromThreadId)
    : undefined;
  const previousSummary = parseJson<SessionSummary>(previous?.summaryJson, {});
  const primaryReviewArtifact = primaryReviewArtifactName(previousSummary);
  return {
    commandLine: attempt?.commandLine ?? null,
    previousCommandLine: previousAttempt?.commandLine ?? null,
    fromThreadId: attempt?.fromThreadId ?? null,
    previousArtifactNames: artifactNamesFromSummary(previous?.summaryJson),
    fallbackSummary: previousSummary.summaryHistory?.at(-1)?.slice(0, 600) ?? null,
    approvedPhase: Number.isSafeInteger(attempt?.targetPhase) && (attempt?.targetPhase ?? 0) > 0 ? attempt!.targetPhase : null,
    primaryReviewArtifact,
  };
}

const artifactContextSchema = z.object({
  name: z.string(),
  type: z.string(),
  version: z.number().int().positive(),
  sha256: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  summary: z.string().nullable(),
  reason: z.enum(["command", "previous-session", "checkpoint", "phase-input"]),
}).strict();

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
  assignment: z.object({
    skillId: z.string().nullable(),
    phase: z.string().nullable(),
    commandLine: z.string().nullable(),
    fromThreadId: z.string().nullable(),
    approvedPhase: z.number().int().positive().nullable(),
    primaryReviewArtifact: z.string().nullable(),
  }).strict(),
  checkpoint: z.object({
    status: z.enum(["available", "missing", "withheld"]),
    fileName: z.string().nullable(),
    version: z.number().int().positive().nullable(),
    sha256: z.string().nullable(),
    previousThreadId: z.string().nullable(),
    fallbackSummary: z.string().nullable(),
  }).strict(),
  artifacts: z.array(artifactContextSchema).max(12),
  discovery: z.object({
    total: z.number().int().nonnegative(),
    selected: z.number().int().nonnegative(),
    remaining: z.number().int().nonnegative(),
    tool: z.literal("rpi_artifacts_list"),
  }).strict(),
  metrics: z.object({ emittedBytes: z.number().int().nonnegative() }).strict(),
}).strict();

export function registerArtifactTools(
  bb: BbPluginApi,
  db: Database,
  mirror: Map<string, SessionMirrorRow>,
  childThreads = new Map<string, ChildThreadMirrorRow>(),
  options: { getResearchModel?: () => string | null; getE2ePrefs?: () => E2ePrefs } = {},
) {
  const hydrationByTask = new Map<string, Promise<void>>();

  bb.agents.registerTool({
    name: "rpi_task_context",
    description: "Return the current RPI assignment and its small, phase-aware artifact manifest.",
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
      const assignment = assignmentContext(db, sessionThreadId);
      const selected = selectContextArtifacts(allArtifacts, {
        phase: row.label?.replace(/^rpi:/, "") ?? null,
        commandLine: assignment.commandLine,
        previousCommandLine: assignment.previousCommandLine,
        previousArtifactNames: assignment.previousArtifactNames,
      });
      const artifacts = selected.map((artifact) => ({
        name: artifact.fileName,
        type: artifact.type,
        version: artifact.currentVersion,
        sha256: artifact.currentSha256 ?? "",
        sizeBytes: artifact.sizeBytes,
        summary: artifactSummary(artifact.frontmatter),
        reason: artifact.reason,
      }));
      const handoff = selected.find((artifact) => artifact.fileName === "handoff.md");
      const researchContext = row.label?.replace(/^rpi:/, "") === "research";
      const taskWorkspace = db.prepare(`
        SELECT default_directory AS defaultDirectory, base_environment_id AS baseEnvironmentId,
          worktree_environment_id AS worktreeEnvironmentId, worktree_timing AS worktreeTiming,
          e2e_mode AS e2eMode, phase_models AS phaseModelsJson
        FROM tasks WHERE id = ?
      `).get(row.taskId) as { defaultDirectory: string | null; baseEnvironmentId: string | null; worktreeEnvironmentId: string | null; worktreeTiming: string; e2eMode: number | null; phaseModelsJson: string | null } | undefined;
      const thread = await bb.sdk.threads.get({ threadId, include: "environment" }).catch(() => null) as { environment?: { id?: string | null; path?: string | null; branchName?: string | null } | null; environmentId?: string | null } | null;
      const e2ePrefs = options.getE2ePrefs?.() ?? DEFAULT_E2E_PREFS;
      const phaseModel = phaseModelFor(
        { e2eMode: taskWorkspace?.e2eMode ?? 0, phaseModels: parsePhaseModels(taskWorkspace?.phaseModelsJson ?? null) },
        row.label?.replace(/^rpi:/, "") ?? null,
        e2ePrefs,
      );
      const phaseModelString = phaseModel ? `${phaseModel.providerId} ${phaseModel.model}` : null;
      const researchModel = phaseModelString ?? resolveResearchModel(row, options.getResearchModel?.() ?? null);
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
          providerId: phaseModel?.providerId ?? row.providerId,
          model: phaseModel?.model ?? row.model,
        },
        assignment: {
          skillId: row.skillId,
          phase: row.label,
          commandLine: assignment.commandLine,
          fromThreadId: assignment.fromThreadId,
          approvedPhase: assignment.approvedPhase,
          primaryReviewArtifact: assignment.primaryReviewArtifact,
        },
        checkpoint: {
          status: researchContext ? "withheld" : handoff ? "available" : "missing",
          fileName: handoff?.fileName ?? null,
          version: handoff?.currentVersion ?? null,
          sha256: handoff?.currentSha256 ?? null,
          previousThreadId: assignment.fromThreadId,
          fallbackSummary: researchContext || handoff ? null : assignment.fallbackSummary,
        },
        artifacts,
        discovery: {
          total: allArtifacts.length,
          selected: artifacts.length,
          remaining: Math.max(0, allArtifacts.length - artifacts.length),
          tool: "rpi_artifacts_list",
        },
        metrics: { emittedBytes: 0 },
      });
      return measuredJson(output);
    },
  });

  bb.agents.registerTool({
    name: "rpi_artifacts_list",
    description: "List a bounded page of current artifact metadata when the selected task context is insufficient.",
    presentation: {
      label: { pending: "Listing task artifacts", completed: "Listed task artifacts" },
      icon: { glyph: "List" },
    },
    parameters: z.object({
      offset: z.number().int().nonnegative().optional().default(0),
      limit: z.number().int().positive().max(25).optional().default(20),
    }).strict(),
    async execute({ offset, limit }, { threadId }) {
      try {
        const { row } = taskSession(mirror, childThreads, threadId);
        const all = listArtifacts(db, row.taskId);
        const artifacts = all.slice(offset, offset + limit).map((artifact) => ({
          name: artifact.fileName,
          type: artifact.type,
          version: artifact.currentVersion,
          sha256: artifact.currentSha256,
          sizeBytes: artifact.sizeBytes,
          summary: artifactSummary(artifact.frontmatter),
        }));
        return toolJson({ artifacts, offset, limit, total: all.length, nextOffset: offset + artifacts.length < all.length ? offset + artifacts.length : null });
      } catch (error) {
        return toolError(error);
      }
    },
  });

  bb.agents.registerTool({
    name: "rpi_artifact_read",
    description: "Read a bounded chunk of one exact text artifact revision. Continue with nextOffset until complete.",
    presentation: {
      label: { pending: "Reading task artifact", completed: "Read task artifact" },
      icon: { glyph: "FileText" },
    },
    parameters: z.object({
      file_name: z.string().min(1),
      version: z.number().int().positive().optional(),
      heading: z.string().trim().min(1).max(200).optional(),
      offset: z.number().int().nonnegative().optional().default(0),
      max_chars: z.number().int().positive().max(20_000).optional().default(12_000),
    }).strict(),
    async execute({ file_name, version, heading, offset, max_chars }, { threadId }) {
      try {
        const { row } = taskSession(mirror, childThreads, threadId);
        const artifact = artifactForTool(db, row.taskId, file_name);
        if (!isTextArtifact(artifact.fileName, artifact.contentType)) throw new Error("artifact is not text");
        const result = getArtifactVersion(db, row.taskId, file_name, version);
        if (!result) throw new Error(`artifact version not found: ${file_name} v${version ?? artifact.currentVersion}`);
        const fullContent = result.version.content.toString("utf8");
        const section = heading ? markdownSection(fullContent, heading) : null;
        if (heading && !section) throw new Error(`heading not found: ${heading}`);
        const content = section?.content ?? fullContent;
        if (offset > content.length) throw new Error("offset exceeds artifact length");
        const chunk = content.slice(offset, offset + max_chars);
        const nextOffset = offset + chunk.length < content.length ? offset + chunk.length : null;
        return toolJson({
          name: artifact.fileName,
          version: result.version.version,
          currentVersion: artifact.currentVersion,
          sha256: result.version.sha256,
          heading: heading ?? null,
          startLine: section?.startLine ?? 1,
          endLine: section?.endLine ?? fullContent.split(/\r?\n/).length,
          headings: offset === 0 ? markdownHeadings(fullContent).slice(0, 50) : [],
          offset,
          nextOffset,
          complete: nextOffset === null,
          returnedChars: chunk.length,
          returnedBytes: Buffer.byteLength(chunk, "utf8"),
          content: chunk,
        });
      } catch (error) {
        return toolError(error);
      }
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
      if (!artifact) {
        const directory = result.artifactDir ? ` (task artifact directory: ${result.artifactDir})` : "";
        throw new Error(`artifact not found: ${file_name}${directory}. Write the file into the task artifact directory reported by rpi_task_context, using a bare name, then call rpi_artifact_save again.`);
      }
      const saved = fileName.endsWith(".md") ? getArtifactVersion(db, row.taskId, fileName) : null;
      const savedText = saved ? saved.version.content.toString("utf8") : null;
      const writingIssues = savedText ? lintWriting(savedText) : [];
      // Keyed on the stored type (frontmatter or NN-epic-plan-* name) so save-time validation and
      // latestEpicPlan select the same files.
      const children = savedText && artifact.type === "epic-plan" ? parseEpicChildren(savedText) : null;
      return JSON.stringify({
        version: artifact.currentVersion,
        ingested: result.ingested,
        permalink: artifactPermalink(row.taskId, artifact.fileName),
        path: artifactPanelPath(row.taskId, artifact.fileName),
        ...(writingIssues.length > 0
          ? {
              writing_issues: writingIssues,
              writing_action: "Rewrite each listed line per the RPI writing guide (delete the filler or state the fact), then call rpi_artifact_save again before replying.",
            }
          : {}),
        ...(children && !children.ok
          ? {
              children_issues: children.issues,
              children_action: "Fix the ## Children json block (one object per child: name, workflow, prompt, depends_on) and call rpi_artifact_save again before replying.",
            }
          : {}),
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
