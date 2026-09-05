import test from "node:test";
import assert from "node:assert/strict";
import { ALIASES, AUTO_ADVANCE, HELPERS, SKILLS, WORKFLOW_GRAPHS, deriveBoardColumn } from "../transitions";

test("skills table keeps labels and button text", () => {
  assert.equal(SKILLS.length, 22);
  assert.ok(SKILLS.every((entry) => entry[2].length > 0));
  assert.ok(HELPERS.some((entry) => entry[1] === "show-me"));
});

test("workflow graphs match the phase plan", () => {
  assert.deepEqual(WORKFLOW_GRAPHS.rpi, ["questions", "research", "design", "plan", "worktree", "implementation", "PR"]);
  assert.deepEqual(WORKFLOW_GRAPHS.outline_only, ["questions", "research", "structure", "implementation", "PR"]);
  assert.deepEqual(WORKFLOW_GRAPHS.prd_tdd, ["research", "PRD", "TDD", "plan", "worktree", "implementation", "PR"]);
  assert.deepEqual(WORKFLOW_GRAPHS.oneshot, ["single session"]);
  assert.deepEqual(WORKFLOW_GRAPHS.freeform, ["single session"]);
  assert.equal(ALIASES["create-worktree"], "setup-worktree");
});

test("auto advance table is literal", () => {
  assert.deepEqual(AUTO_ADVANCE, {
    "research-questions": { flag: "aa_questions_to_research", next: "create-research", to: "research" },
    research: { flag: "aa_research_to_design", next: "create-design-discussion", to: "design" },
    design: { flag: null, next: "create-plan", to: "plan" },
    "design-prd": { flag: null, next: "create-tdd", to: "design-tdd" },
    "design-tdd": { flag: null, next: "create-plan", to: "plan" },
    structure: { flag: null, next: "implement-outline", to: "implementation" },
    plan: { flag: "aa_plan_to_worktree", next: "setup-worktree", to: "worktree-setup" },
    "worktree-setup": { flag: "aa_worktree_to_implementation", next: "implement-plan", to: "implementation" },
    implementation: { flag: "aa_implementation_to_pr", next: "describe-pr", to: "describe-pr" },
  });
});

test("board column derives from the current label", () => {
  assert.equal(deriveBoardColumn(null, true), "todo_draft");
  assert.equal(deriveBoardColumn("research", false), "research_design");
  assert.equal(deriveBoardColumn("plan", false), "planning");
  assert.equal(deriveBoardColumn("implementation", false), "implementation");
});
