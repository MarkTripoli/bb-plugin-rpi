import test from "node:test";
import assert from "node:assert/strict";
import { extractNextStep } from "../extraction";

const aliases = {
  "create-worktree": "setup-worktree",
  "configure-workspace": "configure-workspaces",
  "create-research-plan": "create-research-questions",
  "create-outline": "create-structure-outline",
  "iterate-outline": "iterate-structure-outline",
} as const;

test("extracts every alias to its canonical skill", () => {
  for (const [alias, canonical] of Object.entries(aliases)) {
    const result = extractNextStep(`\`\`\`text\n/rpi-${alias}\n\`\`\``, { liveArtifactNames: [], taskSlug: "task", parsedAt: 1 });
    assert.equal(result.extraction.type, "next_step_found");
    if (result.extraction.type === "next_step_found") {
      assert.equal(result.extraction.nextStepType, canonical);
      assert.equal(result.extraction.nextStepPrompt, `/rpi-${canonical}`);
      assert.equal(result.extraction.taskReference, "task");
    }
  }
});

test("extracts legacy colon command form", () => {
  const result = extractNextStep("```text\n/rpi:create-research\n```", { liveArtifactNames: [], parsedAt: 1 });
  assert.equal(result.extraction.type, "next_step_found");
  if (result.extraction.type === "next_step_found") {
    assert.equal(result.extraction.nextStepPrompt, "/rpi-create-research");
  }
});

test("preserves arguments after the skill command", () => {
  const result = extractNextStep("```text\n/rpi-iterate-research @01-research.md --focus auth\n```", {
    liveArtifactNames: ["01-research.md"],
    parsedAt: 1,
  });
  assert.equal(result.extraction.type, "next_step_found");
  if (result.extraction.type === "next_step_found") {
    assert.equal(result.extraction.nextStepPrompt, "/rpi-iterate-research @01-research.md --focus auth");
  }
});

test("unknown artifact references suppress the next step", () => {
  const result = extractNextStep("```text\n/rpi-iterate-research @missing.md\n```", {
    liveArtifactNames: ["01-research.md"],
    parsedAt: 1,
  });
  assert.deepEqual(result.extraction, { type: "no_next_step", reason: "unknown artifact missing.md" });
});

test("full task artifact references normalize to bare names", () => {
  const result = extractNextStep("```text\n/rpi-iterate-research @.humanlayer/tasks/task/01-research.md\n```", {
    liveArtifactNames: ["01-research.md"],
    taskSlug: "task",
    parsedAt: 1,
  });
  assert.equal(result.extraction.type, "next_step_found");
  if (result.extraction.type === "next_step_found") {
    assert.equal(result.extraction.nextStepPrompt, "/rpi-iterate-research @01-research.md");
  }
});

test("helper commands are recognized but not proceed targets", () => {
  const result = extractNextStep("```text\n/rpi-show-me @01-research.md\n```", {
    liveArtifactNames: ["01-research.md"],
    parsedAt: 1,
  });
  assert.deepEqual(result.extraction, { type: "no_next_step", reason: "helper command show-me" });
});

test("missing command block returns no_next_step", () => {
  const result = extractNextStep("Done, no command here.", { liveArtifactNames: [], parsedAt: 1 });
  assert.deepEqual(result.extraction, { type: "no_next_step", reason: "no command block" });
});

test("last matching block wins inside longer answers", () => {
  const result = extractNextStep("Summary\n```text\n/rpi-create-research\n```\nMore detail\n```\n/rpi-create-design-discussion\n```", {
    liveArtifactNames: [],
    parsedAt: 1,
  });
  assert.equal(result.extraction.type, "next_step_found");
  if (result.extraction.type === "next_step_found") {
    assert.equal(result.extraction.nextStepType, "create-design-discussion");
  }
});

test("unknown skill returns no_next_step", () => {
  const result = extractNextStep("```text\n/rpi-not-real\n```", { liveArtifactNames: [], parsedAt: 1 });
  assert.deepEqual(result.extraction, { type: "no_next_step", reason: "unknown skill not-real" });
});
