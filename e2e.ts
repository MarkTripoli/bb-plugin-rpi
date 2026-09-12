import type { E2ePrefs, ModelOverride, PhaseModels } from "./contract";

export type E2eAttempt = { id: string; launchedBy: string; skillId: string | null; status: string; retriedFrom: string | null };
export type E2ePausedReason = "hops" | "review_cycles" | "retries";
export type E2eGuardState = { hops: number; reviewCycles: number; retryDepth: number; pausedReason: E2ePausedReason | null };

// attempts in created_at ASC order (listLaunchAttempts). Anchor: newest attempt not launched by
// auto_advance (Proceed, completion, manual launch, launchSkill, iterate, user retry). Any human
// launch resets the counters by moving the anchor.
export function e2eGuardState(attempts: readonly E2eAttempt[], caps: Pick<E2ePrefs, "maxHops" | "maxReviewCycles" | "maxRetries">): E2eGuardState {
  let anchor = -1;
  for (let index = attempts.length - 1; index >= 0; index -= 1) {
    if (attempts[index]!.launchedBy !== "auto_advance") { anchor = index; break; }
  }
  const after = attempts.slice(anchor + 1);
  const hops = after.filter((attempt) => attempt.launchedBy === "auto_advance").length;
  const reviewCycles = after.filter((attempt) => attempt.skillId === "fix-code-review").length;
  const newest = attempts[attempts.length - 1];
  const retryDepth = newest ? retryChainDepth(attempts, newest.id) : 0;
  const pausedReason: E2ePausedReason | null = hops >= caps.maxHops
    ? "hops"
    : reviewCycles >= caps.maxReviewCycles
      ? "review_cycles"
      : newest?.status === "failed" && retryDepth >= caps.maxRetries
        ? "retries"
        : null;
  return { hops, reviewCycles, retryDepth, pausedReason };
}

// Same as e2eGuardState for callers that hold attempts newest-first (listLaunchAttempts order);
// reverses into the oldest-first input e2eGuardState is specified against.
export function e2eGuardStateFromRecent(attempts: readonly E2eAttempt[], caps: Pick<E2ePrefs, "maxHops" | "maxReviewCycles" | "maxRetries">): E2eGuardState {
  return e2eGuardState([...attempts].reverse(), caps);
}

// Number of retried_from links from `attemptId` back to the first attempt of its chain.
export function retryChainDepth(attempts: readonly E2eAttempt[], attemptId: string): number {
  const byId = new Map(attempts.map((attempt) => [attempt.id, attempt]));
  let depth = 0;
  let current = byId.get(attemptId);
  const seen = new Set<string>();
  while (current?.retriedFrom && !seen.has(current.id)) {
    seen.add(current.id);
    depth += 1;
    current = byId.get(current.retriedFrom);
  }
  return depth;
}

export const E2E_REASONING_LABELS: ReadonlySet<string> = new Set([
  "research-questions", "research", "design", "design-prd", "design-tdd", "structure", "plan", "code-review",
]);

// Explicit per-phase entry always wins; class defaults apply only when the task runs in full auto.
export function phaseModelFor(
  task: { e2eMode: boolean | number; phaseModels: PhaseModels },
  label: string | null,
  prefs: Pick<E2ePrefs, "fastModel" | "reasoningModel">,
): ModelOverride | undefined {
  if (!label) return undefined;
  const explicit = task.phaseModels[label];
  if (explicit) return explicit;
  if (!task.e2eMode) return undefined;
  return (E2E_REASONING_LABELS.has(label) ? prefs.reasoningModel : prefs.fastModel) ?? undefined;
}

export function e2ePausedText(state: E2eGuardState): string | null {
  if (state.pausedReason === "hops") return "Full auto paused: hop cap reached";
  if (state.pausedReason === "review_cycles") return "Full auto paused: review cap reached";
  if (state.pausedReason === "retries") return "Full auto paused: retry cap reached";
  return null;
}
