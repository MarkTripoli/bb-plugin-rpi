---
name: rpi-iterate-plan
description: Only use when the user explicitly invokes /rpi-iterate-plan. Revise an implementation plan from feedback.
---

# Iterate Plan

You are iterating on an existing implementation plan. Apply feedback only after checking it, preserve the plan structure, and keep validation actionable.

## bb Task Setup

0. Call `hl_task_context` before reading files. Use its task directory, artifact manifest, repository, branch, provider, and thread id. If it fails, stop.
1. Resolve the target plan from `@file` or the artifact manifest. Ask only if multiple plan artifacts are plausible.
2. Locate this skill through the skills tier listing, then read references relative to this skill directory: `references/plan_template.md`, `references/plan_final_answer.md`, `references/plan_in_worktree_answer.md`, and `references/plan_disabled_answer.md`.
3. After editing, call `hl_artifact_save` with the plan file name and keep the returned `::hl-artifact{...}` directive for the final answer.

## Steps

1. **Read all input files fully**:
   - Read the plan and relevant prior artifacts: task or ticket, research, design discussion, PRD, TDD, and structure outline.
   - Read supplied feedback files fully.
   - List the task directory with `ls -La <task-dir>`. Avoid plain `ls`, `ls -l`, search, and glob expansion inside `.humanlayer/tasks` because the path may be linked.
   - Do not use partial reads.

2. **If a ticket or comment file is provided, read it as feedback**:
   - Treat it as user instruction to evaluate, not as automatically correct.
   - Map each item to the affected plan phase or success criterion.
   - If comments are relevant, call `hl_get_artifact_comments` for the plan artifact.

3. **If the user gives input**:
   - Do not accept corrections blindly.
   - Read mentioned files or directories.
   - Verify code examples, file paths, and command names.
   - If the plan depends on uncertain behavior, inspect the source directly or spawn a narrow child research thread and read it with `bb thread output`.

4. **Process the feedback**:
   - Reorganize phases when requested or when the current sequence is not independently verifiable.
   - Update code examples when file or API facts change.
   - Fix inaccurate paths, descriptions, or validation commands.
   - Preserve frontmatter and the overall template shape.

5. **Update the document**:
   - Edit the plan at its existing path.
   - Keep examples accurate and concise.
   - Ensure automated checks are commands the implementer can run.
   - Keep manual checks specific and remove filler.
   - Maintain phase sections with success criteria.

6. **Check worktree state**:

```text
Read .humanlayer/workspace.json if present
Read .humanlayer/workspace.local.json if present
git rev-parse --git-dir
```

7. **Read the appropriate final answer template**:
   - If already in a worktree, use `references/plan_in_worktree_answer.md`.
   - Else if workspace setup is disabled by local config or shared config, create or check out the task branch, then use `references/plan_disabled_answer.md`.
   - Otherwise use `references/plan_final_answer.md`.

8. Save with `hl_artifact_save` and respond following the selected template exactly.

## Plan Writing Guidelines

- Keep every phase independently testable.
- Include concrete code examples when they prevent ambiguity.
- Use runnable automated checks.
- Use manual validation only when human judgment is needed.
- Pause for human confirmation between phases that require manual validation.

## Artifact and Reading Rules

- Read task artifacts fully. Do not read research-question artifacts; use completed research instead.
- Do not inspect unrelated task directories unless the user explicitly asks.
- Treat failed artifact saves, failed comment calls, or unavailable task context as blockers.
- Normal iteration edits the existing plan file; do not allocate a new artifact number unless the user asks for a separate plan.

## Document Precedence

When documents disagree, the latest phase artifact wins:

**plan > structure outline > TDD > PRD > design discussion > research > ticket**

The plan is the final implementation authority. Earlier material provides context, but the updated plan must absorb the current decision.

## Markdown Formatting

When an artifact needs to show markdown that itself contains fenced code, wrap the outer example in four backticks.
