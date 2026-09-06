// Pure resolver for the configurable context-warning threshold. No React, no bb SDK imports: the
// glob match and the seed/resolve decisions here need node:test coverage without a plugin runtime.
import type { ContextWarningPrefs } from "./contract";

export const DEFAULT_CONTEXT_THRESHOLD = 0.6;

// Builtin per-model defaults: small/fast models degrade earlier than large ones, so their
// threshold is lower; every builtin stays at or below 0.7 so the affordance shows before a
// session becomes unusable regardless of which model it is running.
export const BUILTIN_CONTEXT_WARNING_RULES: ReadonlyArray<{ id: string; pattern: string; threshold: number }> = [
  { id: "gpt-5.4-mini", pattern: "*/gpt-5.4-mini*", threshold: 0.5 },
  { id: "claude-haiku", pattern: "*/claude-haiku-*", threshold: 0.5 },
  { id: "gpt-5.5", pattern: "*/gpt-5.5*", threshold: 0.7 },
  { id: "gpt-6", pattern: "*/gpt-6-*", threshold: 0.7 },
  { id: "claude-sonnet", pattern: "*/claude-sonnet-*", threshold: 0.7 },
  { id: "claude-fable", pattern: "*/claude-fable-*", threshold: 0.7 },
  { id: "claude-opus", pattern: "*/claude-opus-*", threshold: 0.7 },
];

// Present the builtin rows on first read (rules empty or missing), skipping any the user has
// deliberately deleted (removedBuiltins). Idempotent: running this again against an
// already-seeded object, or one the user emptied entirely (every builtin id in removedBuiltins),
// is a no-op, so every caller can apply it on every read without re-adding a deleted default.
export function seedContextWarningRules(contextWarning: ContextWarningPrefs): ContextWarningPrefs {
  if (contextWarning.rules.length > 0) return contextWarning;
  const removed = new Set(contextWarning.removedBuiltins);
  return {
    ...contextWarning,
    rules: BUILTIN_CONTEXT_WARNING_RULES.filter((rule) => !removed.has(rule.id)).map((rule) => ({ ...rule, builtin: true })),
  };
}

// `*` is the only glob metacharacter; every other character is matched literally (case
// insensitive), so a pattern never behaves as an unintended regex.
function globToRegExp(pattern: string) {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, (char) => (char === "*" ? ".*" : `\\${char}`));
  return new RegExp(`^${escaped}$`, "i");
}

/**
 * Resolves the context-warning threshold for a session. The first rule in array order whose
 * glob matches "<providerId>/<model>" wins; no match falls back to defaultThreshold. `model`
 * null (no task model recorded yet) always uses defaultThreshold, since there is nothing to match
 * a per-model rule against.
 */
export function contextThresholdFor(contextWarning: ContextWarningPrefs, providerId: string | null, model: string | null): number {
  if (model === null) return contextWarning.defaultThreshold;
  const key = `${providerId ?? ""}/${model}`;
  const seeded = seedContextWarningRules(contextWarning);
  for (const rule of seeded.rules) {
    if (!rule.pattern) continue;
    if (globToRegExp(rule.pattern).test(key)) return rule.threshold;
  }
  return contextWarning.defaultThreshold;
}
