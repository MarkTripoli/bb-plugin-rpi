import test from "node:test";
import assert from "node:assert/strict";
import {
  PHASE_DESCRIPTIONS,
  SUPERSEDED,
  TONE_ORDER,
  attentionCountForTask,
  attentionQueue,
  attentionText,
  effectiveStatus,
  labelStep,
  needsHuman,
  phaseProgress,
  plural,
  statusMeta,
  stepIndex,
  workflowSteps,
} from "../status";
import { WORKFLOW_GRAPHS } from "../transitions";

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

test("statusMeta: superseded is a muted done state, distinct from failed/lost", () => {
  const meta = statusMeta(SUPERSEDED);
  assert.equal(meta.text, "Done");
  assert.equal(meta.tone, "muted");
  assert.equal(meta.icon, "CircleCheck");
  assert.ok(meta.hint.length > 0);
});

test("needsHuman table", () => {
  assert.equal(needsHuman("ready_for_input"), true);
  assert.equal(needsHuman("needs_approval"), true);
  assert.equal(needsHuman("failed"), true);
  assert.equal(needsHuman("lost"), true);
  assert.equal(needsHuman("running"), false);
  assert.equal(needsHuman("launching"), false);
  assert.equal(needsHuman("interrupted"), false);
  assert.equal(needsHuman(SUPERSEDED), false);
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
    "The session failed. Open it to see why, or start fresh.",
  );
  assert.equal(
    attentionText({ rpiStatus: "lost", blockedReason: null, nextStepJson: null, ingestError: "   " }),
    "The session failed. Open it to see why, or start fresh.",
  );
});

test("attentionText: anything else is empty", () => {
  assert.equal(
    attentionText({ rpiStatus: "running", blockedReason: null, nextStepJson: null, ingestError: null }),
    "",
  );
});

type FixtureSession = {
  threadId: string;
  label: string | null;
  rpiStatus: string;
  createdAt: number;
  advancedAt: number | null;
  taskId: string;
  updatedAt: number;
  threadUpdatedAt: number | null;
};
type FixtureTask = { id: string; archived: boolean; workflowType: "rpi"; worktreeTiming: "later" };

function fixtureSession(overrides: Partial<FixtureSession> & Pick<FixtureSession, "threadId" | "rpiStatus" | "taskId">): FixtureSession {
  return {
    label: null,
    createdAt: overrides.updatedAt ?? 0,
    advancedAt: null,
    updatedAt: 0,
    threadUpdatedAt: null,
    ...overrides,
  };
}

test("attentionQueue: filters archived and missing tasks, orders approval before failed/lost before ready-for-input", () => {
  const tasks: FixtureTask[] = [
    { id: "t1", archived: false, workflowType: "rpi", worktreeTiming: "later" },
    { id: "t2", archived: true, workflowType: "rpi", worktreeTiming: "later" },
  ];
  // Distinct (unrecognized) labels, not each session's default null: this fixture tests
  // rank/order/filter, not the same-task null-label supersede rule, so these four t1 sessions
  // must not supersede each other by recency.
  const sessions: FixtureSession[] = [
    fixtureSession({ threadId: "s1", label: "s1", rpiStatus: "ready_for_input", taskId: "t1", updatedAt: 100, threadUpdatedAt: 100 }),
    fixtureSession({ threadId: "s2", label: "s2", rpiStatus: "needs_approval", taskId: "t1", updatedAt: 50, threadUpdatedAt: 50 }),
    fixtureSession({ threadId: "s3", label: "s3", rpiStatus: "failed", taskId: "t1", updatedAt: 75, threadUpdatedAt: 75 }),
    fixtureSession({ threadId: "s4", label: "s4", rpiStatus: "running", taskId: "t1", updatedAt: 200, threadUpdatedAt: 200 }),
    fixtureSession({ threadId: "s5", label: "s5", rpiStatus: "ready_for_input", taskId: "t2", updatedAt: 500, threadUpdatedAt: 500 }),
    fixtureSession({ threadId: "s6", label: "s6", rpiStatus: "lost", taskId: "missing", updatedAt: 10, threadUpdatedAt: 10 }),
  ];
  const queue = attentionQueue(sessions, tasks);
  assert.deepEqual(
    queue.map((entry) => entry.session.rpiStatus),
    ["needs_approval", "failed", "ready_for_input"],
  );
  assert.deepEqual(
    queue.map((entry) => entry.status),
    ["needs_approval", "failed", "ready_for_input"],
  );
});

