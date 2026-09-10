import assert from "node:assert/strict";
import test from "node:test";
import { invalidHeaders, isConventionalHeader } from "../scripts/check-conventional.mjs";

test("Conventional Commit headers accept supported types, scopes, and breaking changes", () => {
  for (const subject of [
    "feat: add launch review",
    "fix(composer): preserve the draft",
    "refactor(api)!: remove the legacy endpoint",
    "ci(deps/tools): update the runner",
  ]) {
    assert.equal(isConventionalHeader(subject), true, subject);
  }
});

test("Conventional Commit headers reject untyped or malformed subjects", () => {
  const values = [
    { subject: "Add launch review" },
    { subject: "feature: add launch review" },
    { subject: "fix : add launch review" },
    { subject: "fix:" },
    { subject: "Merge branch 'main'" },
  ];
  assert.deepEqual(invalidHeaders(values), values);
});
