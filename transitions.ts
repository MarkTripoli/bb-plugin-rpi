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
  design: { flag: null, next: "create-structure-outline", to: "structure" },
  "design-prd": { flag: null, next: "create-tdd", to: "design-tdd" },
  "design-tdd": { flag: null, next: "create-structure-outline", to: "structure" },
  structure: { flag: null, next: "create-plan", to: "plan" },
  plan: { flag: "aa_plan_to_worktree", next: "setup-worktree", to: "worktree-setup" },
  "worktree-setup": { flag: "aa_worktree_to_implementation", next: "implement-plan", to: "implementation" },
  implementation: { flag: "aa_implementation_to_pr", next: "describe-pr", to: "describe-pr" },
} as const;

export const WORKFLOW_GRAPHS = {
  rpi: ["worktree", "questions", "research", "design", "outline", "implement", "PR"],
  outline_only: ["questions", "research", "design", "outline", "implement", "PR"],
  prd_tdd: ["research", "PRD", "TDD", "outline", "implement", "PR"],
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
const IMPLEMENTATION = new Set(["implementation", "implement-plan", "implement-outline", "describe-pr", "review"]);

function normalizeLabel(currentLabel: string) {
  return currentLabel.startsWith("rpi:") ? currentLabel.slice(4) : currentLabel;
}

export function deriveBoardColumn(currentLabel: string | null | undefined, isDraft: boolean): BoardColumn {
  if (isDraft || !currentLabel) return "todo_draft";
  const normalized = normalizeLabel(currentLabel);
  if (RESEARCH_AND_DESIGN.has(normalized)) return "research_design";
  if (PLANNING.has(normalized)) return "planning";
  if (IMPLEMENTATION.has(normalized)) return "implementation";
  return "todo_draft";
}

export function labelToStepLabel(currentLabel: string | null | undefined, isDraft: boolean) {
  if (isDraft || !currentLabel) return "Draft";
  return normalizeLabel(currentLabel);
}
