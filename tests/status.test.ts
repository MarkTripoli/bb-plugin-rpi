import test from "node:test";
import assert from "node:assert/strict";
import {
  TONE_ORDER,
  attentionQueue,
  attentionText,
  labelStep,
  needsHuman,
  phaseProgress,
  statusMeta,
  workflowSteps,
} from "../status";

function nextStepFoundJson(nextStepSummary: string) {
  // Shape from contract.ts's nextStepSuggestionsSchema (extraction.ts's NextStepSuggestions).
  return JSON.stringify({
    parsedAt: Date.now(),
    extraction: {
      type: "next_step_found",
      nextStepPrompt: "run the next skill",
      nextStepSummary,
      nextStepType: "proceed",
      taskReference: null,
      suggestedDirectory: null,
    },
  });
}

test("statusMeta: ready_for_input is attention, not danger", () => {
  const meta = statusMeta("ready_for_input");
  assert.equal(meta.tone, "attention");
  assert.equal(meta.text, "Needs you");
  assert.equal(meta.icon, "MessageSquare");
  assert.ok(meta.hint.length > 0);
});

test("statusMeta: failed is danger", () => {
  const meta = statusMeta("failed");
  assert.equal(meta.tone, "danger");
  assert.equal(meta.text, "Failed");
});

test("statusMeta: needs_approval, running, launching, resuming, lost, interrupted, interrupt_requested", () => {
  assert.equal(statusMeta("needs_approval").tone, "warning");
  assert.equal(statusMeta("running").tone, "active");
  assert.equal(statusMeta("launching").text, "Starting");
  assert.equal(statusMeta("resuming").text, "Resuming");
  assert.equal(statusMeta("lost").tone, "danger");
  assert.equal(statusMeta("interrupted").tone, "muted");
  assert.equal(statusMeta("interrupt_requested").text, "Stopping");
});

test("statusMeta: unlisted status falls back to sentence case, muted", () => {
  const settled = statusMeta("task_settled");
  assert.equal(settled.text, "Task settled");
  assert.equal(settled.tone, "muted");
  assert.equal(settled.icon, "CircleCheck");
  assert.equal(settled.hint, "");

  const other = statusMeta("some_other_status");
  assert.equal(other.text, "Some other status");
  assert.equal(other.icon, "Circle");
});

test("needsHuman table", () => {
  assert.equal(needsHuman("ready_for_input"), true);
  assert.equal(needsHuman("needs_approval"), true);
  assert.equal(needsHuman("failed"), true);
  assert.equal(needsHuman("lost"), true);
  assert.equal(needsHuman("running"), false);
  assert.equal(needsHuman("launching"), false);
  assert.equal(needsHuman("interrupted"), false);
});

test("attentionText: needs_approval branches on blockedReason", () => {
  assert.equal(
    attentionText({ rpiStatus: "needs_approval", blockedReason: "question", nextStepJson: null, ingestError: null }),
    "Asked you a question",
  );
  assert.equal(
    attentionText({ rpiStatus: "needs_approval", blockedReason: "plugin", nextStepJson: null, ingestError: null }),
    "Waiting for permission to continue",
  );
});

test("attentionText: ready_for_input uses the next step summary when present", () => {
  assert.equal(
    attentionText({
      rpiStatus: "ready_for_input",
      blockedReason: null,
      nextStepJson: nextStepFoundJson("create pull request"),
      ingestError: null,
    }),
    "Next: create pull request",
  );
});

test("attentionText: ready_for_input falls back with no extraction", () => {
  assert.equal(
    attentionText({ rpiStatus: "ready_for_input", blockedReason: null, nextStepJson: null, ingestError: null }),
    "Finished its turn. Open to continue.",
  );
  assert.equal(
    attentionText({
      rpiStatus: "ready_for_input",
      blockedReason: null,
      nextStepJson: JSON.stringify({ parsedAt: 1, extraction: { type: "no_next_step", reason: "done" } }),
      ingestError: null,
    }),
    "Finished its turn. Open to continue.",
  );
});

test("attentionText: failed/lost use ingestError, trimmed, or a generic fallback", () => {
  assert.equal(
    attentionText({ rpiStatus: "failed", blockedReason: null, nextStepJson: null, ingestError: "  boom  " }),
    "boom",
  );
  assert.equal(
    attentionText({ rpiStatus: "lost", blockedReason: null, nextStepJson: null, ingestError: null }),
    "The session failed. Open it to see why, or retry.",
  );
  assert.equal(
    attentionText({ rpiStatus: "lost", blockedReason: null, nextStepJson: null, ingestError: "   " }),
    "The session failed. Open it to see why, or retry.",
  );
});

test("attentionText: anything else is empty", () => {
  assert.equal(
    attentionText({ rpiStatus: "running", blockedReason: null, nextStepJson: null, ingestError: null }),
    "",
  );
});

type FixtureSession = { rpiStatus: string; taskId: string; updatedAt: number; threadUpdatedAt: number | null };
type FixtureTask = { id: string; archived: boolean };

