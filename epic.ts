// Pure epic logic: the children block parser for an epic plan artifact, the ready set the
// scheduler launches next, the dependency-depth grouping the epic page renders, and the child
// state rollup. No database, no bb API; server.ts and advance.ts wire it.
import { z } from "zod";
import type { TaskRow } from "./contract";
import { TONE_ORDER, statusMeta, type StatusTone } from "./status";

export const DEFAULT_EPIC_MAX_PARALLEL = 2;
export const CHILD_WORKFLOW_TYPES = ["rpi", "outline_only", "prd_tdd", "oneshot", "freeform"] as const;

export const epicChildSchema = z.object({
  name: z.string().trim().min(1).max(120),
  workflow: z.enum(CHILD_WORKFLOW_TYPES),
  prompt: z.string().trim().min(1).max(10000),
  depends_on: z.array(z.string().trim().min(1)).default([]),
  worktree: z.enum(["now", "later", "never"]).optional(),
}).strict();
export type EpicChildSpec = z.infer<typeof epicChildSchema>;

export type EpicChildrenParse =
  | { ok: true; children: EpicChildSpec[] }
  | { ok: false; issues: string[] };

const CHILDREN_HEADING = /^##\s+Children\s*$/;
const SECTION_END = /^##\s/;
const JSON_FENCE = /```json\s*\n([\s\S]*?)```/;

function childrenSection(markdown: string): string | null {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => CHILDREN_HEADING.test(line));
  if (start === -1) return null;
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (SECTION_END.test(line)) break;
    body.push(line);
  }
  return body.join("\n");
}

// Finds the `## Children` section, then its first ```json fence; JSON.parse + zod. Issues name the
// zod path or the dependency fault. Rejects duplicate names, unknown or self dependencies, and cycles.
export function parseEpicChildren(markdown: string): EpicChildrenParse {
  const section = childrenSection(markdown);
  if (section === null) return { ok: false, issues: ["missing `## Children` section"] };
  const fence = JSON_FENCE.exec(section);
  if (!fence) return { ok: false, issues: ["missing ```json fence under `## Children`"] };
  let raw: unknown;
  try {
    raw = JSON.parse(fence[1]!);
  } catch (error) {
    return { ok: false, issues: [`invalid JSON in children block: ${error instanceof Error ? error.message : String(error)}`] };
  }
  const parsed = z.array(epicChildSchema).min(1).safeParse(raw);
  if (!parsed.success) {
    return { ok: false, issues: parsed.error.issues.map((issue) => `${issue.path.join(".") || "children"}: ${issue.message}`) };
  }
  const children = parsed.data;
  const issues: string[] = [];
  const names = new Set<string>();
  for (const child of children) {
    if (names.has(child.name)) issues.push(`duplicate child name: ${child.name}`);
    names.add(child.name);
  }
  for (const child of children) {
    for (const dependency of child.depends_on) {
      if (dependency === child.name) issues.push(`${child.name} depends on itself`);
      else if (!names.has(dependency)) issues.push(`${child.name} depends on unknown child: ${dependency}`);
    }
  }
  if (issues.length === 0) {
    const cycle = findCycle(children);
    if (cycle) issues.push(`dependency cycle: ${cycle.join(" -> ")}`);
  }
  return issues.length > 0 ? { ok: false, issues } : { ok: true, children };
}

function findCycle(children: EpicChildSpec[]): string[] | null {
  const edges = new Map(children.map((child) => [child.name, child.depends_on]));
  const state = new Map<string, "visiting" | "done">();
  const stack: string[] = [];
  const visit = (name: string): string[] | null => {
    const seen = state.get(name);
    if (seen === "done") return null;
    if (seen === "visiting") return [...stack.slice(stack.indexOf(name)), name];
    state.set(name, "visiting");
    stack.push(name);
    for (const dependency of edges.get(name) ?? []) {
      const found = visit(dependency);
      if (found) return found;
    }
    stack.pop();
    state.set(name, "done");
    return null;
  };
  for (const child of children) {
    const found = visit(child.name);
    if (found) return found;
  }
  return null;
}