test("attentionQueue: newest first within a rank (threadUpdatedAt falls back to updatedAt)", () => {
  const tasks: FixtureTask[] = [{ id: "t1", archived: false, workflowType: "rpi", worktreeTiming: "later" }];
  const sessions: FixtureSession[] = [
    fixtureSession({ threadId: "s1", rpiStatus: "needs_approval", taskId: "t1", updatedAt: 10, threadUpdatedAt: null }),
    fixtureSession({ threadId: "s2", rpiStatus: "needs_approval", taskId: "t1", updatedAt: 20, threadUpdatedAt: 999 }),
  ];
  const queue = attentionQueue(sessions, tasks);
  assert.deepEqual(
    queue.map((entry) => entry.session.threadUpdatedAt ?? entry.session.updatedAt),
    [999, 10],
  );
});

test("attentionQueue: a session superseded by a later phase does not count as needing the human", () => {
  const tasks: FixtureTask[] = [{ id: "t1", archived: false, workflowType: "rpi", worktreeTiming: "later" }];
  const sessions: FixtureSession[] = [
    fixtureSession({ threadId: "s1", label: "research", rpiStatus: "ready_for_input", taskId: "t1", createdAt: 1, updatedAt: 1 }),
    fixtureSession({ threadId: "s2", label: "design", rpiStatus: "running", taskId: "t1", createdAt: 2, updatedAt: 2 }),
  ];
  const queue = attentionQueue(sessions, tasks);
  assert.deepEqual(queue, []);
});

test("attentionQueue: a fixture of 6 sessions across 2 tasks returns exactly the live ones", () => {
  const tasks: FixtureTask[] = [
    { id: "t1", archived: false, workflowType: "rpi", worktreeTiming: "later" },
    { id: "t2", archived: false, workflowType: "rpi", worktreeTiming: "later" },
  ];
  const sessions: FixtureSession[] = [
    // t1: questions and research are each superseded by the next phase that started after them;
    // design (the newest) still needs you.
    fixtureSession({ threadId: "t1-questions", label: "research-questions", rpiStatus: "ready_for_input", taskId: "t1", createdAt: 0, updatedAt: 0 }),
    fixtureSession({ threadId: "t1-research", label: "research", rpiStatus: "ready_for_input", taskId: "t1", createdAt: 1, updatedAt: 1 }),
    fixtureSession({ threadId: "t1-design", label: "design", rpiStatus: "ready_for_input", taskId: "t1", createdAt: 2, updatedAt: 2 }),
    // t2: research failed and nothing later in the workflow followed it, so it is still live; a
    // null-label helper session created after it must not supersede it; needs_approval is never
    // superseded regardless of order.
    fixtureSession({ threadId: "t2-research", label: "research", rpiStatus: "failed", taskId: "t2", createdAt: 1, updatedAt: 1 }),
    fixtureSession({ threadId: "t2-helper", label: null, rpiStatus: "ready_for_input", taskId: "t2", createdAt: 2, updatedAt: 2 }),
    fixtureSession({ threadId: "t2-approval", label: "plan", rpiStatus: "needs_approval", taskId: "t2", createdAt: 0, updatedAt: 0 }),
  ];
  const queue = attentionQueue(sessions, tasks);
  assert.deepEqual(
    queue.map((entry) => entry.session.threadId).sort(),
    ["t1-design", "t2-approval", "t2-helper", "t2-research"].sort(),
  );
});

test("stepIndex: index within the workflow's step order, -1 for null or unknown", () => {
  assert.equal(stepIndex("research", "rpi", "later"), 1);
  assert.equal(stepIndex("worktree-setup", "rpi", "later"), 4);
  assert.equal(stepIndex(null, "rpi", "later"), -1);
  assert.equal(stepIndex("not-a-real-label", "rpi", "later"), -1);
});

const RPI_TASK = { workflowType: "rpi", worktreeTiming: "later" } as const;

test("effectiveStatus: a newer session with the same label supersedes", () => {
  const older = { threadId: "a", label: "research", rpiStatus: "ready_for_input", createdAt: 1, advancedAt: null };
  const newer = { threadId: "b", label: "research", rpiStatus: "ready_for_input", createdAt: 2, advancedAt: null };
  assert.equal(effectiveStatus(older, [older, newer], RPI_TASK), SUPERSEDED);
});