test("attentionQueue: filters archived and missing tasks, orders approval before failed/lost before ready-for-input", () => {
  const tasks: FixtureTask[] = [
    { id: "t1", archived: false },
    { id: "t2", archived: true },
  ];
  const sessions: FixtureSession[] = [
    { rpiStatus: "ready_for_input", taskId: "t1", updatedAt: 100, threadUpdatedAt: 100 },
    { rpiStatus: "needs_approval", taskId: "t1", updatedAt: 50, threadUpdatedAt: 50 },
    { rpiStatus: "failed", taskId: "t1", updatedAt: 75, threadUpdatedAt: 75 },
    { rpiStatus: "running", taskId: "t1", updatedAt: 200, threadUpdatedAt: 200 },
    { rpiStatus: "ready_for_input", taskId: "t2", updatedAt: 500, threadUpdatedAt: 500 },
    { rpiStatus: "lost", taskId: "missing", updatedAt: 10, threadUpdatedAt: 10 },
  ];
  const queue = attentionQueue(sessions, tasks);
  assert.deepEqual(
    queue.map((entry) => entry.session.rpiStatus),
    ["needs_approval", "failed", "ready_for_input"],
  );
});

test("attentionQueue: newest first within a rank (threadUpdatedAt falls back to updatedAt)", () => {
  const tasks: FixtureTask[] = [{ id: "t1", archived: false }];
  const sessions: FixtureSession[] = [
    { rpiStatus: "needs_approval", taskId: "t1", updatedAt: 10, threadUpdatedAt: null },
    { rpiStatus: "needs_approval", taskId: "t1", updatedAt: 20, threadUpdatedAt: 999 },
  ];
  const queue = attentionQueue(sessions, tasks);
  assert.deepEqual(
    queue.map((entry) => entry.session.threadUpdatedAt ?? entry.session.updatedAt),
    [999, 10],
  );
});

test("workflowSteps: rpi with worktree now/later/never", () => {
  assert.deepEqual(workflowSteps("rpi", "now"), ["worktree", "questions", "research", "design", "plan", "implementation", "PR"]);
  assert.deepEqual(workflowSteps("rpi", "later"), ["questions", "research", "design", "plan", "worktree", "implementation", "PR"]);
  assert.deepEqual(workflowSteps("rpi", "never"), ["questions", "research", "design", "plan", "implementation", "PR"]);
});

test("workflowSteps: oneshot ignores worktree timing", () => {
  assert.deepEqual(workflowSteps("oneshot", "now"), ["single session"]);
  assert.deepEqual(workflowSteps("oneshot", "later"), ["single session"]);
});

test("labelStep: normalizes rpi: prefix and known labels", () => {
  assert.equal(labelStep("rpi:research"), "research");
  assert.equal(labelStep("research-questions"), "questions");
  assert.equal(labelStep("worktree-setup"), "worktree");
  assert.equal(labelStep("describe-pr"), "PR");
  assert.equal(labelStep(null), null);
  assert.equal(labelStep(undefined), null);
});

test("phaseProgress: counts, worst tone, and done/current/future split", () => {
  const entries = phaseProgress({
    workflowType: "rpi",
    worktreeTiming: "later",
    currentLabel: "plan",
    sessions: [
      { label: "research-questions", rpiStatus: "completed" },
      { label: "research", rpiStatus: "ready_for_input" },
      { label: "research", rpiStatus: "failed" },
      { label: "plan", rpiStatus: "running" },
    ],
  });
  const steps = entries.map((entry) => entry.step);
  assert.deepEqual(steps, ["questions", "research", "design", "plan", "worktree", "implementation", "PR"]);

  const questions = entries.find((entry) => entry.step === "questions")!;
  assert.equal(questions.state, "done");
  assert.equal(questions.count, 1);
  assert.equal(questions.needsHuman, 0);

  const research = entries.find((entry) => entry.step === "research")!;
  assert.equal(research.state, "done");
  assert.equal(research.count, 2);
  assert.equal(research.needsHuman, 2);
  assert.equal(research.tone, "danger"); // worst of attention (ready_for_input) and danger (failed)

  const plan = entries.find((entry) => entry.step === "plan")!;
  assert.equal(plan.state, "current");
  assert.equal(plan.count, 1);
  assert.equal(plan.tone, "active");

  const design = entries.find((entry) => entry.step === "design")!;
  assert.equal(design.state, "done");
  assert.equal(design.count, 0);
  assert.equal(design.tone, null);

  const worktree = entries.find((entry) => entry.step === "worktree")!;
  assert.equal(worktree.state, "future");
});

test("phaseProgress: unmatched currentLabel means every step is future", () => {
  const entries = phaseProgress({
    workflowType: "oneshot",
    worktreeTiming: "never",
    currentLabel: "does-not-exist",
    sessions: [],
  });
  assert.ok(entries.every((entry) => entry.state === "future"));
});

test("TONE_ORDER puts danger first and muted last", () => {
  assert.equal(TONE_ORDER[0], "danger");
  assert.equal(TONE_ORDER[TONE_ORDER.length - 1], "muted");
});
