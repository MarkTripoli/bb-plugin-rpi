import test from "node:test";
import assert from "node:assert/strict";
import {
  ALIASES,
  AUTO_ADVANCE,
  E2E_AUTO_ADVANCE,
  HELPERS,
  SKILLS,
  WORKFLOW_GRAPHS,
  autoAdvanceAccepts,
  autoAdvanceTransition,
  completionActionsForSession,
  computeSuggestedNext,
  deriveBoardColumn,
  e2eTransition,
  parseNextStepExtraction,
  suggestedNextForSession,
  suggestedNextHint,
  type SuggestedNextSessionFields,
} from "../transitions";

test("skills table keeps labels and button text", () => {
  assert.equal(SKILLS.length, 27);
  assert.ok(SKILLS.every((entry) => entry[2].length > 0));
  assert.ok(HELPERS.some((entry) => entry[1] === "show-me"));
});

test("workflow graphs match the phase plan", () => {
  assert.deepEqual(WORKFLOW_GRAPHS.rpi, ["questions", "research", "design", "plan", "worktree", "implementation", "review", "PR", "PR review"]);
  assert.deepEqual(WORKFLOW_GRAPHS.outline_only, ["questions", "research", "structure", "implementation", "review", "PR", "PR review"]);
  assert.deepEqual(WORKFLOW_GRAPHS.prd_tdd, ["research", "PRD", "TDD", "plan", "worktree", "implementation", "review", "PR", "PR review"]);
  assert.deepEqual(WORKFLOW_GRAPHS.oneshot, ["single session", "review", "PR", "PR review"]);
  assert.deepEqual(WORKFLOW_GRAPHS.freeform, ["single session", "review", "PR", "PR review"]);
  assert.deepEqual(WORKFLOW_GRAPHS.epic, ["questions", "research", "epic plan", "delivery"]);
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
    "code-review": { flag: "aa_implementation_to_pr", next: "fix-code-review", to: "review-fixes" },
    "review-fixes": { flag: "aa_implementation_to_pr", next: "review-code", to: "code-review" },
    "describe-pr": { flag: null, next: "resolve-pr-reviews", to: "pr-review" },
    "pr-review": { flag: null, next: "resolve-pr-reviews", to: "pr-review" },
  });
});

test("e2e auto advance table is literal", () => {
  assert.deepEqual(E2E_AUTO_ADVANCE, {
    "research-questions": { "create-research": { next: "create-research", to: "research" } },
    research: {
      "create-design-discussion": { next: "create-design-discussion", to: "design" },
      "create-structure-outline": { next: "create-structure-outline", to: "structure" },
      "create-prd": { next: "create-prd", to: "design-prd" },
      "create-epic-plan": { next: "create-epic-plan", to: "epic-plan" },
    },
    "worktree-setup": {
      "implement-plan": { next: "implement-plan", to: "implementation" },
      "implement-outline": { next: "implement-outline", to: "implementation" },
    },
    implementation: {
      "implement-plan": { next: "implement-plan", to: "implementation", chain: "phase" },
      "implement-outline": { next: "implement-outline", to: "implementation", chain: "phase" },
      "describe-pr": { next: "review-code", to: "code-review" },
    },
    "code-review": {
      "fix-code-review": { next: "fix-code-review", to: "review-fixes" },
      "describe-pr": { next: "describe-pr", to: "describe-pr" },
    },
    "review-fixes": { "review-code": { next: "review-code", to: "code-review" } },
  });
});

