import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_EPIC_MAX_PARALLEL,
  childWorktreeTiming,
  childrenByDepth,
  epicRollup,
  parseEpicChildren,
  readyChildren,
} from "../epic";

function plan(block: string, heading = "## Children") {
  return `---\ntype: epic-plan\n---\n# Epic\n\n## Overview\nintro\n\n${heading}\n\n\`\`\`json\n${block}\n\`\`\`\n\n## Notes\nafter`;
}

const validBlock = JSON.stringify([
  { name: "A", workflow: "rpi", prompt: "Build A" },
  { name: "B", workflow: "oneshot", prompt: "Build B", depends_on: ["A"], worktree: "never" },
]);

test("parseEpicChildren round-trips a valid block with depends_on and worktree", () => {
  const parsed = parseEpicChildren(plan(validBlock));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(parsed.children, [
    { name: "A", workflow: "rpi", prompt: "Build A", depends_on: [] },
    { name: "B", workflow: "oneshot", prompt: "Build B", depends_on: ["A"], worktree: "never" },
  ]);
});

test("parseEpicChildren names each fault with one issue", () => {
  const cases: Array<[string, string, RegExp]> = [
    ["missing section", plan(validBlock, "## Kids"), /missing `## Children` section/],
    ["missing fence", "## Children\n\nno fence here\n\n## Next\n```json\n[]\n```", /missing ```json fence/],
    ["invalid json", plan("[{ name: A }]"), /invalid JSON/],
    ["unknown workflow", plan(JSON.stringify([{ name: "A", workflow: "epic", prompt: "p" }])), /^0\.workflow: /],
    ["duplicate name", plan(JSON.stringify([{ name: "A", workflow: "rpi", prompt: "p" }, { name: "A", workflow: "rpi", prompt: "q" }])), /duplicate child name: A/],
    ["unknown dependency", plan(JSON.stringify([{ name: "A", workflow: "rpi", prompt: "p", depends_on: ["Z"] }])), /A depends on unknown child: Z/],
    ["self dependency", plan(JSON.stringify([{ name: "A", workflow: "rpi", prompt: "p", depends_on: ["A"] }])), /A depends on itself/],
    ["cycle", plan(JSON.stringify([
      { name: "A", workflow: "rpi", prompt: "p", depends_on: ["B"] },
      { name: "B", workflow: "rpi", prompt: "q", depends_on: ["A"] },
    ])), /dependency cycle: A -> B -> A/],
  ];
  for (const [label, markdown, expected] of cases) {
    const parsed = parseEpicChildren(markdown);
    assert.equal(parsed.ok, false, label);
    if (parsed.ok) continue;
    assert.equal(parsed.issues.length, 1, `${label}: ${parsed.issues.join(" | ")}`);
    assert.match(parsed.issues[0]!, expected, label);
  }
});

test("childWorktreeTiming prefers the explicit value and defaults by workflow", () => {
  assert.equal(childWorktreeTiming({ workflow: "rpi", worktree: "now" }), "now");
  assert.equal(childWorktreeTiming({ workflow: "oneshot" }), "now");
  assert.equal(childWorktreeTiming({ workflow: "freeform" }), "now");
  assert.equal(childWorktreeTiming({ workflow: "rpi" }), "later");
  assert.equal(childWorktreeTiming({ workflow: "prd_tdd" }), "later");
});

function child(id: string, overrides: Partial<{ isDraft: boolean; completed: boolean; archived: boolean; dependsOn: string[]; position: number | null }> = {}) {
  return { id, isDraft: true, completed: false, archived: false, dependsOn: [], position: null, ...overrides };
}

test("readyChildren honors pause, cap minus running, completed dependencies, and position order", () => {
  const a = child("a", { isDraft: false, completed: true, position: 0 });
  const b = child("b", { dependsOn: ["a"], position: 2 });
  const c = child("c", { position: 1 });
  const d = child("d", { dependsOn: ["b"], position: 3 });
  const children = [a, b, c, d];
  assert.deepEqual(readyChildren({ epicPaused: true, maxParallel: 5 }, children, new Set()), []);
  assert.deepEqual(readyChildren({ epicPaused: false, maxParallel: 5 }, children, new Set()).map((row) => row.id), ["c", "b"]);
  assert.deepEqual(readyChildren({ epicPaused: false, maxParallel: 2 }, children, new Set(["x"])).map((row) => row.id), ["c"]);
  assert.deepEqual(readyChildren({ epicPaused: false, maxParallel: 1 }, children, new Set(["x"])), []);
  assert.equal(DEFAULT_EPIC_MAX_PARALLEL, 2);
  assert.deepEqual(readyChildren({ epicPaused: false, maxParallel: null }, children, new Set()).map((row) => row.id), ["c", "b"]);
});

test("childrenByDepth splits a chain into waves", () => {
  const a = child("a");
  const b = child("b", { dependsOn: ["a"] });
  const c = child("c", { dependsOn: ["a", "b"] });
  const orphan = child("o", { dependsOn: ["missing"] });
  assert.deepEqual(childrenByDepth([c, b, a, orphan]).map((wave) => wave.map((row) => row.id)), [["a", "o"], ["b"], ["c"]]);
});

test("epicRollup counts states and picks the worst tone", () => {
  const children = [
    { id: "a", isDraft: false, completed: true, attentionCount: 0 },
    { id: "b", isDraft: false, completed: false, attentionCount: 0 },
    { id: "c", isDraft: false, completed: false, attentionCount: 1 },
    { id: "d", isDraft: false, completed: false, attentionCount: 0 },
    { id: "e", isDraft: true, completed: false, attentionCount: 0 },
  ];
  const statuses = new Map([["b", "running"], ["c", "ready_for_input"], ["d", "failed"], ["b2", "needs_approval"]]);
  assert.deepEqual(epicRollup(children, statuses), { total: 5, done: 1, running: 1, waiting: 1, failed: 1, queued: 1, tone: "danger" });
  assert.deepEqual(epicRollup(children.slice(0, 2), new Map([["b", "needs_approval"]])), { total: 2, done: 1, running: 0, waiting: 0, failed: 0, queued: 0, tone: "warning" });
  assert.equal(epicRollup([children[0]!], new Map()).tone, "success");
  assert.equal(epicRollup([], new Map()).tone, null);
});
