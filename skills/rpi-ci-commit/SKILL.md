---
name: rpi-ci-commit
description: Run for /rpi-ci-commit requests. Create focused commits for completed work.
---

# Commit Changes

You create git commits for completed task work. Do not pause for another approval; this skill is the commit step.

## Process

### 0. Load task context

Call `hl_task_context` before reading task files. Use its task directory, slug, artifact list, environment, and links. Read only files needed for the work.

### 1. Understand what changed

Review repository state:

- Run `git status --short --branch`.
- Run `git diff` for unstaged changes.
- Inspect staged changes if anything is already staged.
- Read enough changed files to understand the behavior.
- Decide whether one or several commits are needed.

Do not stage `.humanlayer/tasks/`, task mirror symlinks, scratch files, dummy scripts, one-off tests, or unrelated generated output.

### 2. Plan the commit or commits

Group files by purpose. Use imperative commit subjects and prefer reason over file lists.

Leave unrelated edits unstaged and mention them. If one file mixes task work with unrelated edits, ask how to split it unless the split is obvious.

### 3. Execute the commits

Use explicit paths:

```bash
git add <path> <path>
git commit -m "<subject>"
```

Never use `git add -A`, `git add .`, or broad staging. Verify with `git status --short --branch`.

### 4. Save the receipt

If a task receipt is useful, call `hl_next_artifact_number`, write `NN-commit-*.md` from `references/commit_template.md`, then call `hl_artifact_save`.

Read `references/commit_final_answer.md` and use it exactly. End with its single fenced `text` command.

## Remember

- Use current session context; do not ask the user to restate it.
- Keep commits focused.
- Do not commit the task artifact directory.
- Do not commit unrelated files.
- Treat failed tests or unsafe git state as blockers.
