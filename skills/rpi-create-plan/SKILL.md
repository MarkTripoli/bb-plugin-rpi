---
name: rpi-create-plan
description: Run for /rpi-create-plan requests. Create a detailed implementation plan from the structure outline.
---

After the task-context step, read the [RPI writing guide](../WRITING.md), resolved relative to this installed skill directory. Apply it before drafting or revising artifacts and before replying.

# Create Plan

Expand the structure outline into a detailed implementation plan with concrete edits, examples, and verification. The plan is the last artifact before worktree setup or implementation.

## Steps

1. **Read primary inputs fully, others by summary**:
   - Read `references/plan_template.md`, `references/plan_final_answer.md`, `references/plan_in_worktree_answer.md`, `references/plan_disabled_answer.md`.
   - Read completely from the exact revisions `rpi_task_context` selected: `task.md` or `ticket.md`, plus the newest design artifact (TDD, PRD, structure outline, or design discussion).
   - Other artifacts from the manifest: use the `summary` field. Open only when the design leaves a gap.

2. **Read relevant source files**:
   - Open source files named in research, design, or outline.
   - Verify file paths and examples before including them.
   - Use existing test patterns when planning tests.

3. **Write the implementation plan**:
   - Call `rpi_next_artifact_number`.
   - Write `NN-plan-<slug>.md` in the task directory.
   - Convert each structure-outline phase into implementation steps.
   - Include concrete code examples where they clarify the change.
   - Include automated verification commands and real manual checks when needed.

## Plan Guidelines

- Every phase must be independently testable.
- Use specific file edits, target functions, and short code examples over broad descriptions.
- Automated verification must be runnable commands.
- Manual verification must be concrete steps a person can perform.
- Pause for human confirmation at every phase boundary before the next phase starts.
- Include test additions or modified test examples following patterns from research.
- Do not add manual validation just to fill a section.

## Output

1. Check whether worktree setup should be skipped:

```text
Read .rpi/workspace.json if present
Read .rpi/workspace.local.json if present
git rev-parse --git-dir
```

2. Choose the final answer template:
   - If the git dir includes `.git/worktrees/`, use `references/plan_in_worktree_answer.md`.
   - Else if workspace config disables setup, check out the task branch using the task slug as the default branch name, then use `references/plan_disabled_answer.md`.
   - Otherwise use `references/plan_final_answer.md`.
3. Save the plan with `rpi_artifact_save` and follow the selected template exactly.
