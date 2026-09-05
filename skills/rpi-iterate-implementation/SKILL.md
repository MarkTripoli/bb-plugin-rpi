---
name: rpi-iterate-implementation
description: Run for /rpi-iterate-implementation requests. Apply follow-up implementation feedback on the same branch.
---

# Iterate Implementation

Use this when implementation already happened and the user has follow-up feedback. The feedback may be a bug report, an adjustment, a missing phase, or a small extension on the same branch.

## Steps

### 0. Load task context

Call `hl_task_context` before reading files. Use the returned task directory, task slug, artifact list, current environment, provider, model preferences, and artifact links.

Resolve any `@file` argument against the artifact list. Read referenced artifacts fully. If comments are relevant, call `hl_get_artifact_comments` for the named artifact and include unresolved comments by default.

### 1. Read all required inputs fully

Read the plan or outline artifact and any user-provided paths without truncation. If the user mentions a ticket or task key, locate the task directory with a symlink-safe directory listing:

```bash
ls -La .humanlayer/tasks/
ls -La .humanlayer/tasks/<task-slug>
```

Read the plan file when it exists. If no plan exists, read the ticket or task file plus the structure outline, design discussion, PRD/TDD, and research artifacts that are needed to understand the implemented work.

Do not read unrelated artifacts just because they are present. Prefer the files named by the user, the current implementation source artifact, and the minimum companion artifacts needed to make the change correctly.

### 2. Understand the current state

Inspect the repository before editing:

- Check the current git status and diff.
- Identify the commit or point where the previous implementation ended, when that is knowable.
- Read commits or changes made since that point.
- Determine which phases are already implemented and whether the user is giving feedback mid-phase.

If the user is asking to implement an unstarted phase, do not implement it inline. Spawn the appropriate child implementer:

```bash
bb thread spawn --project $BB_PROJECT_ID --parent-self --environment $BB_ENVIRONMENT_ID --provider <same provider> --model <implementation model from hl_task_context prefs, or current model> --prompt "/rpi-agent-implementer Implement Phase [N] from <plan-or-outline-path>. Read the companion documents named in the assignment. Stop after automated verification."
bb thread wait <thread-id>
bb thread output <thread-id>
```

Use `/rpi-agent-outline-implementer` instead when the source is a structure outline rather than a plan.

### 3. Verify user feedback before accepting it

If the user supplies a correction, do not treat it as automatically true. Read the files, logs, paths, or examples they mention. Verify that paths exist, code examples match the repository, and the reported behavior is consistent with the current branch.

Proceed only after you have checked the facts. If evidence contradicts the feedback, explain the mismatch briefly and ask how they want to proceed.

### 4. Clarify the requested change

Use the feedback type to choose the next action:

- Bug report: inspect logs, database state, reproduction steps, and relevant code until the remaining work is clear.
- Code change request: update the specific code or behavior after verifying the target files.
- Ambiguous request: ask the smallest question that changes what you will do.
- Missing evidence: add targeted logging or ask the user to reproduce with the needed output.

If there are several viable fixes and no clear default, ask before editing.

### 5. Apply the fix

When the fix is clear, make the smallest correct change in the shared/root-cause location. Run the relevant tests, build, lint, or other checks. If the work changes task artifacts, call `hl_next_artifact_number` before creating a new implementation note, then call `hl_artifact_save` after every task-directory write.

If the change updates comments, use `hl_reply_to_artifact_comment` or `hl_update_artifact_comments` only for the exact comment ids involved, and only when the user has asked you to resolve or reply.

### 6. Update the user

Read `references/implementation_final_answer.md` from this skill directory and respond using that structure exactly. Include the saved `::hl-artifact{...}` directive if a task artifact was written. The final answer must end with the single fenced `text` command from the template.

## Guidance

### Artifact Links

`hl_artifact_save` returns a `::hl-artifact{...}` directive for the saved file. Keep that line in your final answer so the task UI can render the artifact link.

### Markdown Fences

When writing Markdown that itself contains fenced examples, use a longer outer fence so nested code blocks remain valid:

````markdown
# Example

```bash
npm test
```
````

### Comments

Fetch artifact comments only for files involved in the iteration. Work one comment thread at a time when comments drive the change. Do not bulk-resolve comments from inference.

## When Iteration Is Complete

When the feedback is addressed, checks have run, and no further implementation edits are known:

1. Save any changed task artifact with `hl_artifact_save`.
2. Read `references/implementation_final_answer.md`.
3. Respond with that template only. The next step is `/rpi-describe-pr`; use `/rpi-ci-commit` only when the user asks for an in-loop commit gate.