test("e2eTransition resolves rows, redirects implementation into review, and refuses human gates", () => {
  assert.equal(e2eTransition("implementation", "rpi", "describe-pr")?.next, "review-code");
  assert.deepEqual(e2eTransition("implementation", "rpi", "implement-plan"), { next: "implement-plan", to: "implementation", chain: "phase" });
  assert.equal(e2eTransition("implementation", "outline_only", "implement-plan"), undefined);
  assert.equal(e2eTransition("implementation", "outline_only", "implement-outline")?.chain, "phase");
  assert.equal(e2eTransition("research", "rpi", "create-prd"), undefined);
  assert.equal(e2eTransition("research", "prd_tdd", "create-prd")?.to, "design-prd");
  for (const label of ["design", "design-prd", "design-tdd", "structure", "plan", "describe-pr", "pr-review"] as const) {
    assert.equal(e2eTransition(label, "rpi", AUTO_ADVANCE[label].next), undefined, label);
  }
  assert.equal(e2eTransition("code-review", "rpi", "show-me"), undefined);
  assert.equal(e2eTransition(null, "rpi", "create-research"), undefined);
  // The epic plan is a human gate even in full auto; research still flows into the epic plan.
  assert.equal(e2eTransition("epic-plan", "epic", "start-epic-delivery"), undefined);
  assert.equal(e2eTransition("research", "epic", "create-epic-plan")?.to, "epic-plan");
  assert.equal(e2eTransition("research", "rpi", "create-epic-plan"), undefined);
});

test("auto advance resolves workflow-specific targets", () => {
  assert.equal(autoAdvanceTransition("research", "rpi")?.next, "create-design-discussion");
  assert.equal(autoAdvanceTransition("research", "outline_only")?.next, "create-structure-outline");
  assert.equal(autoAdvanceTransition("research", "prd_tdd")?.next, "create-prd");
  assert.equal(autoAdvanceTransition("worktree-setup", "outline_only")?.next, "implement-outline");
  assert.deepEqual(autoAdvanceTransition("research", "epic"), { flag: "aa_research_to_design", next: "create-epic-plan", to: "epic-plan" });
  assert.deepEqual(autoAdvanceTransition("epic-plan", "epic"), { flag: null, next: "start-epic-delivery", to: "delivery" });
  assert.equal(autoAdvanceTransition("epic-plan", "rpi"), undefined);
  assert.equal(autoAdvanceAccepts("code-review", "rpi", "fix-code-review"), true);
  assert.equal(autoAdvanceAccepts("code-review", "rpi", "describe-pr"), true);
  assert.equal(autoAdvanceAccepts("code-review", "rpi", "create-research"), false);
});

test("board column derives from the current label", () => {
  assert.equal(deriveBoardColumn(null, true), "todo_draft");
  assert.equal(deriveBoardColumn("research", false), "research_design");
  assert.equal(deriveBoardColumn("plan", false), "planning");
  assert.equal(deriveBoardColumn("implementation", false), "implementation");
  assert.equal(deriveBoardColumn("epic-plan", false), "planning");
  assert.equal(deriveBoardColumn("delivery", false), "implementation");
});

