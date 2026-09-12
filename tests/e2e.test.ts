import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_E2E_PREFS } from "../contract";
import { E2E_REASONING_LABELS, e2eGuardState, e2eGuardStateFromRecent, e2ePausedText, phaseModelFor, retryChainDepth, type E2eAttempt } from "../e2e";

let counter = 0;
function attempt(overrides: Partial<E2eAttempt> = {}): E2eAttempt {
  counter += 1;
  return { id: `a${counter}`, launchedBy: "auto_advance", skillId: "create-research", status: "spawned", retriedFrom: null, ...overrides };
}

test("e2eGuardState: empty list has zero counters and no pause", () => {
  assert.deepEqual(e2eGuardState([], DEFAULT_E2E_PREFS), { hops: 0, reviewCycles: 0, retryDepth: 0, pausedReason: null });
});

test("e2eGuardState: newest human attempt anchors the counters and resets them", () => {
  const attempts = [
    attempt({ launchedBy: "proceed" }),
    attempt(),
    attempt(),
    attempt(),
    attempt(),
    attempt(),
    attempt({ launchedBy: "user" }),
  ];
  const state = e2eGuardState(attempts, DEFAULT_E2E_PREFS);
  assert.equal(state.hops, 0);
  assert.equal(state.reviewCycles, 0);
  assert.equal(state.pausedReason, null);
});

test("e2eGuardState: hop cap pauses with reason hops", () => {
  const attempts = Array.from({ length: 30 }, () => attempt());
  const state = e2eGuardState(attempts, DEFAULT_E2E_PREFS);
  assert.equal(state.hops, 30);
  assert.equal(state.pausedReason, "hops");
  assert.equal(e2ePausedText(state), "Full auto paused: hop cap reached");
});

test("e2eGuardState: review cycles count fix-code-review hops and pause at the cap", () => {
  const attempts = [
    attempt({ launchedBy: "user" }),
    attempt({ skillId: "fix-code-review" }),
    attempt({ skillId: "fix-code-review" }),
    attempt({ skillId: "fix-code-review" }),
    attempt({ skillId: "fix-code-review" }),
    attempt({ skillId: "fix-code-review" }),
  ];
  const state = e2eGuardState(attempts, { ...DEFAULT_E2E_PREFS, maxReviewCycles: 5 });
  assert.equal(state.reviewCycles, 5);
  assert.equal(state.pausedReason, "review_cycles");
  assert.equal(e2ePausedText(state), "Full auto paused: review cap reached");
});

test("e2eGuardState: a chain under the retry cap does not pause", () => {
  const a1 = attempt({ launchedBy: "proceed" });
  const a2 = attempt({ retriedFrom: a1.id, status: "failed" });
  const a3 = attempt({ retriedFrom: a2.id, status: "failed" });
  const state = e2eGuardState([a1, a2, a3], { ...DEFAULT_E2E_PREFS, maxRetries: 3 });
  assert.equal(state.retryDepth, 2);
  assert.equal(state.pausedReason, null);
});

test("e2eGuardState: newest failed attempt at the retry cap pauses with reason retries", () => {
  const a1 = attempt({ launchedBy: "proceed" });
  const a2 = attempt({ retriedFrom: a1.id, status: "failed" });
  const a3 = attempt({ retriedFrom: a2.id, status: "failed" });
  const a4 = attempt({ retriedFrom: a3.id, status: "failed" });
  const state = e2eGuardState([a1, a2, a3, a4], { ...DEFAULT_E2E_PREFS, maxRetries: 3 });
  assert.equal(state.retryDepth, 3);
  assert.equal(state.pausedReason, "retries");
  assert.equal(e2ePausedText(state), "Full auto paused: retry cap reached");
});

test("e2eGuardState: a spawned newest attempt with depth 3 does not pause", () => {
  const a1 = attempt({ launchedBy: "proceed", status: "failed" });
  const a2 = attempt({ retriedFrom: a1.id, status: "failed" });
  const a3 = attempt({ retriedFrom: a2.id, status: "failed" });
  const a4 = attempt({ retriedFrom: a3.id });
  const state = e2eGuardState([a1, a2, a3, a4], { ...DEFAULT_E2E_PREFS, maxRetries: 3 });
  assert.equal(state.retryDepth, 3);
  assert.equal(state.pausedReason, null);
});

test("e2eGuardState: hop and review caps outrank the retry pause", () => {
  const attempts = [
    attempt({ launchedBy: "user", status: "failed" }),
    attempt({ status: "failed" }),
  ];
  const state = e2eGuardState(attempts, { ...DEFAULT_E2E_PREFS, maxHops: 1 });
  assert.equal(state.pausedReason, "hops");
});

