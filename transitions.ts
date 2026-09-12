import type { ManualLaunchIntent } from "./contract";

export const SKILLS = [
  ["/rpi-create-research-questions", "create-research-questions", "research-questions", "proceed to research questions"],
  ["/rpi-iterate-research-questions", "iterate-research-questions", "research-questions", "iterate research questions"],
  ["/rpi-create-research", "create-research", "research", "proceed to research"],
  ["/rpi-iterate-research", "iterate-research", "research", "iterate research"],
  ["/rpi-create-design-discussion", "create-design-discussion", "design", "proceed to design"],
  ["/rpi-iterate-design-discussion", "iterate-design-discussion", "design", "iterate design"],
  ["/rpi-create-prd", "create-prd", "design-prd", "proceed to PRD"],
  ["/rpi-iterate-prd", "iterate-prd", "design-prd", "iterate PRD"],
  ["/rpi-create-tdd", "create-tdd", "design-tdd", "proceed to TDD"],
  ["/rpi-iterate-tdd", "iterate-tdd", "design-tdd", "iterate TDD"],
  ["/rpi-create-structure-outline", "create-structure-outline", "structure", "proceed to outline"],
  ["/rpi-iterate-structure-outline", "iterate-structure-outline", "structure", "iterate outline"],
  ["/rpi-create-plan", "create-plan", "plan", "write plan"],
  ["/rpi-iterate-plan", "iterate-plan", "plan", "iterate plan"],
  ["/rpi-configure-workspaces", "configure-workspaces", "worktree-setup", "configure workspaces"],
  ["/rpi-setup-worktree", "setup-worktree", "worktree-setup", "setup worktree"],
  ["/rpi-implement-plan", "implement-plan", "implementation", "implement"],
  ["/rpi-implement-outline", "implement-outline", "implementation", "implement from outline"],
  ["/rpi-iterate-implementation", "iterate-implementation", "implementation", "iterate implementation"],
  ["/rpi-review-code", "review-code", "code-review", "review code"],
  ["/rpi-fix-code-review", "fix-code-review", "review-fixes", "fix review findings"],
  ["/rpi-describe-pr", "describe-pr", "describe-pr", "create pull request"],
  ["/rpi-resolve-pr-reviews", "resolve-pr-reviews", "pr-review", "resolve pull request reviews"],
  ["/rpi-ci-commit", "ci-commit", "implementation", "commit changes"],
  ["/rpi-review-artifact-comments", "review-artifact-comments", "review", "review comments"],
] as const;

export const HELPERS = [
  ["/rpi-show-me", "show-me", "show me"],
] as const;

export const RPI_AGENT_SKILL_IDS = [
  "codebase-locator",
  "codebase-analyzer",
  "codebase-pattern-finder",
  "web-search-researcher",
  "implementer",
  "outline-implementer",
  "implementation-reviewer",
] as const;

export const ALIASES = {
  "create-worktree": "setup-worktree",
  "configure-workspace": "configure-workspaces",
  "create-research-plan": "create-research-questions",
  "create-outline": "create-structure-outline",
  "iterate-outline": "iterate-structure-outline",
} as const;

export const AUTO_ADVANCE = {
  "research-questions": { flag: "aa_questions_to_research", next: "create-research", to: "research" },
  research: { flag: "aa_research_to_design", next: "create-design-discussion", to: "design" },
  design: { flag: null, next: "create-plan", to: "plan" },
  "design-prd": { flag: null, next: "create-tdd", to: "design-tdd" },
  "design-tdd": { flag: null, next: "create-plan", to: "plan" },
  structure: { flag: null, next: "implement-outline", to: "implementation" },
  plan: { flag: "aa_plan_to_worktree", next: "setup-worktree", to: "worktree-setup" },
  "worktree-setup": { flag: "aa_worktree_to_implementation", next: "implement-plan", to: "implementation" },
  implementation: { flag: "aa_implementation_to_pr", next: "describe-pr", to: "describe-pr" },
  "code-review": { flag: "aa_implementation_to_pr", next: "fix-code-review", to: "review-fixes" },
  "review-fixes": { flag: "aa_implementation_to_pr", next: "review-code", to: "code-review" },
  "describe-pr": { flag: null, next: "resolve-pr-reviews", to: "pr-review" },
  "pr-review": { flag: null, next: "resolve-pr-reviews", to: "pr-review" },
} as const;

type AutoAdvanceLabel = keyof typeof AUTO_ADVANCE;
type AutoAdvanceFlag =
  | "aa_questions_to_research"
  | "aa_research_to_design"
  | "aa_plan_to_worktree"
  | "aa_worktree_to_implementation"
  | "aa_implementation_to_pr"
  | null;
