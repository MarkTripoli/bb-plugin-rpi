---
name: rpi-ci-commit
description: Run for /rpi-ci-commit requests. Create focused commits for completed work.
---

After the task-context step, read the [RPI writing guide](../WRITING.md), resolved relative to this installed skill directory. Apply it before drafting or revising artifacts and before replying.

# Commit Changes

Create commits for completed work. No approval pause; this skill is the commit step.

## Process

### 0. Load context

Call `rpi_task_context` before reading task files. Use its task directory, slug, artifact list, environment, and links. Read only files needed for the work.

### 1. Review changes

```bash
git status --short --branch
git diff
```

Inspect staged. Read changed files. Decide one or multiple commits.

Do not stage `.rpi/tasks/`, task mirrors, scratch, dummy scripts, one-off tests, unrelated output.

### 2. Plan commits

Group by purpose. Imperative subjects, reason over file lists.

Unrelated edits: leave unstaged, mention. Mixed file: ask how to split unless obvious.

### 3. Execute

```bash
git add <path> <path>
git commit -m "<subject>"
```

Never `git add -A`, `git add .`, broad staging. Verify.

### 4. Save receipt

Useful: call `rpi_next_artifact_number`, write `NN-commit-*.md` from `references/commit_template.md`, call `rpi_artifact_save`.

Read and use `references/commit_final_answer.md` exactly. End with single fenced `text` command.

## Rules

- Use current session context; do not ask the user to restate it.
- Focused commits.
- No task directory, unrelated files.
- Failed tests, unsafe git: blockers.
