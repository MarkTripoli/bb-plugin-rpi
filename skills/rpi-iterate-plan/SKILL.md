---
name: rpi-iterate-plan
description: Run for /rpi-iterate-plan requests. Revise an implementation plan from feedback.
---

After the task-context step, read the [RPI writing guide](../WRITING.md), resolved relative to this installed skill directory. Apply it before drafting or revising artifacts and before replying.

# Revise Implementation Plan

Revise an existing implementation plan. Check feedback before applying it, preserve the plan structure, and keep validation actionable.

## Steps

1. **Resolve target and read references**:
   - Resolve the target plan from `@file` or the artifact manifest. Ask only if multiple plan artifacts are plausible.
   - Read `references/plan_template.md`, `references/plan_final_answer.md`, `references/plan_in_worktree_answer.md`, `references/plan_disabled_answer.md`.

2. **Read primary inputs fully, others by summary**:
   - Read fully without partial reads: the plan and the supplied feedback (files, comments, or the user's message).
   - Upstream artifacts (task, ticket, research, design, PRD, TDD, structure outline): use their `summary` fields from the manifest. Open only when feedback touches something the summary covers.

3. **Process feedback**:
   - If a ticket or comment file is provided, treat it as instruction to evaluate, not as automatically correct.
   - Map each item to the affected plan phase or success criterion.
   - Call `rpi_get_artifact_comments` for the plan if comments are relevant.
   - Do not accept corrections blindly. Read mentioned files or directories.
   - Verify code examples, file paths, and command names.
   - If the plan depends on uncertain behavior, inspect the source directly or spawn `/rpi-agent-codebase-analyzer` to verify the narrow fact.

4. **Update the plan**:
   - Edit the plan at its existing path.
   - Reorganize phases when requested or when the current sequence is not independently verifiable.
   - Update code examples when file or API facts change.
   - Fix inaccurate paths, descriptions, or validation commands.
   - Preserve frontmatter and template shape.
   - Keep examples accurate and concise.
   - Ensure automated checks are commands the implementer can run.
   - Keep manual checks specific and remove filler.
   - Maintain phase sections with success criteria.

5. **Inspect workspace state**:

```text
Read .rpi/workspace.json if present
Read .rpi/workspace.local.json if present
git rev-parse --git-dir
```

6. **Select the final answer template**:
   - If already in a worktree, use `references/plan_in_worktree_answer.md`.
   - Else if workspace setup is disabled, create or check out the task branch, then use `references/plan_disabled_answer.md`.
   - Otherwise use `references/plan_final_answer.md`.

7. Save with `rpi_artifact_save` and respond following the selected template exactly.

## Plan Guidelines

- Keep every phase independently testable.
- Include concrete code examples when they prevent ambiguity.
- Use runnable automated checks.
- Use manual validation only when human judgment is needed.
- Pause for human confirmation at every phase boundary before the next phase starts.
- Normal iteration edits the existing plan file; do not allocate a new artifact number unless the user asks for a separate plan.