type AutoAdvanceTransition = { flag: AutoAdvanceFlag; next: SkillId; to: PhaseLabel };

const WORKFLOW_AUTO_ADVANCE: Partial<Record<string, Partial<Record<AutoAdvanceLabel, AutoAdvanceTransition>>>> = {
  outline_only: {
    research: { flag: "aa_research_to_design", next: "create-structure-outline", to: "structure" },
    "worktree-setup": { flag: "aa_worktree_to_implementation", next: "implement-outline", to: "implementation" },
  },
  prd_tdd: {
    research: { flag: "aa_research_to_design", next: "create-prd", to: "design-prd" },
  },
};

export function autoAdvanceTransition(label: PhaseLabel, workflowType: string): AutoAdvanceTransition | undefined {
  const key = label as AutoAdvanceLabel;
  return WORKFLOW_AUTO_ADVANCE[workflowType]?.[key] ?? AUTO_ADVANCE[key];
}

const AUTO_ADVANCE_ALTERNATIVES: Partial<Record<PhaseLabel, readonly string[]>> = {
  "code-review": ["describe-pr"],
  "pr-review": ["show-me"],
};

export function autoAdvanceAccepts(label: PhaseLabel, workflowType: string, skillId: string) {
  const transition = autoAdvanceTransition(label, workflowType);
  return transition?.next === skillId || AUTO_ADVANCE_ALTERNATIVES[label]?.includes(skillId) === true;
}

export const WORKFLOW_GRAPHS = {
  rpi: ["questions", "research", "design", "plan", "worktree", "implementation", "review", "PR", "PR review"],
  outline_only: ["questions", "research", "structure", "implementation", "review", "PR", "PR review"],
  prd_tdd: ["research", "PRD", "TDD", "plan", "worktree", "implementation", "review", "PR", "PR review"],
  oneshot: ["single session", "review", "PR", "PR review"],
  freeform: ["single session", "review", "PR", "PR review"],
} as const;

export const WORKFLOW_GRAPH_LABELS = {
  rpi: "RPI",
  outline_only: "Outline",
  prd_tdd: "PRD / TDD",
  oneshot: "Oneshot",
  freeform: "Freeform",
} as const;

export type SkillId = (typeof SKILLS)[number][1];
export type PhaseLabel = (typeof SKILLS)[number][2];

export const SKILL_BY_ID = Object.fromEntries(
  SKILLS.map(([command, skillId, label, buttonText]) => [skillId, { command, skillId, label, buttonText }]),
) as Record<SkillId, { command: string; skillId: SkillId; label: PhaseLabel; buttonText: string }>;

export const HELPER_BY_ID = Object.fromEntries(
  HELPERS.map(([command, helperId, buttonText]) => [helperId, { command, helperId, kind: "helper" as const, buttonText }]),
) as Record<(typeof HELPERS)[number][1], { command: string; helperId: (typeof HELPERS)[number][1]; kind: "helper"; buttonText: string }>;

export const SKILL_BY_LABEL = Object.fromEntries(
  SKILLS.map(([, skillId, label, buttonText]) => [label, { skillId, label, buttonText }]),
) as Partial<Record<PhaseLabel, { skillId: SkillId; label: PhaseLabel; buttonText: string }>>;

export const ITERATE_SKILL_BY_LABEL: Partial<Record<PhaseLabel, SkillId>> = {
  "research-questions": "iterate-research-questions",
  research: "iterate-research",
  design: "iterate-design-discussion",
  "design-prd": "iterate-prd",
  "design-tdd": "iterate-tdd",
  structure: "iterate-structure-outline",
  plan: "iterate-plan",
  implementation: "iterate-implementation",
  "code-review": "review-code",
  "review-fixes": "fix-code-review",
  "pr-review": "resolve-pr-reviews",
};

export const FIRST_SKILL_BY_WORKFLOW = {
  rpi: "create-research-questions",
  outline_only: "create-research-questions",
  prd_tdd: "create-research",
  oneshot: null,
  freeform: null,
} as const;

export function normalizeSkillId(input: string) {
  return ((ALIASES as Record<string, string>)[input] ?? input) as SkillId;
}

export function skillInfo(skillId: string) {
  return SKILL_BY_ID[skillId as SkillId] ?? null;
}

export function helperInfo(skillId: string) {
  return HELPER_BY_ID[skillId as keyof typeof HELPER_BY_ID] ?? null;
}

