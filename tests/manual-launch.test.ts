import assert from "node:assert/strict";
import test from "node:test";
import { buildManualLaunchRoute, parseManualLaunchRoute } from "../manual-launch";
import type { ManualLaunchIntent } from "../contract";

test("manual launch routes round-trip every supported intent", () => {
  const intents: ManualLaunchIntent[] = [
    { kind: "draft", taskId: "task_1" },
    { kind: "skill", taskId: "task_1", skillId: "review-code" },
    { kind: "proceed", threadId: "thread:1" },
    { kind: "iterate", threadId: "thread.1" },
  ];

  for (const intent of intents) {
    assert.deepEqual(parseManualLaunchRoute(buildManualLaunchRoute(intent)), intent);
  }
});

test("manual launch routes reject malformed and unbounded input", () => {
  for (const route of [
    "compose/draft/",
    `compose/draft/${"a".repeat(257)}`,
    "compose/draft/%E0%A4%A",
    "compose/draft/task%2Fother",
    "compose/draft/task/extra",
    "compose/unknown/task",
    "compose/skill/task",
    "compose/skill/task/review-code/extra",
    "compose/skill/task/%2Freview-code",
    "compose/skill/task/unknown-skill",
    "compose/proceed/thread/extra",
    "compose/iterate/thread%5Cother",
  ]) {
    assert.equal(parseManualLaunchRoute(route), null, route);
  }
});

test("manual launch route builder rejects identifiers that cannot be routed", () => {
  assert.throws(() => buildManualLaunchRoute({ kind: "draft", taskId: "task/other" }));
  assert.throws(() => buildManualLaunchRoute({ kind: "skill", taskId: "task", skillId: "" }));
  assert.throws(() => buildManualLaunchRoute({ kind: "skill", taskId: "task", skillId: "unknown-skill" }));
});