// Explicit wins; oneshot/freeform default "now"; others "later".
export function childWorktreeTiming(spec: Pick<EpicChildSpec, "workflow" | "worktree">): "now" | "later" | "never" {
  if (spec.worktree) return spec.worktree;
  return spec.workflow === "oneshot" || spec.workflow === "freeform" ? "now" : "later";
}

type ChildLike = Pick<TaskRow, "id" | "isDraft" | "completed" | "archived" | "dependsOn" | "position">;

// Paused -> []; drafts whose every dependency id is completed or names no live child (deleted or
// archived, as childrenByDepth treats it), ordered by position, sliced to max(0, cap - runningIds.size).
export function readyChildren<T extends ChildLike>(
  epic: Pick<TaskRow, "epicPaused" | "maxParallel">,
  children: T[],
  runningIds: ReadonlySet<string>,
): T[] {
  if (epic.epicPaused) return [];
  const live = new Set(children.map((child) => child.id));
  const completed = new Set(children.filter((child) => child.completed).map((child) => child.id));
  const slots = Math.max(0, (epic.maxParallel ?? DEFAULT_EPIC_MAX_PARALLEL) - runningIds.size);
  return children
    .filter((child) => child.isDraft && !child.archived && !child.completed && !runningIds.has(child.id))
    .filter((child) => child.dependsOn.every((id) => !live.has(id) || completed.has(id)))
    .sort((left, right) => (left.position ?? Number.MAX_SAFE_INTEGER) - (right.position ?? Number.MAX_SAFE_INTEGER))
    .slice(0, slots);
}

// Depth 0 = no dependencies; depth n = 1 + max depth of dependencies; missing ids count as depth 0.
export function childrenByDepth<T extends ChildLike>(children: T[]): T[][] {
  const byId = new Map(children.map((child) => [child.id, child]));
  const depths = new Map<string, number>();
  const depthOf = (child: T, trail: Set<string>): number => {
    const known = depths.get(child.id);
    if (known !== undefined) return known;
    if (trail.has(child.id)) return 0;
    trail.add(child.id);
    let depth = 0;
    for (const id of child.dependsOn) {
      const dependency = byId.get(id);
      if (dependency) depth = Math.max(depth, depthOf(dependency, trail) + 1);
    }
    depths.set(child.id, depth);
    return depth;
  };
  const waves: T[][] = [];
  for (const child of children) {
    const depth = depthOf(child, new Set());
    while (waves.length <= depth) waves.push([]);
    waves[depth]!.push(child);
  }
  return waves;
}

export const RUNNING_SESSION_STATUSES: ReadonlySet<string> = new Set(["running", "launching", "resuming", "interrupt_requested", "needs_approval"]);

export type EpicRollup = { total: number; done: number; running: number; waiting: number; failed: number; queued: number; tone: StatusTone | null };

// done = completed; running = current status in RUNNING minus needs_approval; waiting =
// attentionCount > 0; failed = current status failed/lost; queued = isDraft; tone = worst by
// TONE_ORDER over statusMeta(current).tone, "success" when all done.
export function epicRollup(
  children: Array<Pick<TaskRow, "id" | "isDraft" | "completed" | "attentionCount">>,
  currentStatusByChild: ReadonlyMap<string, string>,
): EpicRollup {
  const rollup: EpicRollup = { total: children.length, done: 0, running: 0, waiting: 0, failed: 0, queued: 0, tone: null };
  const tones = new Set<StatusTone>();
  for (const child of children) {
    const status = currentStatusByChild.get(child.id);
    if (child.completed) rollup.done += 1;
    if (status && RUNNING_SESSION_STATUSES.has(status) && status !== "needs_approval") rollup.running += 1;
    if (child.attentionCount > 0) rollup.waiting += 1;
    if (status === "failed" || status === "lost") rollup.failed += 1;
    if (child.isDraft) rollup.queued += 1;
    if (status && !child.completed) tones.add(statusMeta(status).tone);
  }
  if (rollup.total > 0 && rollup.done === rollup.total) rollup.tone = "success";
  else rollup.tone = TONE_ORDER.find((tone) => tones.has(tone)) ?? null;
  return rollup;
}
