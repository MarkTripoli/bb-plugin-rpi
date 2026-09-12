---
name: rpi-implement-plan
description: Run for /rpi-implement-plan requests. Orchestrate phased implementation from a saved plan artifact.
---

After the task-context step, read the [RPI writing guide](../WRITING.md), resolved relative to this installed skill directory. Apply it before drafting or revising artifacts and before replying.

# Plan Implementation Orchestrator

Coordinate an approved plan artifact in `.rpi/tasks/<slug>/`. Launch focused child threads, verify them, preserve the human gate, and hand off after implementation is complete. Do not do bulk implementation inline.

## Workflow

### 1. Locate the plan

- If the user supplied a specific plan path or `@file`, use that file.
- Otherwise use the selected plan in `rpi_task_context`; if none is selected, page `rpi_artifacts_list` and resolve ambiguity before reading one.
- Use `rpi_artifact_read` on the selected plan version: headings first, then the implementation overview, shared constraints, first incomplete phase, and that phase's acceptance checks. Do not load completed or later phase bodies unless the current phase depends on them. Read `task.md` or `ticket.md` only when needed for ticket identity, manual checks, or acceptance language.
- Use `assignment.approvedPhase` and `assignment.primaryReviewArtifact` from `rpi_task_context` as authoritative; ignore inferred phase markers.
- If no plan is found, ask for the plan path and stop.

### 2. Launch the implementer child thread

For each phase that still needs work, spawn `/rpi-agent-implementer` for one phase. Point to the plan and phase number; do not copy plan content.

### 3. Review the child output

The child thread's final answer is its deliverable. Read it and compare it with the plan.

Inspect the implementer report and confirm:

- Which files changed.
- Which plan items were completed.
- Which automated checks ran and their results.
- Which manual checks are still needed.
- Whether the child reported mismatches, blockers, or intentionally skipped work.

If the child says the plan cannot be followed, present that mismatch to the user instead of improvising a new direction.

### 4. Run missed automated checks

Run checks the child missed and checks the plan makes mandatory: build, test, lint, typecheck, generated-code verification, or focused acceptance scripts. Keep enough output to prove pass or fail.

### 5. Report the phase to the human

After each verified numeric phase, call `rpi_next_artifact_number`, write one receipt from `references/implementation_template.md`, and save it with `rpi_artifact_save`, even when later phases remain. Set `completed_phase` to the highest proven plan phase. Fill `Human Review` with exact targets, checks, and known limits.

Use `references/implementation_phase_final_answer.md` between numeric phases and `references/implementation_final_answer.md` only after the terminal phase. Name the receipt as the primary directive, copy its checks, invoke this skill with the same plan between phases, and keep the command fence last.

Then summarize:

```markdown
## Phase [N] Implementation Summary

**Completed by child thread:**
- [completed work]

**Automated verification:**
- [command] -> [result]

**Manual verification required:**
- [manual check]

Ready for Phase [N+1] after you confirm manual verification, or send the issue you want addressed.
```

### 6. Wait for human confirmation

Pause unless the user explicitly requested multiple phases in one run. Wait for confirmation, an issue report, or approval to move on.

### 7. Commit changes after approval

When the user confirms the phase and asks you to commit, create a focused commit. Do not commit `.rpi/tasks/` or generated task mirrors. Use explicit paths with `git add`; never stage the whole repository. In the normal RPI flow, `/rpi-ci-commit` owns this handoff.

### 8. Repeat for the next phase

Repeat the same child-thread, review, verification, human gate, and commit handoff. If the user asked for several phases, still use a separate child thread per phase and verify between phases.

## Special Instructions

### Resuming Work

If the plan already has progress markers:

- Treat checked items as complete unless the diff, test result, or user report makes that unsafe.
- Resume at the first unchecked phase or item.
- Ask the child to continue from that point, not to restart the whole plan.

### Handling Issues

When a child thread or local verification finds a mismatch, stop the phase loop and present:

```markdown
Issue in Phase [N]

Expected: [what the plan called for]
Found: [what the repository actually contains]
Why it matters: [impact]

How should I proceed?
```

Do not patch around unclear plan drift without user direction.

### Multiple Phases

When the user explicitly asks for multiple phases, spawn a fresh implementer child for each phase, verify between phases, collect manual checks, and report them after the final requested phase. Do not mark manual checks complete unless the user confirms them.

### Artifact Notes

Read `references/implementation_template.md`, `references/implementation_phase_final_answer.md`, and `references/implementation_final_answer.md`.

If you write an implementation receipt or update the plan artifact, call `rpi_next_artifact_number` for a new `NN-implementation-*.md` file.

## After Final Phase Completion

When every phase is complete, automated checks pass, and the human gate is satisfied:

1. Save changed task artifacts with `rpi_artifact_save`.
2. Commit all remaining repository work before the PR handoff. Use the `/rpi-ci-commit` conventions: inspect the diff, stage explicit files, exclude `.rpi/tasks/` task mirrors unless the user specifically asks for them, and write a focused message.
3. Read `references/implementation_final_answer.md`.
4. Respond with that template only, including the `/rpi-describe-pr` block.
