// Pure plan-phase parsing and session-bound handoff derivation, shared by the server and UI.
export type PlanPhase = {
  phase: number;
  title: string;
  complete: boolean;
};

export type PlanPhaseHint = {
  phase: number;
  title: string;
};

export type PrimaryReviewArtifact = { fileName: string };

export type PhaseArtifact = {
  fileName: string;
  frontmatter: Readonly<Record<string, string | number | boolean>>;
};

export type PhaseHandoff<T extends PhaseArtifact = PhaseArtifact> =
  | { ok: true; reviewArtifact: T; completedPhase: number; nextPhase: PlanPhaseHint | null }
  | { ok: false; error: "missing_review_artifact" | "missing_phase_completion" | "phase_not_in_plan" };

const PHASE_HEADING = /^##\s+(?:Phase|Step)\s+(\d+)\s*:?\s*(.*)$/;
const UNCHECKED_ITEM = /^(\s*[-*]\s*)\[ \]/;
const MAX_SUMMARY_JSON_LENGTH = 1024 * 1024;

export function parsePlanPhases(content: string): PlanPhase[] {
  const lines = content.split("\n");
  const phases: Array<PlanPhase & { start: number; end: number }> = [];
  for (const [index, line] of lines.entries()) {
    const match = PHASE_HEADING.exec(line);
    if (!match) continue;
    const phase = Number.parseInt(match[1]!, 10);
    if (!Number.isFinite(phase)) continue;
    phases.push({ phase, title: match[2]!.trim(), complete: false, start: index, end: lines.length });
  }
  for (const [index, phase] of phases.entries()) {
    const next = phases[index + 1];
    if (next) phase.end = next.start;
    const body = lines.slice(phase.start + 1, phase.end);
    let boxes = 0;
    let unchecked = 0;
    for (const line of body) {
      if (!/^(\s*[-*]\s*)\[/.test(line)) continue;
      boxes += 1;
      if (UNCHECKED_ITEM.test(line)) unchecked += 1;
    }
    phase.complete = boxes > 0 && unchecked === 0;
  }
  return phases.map(({ phase, title, complete }) => ({ phase, title, complete }));
}

export type LatestPlanArtifactInput = {
  groupType: string;
  updatedAt: number;
  fileName: string;
};

function latestArtifactInGroup<T extends LatestPlanArtifactInput>(artifacts: readonly T[], groupType: "plan" | "structure-outline"): T | null {
  const candidates = artifacts.filter((artifact) => artifact.groupType === groupType);
  if (candidates.length === 0) return null;
  return candidates.reduce((latest, artifact) => {
    if (artifact.updatedAt > latest.updatedAt) return artifact;
    if (artifact.updatedAt < latest.updatedAt) return latest;
    return parseArtifactNumber(artifact.fileName) > parseArtifactNumber(latest.fileName) ? artifact : latest;
  });
}

export function latestPlanArtifact<T extends LatestPlanArtifactInput>(artifacts: readonly T[]): T | null {
  return latestArtifactInGroup(artifacts, "plan");
}

export function latestStructureOutlineArtifact<T extends LatestPlanArtifactInput>(artifacts: readonly T[]): T | null {
  return latestArtifactInGroup(artifacts, "structure-outline");
}

export function phaseArtifactGroup(workflowType: string): "plan" | "structure-outline" {
  return workflowType === "outline_only" ? "structure-outline" : "plan";
}

export function latestPhaseArtifact<T extends LatestPlanArtifactInput>(artifacts: readonly T[], workflowType: string): T | null {
  return latestArtifactInGroup(artifacts, phaseArtifactGroup(workflowType));
}

export function parsePrimaryReviewArtifact(summaryJson: string | null): PrimaryReviewArtifact | null {
  if (!summaryJson || summaryJson.length > MAX_SUMMARY_JSON_LENGTH) return null;
  try {
    const summary = JSON.parse(summaryJson) as { primaryReviewArtifact?: unknown };
    const value = summary?.primaryReviewArtifact;
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const fileName = (value as { fileName?: unknown }).fileName;
    if (typeof fileName !== "string" || fileName.length === 0 || fileName.length > 255) return null;
    return { fileName };
  } catch {
    return null;
  }
}

export function derivePhaseHandoff<T extends PhaseArtifact>(
  planContent: string,
  primaryReviewArtifact: PrimaryReviewArtifact | null,
  artifacts: readonly T[],
): PhaseHandoff<T> {
  const reviewArtifact = primaryReviewArtifact
    ? artifacts.find((artifact) => artifact.fileName === primaryReviewArtifact.fileName)
    : undefined;
  if (!reviewArtifact) return { ok: false, error: "missing_review_artifact" };

  const completedPhase = reviewArtifact.frontmatter.type === "implementation"
    ? reviewArtifact.frontmatter.completed_phase
    : undefined;
  if (typeof completedPhase !== "number" || !Number.isSafeInteger(completedPhase) || completedPhase <= 0) {
    return { ok: false, error: "missing_phase_completion" };
  }

  const phases = parsePlanPhases(planContent);
  if (phases.filter((phase) => phase.phase === completedPhase).length !== 1) {
    return { ok: false, error: "phase_not_in_plan" };
  }
  const later = phases.filter((phase) => phase.phase > completedPhase);
  if (later.length === 0) return { ok: true, reviewArtifact, completedPhase, nextPhase: null };
  const next = phases.find((phase) => phase.phase === completedPhase + 1);
  if (!next) return { ok: false, error: "phase_not_in_plan" };
  return {
    ok: true,
    reviewArtifact,
    completedPhase,
    nextPhase: { phase: next.phase, title: displayTitle(next.title) },
  };
}

function displayTitle(title: string): string {
  return /^\[.*\]$/.test(title) ? "" : title;
}

function parseArtifactNumber(fileName: string): number {
  const match = /^(\d{2})-/.exec(fileName);
  return match ? Number.parseInt(match[1]!, 10) : 0;
}