export function normalizePhaseLabel(currentLabel: string | null | undefined) {
  if (!currentLabel) return null;
  return currentLabel.startsWith("rpi:") ? currentLabel.slice(4) : currentLabel;
}

export const BOARD_COLUMNS = ["todo_draft", "research_design", "planning", "implementation"] as const;

export type BoardColumn = (typeof BOARD_COLUMNS)[number];

const RESEARCH_AND_DESIGN = new Set([
  "research-questions",
  "research",
  "design",
  "design-prd",
  "design-tdd",
]);

const PLANNING = new Set(["structure", "plan", "worktree-setup"]);
// Ground truth does not specify rpi:review, so keep it in Implementation for now.
const IMPLEMENTATION = new Set(["implementation", "implement-plan", "implement-outline", "code-review", "review-fixes", "describe-pr", "pr-review", "review"]);

export function deriveBoardColumn(currentLabel: string | null | undefined, isDraft: boolean): BoardColumn {
  if (isDraft || !currentLabel) return "todo_draft";
  const normalized = normalizePhaseLabel(currentLabel) ?? currentLabel;
  if (RESEARCH_AND_DESIGN.has(normalized)) return "research_design";
  if (PLANNING.has(normalized)) return "planning";
  if (IMPLEMENTATION.has(normalized)) return "implementation";
  return "todo_draft";
}

export function labelToStepLabel(currentLabel: string | null | undefined, isDraft: boolean) {
  if (isDraft || !currentLabel) return "Draft";
  return normalizePhaseLabel(currentLabel) ?? currentLabel;
}

export type SuggestedNextExtraction =
  | { type: "next_step_found"; nextStepType: string }
  | { type: "no_next_step" }
  | null;

export type SuggestedNext = {
  visible: boolean;
  // Workflow's own canonical next skill for this label (autoAdvanceTransition(...).next), the one
  // the button launches. Null when the label has no defined transition (e.g. a terminal phase).
  skillId: SkillId | null;
  buttonText: string | null;
  // True when the agent's own extraction found a next step, but it differs from `skillId`; shows
  // "Agent suggested X; workflow expects Y" instead of the single-hint copy.
  mismatch: boolean;
  extractedSkillId: string | null;
};

// Suggested-next affordance (plan §2.9 / phase 8 review): visible whenever the agent's own
// extraction did not find a next step, or found one outside the targets allowed for this label.
// Branching labels stay hidden when extraction is missing because the workflow cannot safely
// choose a branch. autoAdvanceAccepts is shared with advanceSession so both paths accept the same
// extracted targets.
export function computeSuggestedNext(label: PhaseLabel | null, workflowType: string, extraction: SuggestedNextExtraction): SuggestedNext {
  const empty: SuggestedNext = { visible: false, skillId: null, buttonText: null, mismatch: false, extractedSkillId: null };
  if (!label) return empty;
  const transition = autoAdvanceTransition(label, workflowType);
  if (!transition) return empty;
  const info = SKILL_BY_ID[transition.next];
  const buttonText = info?.buttonText ?? transition.next;
  if (!extraction || extraction.type === "no_next_step") {
    if (AUTO_ADVANCE_ALTERNATIVES[label]?.length) return empty;
    return { visible: true, skillId: transition.next, buttonText, mismatch: false, extractedSkillId: null };
  }
  const mismatch = !autoAdvanceAccepts(label, workflowType, extraction.nextStepType);
  return { visible: mismatch, skillId: transition.next, buttonText, mismatch, extractedSkillId: extraction.nextStepType };
}

// Parses a session's stored `nextStepJson` (extraction.ts's NextStepSuggestions, persisted as
// text) into the shape computeSuggestedNext expects. Shared by the UI's suggested-next button and
// the server's ready_for_input toast hint so they can never read the same field two different
// ways.
export function parseNextStepExtraction(nextStepJson: string | null): SuggestedNextExtraction {
  if (!nextStepJson) return null;
  try {
    const parsed = JSON.parse(nextStepJson) as { extraction?: { type?: string; nextStepType?: string } };
    if (parsed.extraction?.type === "next_step_found" && parsed.extraction.nextStepType) {
      return { type: "next_step_found", nextStepType: parsed.extraction.nextStepType };
    }
    if (parsed.extraction?.type === "no_next_step") return { type: "no_next_step" };
    return null;
  } catch {
    return null;
  }
}

type ParsedNextStep = {
  nextStepType: string;
  nextStepPrompt: string;
};