test("computeSuggestedNext visibility matrix: found+match, found+mismatch, none, and human gates", () => {
  // found+match: extraction agrees with the workflow's canonical next skill -> not visible, the
  // existing Proceed button already covers this case.
  const match = computeSuggestedNext("research-questions", "rpi", { type: "next_step_found", nextStepType: "create-research" });
  assert.equal(match.visible, false);
  assert.equal(match.skillId, "create-research");

  // found+mismatch: extraction found a different skill than the workflow expects -> visible with
  // both hints (agent-suggested vs workflow-expected).
  const mismatch = computeSuggestedNext("research-questions", "rpi", { type: "next_step_found", nextStepType: "create-design-discussion" });
  assert.equal(mismatch.visible, true);
  assert.equal(mismatch.mismatch, true);
  assert.equal(mismatch.skillId, "create-research");
  assert.equal(mismatch.extractedSkillId, "create-design-discussion");
  assert.equal(mismatch.buttonText, "proceed to research");

  // none: no_next_step -> visible with the single workflow-expected hint, no mismatch banner.
  const none = computeSuggestedNext("research-questions", "rpi", { type: "no_next_step" });
  assert.equal(none.visible, true);
  assert.equal(none.mismatch, false);
  assert.equal(none.extractedSkillId, null);
  assert.equal(none.skillId, "create-research");

  // gate: a human-gated label (flag: null, e.g. "design") follows the exact same rule, not a
  // special always-on or always-off case. Matching extraction on a gate -> still not visible...
  const gateMatch = computeSuggestedNext("design", "rpi", { type: "next_step_found", nextStepType: "create-plan" });
  assert.equal(gateMatch.visible, false);
  // ...but a missing/mismatched extraction on that same gate label -> visible, exactly like any
  // other label ("it is manual anyway" does not mean it is exempt from the visibility rule).
  const gateNone = computeSuggestedNext("design", "rpi", { type: "no_next_step" });
  assert.equal(gateNone.visible, true);
  assert.equal(gateNone.skillId, "create-plan");

  // A missing label never shows the affordance. PR creation now exposes the manual review loop.
  assert.equal(computeSuggestedNext(null, "rpi", { type: "no_next_step" }).visible, false);
  assert.equal(computeSuggestedNext("describe-pr", "rpi", { type: "no_next_step" }).skillId, "resolve-pr-reviews");

  // A review can branch to fixes or directly to PR creation. Missing extraction must not guess.
  assert.equal(computeSuggestedNext("code-review", "rpi", { type: "no_next_step" }).visible, false);
  assert.equal(computeSuggestedNext("code-review", "rpi", { type: "next_step_found", nextStepType: "fix-code-review" }).visible, false);
  assert.equal(computeSuggestedNext("code-review", "rpi", { type: "next_step_found", nextStepType: "describe-pr" }).visible, false);

  // An approved PR review ends through the show-me helper, which extracts as no next step.
  assert.equal(computeSuggestedNext("pr-review", "rpi", { type: "no_next_step" }).visible, false);
  assert.equal(computeSuggestedNext("pr-review", "rpi", { type: "next_step_found", nextStepType: "resolve-pr-reviews" }).visible, false);
});

test("parseNextStepExtraction reads the persisted nextStepJson shape, tolerating null and garbage", () => {
  assert.equal(parseNextStepExtraction(null), null);
  assert.equal(parseNextStepExtraction("not json"), null);
  assert.deepEqual(parseNextStepExtraction(JSON.stringify({ extraction: { type: "no_next_step" } })), { type: "no_next_step" });
  assert.deepEqual(
    parseNextStepExtraction(JSON.stringify({ extraction: { type: "next_step_found", nextStepType: "create-research" } })),
    { type: "next_step_found", nextStepType: "create-research" },
  );
  // A "next_step_found" extraction missing its own nextStepType is treated the same as no
  // extraction at all, never a crash.
  assert.equal(parseNextStepExtraction(JSON.stringify({ extraction: { type: "next_step_found" } })), null);
});

function baseSuggestedNextSession(overrides: Partial<SuggestedNextSessionFields> = {}): SuggestedNextSessionFields {
  return {
    rpiStatus: "ready_for_input",
    blockedReason: null,
    completedTurnKey: "turn_1",
    lastSummarizedTurnKey: "turn_1",
    label: "research-questions",
    workflowType: "rpi",
    nextStepJson: JSON.stringify({ extraction: { type: "no_next_step" } }),
    ...overrides,
  };
}

test("suggestedNextForSession/suggestedNextHint share one precondition gate: not ready, blocked, or unsummarized -> null", () => {
  assert.equal(suggestedNextForSession(baseSuggestedNextSession({ rpiStatus: "running" })), null);
  assert.equal(suggestedNextForSession(baseSuggestedNextSession({ blockedReason: "question" })), null);
  assert.equal(suggestedNextForSession(baseSuggestedNextSession({ completedTurnKey: null })), null);
  assert.equal(suggestedNextForSession(baseSuggestedNextSession({ completedTurnKey: "turn_2", lastSummarizedTurnKey: "turn_1" })), null);
  assert.equal(suggestedNextHint(baseSuggestedNextSession({ rpiStatus: "running" })), null);
});