test("effectiveStatus: a newer session in a later phase supersedes", () => {
  const older = { threadId: "a", label: "research", rpiStatus: "failed", createdAt: 1, advancedAt: null };
  const newer = { threadId: "b", label: "plan", rpiStatus: "running", createdAt: 2, advancedAt: null };
  assert.equal(effectiveStatus(older, [older, newer], RPI_TASK), SUPERSEDED);
});

test("effectiveStatus: a newer session with a null label never supersedes a labeled session", () => {
  const older = { threadId: "a", label: "research", rpiStatus: "ready_for_input", createdAt: 1, advancedAt: null };
  const newer = { threadId: "b", label: null, rpiStatus: "ready_for_input", createdAt: 2, advancedAt: null };
  assert.equal(effectiveStatus(older, [older, newer], RPI_TASK), "ready_for_input");
});

test("effectiveStatus: a newer null-label session supersedes an older null-label session in the same task", () => {
  // Live finding: three freeform sessions of the same task from 11h ago all read "Needs you";
  // only the newest of them should.
  const oldest = { threadId: "a", label: null, rpiStatus: "ready_for_input", createdAt: 1, advancedAt: null };
  const middle = { threadId: "b", label: null, rpiStatus: "ready_for_input", createdAt: 2, advancedAt: null };
  const newest = { threadId: "c", label: null, rpiStatus: "ready_for_input", createdAt: 3, advancedAt: null };
  const all = [oldest, middle, newest];
  assert.equal(effectiveStatus(oldest, all, RPI_TASK), SUPERSEDED);
  assert.equal(effectiveStatus(middle, all, RPI_TASK), SUPERSEDED);
  assert.equal(effectiveStatus(newest, all, RPI_TASK), "ready_for_input");
});

test("effectiveStatus: an older session never supersedes", () => {
  const target = { threadId: "a", label: "research", rpiStatus: "ready_for_input", createdAt: 2, advancedAt: null };
  const olderOther = { threadId: "b", label: "plan", rpiStatus: "running", createdAt: 1, advancedAt: null };
  assert.equal(effectiveStatus(target, [target, olderOther], RPI_TASK), "ready_for_input");
});

test("effectiveStatus: advancedAt supersedes even with no other session", () => {
  const advanced = { threadId: "a", label: "research", rpiStatus: "ready_for_input", createdAt: 1, advancedAt: 5 };
  assert.equal(effectiveStatus(advanced, [advanced], RPI_TASK), SUPERSEDED);
});

test("effectiveStatus: needs_approval is never superseded", () => {
  const older = { threadId: "a", label: "research", rpiStatus: "needs_approval", createdAt: 1, advancedAt: null };
  const newer = { threadId: "b", label: "plan", rpiStatus: "running", createdAt: 2, advancedAt: null };
  assert.equal(effectiveStatus(older, [older, newer], RPI_TASK), "needs_approval");
});

test("effectiveStatus: running is never superseded", () => {
  const older = { threadId: "a", label: "research", rpiStatus: "running", createdAt: 1, advancedAt: null };
  const newer = { threadId: "b", label: "plan", rpiStatus: "ready_for_input", createdAt: 2, advancedAt: null };
  assert.equal(effectiveStatus(older, [older, newer], RPI_TASK), "running");
});

test("effectiveStatus: a lone ready_for_input in the current phase stays live", () => {
  const only = { threadId: "a", label: "plan", rpiStatus: "ready_for_input", createdAt: 1, advancedAt: null };
  assert.equal(effectiveStatus(only, [only], RPI_TASK), "ready_for_input");
});

test("attentionCountForTask matches the number of live needs-human sessions", () => {
  const sessions = [
    { threadId: "a", label: "research", rpiStatus: "ready_for_input", createdAt: 1, advancedAt: null },
    { threadId: "b", label: "design", rpiStatus: "ready_for_input", createdAt: 2, advancedAt: null },
    { threadId: "c", label: "design", rpiStatus: "running", createdAt: 2, advancedAt: null },
  ];
  assert.equal(attentionCountForTask(sessions, RPI_TASK), 1); // only "b"; "a" is superseded by "b"
});

test("PHASE_DESCRIPTIONS covers every step of every WORKFLOW_GRAPHS entry", () => {
  for (const steps of Object.values(WORKFLOW_GRAPHS)) {
    for (const step of steps) {
      assert.ok(PHASE_DESCRIPTIONS[step], `missing description for step "${step}"`);
    }
  }
});