function parseNextStepDetails(nextStepJson: string | null): ParsedNextStep | null {
  if (!nextStepJson) return null;
  try {
    const parsed = JSON.parse(nextStepJson) as { extraction?: { type?: string; nextStepType?: string; nextStepPrompt?: string } };
    if (
      parsed.extraction?.type !== "next_step_found"
      || !parsed.extraction.nextStepType
      || !parsed.extraction.nextStepPrompt
    ) return null;
    return {
      nextStepType: parsed.extraction.nextStepType,
      nextStepPrompt: parsed.extraction.nextStepPrompt,
    };
  } catch {
    return null;
  }
}

export type CompletionAction = {
  id: "continue" | "implement-phase" | "review" | "fix-review" | "create-pr" | "resolve-pr" | "iterate" | "agent-suggestion";
  label: string;
  emphasis: "primary" | "secondary";
  intent: ManualLaunchIntent;
};

export type CompletionActionsResult = {
  state: "available" | "blocked" | "replaced";
  actions: CompletionAction[];
  successorThreadId: string | null;
};

type CompletionSessionFields = SuggestedNextSessionFields & { threadId: string };
type CompletionCatalogEntry = Omit<CompletionAction, "intent"> & { skillId: SkillId | null; forceCompletion?: boolean };

function titleCaseButtonText(buttonText: string) {
  return buttonText.length > 0 ? `${buttonText[0]!.toUpperCase()}${buttonText.slice(1)}` : buttonText;
}

export type PlanPhaseHint = {
  phase: number;
  title: string;
};

export function phaseImplementationSkill(workflowType: string): "implement-plan" | "implement-outline" | null {
  if (workflowType === "outline_only") return "implement-outline";
  if (workflowType === "rpi" || workflowType === "prd_tdd") return "implement-plan";
  return null;
}

export function isNumericImplementationSkill(skillId: string | null): boolean {
  return skillId === "implement-plan" || skillId === "implement-outline" || skillId === "iterate-implementation";
}

export function isReviewEntrySkill(skillId: string): boolean {
  return skillId === "review-code" || skillId === "fix-code-review" || skillId === "resolve-pr-reviews";
}

function completionCatalog(
  label: PhaseLabel | null,
  workflowType: string,
  nextPlanPhase?: PlanPhaseHint | null,
): CompletionCatalogEntry[] {
  const iterate = label ? ITERATE_SKILL_BY_LABEL[label] : undefined;
  const iterateEntry = {
    id: "iterate" as const,
    label: "Iterate",
    emphasis: "secondary" as const,
    skillId: iterate && skillInfo(iterate) ? iterate : null,
  };

  if (label === "implementation") {
    const phaseSkill = phaseImplementationSkill(workflowType);
    const implementPhase = phaseSkill && nextPlanPhase
      ? [{
          id: "implement-phase" as const,
          label: `Proceed to Phase ${nextPlanPhase.phase}`,
          emphasis: "primary" as const,
          skillId: phaseSkill as SkillId,
          forceCompletion: true,
        }]
      : [];
    return [
      ...implementPhase,
      { id: "review", label: "Review code", emphasis: implementPhase.length > 0 ? "secondary" as const : "primary" as const, skillId: "review-code" },
      { id: "create-pr", label: "Create pull request", emphasis: "secondary" as const, skillId: "describe-pr" },
      iterateEntry,
    ];
  }
  if (label === "code-review") {
    return [
      { id: "fix-review", label: "Fix review findings", emphasis: "primary", skillId: "fix-code-review" },
      { id: "create-pr", label: "Create pull request", emphasis: "secondary", skillId: "describe-pr" },
      iterateEntry,
    ];
  }
  if (label === "review-fixes") {
    return [
      { id: "review", label: "Review code", emphasis: "primary", skillId: "review-code" },
      { id: "create-pr", label: "Create pull request", emphasis: "secondary", skillId: "describe-pr" },
      iterateEntry,
    ];
  }
  if (label === "describe-pr" || label === "pr-review") {
    return [
      { id: "resolve-pr", label: "Resolve pull request reviews", emphasis: "primary", skillId: "resolve-pr-reviews" },
      iterateEntry,
    ];
  }
  if ((workflowType === "oneshot" || workflowType === "freeform") && label === null) {
    return [
      { id: "review", label: "Review code", emphasis: "primary", skillId: "review-code" },
      { id: "create-pr", label: "Create pull request", emphasis: "secondary", skillId: "describe-pr" },
      iterateEntry,
    ];
  }

  const transition = label ? autoAdvanceTransition(label, workflowType) : undefined;
  const info = transition ? skillInfo(transition.next) : null;
  if (!info) return [];
  return [
    { id: "continue", label: titleCaseButtonText(info.buttonText), emphasis: "primary", skillId: info.skillId },
    iterateEntry,
  ];
}

