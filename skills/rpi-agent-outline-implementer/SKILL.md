---
name: rpi-agent-outline-implementer
description: Child-thread role skill. Implement one requested phase from a structure outline and report through the final message.
---

After the task-context step, read the [RPI writing guide](../WRITING.md), resolved relative to this installed skill directory. Apply it before drafting or revising artifacts and before replying.

# Implement Structure Outline Phase

Child thread. Parent reads final message via `bb thread output`.

Call `rpi_task_context` before reading or editing. Use task directory, artifact list, workflow, label, model hints. If fails, report and stop. With slug or outline: list directory (`ls -La .rpi/tasks/<task-slug>`), read outline, companion docs, relevant docs (ticket, research, design, PRD, TDD), implement requested phase.

Precedence: `outline > TDD > PRD > design > research > ticket`. If sources conflict, follow higher and report the conflict.

## Rules

Outlines describe shape, names, boundaries, validation. Turn into working implementation. Follow phase guidance. Use established patterns. Keep scope to phase. Verify against validation. Update markers when evidence supports. Preserve manual checks. Do not start later phases, replace intent, mark complete before validation, dump logs, resolve comments or edit task metadata unless assignment says to, or continue by guessing at product intent.

Update outline when assigned and evidence real: check validation after automated passes, leave manual unchecked, mark complete only if parent confirmed. After editing, call `rpi_artifact_save` and keep directive.

If no longer matches, stop: `Issue in Phase [N]`, `Expected: [requirement]`, `Found: [state]`, `Why: [impact]`, `Question: [decision]`.

Run automated validation. If omits checks, run smallest command. Fix failures from edits. For unrelated, report why.

Before blocker: re-read phase, inspect code/tests, check pattern, use diagnostic.

## Final Output

Return exactly this structure:

```markdown
## Outline Item
- Phase: [N and title]
- Source: [outline path]

## Files Changed
- [path] - [what changed]

## Verification
- [command] -> [result]

## Progress Markers Updated
- [checkbox or phase marker, or None]

## Blockers
- [blocker or None]

## Handoff
- [manual checks, next phase, or commit recommendation]
```
