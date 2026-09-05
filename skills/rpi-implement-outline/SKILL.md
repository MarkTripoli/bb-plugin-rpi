---
name: rpi-implement-outline
description: Only use when the user explicitly invokes /rpi-implement-outline. Orchestrate implementation from a structure outline artifact.
---

# Outline Implementation Orchestrator

You coordinate phased implementation from a structure outline in `.humanlayer/tasks/<slug>/`. This skill is itself the implementation orchestrator. Do not redirect to `/rpi-implement-plan` or `/rpi-create-plan`; launch the outline implementer child thread directly.

## Getting Started

### 0. Load task context and discover documents

Call `hl_task_context` before reading files. Use the returned task directory, task slug, artifact manifest, bb environment, provider, and model preferences.

List the task directory with:

```bash
ls -La .humanlayer/tasks/<task-slug>
```

Use `ls -La` because task directories can be symlinks. Do not rely on glob-only discovery or a recursive repository search.

Identify these artifacts when present:

- Structure outline: a file containing `structure-outline`.
- Research: files containing `research`.
- Design discussion: files containing `design-discussion`.
- PRD and TDD files if the task used that workflow.
- `task.md` or `ticket.md`.

Read the structure outline fully before launching work. Read companion documents only after locating them, and read them fully when they influence implementation.

Document precedence is:

```text
structure outline > TDD > PRD > design discussion > research > task or ticket
```

When artifacts disagree, follow the higher-precedence source and mention the conflict in the child assignment or user report.

### Progress tracking

The outline implementer updates the outline artifact as work completes:

- Validation checkboxes move from open to checked only when automated verification passes.
- A phase title is marked complete only after all validation, including human confirmation, is done.

If you or a child thread writes the outline or an implementation receipt, call `hl_artifact_save` immediately after the write and preserve the returned artifact directive.

## Workflow

### 1. Launch the outline implementer child thread

Spawn one child thread for the current phase. Include paths to the outline and companion documents, but do not paste their contents into the prompt.

```bash
bb thread spawn --project $BB_PROJECT_ID --parent-self --environment $BB_ENVIRONMENT_ID --provider <same provider> --model <implementation model from hl_task_context prefs, or current model> --prompt "/rpi-agent-outline-implementer Implement Phase [N] from .humanlayer/tasks/<task-slug>/<outline-file>. Companion documents: research=<path if present>; design=<path if present>; prd=<path if present>; tdd=<path if present>. The outline wins on conflicts. Stop after automated verification and update progress markers you can verify."
```

Wait and read the final child message:

```bash
bb thread wait <thread-id>
bb thread output <thread-id>
```

The final message is the deliverable. Compare it to the outline before reporting success.

### 2. Report to the human

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

After confirmation, create a focused commit or hand off to `/rpi-ci-commit`, depending on the current workflow. Do not commit `.humanlayer/tasks/`; it is a task mirror and may be a symlink. Use explicit `git add <path>` commands.

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

Read reference files relative to the installed skill directory. Locate that directory through the skills tier listing, then read `references/implementation_template.md` when writing an implementation receipt and `references/implementation_final_answer.md` for the final answer.

Call `hl_next_artifact_number` before creating a new `NN-implementation-*.md` receipt. After every write in `.humanlayer/tasks/<slug>/`, call `hl_artifact_save`.

## Workflow Checklist

- [ ] Call `hl_task_context`.
- [ ] List the task directory with `ls -La`.
- [ ] Read the structure outline fully.
- [ ] Read companion documents needed for implementation.
- [ ] Spawn `/rpi-agent-outline-implementer` for the current phase.
- [ ] Wait for and read the child output.
- [ ] Verify the reported work.
- [ ] Ask for manual validation.
- [ ] Commit only after confirmation, or hand off to `/rpi-ci-commit`.

## After Final Phase Completion

When all outline phases are complete and verified:

1. Save any changed task artifacts with `hl_artifact_save`.
2. Read `references/implementation_final_answer.md`.
3. Respond using that template only, including the artifact directive and the single fenced `text` command.
