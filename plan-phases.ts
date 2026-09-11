// Pure plan-phase parsing, shared by the server (advance.ts launch validation) and the
// frontend bundle (ui/rpi.tsx phase-complete banner). Follows the rpi-create-plan template
// shape: "## Phase N: Title" sections whose "Success Criteria" hold "- [ ]" / "- [x]" items.
export type PlanPhase = {
  phase: number;
  title: string;
  complete: boolean;
};

export type PlanPhaseHint = {
  phase: number;
  title: string;
};

const PHASE_HEADING = /^##\s+Phase\s+(\d+)\s*:?\s*(.*)$/;
const UNCHECKED_ITEM = /^(\s*[-*]\s*)\[ \]/;

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

// The launch target for an "Implement Phase N" button: the first phase whose acceptance boxes
// are not all checked. Phase 1 is never returned: an unchecked Phase 1 on a task whose
// implementation session just finished a turn cannot be distinguished from a plan whose
// acceptance boxes were simply never ticked, and re-implementing Phase 1 would be the wrong
// guess. Returns null when the plan is fully complete or unreadable.
export function nextIncompletePlanPhase(content: string): PlanPhaseHint | null {
  const phases = parsePlanPhases(content);
  if (phases.length === 0) return null;
  const next = phases.find((phase) => !phase.complete);
  if (!next || next.phase <= 1) return null;
  const title = /^\[.*\]$/.test(next.title) ? "" : next.title;
  return { phase: next.phase, title };
}

// The phase range a completed implementation receipt claims, parsed from its H1 heading
// ("# Phase 1 Implementation Receipt") and its "Phase range:" source line only. Frontmatter
// summaries and body prose deliberately mention later phases ("Phase 2 must build on..."),
// so everything outside those two shapes is ignored; sub-item numbers like "items 1.1" are
// skipped because they never follow the word "Phase" directly.
export function receiptPhaseRange(content: string): number | null {
  const body = content.replace(/^---\n[\s\S]*?\n---\n/, "");
  let max: number | null = null;
  const consider = (phase: number) => {
    if (Number.isFinite(phase) && (max === null || phase > max)) max = phase;
  };
  for (const line of body.split("\n")) {
    const heading = /^#\s+Phase\s+(\d+)(?![.\d])/.exec(line);
    if (heading) consider(Number.parseInt(heading[1]!, 10));
    const range = /^[-*]\s*[Pp]hase range:\s*(.*)$/.exec(line);
    if (range) {
      for (const match of range[1]!.matchAll(/Phase\s+(\d+)(?![.\d])/g)) {
        consider(Number.parseInt(match[1]!, 10));
      }
    }
  }
  return max;
}

export type LatestPlanArtifactInput = {
  groupType: string;
  updatedAt: number;
  fileName: string;
};

export function latestPlanArtifact<T extends LatestPlanArtifactInput>(artifacts: T[]): T | null {
  const plans = artifacts.filter((artifact) => artifact.groupType === "plan");
  if (plans.length === 0) return null;
  return plans.reduce((latest, artifact) => {
    if (artifact.updatedAt > latest.updatedAt) return artifact;
    if (artifact.updatedAt < latest.updatedAt) return latest;
    return parseArtifactNumber(artifact.fileName) > parseArtifactNumber(latest.fileName) ? artifact : latest;
  });
}

export type LatestReceiptArtifactInput = {
  type: string;
  updatedAt: number;
  fileName: string;
};

export function latestImplementationReceipt<T extends LatestReceiptArtifactInput>(artifacts: T[]): T | null {
  const receipts = artifacts.filter((artifact) => artifact.type === "implementation");
  if (receipts.length === 0) return null;
  return receipts.reduce((latest, artifact) => (artifact.updatedAt > latest.updatedAt ? artifact : latest));
}

// Launch target for the "Implement Phase N" banner action. The newest implementation receipt's
// claimed phase range is authoritative when present (Phase N done, so offer N+1 when the plan
// has it); otherwise the plan's own acceptance-checkbox markers decide, but only from Phase 2
// upward: an unticked Phase 1 on a task whose implementation session just finished a turn is
// indistinguishable from a plan whose boxes were never ticked, so it never launches a guess.
export function nextImplementablePlanPhase(
  planContent: string,
  receiptContent: string | null,
): PlanPhaseHint | null {
  const phases = parsePlanPhases(planContent);
  if (phases.length === 0) return null;
  const receiptPhase = receiptContent === null ? null : receiptPhaseRange(receiptContent);
  if (receiptPhase !== null) {
    const next = phases.find((phase) => phase.phase === receiptPhase + 1);
    if (next) return { phase: next.phase, title: displayTitle(next.title) };
    return null;
  }
  const next = phases.find((phase) => !phase.complete);
  if (!next || next.phase <= 1) return null;
  return { phase: next.phase, title: displayTitle(next.title) };
}

function displayTitle(title: string): string {
  return /^\[.*\]$/.test(title) ? "" : title;
}

function parseArtifactNumber(fileName: string): number {
  const match = /^(\d{2})-/.exec(fileName);
  return match ? Number.parseInt(match[1]!, 10) : 0;
}
