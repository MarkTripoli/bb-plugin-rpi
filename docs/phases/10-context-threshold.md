# Phase 10: configurable context-warning threshold

## What shipped

The context gauge and "Context high" banner used a single hardcoded 70%
threshold (`CONTEXT_WARNING_THRESHOLD`, `ui/rpi.tsx`). Replaced with a
threshold resolved per session from prefs, so it can be tuned globally and
per model.

- **`context-threshold.ts`** (new, pure module, no React/bb imports):
  - `contextThresholdFor(contextWarning, providerId, model)`: first rule in
    array order whose glob matches `"<providerId>/<model>"` wins, otherwise
    `defaultThreshold`. `model === null` always uses `defaultThreshold`.
  - `seedContextWarningRules(contextWarning)`: fills in the builtin rules
    when `rules` is empty, skipping any id already in `removedBuiltins`.
    Idempotent, so every reader can call it unconditionally.
  - Glob matching: `*` is the only metacharacter, everything else is
    escaped and matched literally, case-insensitive. No dependency, a small
    escape-then-`RegExp` (`globToRegExp`).
- **`contract.ts`**: `contextWarningRuleSchema` (`id`, `pattern`,
  `threshold` 0.3-0.95, `builtin`) and `contextWarningPrefsSchema`
  (`defaultThreshold` 0.3-0.95 default 0.6, `rules`, `removedBuiltins`),
  added to `prefsSchema`/`prefsUpdateSchema` the same way `notifications`
  already is (full-object default, `.partial()` on the update side).
  `sessionViewSchema` gained `contextWarnThreshold: number`.
- **`server.ts`**: `sessionTaskMeta(db, taskId)` reads the owning task's
  `provider_id`/`model` in the same query `sessionWorkflowType` used to read
  `workflow_type` (folded into one query). `sessionView`/`cachedSessionView`
  now also compute `contextWarnThreshold` via `contextThresholdFor`.
  `getPrefs` seeds the response's `contextWarning.rules` (without persisting
  until the user actually saves an edit through `setPrefs`, matching how a
  fresh install shows the builtin defaults without a migration).
  `setPrefs` merges `contextWarning` the same way it already merges
  `notifications`, keeps an in-memory `contextWarningPrefs` cache in sync
  (mirroring the existing `notificationPrefs` cache, needed because
  `cachedSessionView` runs synchronously inside `listSessions().map(...)`),
  and still publishes `prefs` realtime on every change (unchanged), so open
  headers re-resolve their threshold live.
- **`ui/rpi.tsx`**: `contextGaugeText(usage, threshold)` and
  `ContextGauge({ usage, threshold })` now take the session's
  `contextWarnThreshold` instead of a hardcoded constant; the gauge tooltip
  appends `warn at NN%`. `RpiDefaultsSettings` gained a "Context warning"
  section: a range+number input pair for `defaultThreshold` (30-95%, step
  5), a Pattern/Threshold/Delete table (builtin rows tagged "default"), an
  "Add rule" button, and a one-line pattern-syntax hint. Deleting a builtin
  row records its id in `removedBuiltins` so it is not re-seeded.
- **`tasks.ts`**: `defaultTaskPrefs` includes the new
  `contextWarning: { defaultThreshold: DEFAULT_CONTEXT_THRESHOLD, rules: [],
  removedBuiltins: [] }` field (same fresh-install-default shape as every
  other `Prefs` field).

### Builtin defaults

Small/fast models degrade earlier than large ones, so their default
threshold is lower; every builtin stays at or below 70% so the affordance
shows before a session becomes unusable regardless of model.

| Pattern | Threshold |
| --- | --- |
| `*/gpt-5.4-mini*` | 50% |
| `*/claude-haiku-*` | 50% |
| `*/gpt-5.5*` | 70% |
| `*/gpt-6-*` | 70% |
| `*/claude-sonnet-*` | 70% |
| `*/claude-fable-*` | 70% |
| `*/claude-opus-*` | 70% |

Global default (no rule matches, or no model recorded yet): 60%.

## Verification

- `npm test`: 175/175 passing, including the new
  `tests/context-threshold.test.ts`:
  - `seedContextWarningRules seeds every builtin when rules is empty`
  - `seedContextWarningRules skips removed builtins`
  - `seedContextWarningRules is a no-op once rules is non-empty`
  - `seedContextWarningRules stays empty when every builtin was removed`
  - `contextThresholdFor is case-insensitive and matches builtins`
  - `contextThresholdFor falls back to defaultThreshold with a null model`
  - `contextThresholdFor falls back to defaultThreshold when nothing matches`
  - `contextThresholdFor: first matching rule in array order wins`
  - `contextThresholdFor: glob escapes non-* characters literally`
  - `contextThresholdFor skips a rule with an empty pattern`
- `npx tsc --noEmit`: clean.
- `bb plugin build`: clean (`dist/server.js`, `dist/app.js`, `dist/app.css`).
- `npm run check:pack`: clean (dist/FEATURES.md/LICENSE/README.md present,
  docs/ and tests/ absent from the pack).
- `contextThresholdFor` spot checks from the task's Verify section:
  - `contextThresholdFor(seeded, "pi", "anthropic/claude-haiku-4-5-20251001") === 0.5`
  - `contextThresholdFor(seeded, "codex", "gpt-5.5") === 0.7`
  - `contextThresholdFor(seeded, "codex", null) === 0.6`
  All three are covered by `tests/context-threshold.test.ts`.

## Deviations from the task and why

- None. Extraction, auto-advance, notifications, skills, and the DB
  migrations are untouched; prefs storage keeps using the existing
  `bb.storage.kv` `PREFS_KEY` row, no new dependency, no new CLI subcommand
  (`getPrefs` already exposes the resolved prefs as JSON).

## Open items for the reviewer checklist

- No visual/manual pass in the bb desktop app or a simulator; verification
  is `npm test` + `tsc` + `bb plugin build` + `check:pack` only.