test("workflowSteps: rpi with worktree now/later/never", () => {
  assert.deepEqual(workflowSteps("rpi", "now"), ["worktree", "questions", "research", "design", "plan", "implementation", "review", "PR", "PR review"]);
  assert.deepEqual(workflowSteps("rpi", "later"), ["questions", "research", "design", "plan", "worktree", "implementation", "review", "PR", "PR review"]);
  assert.deepEqual(workflowSteps("rpi", "never"), ["questions", "research", "design", "plan", "implementation", "review", "PR", "PR review"]);
});

test("workflowSteps: oneshot ignores worktree timing but keeps optional review phases", () => {
  assert.deepEqual(workflowSteps("oneshot", "now"), ["single session", "review", "PR", "PR review"]);
  assert.deepEqual(workflowSteps("oneshot", "later"), ["single session", "review", "PR", "PR review"]);
});

test("labelStep: normalizes rpi: prefix and known labels", () => {
  assert.equal(labelStep("rpi:research"), "research");
  assert.equal(labelStep("freeform"), "single session");
  assert.equal(labelStep("research-questions"), "questions");
  assert.equal(labelStep("worktree-setup"), "worktree");
  assert.equal(labelStep("code-review"), "review");
  assert.equal(labelStep("review-fixes"), "review");
  assert.equal(labelStep("describe-pr"), "PR");
  assert.equal(labelStep("pr-review"), "PR review");
  assert.equal(labelStep(null), null);
  assert.equal(labelStep(undefined), null);
});

test("phaseProgress: counts, worst tone, and done/current/future split", () => {
  const entries = phaseProgress({
    workflowType: "rpi",
    worktreeTiming: "later",
    currentLabel: "plan",
    sessions: [
      { threadId: "s1", label: "research-questions", rpiStatus: "completed", createdAt: 1, advancedAt: null },
      { threadId: "s2", label: "research", rpiStatus: "ready_for_input", createdAt: 2, advancedAt: null },
      { threadId: "s3", label: "research", rpiStatus: "failed", createdAt: 3, advancedAt: null },
      { threadId: "s4", label: "plan", rpiStatus: "running", createdAt: 4, advancedAt: null },
    ],
  });
  const steps = entries.map((entry) => entry.step);
  assert.deepEqual(steps, ["questions", "research", "design", "plan", "worktree", "implementation", "review", "PR", "PR review"]);

  const questions = entries.find((entry) => entry.step === "questions")!;
  assert.equal(questions.state, "done");
  assert.equal(questions.count, 1);
  assert.equal(questions.needsHuman, 0);

  // research's own sessions are each superseded once the later "plan" session started (B.1: a
  // finished phase whose successor already ran no longer needs the human), so needsHuman/live
  // drop to 0 even though count (every session ever assigned to the step) stays 2.
  const research = entries.find((entry) => entry.step === "research")!;
  assert.equal(research.state, "done");
  assert.equal(research.count, 2);
  assert.equal(research.needsHuman, 0);
  assert.equal(research.tone, "muted");
  assert.equal(research.live, 0);

  const plan = entries.find((entry) => entry.step === "plan")!;
  assert.equal(plan.state, "current");
  assert.equal(plan.count, 1);
  assert.equal(plan.tone, "active");
  assert.equal(plan.live, 1);

  const design = entries.find((entry) => entry.step === "design")!;
  assert.equal(design.state, "done");
  assert.equal(design.count, 0);
  assert.equal(design.tone, null);
  assert.equal(design.live, 0);

  const worktree = entries.find((entry) => entry.step === "worktree")!;
  assert.equal(worktree.state, "future");
});

test("phaseProgress: a step whose only session is superseded shows a muted tone", () => {
  const entries = phaseProgress({
    workflowType: "rpi",
    worktreeTiming: "later",
    currentLabel: "design",
    sessions: [
      { threadId: "s1", label: "research", rpiStatus: "ready_for_input", createdAt: 1, advancedAt: null },
      { threadId: "s2", label: "design", rpiStatus: "running", createdAt: 2, advancedAt: null },
    ],
  });
  const research = entries.find((entry) => entry.step === "research")!;
  assert.equal(research.tone, "muted");
  assert.equal(research.needsHuman, 0);
  assert.equal(research.live, 0);
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

test("plural: singular at 1, default and explicit plural form otherwise", () => {
  assert.equal(plural(1, "session"), "1 session");
  assert.equal(plural(2, "session"), "2 sessions");
  assert.equal(plural(0, "session"), "0 sessions");
  assert.equal(plural(1, "child", "children"), "1 child");
  assert.equal(plural(3, "child", "children"), "3 children");
});
