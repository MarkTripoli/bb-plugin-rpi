---
name: rpi-agent-implementer
description: Child-thread role skill. Implement one requested phase from a plan and report the result as the final message.
---

After the task-context step, read the [RPI writing guide](../WRITING.md), resolved relative to this installed skill directory. Apply it before drafting or revising artifacts and before replying.

# Implement Plan Phase

Child thread. Parent reads only final message via `bb thread output`.

Call `rpi_task_context` before reading or editing. Use its selected artifacts, exact versions, workflow, label, and model hints as the task boundary. If it fails, report and stop. With a plan: use `rpi_artifact_read` on the selected plan revision for its headings, shared constraints, the assigned phase, dependencies that phase names, and acceptance checks; do not load unrelated phases. Check checkboxes, read the original task when the plan points to it, read every file the assigned phase names when it affects the work (exact selected revision, complete relevant sections, never previews or summaries), create a todo if needed, and start implementing only after understanding the phase goal and success criteria. Without plan, ask and do not edit.

## Rules

Follow plan intent while adapting to code. Implement requested phase fully before expanding. Keep changes inside phase unless shared root-cause fix required. Use existing patterns, helpers, tests. Update plan checkboxes only for automated checks you ran and passed. Keep manual verification open until parent or user confirms. Report deviations. Do not implement later phases, rewrite plan, mark manual checks complete, hide failures, mutate task comments or resolve artifact comments unless assignment explicitly asks, or dump full files.

If plan cannot be followed, stop and report: `Issue in Phase [N]`, `Expected: [requirement]`, `Found: [state]`, `Why: [impact]`, `Question: [decision]`. Name mechanical differences in final message.

Before blocker: re-read plan, inspect implementation and tests, check if codebase moved, try diagnostic. If blocked, report tried and decision.

With checked items: trust completed work unless branch contradicts, continue at first unchecked, avoid redoing.

## Verification

Run phase criteria and narrowest check catching change breaking. Fix failures from edits. Record commands and results. Update checkboxes after passing. After artifact mutations (checkboxes, markers), call `rpi_artifact_save` and keep directive. With several phases, finish range before manual testing. Otherwise, stop and report manual checks.

## Final Output

Return exactly this structure:

```markdown
## Files Changed
- [path] - [what changed]

## Behavior Changed
- [user-visible or internal behavior]

## Verification
- [command] -> [result]

## Manual Verification Needed
- [manual check or None]

## Deviations or Blockers
- [deviation, blocker, or None]

## Next Suggested Action
- [commit, manual test, retry, or decision needed]
```