test("suggestedNextForSession/suggestedNextHint compute the same result once preconditions hold", () => {
  const result = suggestedNextForSession(baseSuggestedNextSession());
  assert.ok(result);
  assert.equal(result.visible, true);
  assert.equal(result.skillId, "create-research");
  assert.equal(suggestedNextHint(baseSuggestedNextSession()), "Suggested next: proceed to research");

  const mismatchJson = JSON.stringify({ extraction: { type: "next_step_found", nextStepType: "create-design-discussion" } });
  assert.equal(
    suggestedNextHint(baseSuggestedNextSession({ nextStepJson: mismatchJson })),
    "Agent suggested create-design-discussion; workflow expects proceed to research",
  );

  // Extraction agreeing with the workflow's canonical next skill: not visible, no hint.
  const matchJson = JSON.stringify({ extraction: { type: "next_step_found", nextStepType: "create-research" } });
  assert.equal(suggestedNextForSession(baseSuggestedNextSession({ nextStepJson: matchJson })), null);
  assert.equal(suggestedNextHint(baseSuggestedNextSession({ nextStepJson: matchJson })), null);
});

function baseCompletionSession(overrides: Partial<SuggestedNextSessionFields & { threadId: string }> = {}) {
  return {
    threadId: "thr_source",
    rpiStatus: "ready_for_input",
    blockedReason: null,
    completedTurnKey: "turn_1",
    lastSummarizedTurnKey: "turn_1",
    label: "research-questions",
    workflowType: "rpi",
    nextStepJson: JSON.stringify({ extraction: { type: "no_next_step" } }),
    ...overrides,
  };
}

test("completion catalog covers workflow-specific canonical transitions and iterate", () => {
  const expected: Record<string, Record<string, string>> = {
    rpi: {
      "research-questions": "create-research",
      research: "create-design-discussion",
      design: "create-plan",
      "design-prd": "create-tdd",
      "design-tdd": "create-plan",
      structure: "implement-outline",
      plan: "setup-worktree",
      "worktree-setup": "implement-plan",
    },
    outline_only: {
      "research-questions": "create-research",
      research: "create-structure-outline",
      design: "create-plan",
      "design-prd": "create-tdd",
      "design-tdd": "create-plan",
      structure: "implement-outline",
      plan: "setup-worktree",
      "worktree-setup": "implement-outline",
    },
    prd_tdd: {
      "research-questions": "create-research",
      research: "create-prd",
      design: "create-plan",
      "design-prd": "create-tdd",
      "design-tdd": "create-plan",
      structure: "implement-outline",
      plan: "setup-worktree",
      "worktree-setup": "implement-plan",
    },
  };
  for (const [workflowType, rows] of Object.entries(expected)) {
    for (const [label, skillId] of Object.entries(rows)) {
      const result = completionActionsForSession(baseCompletionSession({ workflowType, label }));
      assert.ok(result, `${workflowType}/${label}`);
      assert.deepEqual(result.actions.map((action) => action.id), ["continue", "iterate"], `${workflowType}/${label}`);
      assert.deepEqual(result.actions[0]?.intent, { kind: "completion", threadId: "thr_source", skillId });
      assert.deepEqual(result.actions[1]?.intent, {
        kind: "iterate",
        threadId: "thr_source",
      }, `${workflowType}/${label}`);
    }
  }
  for (const workflowType of ["oneshot", "freeform"] as const) {
    const result = completionActionsForSession(baseCompletionSession({ workflowType, label: null }));
    assert.ok(result);
    assert.deepEqual(result.actions.map((action) => action.id), ["review", "create-pr", "iterate"]);
    assert.deepEqual(result.actions.map((action) => action.intent), [
      { kind: "completion", threadId: "thr_source", skillId: "review-code" },
      { kind: "completion", threadId: "thr_source", skillId: "describe-pr" },
      { kind: "iterate", threadId: "thr_source" },
    ]);
  }
});

