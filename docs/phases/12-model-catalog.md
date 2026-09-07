# Phase E: model dropdowns from bb's own catalog, changeable per task between phases

## What shipped

- `contract.ts`: `listModels` RPC (`listModelsInputSchema` / `listModelsOutputSchema`), bounded to
  200 models and 50 providers.
- `models.ts` (pure, no bb imports) + `tests/models.test.ts`: `normalizeModelCatalog` merges one
  `bb.sdk.providers.models()` response per available provider into the contract's deduped, sorted,
  bounded shape; `modelOptionValue` / `parseModelOptionValue` encode a `<select>` option value as
  `providerId/model` (splitting on the first `/` only, since model ids themselves can contain `/`,
  e.g. `pi`'s `anthropic/claude-sonnet-5`); `modelDisplay` renders a task's/prefs' chosen model for
  display text.
- `server.ts`: `listModels` handler, wiring only, wrapped so any SDK failure reports as a catalog
  error instead of throwing.
- `ui/rpi.tsx`: shared `ModelSelect` (native `<select>`, host token classes, page-lifetime
  catalog cache keyed by hostId) used in:
  1. `NewTaskPage`, rebuilt per the approved mock: labeled "Where" (Project, Machine, Worktree with
     relabeled options and hint, Working directory) and "How" (Workflow with step count and step
     list hint, Permissions, Auto-advance with hint, Model) groups, `Create and start <phase>` /
     `Create` primary button, `Save as draft` secondary, and the "Recent drafts" row navigation fix
     (now goes to the draft's own task page, not the list).
  2. Task detail Settings tab's new "Model" section (`TaskModelPanel`), saving through `updateTask`
     with a toast and a "Current: ..." line.
  3. `RpiComposerBanner`'s compact model control (outline button + Popover), so the model can change
     between phases without leaving the thread; that is the actual ask behind this phase.
  4. `RpiDefaultsSettings`: `ModelSelect` replaces the free-text Provider/Model/Reasoning inputs for
     the global default, the per-workflow-type table (one Model column instead of three), and the
     research subagent model row.
  5. Task header meta line: a fifth tooltipped term for the task's model.

## Verification

- `npx tsc --noEmit`: clean.
- `npm test`: 220/221 pass; the one failure is the pre-existing `tests/prose.test.ts` em-dash
  finding against `.rpi/tasks/rpi-cleanup/*.md` (unrelated to this change, present before it).
- `bb plugin build`: clean.
- `bb plugin install . --yes` then `bb plugin reload rpi`: plugin comes back up running.
- `bb plugin types --check`: SDK pin matches host (0.4.34).
- Live-verified SDK behavior with the running bb instance's own CLI (`bb provider list --json`,
  `bb provider models <id> --json`), see Deviations below.

## Deviations from the plan, and why

1. **`listModels` fetches per provider, not with one unscoped call.** The task's server.ts sketch
   was `bb.sdk.providers.models(hostId ? { hostId } : {})`. Verified live against the running bb
   instance: `bb provider models --json` (no providerId) returned exactly the same 7 models as
   `bb provider models codex --json`: a single unscoped call only returns one (apparently
   host-default) provider's catalog, not the merged catalog across every provider the host has
   access to. Since the product ask is explicitly "looking at the existing models we support and
   have access to" (i.e. across codex, claude-code, pi, acp-cursor, acp-opencode: five providers,
   the "pi" one alone showing 603 models), `listModels` now calls `bb.sdk.providers.list()` first,
   then `bb.sdk.providers.models({ ...routing, providerId })` once per provider, and merges with
   `normalizeModelCatalog`. This matches the task's own explicit fallback guidance for the
   ambiguous-providerId case ("if unclear, use providerId = the provider whose catalog the model
   came from").
2. **A model has no per-model `providerId` in the SDK's own catalog schema**, only an optional
   `routeProviderId`. `normalizeModelCatalog` attributes each model to
   `routeProviderId ?? <the provider whose catalog listed it>`, and drops a routed model if that
   routing provider was not itself among the providers passed in (bounded, never guessed).
3. **`modelDisplay`'s first parameter is the whole catalog `{ providers, models, error }`, not a bare
   models array**, since showing the provider's display name (when more than one provider is
   present) needs the providers list too.
4. **Research subagent model** (`Prefs.defaults.researchModel`) is a bare model string with no
   `providerId` field in its own schema (it is only ever used as a text hint appended to an agent's
   instructions, never passed to `threads.spawn`). `ModelSelect` falls back to matching by model id
   alone when the caller passes `providerId: null` with a non-null model, so the saved bare string
   still renders as "known" instead of falling into the "not available" branch; `RpiDefaultsSettings`
   only ever writes back the `model` half of what `ModelSelect` reports for that one row.
5. **Global defaults row keeps `allowDefault` on** (not off as literally suggested) so a genuinely
   unset default is representable and not silently coerced into whichever model happens to sort
   first in a native `<select>` with no blank option; kept the requested `label="Default model"`.
6. **No `components/ui/select.tsx`.** `ModelSelect` renders a native `<select>` directly per the
   task's own steer ("Prefer a native `<select>`... do not add a dependency"); one call-site pattern
   did not earn a separate wrapper component.
7. Removed `WorkflowStrip` (dead code once `NewTaskPage` no longer renders it after the redesign)
   and extended `ComposerToolbarSelect` with optional `className`/`id` props (non-breaking) so the
   new task form's grouped selects can be full width.

## Open items for the reviewer

- No browser/UI click-through was performed in this session (headless subagent); verification is
  `tsc`/`npm test`/`bb plugin build`/`install`/`reload`/`types --check` plus live SDK shape checks
  via the `bb provider` CLI. A manual pass through New task, a task's Settings tab, the composer
  banner popover, and Settings → Defaults is recommended before merge.
- `normalizeModelCatalog`'s 200-model / 50-provider cap is a flat slice after sorting; with `pi`
  alone reporting 603 models today, some of its models will not appear in the picker. Acceptable
  per the contract's explicit bound; revisit if a provider's catalog needs full coverage.
