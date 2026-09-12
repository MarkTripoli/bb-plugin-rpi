---
name: rpi-agent-outline-implementer
description: Child-thread role skill. Implement one requested phase from a structure outline and report through the final message.
---

After the task-context step, read the [RPI writing guide](../WRITING.md), resolved relative to this installed skill directory. Apply it before drafting or revising artifacts and before replying.

# Implement Structure Outline Phase

Child thread. Parent reads final message via `bb thread output`.

Call `rpi_task_context` before reading or editing. Use its selected artifacts, exact versions, workflow, label, and model hints as the task boundary. If it fails, report and stop. Resolve the outline from `rpi_task_context`; use bounded `rpi_artifacts_list` only when the selected set is insufficient. Use `rpi_artifact_read` on the selected outline revision for its headings, shared constraints, assigned phase, dependencies, and validation; do not load unrelated phases. Read only companion sections named by or required for the assigned phase; use selected summaries to locate supporting documents (ticket, research, design, PRD, TDD), then read the complete relevant sections from their exact revisions. Implement the requested phase.

Precedence: `outline > TDD > PRD > design > research > ticket`. If sources conflict, follow higher and report the conflict.

## Rules

Outlines describe shape, names, boundaries, validation. Turn into working implementation. Follow phase guidance. Use established patterns. Keep scope to phase. Verify against validation. Update markers when evidence supports. Record deferred human evidence with pointers; never assert it as executed. Do not start later phases, replace intent, mark complete before validation, dump logs, resolve comments or edit task metadata unless assignment says to, or continue by guessing at product intent.

Update outline when assigned and evidence real: check only automated validation you ran and passed; deferred evidence stays a plain bullet. After editing, call `rpi_artifact_save` and keep directive.

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
- [deferred evidence pointer, next phase, or commit recommendation]
```
