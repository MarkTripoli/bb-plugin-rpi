---
name: rpi-iterate-implementation
description: Run for /rpi-iterate-implementation requests. Apply follow-up implementation feedback on the same branch.
---

After the task-context step, read the [RPI writing guide](../WRITING.md), resolved relative to this installed skill directory. Apply it before drafting or revising artifacts and before replying.

# Iterate Implementation

Use this when implementation already happened and the user has follow-up feedback. The feedback may be a bug report, an adjustment, a missing phase, or a small extension on the same branch.

## Steps

### 1. Read all required inputs fully

- Resolve any `@file` argument against the selected artifacts. Read referenced artifacts completely from their exact revisions.
- If comments are relevant, call `rpi_get_artifact_comments` for the named artifact and include unresolved comments by default.
- Read the plan or outline artifact and any user-provided paths completely from their exact revisions. If the selected set is insufficient, call `rpi_artifacts_list`. Do not list, search, or glob the task mirror directly.
- Read the plan file when it exists. If no plan exists, read the ticket or task file plus the structure outline, design discussion, PRD/TDD, and research artifacts needed to understand the implemented work.
- Do not read unrelated artifacts just because they are present. Prefer the files named by the user, the current implementation source artifact, and the minimum companion artifacts needed to make the change correctly.

### 2. Understand the current state

Inspect the repository before editing:

- Check the current git status and diff.
- Identify the commit or point where the previous implementation ended, when that is knowable.
- Read commits or changes made since that point.
- Determine which phases are already implemented and whether the user is giving feedback mid-phase.

If the user is asking to implement an unstarted phase, do not implement it inline. Spawn `/rpi-agent-implementer` for plan phases or `/rpi-agent-outline-implementer` for structure outline phases.

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

When the fix is clear, make the smallest correct change in the shared/root-cause location. Run the relevant tests, build, lint, or other checks. If the work changes task artifacts, call `rpi_next_artifact_number` before creating a new implementation note.

If the change updates comments, use `rpi_reply_to_artifact_comment` or `rpi_update_artifact_comments` only for the exact comment ids involved, and only when the user has asked you to resolve or reply.

### 6. Update the user

When the iteration completes a numeric phase, call `rpi_next_artifact_number`, write one receipt from `references/implementation_template.md`, and save it with `rpi_artifact_save`. Set `completed_phase` to the highest plan or outline phase the receipt proves complete. Populate `Human Review` with exact review targets, checks, and known limits. Save this receipt even when later numeric phases remain.

Read `references/implementation_phase_final_answer.md` when another numeric phase remains, and set `{implementation_command}` to `/rpi-implement-plan` or `/rpi-implement-outline` for the source artifact. Read `references/implementation_final_answer.md` only for terminal implementation. Populate `Check` from the receipt's `Human Review` section, include exactly one standalone receipt directive, and keep the final command fence last.

## Guidance

### Comments

Fetch artifact comments only for files involved in the iteration. Work one comment thread at a time when comments drive the change. Do not bulk-resolve comments from inference.

## When Iteration Is Complete

When the feedback is addressed, checks have run, and no further implementation edits are known:

1. Save any changed task artifact with `rpi_artifact_save`.
2. Read `references/implementation_final_answer.md`.
3. Respond with that template only. The next step is `/rpi-describe-pr`; use `/rpi-ci-commit` only when the user asks for an in-loop commit gate.
