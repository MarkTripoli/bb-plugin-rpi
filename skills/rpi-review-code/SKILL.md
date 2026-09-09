---
name: rpi-review-code
description: Run for /rpi-review-code requests. Review the complete task diff and record only concrete findings.
---

# Code Review

Review the task's complete code change without editing product code. The output is a durable review artifact that either sends concrete findings to a fix session or records a clean review and permits pull request creation.

## 0. Load task context

Call `rpi_task_context` before reading files. Use its task directory, artifact manifest, environment, workflow, provider, and model values. Read explicit `@file` arguments fully.

Locate this skill through the skills tier listing, then read:

- `references/code_review_template.md`
- `references/code_review_findings_answer.md`
- `references/code_review_clean_answer.md`
- `references/code_review_blocked_answer.md`

## 1. Pin the review scope

Determine the intended merge target from the existing pull request, bb environment metadata, or the repository's tracked default branch, in that order. Resolve and record:

- base branch and merge-base SHA
- current HEAD SHA
- staged and unstaged changes
- untracked files that belong to the task
- commits in the task branch after the merge base

Use the merge base as the fixed comparison point. Review committed and working-tree changes. Exclude `.rpi/tasks/` and unrelated user changes. If the base cannot be resolved, stop and report the blocker. Do not call an empty or incomplete scope clean.

## 2. Recover the requirements

Read `task.md` or `ticket.md` and the newest implementation source artifact, preferring plan, structure outline, TDD, then PRD. Use artifact summaries to avoid opening unrelated documents. Read repository instructions and documented coding standards that govern changed files.

## 3. Review the change

Trace changed behavior through its callers and tests. Check:

- correctness, edge cases, and error handling
- data loss, security, permission, and trust-boundary risks
- concurrency, retries, lifecycle, cleanup, and idempotency where relevant
- public contracts, persistence, migrations, and compatibility
- missing or misleading tests and verification
- requirements that are absent, partial, or implemented incorrectly
- unnecessary code when an existing helper, standard feature, or installed dependency already covers it
- accessibility and interaction behavior for user-interface changes

Report only actionable findings caused by the reviewed change. Every finding needs a severity, stable id, file and line, concrete failure mode, evidence or reproduction, and the smallest credible fix direction. Do not include praise, style nits already enforced by tooling, speculative risks without a reachable path, or pre-existing unrelated defects.

Run focused read-only checks when they can confirm or reject a suspected finding. Do not edit source files during this phase.

## 4. Save the review artifact

Call `rpi_next_artifact_number`, then write:

```text
NN-code-review-<2-4-word-kebab-summary>.md
```

Use `references/code_review_template.md`. Set `status: findings` when one or more actionable findings remain, `status: clean` only when the complete pinned scope has no findings, or `status: blocked` when a required review gate could not run. A blocked review is not clean.

Call `rpi_artifact_save` immediately after writing.

## 5. Choose the next phase

- Findings: use `references/code_review_findings_answer.md`. The next command must be `/rpi-fix-code-review @<artifact>`.
- Clean review: use `references/code_review_clean_answer.md`. The next command must be `/rpi-describe-pr`.
- Blocked review: use `references/code_review_blocked_answer.md`. Stop the loop until the missing gate can run.

Respond with the selected template only. End with exactly one fenced `text` command.