test("implement-phase action leads the implementation catalog and forces a completion intent", () => {
  const withPhase = completionActionsForSession(baseCompletionSession({ label: "implementation" }), {
    nextPlanPhase: { phase: 2, title: "Wire server" },
  });
  assert.ok(withPhase);
  assert.deepEqual(withPhase.actions.map((action) => action.id), ["implement-phase", "review", "create-pr", "iterate"]);
  assert.equal(withPhase.actions[0]?.label, "Proceed to Phase 2");
  assert.equal(withPhase.actions[0]?.emphasis, "primary");
  assert.equal(withPhase.actions[1]?.emphasis, "secondary");
  assert.deepEqual(withPhase.actions[0]?.intent, { kind: "completion", threadId: "thr_source", skillId: "implement-plan", phase: 2 });

  const matchedExtraction = completionActionsForSession(baseCompletionSession({
    label: "implementation",
    nextStepJson: JSON.stringify({ extraction: { type: "next_step_found", nextStepType: "implement-plan", nextStepPrompt: "/rpi-implement-plan" } }),
  }), { nextPlanPhase: { phase: 3, title: "Ship" } });
  assert.ok(matchedExtraction);
  assert.deepEqual(matchedExtraction.actions[0]?.intent, { kind: "completion", threadId: "thr_source", skillId: "implement-plan", phase: 3 });

  const outline = completionActionsForSession(baseCompletionSession({ workflowType: "outline_only", label: "implementation" }), {
    nextPlanPhase: { phase: 2, title: "Wire server" },
  });
  assert.ok(outline);
  assert.deepEqual(outline.actions.map((action) => action.id), ["implement-phase", "review", "create-pr", "iterate"]);
  assert.equal(outline.actions[0]?.label, "Proceed to Phase 2");
  assert.deepEqual(outline.actions[0]?.intent, { kind: "completion", threadId: "thr_source", skillId: "implement-outline", phase: 2 });
  assert.equal(outline.actions.some((action) => action.id === "agent-suggestion"), false);
});

test("completion catalog preserves matching Proceed and adds a bounded agent suggestion", () => {  const matching = completionActionsForSession(baseCompletionSession({
    label: "implementation",
    nextStepJson: JSON.stringify({ extraction: { type: "next_step_found", nextStepType: "describe-pr", nextStepPrompt: "/rpi-describe-pr --draft" } }),
  }));
  assert.ok(matching);
  assert.deepEqual(matching.actions.map((action) => action.id), ["review", "create-pr", "iterate"]);
  assert.deepEqual(matching.actions[1]?.intent, { kind: "proceed", threadId: "thr_source" });

  const conflicting = completionActionsForSession(baseCompletionSession({
    nextStepJson: JSON.stringify({ extraction: { type: "next_step_found", nextStepType: "create-design-discussion", nextStepPrompt: "/rpi-create-design-discussion" } }),
  }));
  assert.ok(conflicting);
  assert.equal(conflicting.actions.at(-1)?.id, "agent-suggestion");
  assert.equal(conflicting.actions.at(-1)?.label, "Agent suggestion");
  assert.deepEqual(conflicting.actions.at(-1)?.intent, { kind: "proceed", threadId: "thr_source" });

  const malformed = completionActionsForSession(baseCompletionSession({
    nextStepJson: JSON.stringify({ extraction: { type: "next_step_found", nextStepType: "create-design-discussion" } }),
  }));
  assert.ok(malformed);
  assert.equal(malformed.actions.some((action) => action.id === "agent-suggestion"), false);
});

test("completion catalog hides unready sessions and reports active or replaced sources", () => {
  for (const overrides of [
    { rpiStatus: "running" },
    { blockedReason: "question" },
    { completedTurnKey: null },
    { lastSummarizedTurnKey: "turn_old" },
    { label: "review" },
  ]) {
    assert.equal(completionActionsForSession(baseCompletionSession(overrides)), null);
  }

  const blocked = completionActionsForSession(baseCompletionSession(), { activeAttempt: true, successorThreadId: null });
  assert.equal(blocked?.state, "blocked");
  assert.equal(blocked?.actions.length, 2);

  const replaced = completionActionsForSession(baseCompletionSession(), { activeAttempt: false, successorThreadId: "thr_next" });
  assert.deepEqual(replaced, { state: "replaced", actions: [], successorThreadId: "thr_next" });
});
