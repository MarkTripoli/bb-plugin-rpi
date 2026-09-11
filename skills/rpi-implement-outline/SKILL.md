---
name: rpi-implement-outline
description: Run for /rpi-implement-outline requests. Orchestrate implementation from a structure outline artifact.
---

After the task-context step, read the [RPI writing guide](../WRITING.md), resolved relative to this installed skill directory. Apply it before drafting or revising artifacts and before replying.

# Outline Implementation Orchestrator

Coordinate phased implementation from a structure outline in `.rpi/tasks/<slug>/`. Launch the outline implementer child thread directly. Do not redirect to `/rpi-implement-plan` or `/rpi-create-plan`.

## Getting Started

### 1. Discover documents

Use the selected outline in `rpi_task_context`. If none is selected, page `rpi_artifacts_list` and resolve ambiguity before reading one. Do not search, glob, or list the task mirror directly.

Companion documents when present: research, design discussion, PRD, TDD, `task.md` or `ticket.md`.

Use `rpi_artifact_read` on the selected outline version: headings, implementation overview, shared constraints, first incomplete phase, and that phase's validation. Read only the complete companion sections that influence the current phase.

When artifacts disagree, the structure outline wins; mention the conflict in the child assignment or user report.

### Progress tracking

The outline implementer updates the outline artifact as work completes:

- Validation checkboxes move from open to checked only when automated verification passes.
- A phase title is marked complete only after all validation, including human confirmation, is done.

## Workflow

### 1. Launch the outline implementer child thread

Spawn `/rpi-agent-outline-implementer` for the current phase. Include paths to the outline and companion documents; do not paste contents.

The final message is the deliverable. Compare it to the outline before reporting success.

### 2. Report to the human

After a numeric phase passes automated verification, call `rpi_next_artifact_number`, write one implementation receipt from `references/implementation_template.md`, and save it with `rpi_artifact_save`. Set `completed_phase` to the highest outline phase the receipt proves complete. Populate `Human Review` with the exact review targets, checks, and known limits for that phase. Save a receipt at every numeric phase boundary, including when later phases remain.

Read `references/implementation_phase_final_answer.md` when another numeric phase remains. Its directive names the receipt as the primary review artifact, and its final command invokes this skill with the same outline. Read `references/implementation_final_answer.md` only after the terminal phase. In both answers, populate `Check` from the receipt's `Human Review` section and keep the final command fence last.

After the child finishes and automated checks have passed or failed, report the phase:

```markdown
## Phase [N] Complete

**What changed:**
- [brief result]

**Automated verification:**
- [command] -> [result]

**Manual verification needed:**
- [manual check]

Ready for Phase [N+1] when you confirm, or send what needs adjustment.
```

If automated checks failed, report the failure and either fix it or ask for direction when the outline no longer matches the repository.

### 3. Wait for human confirmation

Pause before moving on unless the user explicitly requested several phases in one invocation. The human must confirm manual checks before the phase title is marked complete.

### 4. Commit the changes

After confirmation, create a focused commit or hand off to `/rpi-ci-commit`. Do not commit `.rpi/tasks/`; it is a task mirror and may be a symlink. Use explicit `git add <path>` commands.

### 5. Repeat for the next phase

Repeat the same discovery, child implementation, verification, human gate, and commit handoff for later phases. Separate child threads keep context bounded and make phase evidence easier to audit.

## Special Instructions

### Resuming Work

When resuming a partially implemented outline:

- Read the outline and identify phase markers, checked validation items, and incomplete sections.
- Trust completed phases unless current evidence contradicts them.
- Continue at the first phase that is not complete.
- Ask the child to resume the remaining phase work, not to redo completed phases.

### Handling Issues

If the child cannot follow the outline, stop and present:

```markdown
Issue in Phase [N]

Expected: [outline requirement]
Found: [repository reality]
Why it matters: [impact]

How should I proceed?
```

Do not silently rewrite the outline's intent.

### Multiple Phases

If the user explicitly asks for multiple phases in one run:

- Use a different child thread for each phase.
- Run validation between phases.
- Gather manual checks and present them at the final gate.
- Do not mark manual validation complete without the user's confirmation.

### Artifact and Reference Handling

Read `references/implementation_template.md`, `references/implementation_phase_final_answer.md`, and `references/implementation_final_answer.md` before reporting a phase boundary.

Call `rpi_next_artifact_number` before creating a new `NN-implementation-*.md` receipt.

## After Final Phase Completion

When all outline phases are complete and verified:

1. Save any changed task artifacts with `rpi_artifact_save`.
2. Commit all remaining repository work before the PR handoff. Use the `/rpi-ci-commit` conventions: inspect the diff, stage explicit files, exclude `.rpi/tasks/` task mirrors unless the user specifically asks for them, and write a focused message.
3. Read `references/implementation_final_answer.md`.
4. Respond using that template only, including the artifact directive and the single fenced `text` command for `/rpi-describe-pr`.
