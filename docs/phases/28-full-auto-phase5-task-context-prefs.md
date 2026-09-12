# Phase 5 report: task context reports the phase model

Plan: `.rpi/tasks/i-want-to-create-some-kind-of-option-or-maybe-it-is-an-option-i-want-to-create-a-checkbox-that-we-can-check-before-we-2/04-plan-full-auto-mode.md`, Phase 5 only (edits 5.1 to 5.3).

## What shipped

- `tools.ts`:
  - `registerArtifactTools` options gained `getE2ePrefs?: () => E2ePrefs`.
  - The `rpi_task_context` `taskWorkspace` SELECT now reads `e2e_mode AS e2eMode, phase_models AS phaseModelsJson`.
  - `phaseModelFor` resolves the session label's effective model (explicit `phase_models` entry wins; class defaults only when `e2e_mode` is on).
  - `prefs.providerId` / `prefs.model` fall back to the task row when no phase model applies.
  - `prefs.researchModel` / `prefs.researchSubagentModel` become the phase model string (`providerId model`) when a phase model applies, otherwise `resolveResearchModel` as before.
  - Imports: `DEFAULT_E2E_PREFS`, `E2ePrefs` from `contract`; `phaseModelFor` from `e2e`; `parsePhaseModels` from `tasks` (exported in Phase 1).
- `server.ts`: `registerArtifactTools` wiring passes `getE2ePrefs: () => e2ePrefs` (the prefs mirror kept current by `setPrefs`).
- `tests/server.test.ts`: new test "task context prefs follow the phase model" covering: baseline equals the task's own model; an explicit `phase_models` entry applies regardless of e2e mode; with `e2e_mode = 1` and no entry an `implementation` session reports the fast class default and a `code-review` session the reasoning class default (via `setPrefs({ e2e: { fastModel, reasoningModel } })`); with `e2e_mode = 0` the class defaults never apply.

## Deviations from the plan

None in substance. One test-setup difference: the plan's sketch implies seeding a session row directly, but the session mirror is only populated through plugin launches or lifecycle events, so the test launches the implementation session via the `launchSkill` RPC and refreshes the mirror with `thread.active` emits when the label changes. Behavior under test is unchanged.

## Verification

- `npm test -- tests/server.test.ts`: 17 tests, 17 pass, 0 fail.
- `npm test` (pretest runs `tsc --noEmit`): 356 tests, 356 pass, 0 fail.

Committed as `3af2fca feat(rpi): task context prefs report the phase model (plan phase 5)`.

## Open items for the reviewer

- Confirm `prefs.researchModel` overriding the host research preference when a phase model applies is the intended reading of the plan (the plan text says so literally; a full-auto research session with a reasoning class default now reports that model instead of the research preference).
- Phase 6 (UI surfaces) not started, per instruction.