test("retryChainDepth counts retried_from links and survives a cycle", () => {
  const a1 = attempt();
  const a2 = attempt({ retriedFrom: a1.id });
  const a3 = attempt({ retriedFrom: a2.id });
  assert.equal(retryChainDepth([a1, a2, a3], a1.id), 0);
  assert.equal(retryChainDepth([a1, a2, a3], a2.id), 1);
  assert.equal(retryChainDepth([a1, a2, a3], a3.id), 2);
  assert.equal(retryChainDepth([a1, a2, a3], "missing"), 0);

  const c1 = attempt({ id: "c1" });
  const c2 = attempt({ id: "c2", retriedFrom: "c1" });
  const c3 = attempt({ id: "c3", retriedFrom: "c2" });
  c1.retriedFrom = "c3";
  assert.equal(retryChainDepth([c1, c2, c3], "c3"), 3);
  assert.equal(retryChainDepth([c1, c2, c3], "c1"), 3);
});

test("e2eGuardStateFromRecent: newest-first panel input matches the oldest-first result", () => {
  const attempts = [
    attempt({ launchedBy: "proceed" }),
    attempt(),
    attempt(),
    attempt({ skillId: "fix-code-review" }),
    attempt({ skillId: "fix-code-review" }),
    attempt({ launchedBy: "user" }),
    attempt({ skillId: "fix-code-review" }),
    attempt({ skillId: "fix-code-review" }),
    attempt({ skillId: "fix-code-review" }),
  ];
  const newestFirst = [...attempts].reverse();
  assert.deepEqual(e2eGuardStateFromRecent(newestFirst, { ...DEFAULT_E2E_PREFS, maxReviewCycles: 5 }), e2eGuardState(attempts, { ...DEFAULT_E2E_PREFS, maxReviewCycles: 5 }));
  assert.deepEqual(e2eGuardStateFromRecent(newestFirst, DEFAULT_E2E_PREFS), e2eGuardState(attempts, DEFAULT_E2E_PREFS));
  assert.deepEqual(e2eGuardStateFromRecent([], DEFAULT_E2E_PREFS), e2eGuardState([], DEFAULT_E2E_PREFS));
});

test("phaseModelFor: explicit per-phase entry wins over the class default", () => {
  const task = {
    e2eMode: true,
    phaseModels: { implementation: { providerId: "codex", model: "gpt-fast" } },
  };
  assert.deepEqual(
    phaseModelFor(task, "implementation", { fastModel: { providerId: "pi", model: "f" }, reasoningModel: { providerId: "pi", model: "r" } }),
    { providerId: "codex", model: "gpt-fast" },
  );
});

test("phaseModelFor: class defaults apply only when e2e mode is on", () => {
  const prefs = { fastModel: { providerId: "pi", model: "fast" }, reasoningModel: { providerId: "pi", model: "reason" } };
  const on = { e2eMode: true, phaseModels: {} };
  const off = { e2eMode: false, phaseModels: {} };
  assert.deepEqual(phaseModelFor(on, "implementation", prefs), { providerId: "pi", model: "fast" });
  assert.deepEqual(phaseModelFor(on, "code-review", prefs), { providerId: "pi", model: "reason" });
  assert.equal(phaseModelFor(off, "implementation", prefs), undefined);
  assert.equal(phaseModelFor(off, "code-review", prefs), undefined);
});

test("phaseModelFor: reasoning labels classify, null label returns undefined", () => {
  assert.equal(E2E_REASONING_LABELS.has("code-review"), true);
  assert.equal(E2E_REASONING_LABELS.has("implementation"), false);
  const task = { e2eMode: true, phaseModels: {} };
  assert.equal(phaseModelFor(task, null, { fastModel: { providerId: "pi", model: "f" }, reasoningModel: null }), undefined);
  assert.equal(phaseModelFor(task, "design-prd", { fastModel: { providerId: "pi", model: "f" }, reasoningModel: null }), undefined);
  assert.deepEqual(
    phaseModelFor(task, "design-prd", { fastModel: { providerId: "pi", model: "f" }, reasoningModel: { providerId: "pi", model: "r" } }),
    { providerId: "pi", model: "r" },
  );
});

test("e2ePausedText returns null with no paused reason", () => {
  assert.equal(e2ePausedText({ hops: 0, reviewCycles: 0, retryDepth: 0, pausedReason: null }), null);
});
