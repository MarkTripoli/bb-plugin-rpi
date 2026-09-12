---
name: rpi-create-epic-plan
description: Run for /rpi-create-epic-plan requests. Decompose an epic into child tasks with workflow types and dependencies.
---

After the task-context step, read the [RPI writing guide](../WRITING.md), resolved relative to this installed skill directory. Apply it before drafting or revising artifacts and before replying.

# Create Epic Plan

Split an epic into child tasks that ship as separate pull requests. The epic plan is the last artifact before delivery creates the children and starts the ready ones.

## Steps

1. **Read primary inputs fully, others by summary**:
   - Read `references/epic_plan_template.md` and `references/epic_plan_final_answer.md`.
   - Read completely from the exact revisions `rpi_task_context` selected: `task.md` or `ticket.md`, plus the newest research artifact.
   - Other artifacts from the manifest: use the `summary` field. Open only when research leaves a gap.

2. **Read relevant source files**:
   - Open source files named in research that decide where a child's change lands.
   - Verify file paths before naming them in a child prompt.

3. **Write the epic plan**:
   - Call `rpi_next_artifact_number`.
   - Write `NN-epic-plan-<slug>.md` in the task directory following the template.
   - Fill the `## Children` JSON fence with one entry per child.
   - Derive `## Ordering` waves from `depends_on`.

## Child Rules

- One child per independently mergeable change. Name each child by its outcome.
- A child's `prompt` is a self-contained task description. It never references the epic's artifact directory; the child session cannot read it.
- `workflow` per child: `oneshot` for a bounded change with a clear spec, `rpi` when research or design is needed, `outline_only` or `prd_tdd` only when the task asks for them.
- `depends_on` lists sibling names whose merged pull request the child needs. Keep it minimal so independent children run together.

## Output

1. Save the plan with `rpi_artifact_save`.
2. Fix every `writing_issues` and `children_issues` line the save returns, then save again.
3. Reply following `references/epic_plan_final_answer.md` exactly.
