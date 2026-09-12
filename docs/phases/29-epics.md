# Epics: all phases (plan phase 6 report)

Summarizes the six phases of `04-plan-epic-workflow-view.md` (task artifact dir
`.rpi/tasks/i-want-to-work-on-how-we-visualize-our-entire-workflows-here-right-now-we-have-the-left-side-panel-and-we-can-see-all`).
Phases 1 to 5 shipped as one commit each on this branch; this document is the only phase
record for the plan, so each phase's shipped surface is listed here from its commit.

## What shipped per phase

1. **Schema, contract, and workflow literals** (`4ee52a9`) - `epic` joins the workflow type
   union and `WORKFLOW_GRAPHS` in `transitions.ts`; migrations add `tasks.parent_task_id`,
   `tasks.depends_on_json`, `tasks.position`, `tasks.epic_paused`, and `tasks.max_parallel`
   in `db.ts`; `TaskRecord` / `TaskRow` gain `parentTaskId`, `dependsOn`, `position`,
   `epicPaused`, `maxParallel` (`contract.ts`, `tasks.ts` both SELECTs, `normalizeTaskRecord`,
   `taskRowFromRecord`); `status.ts` derives epic status; literal `TaskRecord` fixtures in
   `tests/launch.test.ts`, `tests/tasks.test.ts` carry the new fields.
2. **Pure epic module and epic plan artifact type** (`fee3b7d`) - `epic.ts` parses the fenced
   JSON children block under `## Children` with zod (issue paths from zod, no YAML
   dependency), computes the ready set against `epicPaused` and `maxParallel`
   (`DEFAULT_EPIC_MAX_PARALLEL = 2`), and rolls child status up to the epic; `artifacts.ts`
   names `NN-epic-plan-*.md` as type `epic-plan`; `rpi_artifact_save` in `tools.ts` returns
   `children_issues` for an invalid block.
3. **The rpi-create-epic-plan skill** (`6d81be3`) - `skills/rpi-create-epic-plan/SKILL.md`
   with `references/epic_plan_template.md` and `references/epic_plan_final_answer.md`; the
   final command `/rpi-start-epic-delivery` is a SKILLS row with no skill directory;
   `README.md` and `skills/README.md` list the new type and skill; `tests/skills.test.ts`
   covers the template, the gate-answer shape, and the shingle check.
4. **Delivery: Proceed materializes children and the scheduler runs** (`a4d085b`) -
   `advance.ts` `startEpicDelivery` creates draft children from the approved epic plan and
   records dependencies by sibling id; `scheduleEpic` launches ready children up to the cap
   through the one launch boundary; `server.ts` triggers it from `updateTask`, completed
   turns, and the 60 second sweep. Mark done on a child unblocks its dependents; all children
   done completes the epic.
5. **Epic page, sidebar group, band prefix, composer, settings** (`7ef3a6c`) - `ui/rpi.tsx`
   gains `EpicTasksPanel` (waves by dependency depth, child rows with glyph, phase strip,
   what it wants, model, elapsed, attention, Open or recovery, Mark done at PR stage, Pause
   and Resume epic), `RpiThreadList` epic group with live child sessions only, the
   `Epic › Child` prefix in `NeedsYouRow`, `EpicProgressCell` (`K of N tasks`), the
   `Epic` composer entry, and the `Max parallel tasks` setting; `tests/ui-conventions.test.ts`
   asserts the surfaces exist and `launchDraft` stays the single launch call.
6. **Ledgers and version** (`aa1bfb8`) - six rows in `FEATURES.md` (one under
   `Workflow types`, five under a new `Epics` category) with the recount sentence set to the
   mechanical count and the ledger's "as of" phase set to 29; the six pins and regex in
   `tests/features.test.ts`; version `0.5.0` in `package.json` and both `package-lock.json`
   version fields; this document.

## Verification (phase 6, and suite state entering it)

- `npm run check:features`: `102 status-bearing rows, 1 mixed: 68 full, 15 partial, 8 omitted, 12 N/A`
  (matches the opening bold sentence in `FEATURES.md` and the pins in `tests/features.test.ts`).