export function completionActionsForSession(
  session: CompletionSessionFields,
  options: {
    activeAttempt?: boolean;
    successorThreadId?: string | null;
    nextPlanPhase?: PlanPhaseHint | null;
  } = {},
): CompletionActionsResult | null {
  const { activeAttempt = false, successorThreadId = null, nextPlanPhase = null } = options;
  if (session.rpiStatus !== "ready_for_input" || session.blockedReason || !completedTurnIsProcessed(session)) return null;
  const label = normalizePhaseLabel(session.label) as PhaseLabel | null;
  const catalog = completionCatalog(label, session.workflowType, nextPlanPhase);
  if (catalog.length === 0) return null;
  if (successorThreadId) return { state: "replaced", actions: [], successorThreadId };

  const extraction = parseNextStepDetails(session.nextStepJson);
  const actions = catalog.map(({ skillId, forceCompletion, ...descriptor }) => ({
    ...descriptor,
    intent: !forceCompletion && extraction?.nextStepType === skillId && skillId
      ? { kind: "proceed" as const, threadId: session.threadId }
      : descriptor.id === "iterate"
        ? { kind: "iterate" as const, threadId: session.threadId }
        : descriptor.id === "implement-phase"
          ? { kind: "completion" as const, threadId: session.threadId, skillId: skillId!, phase: nextPlanPhase!.phase }
          : { kind: "completion" as const, threadId: session.threadId, skillId: skillId! },
  }));
  const phaseActionAvailable = label === "implementation"
    && phaseImplementationSkill(session.workflowType) !== null
    && nextPlanPhase !== null;
  if (extraction && skillInfo(extraction.nextStepType) && !catalog.some((entry) => entry.skillId === extraction.nextStepType) && !phaseActionAvailable) {
    actions.push({
      id: "agent-suggestion",
      label: "Agent suggestion",
      emphasis: "secondary",
      intent: { kind: "proceed", threadId: session.threadId },
    });
  }
  return {
    state: activeAttempt ? "blocked" : "available",
    actions,
    successorThreadId: null,
  };
}

export type SuggestedNextSessionFields = {
  rpiStatus: string;
  blockedReason: string | null;
  completedTurnKey: string | null;
  lastSummarizedTurnKey: string | null;
  label: string | null;
  workflowType: string;
  nextStepJson: string | null;
};

export function completedTurnIsProcessed(session: Pick<SuggestedNextSessionFields, "completedTurnKey" | "lastSummarizedTurnKey">) {
  return Boolean(session.completedTurnKey) && session.completedTurnKey === session.lastSummarizedTurnKey;
}

// Suggested-next precondition (plan §2.9): the session must be at rest, ready for input, nothing
// blocking it, and its completed turn already fully processed (summarized), before
// computeSuggestedNext's extraction-vs-workflow comparison means anything. A mid-processing or
// blocked session has no meaningful "suggested next" yet. Shared by the UI's button
// (ui/rpi.tsx) and the server's ready_for_input toast hint (server.ts notifySnapshot).
export function suggestedNextForSession(session: SuggestedNextSessionFields): SuggestedNext | null {
  if (session.rpiStatus !== "ready_for_input") return null;
  if (session.blockedReason) return null;
  if (!completedTurnIsProcessed(session)) return null;
  const label = normalizePhaseLabel(session.label) as PhaseLabel | null;
  const result = computeSuggestedNext(label, session.workflowType, parseNextStepExtraction(session.nextStepJson));
  return result.visible ? result : null;
}

// Same precondition and computation as suggestedNextForSession, formatted as the one-line hint
// used in the ready_for_input notification toast body (server.ts).
export function suggestedNextHint(session: SuggestedNextSessionFields): string | null {
  const result = suggestedNextForSession(session);
  if (!result) return null;
  return result.mismatch
    ? `Agent suggested ${result.extractedSkillId}; workflow expects ${result.buttonText}`
    : `Suggested next: ${result.buttonText}`;
}

// Composer banner visibility (phase 10 header/composer split): the banner (Proceed +
// Suggested-next) hides entirely for a quiet session (no extraction, no suggestion), but the
// context-high notice is an independent affordance and still shows the banner even when the
// session is otherwise quiet. Shared by RpiComposerBanner (ui/rpi.tsx); pure so it is unit-tested
// without mounting the composer.
export function shouldShowComposerBanner(input: { extracted: unknown; suggested: unknown; contextWarn: boolean; dismissed: boolean }): boolean {
  if (input.contextWarn && !input.dismissed) return true;
  return Boolean(input.extracted) || Boolean(input.suggested);
}
