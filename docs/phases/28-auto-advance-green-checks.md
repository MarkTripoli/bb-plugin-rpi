# 28: Auto-Advance on Green Checks

## What shipped

Removed per-phase human confirmation gates from the plan and outline implementation flow. Phases advance when automated checks pass; the orchestrator reports, commits, and starts the next phase. Deferred human evidence is recorded with pointers and never asserted as executed.

- Plan templates (`rpi-create-plan`, `rpi-iterate-plan`): the `Manual Verification` block and pause note are replaced by a `human-gated: false` line plus an optional `Deferred human evidence (recorded, not a gate)` section of plain bullets.
- Outline templates (`rpi-create-structure-outline`, `rpi-iterate-structure-outline`): same replacement under `### Validation`.
- Authoring skills stop instructing pauses; they explain the flag line and deferred-evidence bullets.
- Orchestrators (`rpi-implement-plan`, `rpi-implement-outline`): steps "Wait for human confirmation" and "Commit changes after approval" collapse into "Commit and continue"; summary templates report deferred evidence; the terminal precondition now requires recorded confirmation only for `human-gated: true` phases.
- Child skills (`rpi-agent-implementer`, `rpi-agent-outline-implementer`) moved to recorded-not-asserted vocabulary; the implementer's `Manual Verification Needed` output section is now `Deferred Human Evidence`.
- Receipt templates (three copies) carry `Deferred Human Evidence` sections and commit-handoff lines keyed to green checks.
- Phase answers (three copies) are progress reports with no approval wording; the terminal answer keeps approval semantics.
- `tests/plan-phases.test.ts` locks the parser invariant (flag line and plain bullets ignored); `tests/skills.test.ts` excludes phase answers from the approval pin and adds a progress-report pin.
- `package.json` 0.1.0 -> 0.1.1.

## Deviations from the plan

- The plan's 1.4 test snippet used `# Phase 1:`; the parser matches `## Phase 1:`, so the test input uses `## Phase 1:`. Invariant unchanged.
- The plan claimed the three receipt templates and three phase answers are identical copies. They differ per skill (different section names). Edits applied semantically per copy rather than verbatim.
- The `rpi-implement-plan` step-1 `task.md` read reason is one line (not two), edited accordingly.
- The iterate-structure-outline authoring guideline reword also dropped the now-wrong "no useful manual check" clause so the paragraph reads consistently.

## Verification

- `npm test`: 329 tests, 0 failures (includes new parser case and new phase-answer pin).
- `bb plugin build`: passes.
- `bb plugin types --check`: passes.
- `grep -rn "Wait for human confirmation\|after approval\|human gate" skills/rpi-implement-plan skills/rpi-implement-outline`: no matches.
- `grep -rn "If approved" skills/*/references/implementation_phase_final_answer.md`: no matches.
- `bb plugin install . --yes` then `bb plugin reload rpi`: rpi@0.1.1 running from this worktree.
- `bb skill list --json` plus `bb skill show`: live registry serves the new wording (`advance on green automated checks` in `rpi-implement-plan`, `human-gated: false` in `rpi-create-plan` template, `Deferred Human Evidence` in `rpi-agent-implementer`). A new catalog snapshot (`7d290a01...`) was restaged by the host daemon.

## Open items for reviewer

- Confirm the three adopted Option A decisions (per-phase `human-gated` flag, progress-report phase answers, per-phase commits) match intent.
- Check that the receipt edits diverging from the plan's verbatim diffs are acceptable.
- The PR needs a title check against Conventional Commits: `feat(rpi)!: advance phase implementation on green automated checks`.