- `npm test` (pretest `tsc --noEmit`): `tests 386, pass 386, fail 0`.
- `npm run check:conventional`: `Validated 6 commit subjects.` (8 after the review-fix commits below).
- `git diff --check`: no whitespace errors.

Phases 1 to 5 each ticked `npm test` and, where listed, `bb plugin build` in the plan's
Automated Verification. Phase 3's live install check (`bb plugin install . && bb plugin reload
rpi` lists `rpi-create-epic-plan`) stays unticked; see Open items.

## Review fixes (`11-code-review-epic-workflow-view.md`)

- CR-001: `advanceSession` returns before `startEpicDelivery` unless the mode is `proceed`, so a
  completed epic-plan turn never creates children in any automation mode. `tests/advance.test.ts`
  adds the `epic-plan` MATRIX row, the human-gate case, and a three-mode gate test.
- CR-002: `scheduleEpic` returns for a completed epic; Mark done on the epic row launches nothing.
- CR-003: `readyChildren` treats a dependency id with no live child as satisfied, so a deleted or
  archived dependency no longer strands its dependents and the epic still auto-completes.
- CR-004: `archiveTask` archives an epic's children in one transaction and
  `archiveTaskEverywhere` archives their session threads as well.
- ADV-001: `rpi_artifact_save` validates the children block by the stored artifact type, the
  same key `latestEpicPlan` uses. ADV-004: the resume and Mark done toasts say the ready
  children have started, matching the synchronous schedule in the `updateTask` handler.
- Left advisory: ADV-002 (epic worktree timing stays selectable) and ADV-005 (FYI).

## Deviations

- **Phase 6, version baseline.** The plan says bump from the branch base; `package.json` read
  `0.4.2` while `package-lock.json` read `0.4.1` on the base commit. Both now read `0.5.0`.
- **Phase 6, ledger header.** The plan names only rows and the recount sentence. The ledger's
  opening paragraph pins its verification point ("as of phase 21"); it now reads "as of phase
  29" so the ledger names the phase that last verified it.
- **Phase 6, `README.md`.** The phase goal lists `README.md`; phase 3 already added the
  `epic` type and the children-plus-scheduler paragraph there, so no edit this phase.
- **Execution Strategy refinements (all phases).** The children block is fenced JSON, not
  YAML, because no YAML dependency is installed. "Running" for the cap counts a child with a
  session in `running`, `launching`, `resuming`, `interrupt_requested`, or `needs_approval`,
  or an active launch attempt; a child at a human gate frees its slot.
- **Per-phase records.** The Execution Strategy asked for `docs/phases/29-epics-phaseN.md`
  per phase; phases 1 to 5 wrote none, so this consolidated record stands in for them.

## Open items

Deferred human evidence from the plan (recorded, not gates):

- [ ] Phase 3: `bb plugin install . && bb plugin reload rpi` lists `rpi-create-epic-plan` for
  a task session.
- [ ] Phase 5: create an `Epic` task, run it to the epic plan, choose Start delivery; confirm
  the Tasks tab shows waves with the row fields, the sidebar shows one epic group with live
  child sessions only, a waiting child appears in the band as `Epic › Child`, Mark done on a
  PR-stage child launches its dependent, and Pause epic stops new launches.

Plan Human Review, Verify section (decisions the reviewer confirms):

- [ ] Child tasks inherit the epic's host, directory, base environment, model, permission
  mode, auto-advance, and full auto, with worktree timing `now` for oneshot and freeform and
  `later` otherwise.
- [ ] Max parallel default of 2 as a constant (`DEFAULT_EPIC_MAX_PARALLEL`) with a per-epic
  `max_parallel` override, instead of a prefs block.
- [ ] `deleteTask` rejects an epic that still has children.

## Known limits (from the plan)

- No iterate skill for the epic plan; feedback flows through the generic Iterate session.
- A slot freed by a failed, lost, or interrupted child session is reused on the next 60
  second sweep, not immediately.
- Children created by Start delivery are drafts until launched; a child whose launch fails
  stays a draft with a failed attempt on its own page, and the sweep retries only through
  `readyChildren` once the attempt is resolved.
- `TaskActionsMenu` on a child row duplicates Mark done for PR-stage rows; the inline button
  exists so the dependency gate is visible where the decision is made.
