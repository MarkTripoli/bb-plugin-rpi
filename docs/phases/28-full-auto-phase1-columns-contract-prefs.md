# Phase 1: Columns, contract, prefs (full auto mode)

Implements Phase 1 of `04-plan-full-auto-mode.md` (task artifact dir `.rpi/tasks/i-want-to-create-some-kind-of-option-or-maybe-it-is-an-option-i-want-to-create-a-checkbox-that-we-can-check-before-we-2`). Every layer now carries `e2eMode`, `phaseModels`, and `prefs.e2e`; nothing behaves differently yet.

## What shipped

- `db.ts`: two appended migrations, `tasks.e2e_mode` (`INTEGER NOT NULL DEFAULT 0 CHECK (e2e_mode IN (0, 1))`) and `tasks.phase_models` (`TEXT`, JSON `Partial<Record<PhaseLabel, ModelOverride>>`, NULL means no per-phase entries).
- `contract.ts`: `phaseModelsSchema` (`z.record` of 1-64 char keys over `modelOverrideSchema`) plus `PhaseModels`; `taskRowSchema.e2eMode`, `taskRecordSchema.e2eMode` and `.phaseModels`; `taskCreateRequestSchema.e2eMode` default `false`; `taskUpdateInputSchema.patch.e2eMode` and `.phaseModels` (nullable, `null` clears all entries); new `e2ePrefsSchema` (`fastModel`, `reasoningModel` nullable model overrides, `permissionMode` default `bypass`, `maxHops` 30, `maxReviewCycles` 5, `maxRetries` 3) with `E2ePrefs` and `DEFAULT_E2E_PREFS`; `prefsSchema.e2e` default and `prefsUpdateSchema.e2e` partial patch.
- `tasks.ts`: `RawTaskRecord.e2eMode`/`phaseModelsJson`; exported `parsePhaseModels` (untrusted JSON reads back `{}` on parse or schema failure); `normalizeTaskRecord` spreads everything but `phaseModelsJson` and adds `e2eMode`/`phaseModels`; both SELECTs (readTaskRecord, listTasks) select `e2e_mode AS e2eMode, phase_models AS phaseModelsJson`; `taskRowFromRecord` carries `e2eMode`; `createDraftTask` accepts `e2eMode?: boolean` and inserts `e2e_mode` bound to `input.e2eMode ? 1 : 0` (phase_models stays NULL); `updateTask` accepts `e2eMode?: boolean` and `phaseModels?: PhaseModels | null` (undefined keeps stored JSON, null clears, object replaces); `defaultTaskPrefs` includes `e2e: DEFAULT_E2E_PREFS`.
- `server.ts`: import of `DEFAULT_E2E_PREFS`, `e2ePrefsSchema`, `E2ePrefs`; in-memory `e2ePrefs` mirror seeded from initial prefs beside the other mirrors; `setPrefs` merges `{ ...current.e2e, ...patch.e2e }` through `e2ePrefsSchema.parse` and refreshes the mirror; `createTask` passes `e2eMode: request.e2eMode` into `createDraftTask`.
- Tests: `tests/db.test.ts` asserts the two new task columns and that `UPDATE tasks SET e2e_mode = 2` throws; `tests/tasks.test.ts` adds the create/update/list round-trip with a corrupt-JSON read-back check; `tests/polish.test.ts` adds "setPrefs merges the e2e block and keeps defaults" (empty kv returns the defaults; a `maxHops` patch keeps `permissionMode` and `maxReviewCycles`).

## Deviations from the plan

- Plan 1.5 said extend a prefs round-trip in `tests/server.test.ts`; the existing prefs round-trip lives in `tests/polish.test.ts` (setPrefs workflowDefaults merge test), so the new e2e merge test went there.
- `normalizeTaskRecord` needed an explicit `phaseModelsJson` destructure before the spread: the `...row` spread leaked the raw JSON string into `TaskRecord` and the RPC output validator rejected the unknown key (caught by the full-suite run, not by targeted files).
- Three pre-existing literal `TaskRecord` fixtures in `tests/launch.test.ts` and `tests/workspace.test.ts` needed `e2eMode`/`phaseModels` added; not in the plan's edit list but required by the strict record type.

## Verification

- `npx tsc --noEmit`: clean.
- `npm test`: 329 pass, 0 fail (pretest ran `tsc --noEmit`).
- `npm test -- tests/db.test.ts tests/tasks.test.ts tests/polish.test.ts`: 16 pass, 0 fail.

## Open items for the reviewer

- Confirm the plan's Phase 1 test-file placement change (polish vs server) is acceptable.
- Confirm `parsePhaseModels` exported from `tasks.ts` (Phase 5 imports it).
- Phase 2 (override table, guard counters) not started, per instructions.
