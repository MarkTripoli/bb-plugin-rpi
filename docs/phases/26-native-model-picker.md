# Phase 26: native provider/model picker everywhere

## What shipped

- All five model pickers (New task form, task Settings tab, phase-complete composer banner,
  Settings defaults card, per-workflow table, research subagent row) now render bb's own
  host-owned `experimental_ProviderModelPicker` (SDK app export) instead of the plugin's
  hand-rolled `ModelSelect` native `<select>`. The picker shows the same UI as bb's composers:
  provider tabs, search, model list, reasoning level, fast mode, and service tiers.
- New shared wrapper `RpiModelPicker` (ui/rpi.tsx): maps the plugin's stored
  `{providerId, model, reasoningLevel}` value onto the picker's concrete
  `ExperimentalProviderModelPickerValue`, and carries the "unset" option as a checkbox
  (`allowDefault`) because the native picker only speaks a concrete selection.
- Incomplete stored values (task model set but reasoning null; the bare research-model string
  with no providerId) are seeded from `listModels`: matching by model id when a providerId is
  absent, otherwise bb's `isDefault` entry, with the model's `defaultReasoningEffort` as the
  reasoning seed. `listModels` stays as the only catalog fetch the plugin makes, and it is now
  a one-shot seed, not a page-lifetime cache.
- Deleted as dead code: `modelCatalogCache`/`fetchModelCatalog` (the page-lifetime cache whose
  stale partial fetch left every picker showing only Codex until a full app reload),
  `ModelSelect`, `truncateForBanner`, and in models.ts `modelOptionValue` /
  `parseModelOptionValue` / `modelDisplay` (with their tests). The 200-model optgroup
  truncation and the silently dropped failed provider (`acp-cursor` auth_required) both
  disappear with the plugin-side catalog rendering.
- Task detail page's model meta line uses `experimental_useProviders` for the provider
  display name (`modelLabel` helper) instead of the merged catalog.

## Diagnosis that motivated this (live-verified)

The user reported only Codex models in every picker. Temporary instrumentation in the
`listModels` RPC proved the server side was healthy all along: 5 providers listed, merged
catalog codex 6 / claude-code 6 / pi 627 / acp-opencode 482 / acp-cursor 0 (auth_required).
The bug was the client: the first `listModels` fetch, whenever it happened (possibly before
bb finished loading providers), was cached for the page's lifetime with no invalidation, so a
partial catalog poisoned every picker until the app tab was reloaded. The instrumentation
logs were removed after confirming; the cache itself is gone with `ModelSelect`.

## Revision 2: in-place launch prompt, no navigation

User rejected the composer-navigation flow ("dropping me to the RPI tab every time"). Final
shape: the launch prompt is a small dialog rendered inside the session view, no navigation.

- Banner action buttons (proceed, completion actions, iterate with confirmation on) open
  `LaunchActionDialog` in place: pre-checked "Use task default (model)" plus a native
  `ProviderModelPicker` revealed by unchecking it. Launch calls the one-click RPC with an
  optional `modelOverride`; the pick is one-shot and never written to the task record.
- The one-click RPCs (`proceed`, `launchCompletion`, `iterateInFreshSession`) accept an
  optional `modelOverride: { providerId, model, reasoningLevel? }` (contract.ts
  `modelOverrideSchema`). `launchPhase` applies it over `taskExecutionSeeds(task)` in the
  no-request spawn branch only; the composer/manual-launch path is unchanged. CLI is
  unaffected (override omitted means task defaults, as before).
- `launchSkill`/`launchDraft` do not take an override yet: skill launches go through the task
  menu where the model setting is adjacent, and draft creation sets the model at creation.
- The old iterate ConfirmDialog is replaced by this dialog (it is the confirmation step).
  `showIterateConfirmation = false` keeps the truly direct one-click iterate with no prompt.
- tests/ui-conventions.test.ts enforces: each of `proceed`, `launchCompletion`,
  `iterateInFreshSession` is called exactly once in the UI (dialog path for the first two,
  direct for the no-confirmation iterate), and the banner branch carries `modelOverride`.
- Server RPC contract additions are backward compatible (optional field).

## Revision 1: model choice moved to launch time (superseded by revision 2)

Follow-up decision: model selection belongs at the moment of pushing a launch button, not on
the banner. Shipped on top of the picker rollout:

Superseded flow kept below for the record:

- The banner's model picker is removed. The banner now shows a read-only "Next: <model>"
  label (the model the launch composer will be seeded with, or "default model").
- Banner actions (proceed, completion actions like Implement Phase N / Review code / Create
  pull request) no longer call the one-click `proceed`/`launchCompletion` RPCs. They navigate
  to the manual launch composer route with the action's intent, which is the plugin's launch
  prompt: the composer is seeded with the task's default model and the user can pick a
  different provider/model/reasoning for just that session, or send as-is. The pick is
  one-shot; it is not written to the task record.
- Iterate follows the same rule, honoring the existing "show iterate confirmation" setting:
  confirmation on opens the launch composer; off keeps the direct one-click
  `iterateInFreshSession` path. The "Start a fresh session?" ConfirmDialog is replaced by the
  composer page.
- tests/ui-conventions.test.ts updated to enforce the (then-current) invariant: the UI never
  calls
  `proceed`/`launchCompletion` RPCs (every launch routes through the composer), and
  `iterateInFreshSession` is called exactly once (the no-confirmation path).
- The server RPC contract is unchanged; the one-click RPCs remain for the CLI
  (`bb rpi proceed`) and future server-side callers.

## Behavioral changes to be aware of

- The native picker always emits a concrete reasoning level. Once a task's model is changed
  through any picker, the task stores that level instead of "provider default". Tasks never
  touched keep spawning on the provider default as before.
- The phase-complete banner no longer offers a "Default" choice; it sets a concrete model.
  Project defaults remain settable in the task Settings tab and Settings defaults.
- `serviceTier` emitted by the native picker is not persisted (tasks have no tier column);
  dropped on write.

## Incidental fix

- SDK pin bumped 0.4.34 → 0.4.47 to match the host. That surfaced a fork type drift in
  `forkSession` (launch.ts): `workspace: "reuse"` no longer exists on `ThreadForkArgs`; it now
  passes `environment: { type: "reuse", environmentId }`, reading `environmentId` via
  `threads.get({threadId, include: "environment"})` per the repo's hard rule.

## Verification

- `npm run typecheck`: clean.
- `npm test`: 295/295 pass.
- `bb plugin build`: clean. `bb plugin install . --yes` + `bb plugin reload rpi`: running.
- Server-side catalog health was live-verified via the instrumented `listModels` (see above)
  before the change; the native picker's rendering was not yet click-verified by the plugin
  author at time of writing (user to confirm visually after app reload).

## Open items for the reviewer

- Visual pass across all five call sites after an app reload, especially: the New task form
  with the "Use bb's default model" checkbox, the defaults table cell sizing, and the banner
  row with the native trigger at `align="end"`.
- The mid-task "stop and continue on another provider" affordance discussed in this thread is
  NOT part of this phase; the banner picker changes the next session only. Still a candidate
  follow-up.
- `modelLabel` loses the pretty model display name (raw model id shown in the task meta line);
  the picker itself shows pretty names. Revisit if the meta line matters.
