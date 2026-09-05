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
  ["/rpi-describe-pr", "describe-pr", "describe-pr", "create pull request"],
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
} as const;

export const WORKFLOW_GRAPHS = {
  rpi: ["questions", "research", "design", "plan", "worktree", "implementation", "PR"],
  outline_only: ["questions", "research", "structure", "implementation", "PR"],
  prd_tdd: ["research", "PRD", "TDD", "plan", "worktree", "implementation", "PR"],
  oneshot: ["single session"],
  freeform: ["single session"],
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
const IMPLEMENTATION = new Set(["implementation", "implement-plan", "implement-outline", "describe-pr", "review"]);

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
