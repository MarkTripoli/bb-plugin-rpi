---
name: rpi-implement-plan
description: Run for /rpi-implement-plan requests. Orchestrate phased implementation from a saved plan artifact.
---

# Plan Implementation Orchestrator

You coordinate an approved plan artifact in `.rpi/tasks/<slug>/`. Do not do bulk implementation inline. Launch focused child threads, verify them, preserve the human gate, and hand off after implementation is complete.

## Workflow

### 0. Load task context and locate the plan

Call `rpi_task_context` before any file read. Use its task directory, slug, artifact list, bb environment, provider, model preferences, and artifact links as the source of truth.

If the user supplied a specific plan path or `@file`, use that file. If they supplied only a task directory, list it with:

```bash
ls -La .rpi/tasks/<task-slug>
```

Use `ls -La` because the task path may be a symlink. Do not use lowercase `-l`, glob-only discovery, or broad repository search. Select the current `*-plan-*.md` unless the user named another file.

Read the selected plan fully. Read `task.md` or `ticket.md` only when needed for ticket identity, manual checks, or acceptance language. Do not read unrelated task artifacts unless the plan or user points at them.

If no plan is found, ask for the plan path and stop.

### 1. Launch the implementer child thread

For each phase that still needs work, spawn one implementation child thread. Keep the prompt short: point to the plan and phase number instead of copying plan content.

Use this bb-native pattern:

```bash
bb thread spawn --project $BB_PROJECT_ID --parent-self --environment $BB_ENVIRONMENT_ID --provider <same provider> --model <implementation model from rpi_task_context prefs, or current model> --prompt "/rpi-agent-implementer Implement Phase [N] of the plan at .rpi/tasks/<task-slug>/<plan-file>. Focus only on Phase [N]. Stop after automated verification and report manual checks."
```

Then collect the result:

```bash
bb thread wait <thread-id>
bb thread output <thread-id>
```

The child thread's final answer is its deliverable. Read it and compare it with the plan.

### 2. Review the child output

Inspect the implementer report and confirm:

- Which files changed.
- Which plan items were completed.
- Which automated checks ran and their results.
- Which manual checks are still needed.
- Whether the child reported mismatches, blockers, or intentionally skipped work.

If the child says the plan cannot be followed, present that mismatch to the user instead of improvising a new direction.

### 3. Run missed automated checks

Run checks the child missed and checks the plan makes mandatory: build, test, lint, typecheck, generated-code verification, or focused acceptance scripts. Use existing repository commands and keep enough output to prove pass or fail.

### 4. Report the phase to the human

After a phase is implemented and automated verification is complete, summarize exactly what is ready for human validation:

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

### 5. Wait for human confirmation

Pause unless the user explicitly requested multiple phases in one run. Wait for confirmation, an issue report, or approval to move on.

### 6. Commit changes after approval

When the user confirms the phase and asks you to commit, create a focused commit. Do not commit `.rpi/tasks/` or generated task mirrors. Use explicit paths with `git add`; never stage the whole repository. In the normal RPI flow, `/rpi-ci-commit` owns this handoff.

### 7. Repeat for the next phase

Repeat the same child-thread, review, verification, human gate, and commit handoff. If the user asked for several phases, still use a separate child thread per phase and verify between phases.

## Special Instructions

### Resuming Work

If the plan already has progress markers, read them before launching a child thread.

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

If you write an implementation receipt or update the plan artifact, call `rpi_next_artifact_number` for a new `NN-implementation-*.md` file. After every task-directory write, call `rpi_artifact_save` and keep the returned `::rpi-artifact{...}` directive.

Read references relative to this skill directory. Locate the directory through the skills tier listing, then read `references/implementation_template.md` and `references/implementation_final_answer.md`.

## Workflow Checklist

- [ ] Call `rpi_task_context`.
- [ ] Read the plan artifact.
- [ ] Launch `/rpi-agent-implementer`.
- [ ] Read `bb thread output`.
- [ ] Verify against the plan.
- [ ] Ask for manual verification.
- [ ] Commit only after approval, or hand off to `/rpi-ci-commit`.

## After Final Phase Completion

When every phase is complete, automated checks pass, and the human gate is satisfied:

1. Save changed task artifacts with `rpi_artifact_save`.
2. Commit all remaining repository work before the PR handoff. Use the `/rpi-ci-commit` conventions: inspect the diff, stage explicit files, exclude `.rpi/tasks/` task mirrors unless the user specifically asks for them, and write a focused message.
3. Read `references/implementation_final_answer.md`.
4. Respond with that template only, including the `/rpi-describe-pr` block.
