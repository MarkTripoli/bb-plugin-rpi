import test from "node:test";
import assert from "node:assert/strict";
import {
  BUILTIN_CONTEXT_WARNING_RULES,
  DEFAULT_CONTEXT_THRESHOLD,
  contextThresholdFor,
  seedContextWarningRules,
} from "../context-threshold";
import type { ContextWarningPrefs } from "../contract";

const EMPTY: ContextWarningPrefs = { defaultThreshold: DEFAULT_CONTEXT_THRESHOLD, rules: [], removedBuiltins: [] };

test("seedContextWarningRules seeds every builtin when rules is empty", () => {
  const seeded = seedContextWarningRules(EMPTY);
  assert.equal(seeded.rules.length, BUILTIN_CONTEXT_WARNING_RULES.length);
  assert.ok(seeded.rules.every((rule) => rule.builtin === true));
  assert.deepEqual(seeded.rules.map((rule) => rule.id), BUILTIN_CONTEXT_WARNING_RULES.map((rule) => rule.id));
});

test("seedContextWarningRules skips removed builtins", () => {
  const seeded = seedContextWarningRules({ ...EMPTY, removedBuiltins: ["claude-haiku", "gpt-5.5"] });
  assert.ok(!seeded.rules.some((rule) => rule.id === "claude-haiku" || rule.id === "gpt-5.5"));
  assert.equal(seeded.rules.length, BUILTIN_CONTEXT_WARNING_RULES.length - 2);
});

test("seedContextWarningRules is a no-op once rules is non-empty", () => {
  const custom: ContextWarningPrefs = { ...EMPTY, rules: [{ id: "custom", pattern: "*/my-model*", threshold: 0.4, builtin: false }] };
  assert.deepEqual(seedContextWarningRules(custom), custom);
});

test("seedContextWarningRules stays empty when every builtin was removed", () => {
  const removedBuiltins = BUILTIN_CONTEXT_WARNING_RULES.map((rule) => rule.id);
  const seeded = seedContextWarningRules({ ...EMPTY, removedBuiltins });
  assert.deepEqual(seeded.rules, []);
});

test("contextThresholdFor is case-insensitive and matches builtins", () => {
  assert.equal(contextThresholdFor(EMPTY, "pi", "anthropic/claude-haiku-4-5-20251001"), 0.5);
  assert.equal(contextThresholdFor(EMPTY, "pi", "ANTHROPIC/CLAUDE-HAIKU-4-5"), 0.5);
  assert.equal(contextThresholdFor(EMPTY, "codex", "gpt-5.5"), 0.7);
});

test("contextThresholdFor falls back to defaultThreshold with a null model", () => {
  assert.equal(contextThresholdFor(EMPTY, "codex", null), DEFAULT_CONTEXT_THRESHOLD);
});

test("contextThresholdFor falls back to defaultThreshold when nothing matches", () => {
  assert.equal(contextThresholdFor(EMPTY, "pi", "some-unlisted-model"), DEFAULT_CONTEXT_THRESHOLD);
});

test("contextThresholdFor: first matching rule in array order wins", () => {
  const prefs: ContextWarningPrefs = {
    defaultThreshold: 0.6,
    rules: [
      { id: "a", pattern: "*/claude-sonnet-*", threshold: 0.9, builtin: false },
      { id: "b", pattern: "*/claude-sonnet-*", threshold: 0.3, builtin: false },
    ],
    removedBuiltins: [],
  };
  assert.equal(contextThresholdFor(prefs, "pi", "anthropic/claude-sonnet-5"), 0.9);
});

test("contextThresholdFor: glob escapes non-* characters literally", () => {
  const prefs: ContextWarningPrefs = {
    defaultThreshold: 0.6,
    rules: [{ id: "literal", pattern: "codex/gpt-5.5", threshold: 0.8, builtin: false }],
    removedBuiltins: [],
  };
  // A literal "." in the pattern must not act as a regex wildcard: "gpt-5X5" must not match.
  assert.equal(contextThresholdFor(prefs, "codex", "gpt-5X5"), 0.6);
  assert.equal(contextThresholdFor(prefs, "codex", "gpt-5.5"), 0.8);
});

test("contextThresholdFor skips a rule with an empty pattern", () => {
  const prefs: ContextWarningPrefs = {
    defaultThreshold: 0.6,
    rules: [{ id: "blank", pattern: "", threshold: 0.9, builtin: false }],
    removedBuiltins: [],
  };
  assert.equal(contextThresholdFor(prefs, "pi", "anthropic/claude-sonnet-5"), 0.6);
});
