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

## 2. Recover the requirements and read tests first

Read `task.md` or `ticket.md` and the newest implementation source artifact, preferring plan, structure outline, TDD, then PRD. Use artifact summaries to avoid opening unrelated documents. Read repository instructions and documented coding standards that govern changed files.

Before judging the implementation, read the changed tests and the existing tests for the affected behavior. Establish what they claim, which boundaries they cover, and whether they would fail for the reported regression or requirement.

Inspect the commit or pull request description when one exists. Its title should stand alone in history, and its body should explain the behavior change, motivation, non-obvious decisions, evidence, and known limits. Record the implementation model and review model when known; a different reviewer model is useful independent evidence, but its absence is not itself a blocker.

## 3. Review the change on five axes

Trace changed behavior through its callers and tests. Evaluate every applicable axis and record the evidence in the artifact:

1. **Correctness:** requirements, null and boundary cases, failure paths, test validity, state consistency, races, retries, lifecycle, cleanup, idempotency, persistence, migrations, and compatibility.
2. **Readability and simplicity:** precise names, direct control flow, cohesive organization, unnecessary lines or abstractions, dead compatibility remnants, and comments only where intent is not evident. Treat a new conditional bolted onto an unrelated path or repeated branching on the same shape as a structural concern.
3. **Architecture:** consistency with established patterns, module ownership, dependency direction, duplication, coupling, abstraction level, and explicit type boundaries. A refactor must reduce the number of concepts a reader holds, not merely move them.
4. **Security:** untrusted inputs and external data, authorization, secrets, query parameterization, output encoding, dependency provenance, and trust-boundary validation.
5. **Performance:** N+1 work, unbounded queries or loops, blocking work in asynchronous paths, unnecessary UI renders, missing pagination, and large allocations on hot paths.

For interface changes, include accessibility, keyboard and pointer behavior, responsive layout, and manual or screenshot evidence when applicable.

## 4. Apply the health and severity standard

A clean verdict means the change improves overall code health, satisfies the task, follows repository conventions, and has no Critical or Required findings. Do not block on personal preference, unattainable perfection, or a non-blocking suggestion.

Classify every recorded item:

- **Critical:** merge blocker with a reachable security, data-loss, or broken-functionality path.
- **Required:** must be repaired before merge because it is a concrete defect, missing necessary regression check, or structural regression caused by the change.
- **Optional:** worthwhile improvement that is not required for a healthy merge.
- **Nit:** minor presentation or naming preference that tooling does not already enforce.
- **FYI:** context only, with no requested action.

Only Critical and Required items count as findings and set `status: findings`. Put Optional, Nit, and FYI items under Advisories; they do not force a fix round or prevent `status: clean`.

Lead with the highest-leverage issue. Prefer a few proven findings to a long list of weak comments. For a structural finding, name the smallest credible restructuring, such as collapsing duplicate branches, separating orchestration from policy, moving feature logic to its owning module, reusing the canonical helper, making a type boundary explicit, deleting a pass-through abstraction, or extracting a focused module.

Inspect change size and the resulting file sizes. Roughly 100 changed lines is easy to review, 300 can still be one coherent change, and 1,000 warrants a split check. These are signals, not automatic blockers. Require a split when unrelated concerns are bundled or the change materially worsens an already oversized module. Still review the complete pinned scope.

If the change adds or upgrades dependencies, verify that the existing stack cannot cover the need, inspect the lockfile, maintenance, license, security state, and relevant changelog or migration guidance. Prefer one dependency upgrade per change unless a coupled set is justified.

Identify newly orphaned code explicitly. Treat clearly task-caused dead code as Required. Do not request deletion of uncertain or unrelated pre-existing code without user direction.

Report only evidence-backed items caused by the reviewed change. Every Critical or Required finding needs a stable id, file and line, concrete failure mode, evidence or reproduction, and the smallest credible fix direction. Every advisory needs a location, evidence, and bounded suggestion. Do not include praise, style nits already enforced by tooling, speculative risks without a reachable path, or pre-existing unrelated defects.

Run focused read-only checks when they can confirm or reject a suspected finding. Do not edit source files during this phase.

Verify the verification story: tests, build, manual checks, screenshots or before-and-after evidence when applicable. A green test suite is necessary evidence, not proof that architecture, security, or requirements are correct.

## 5. Save the review artifact

Call `rpi_next_artifact_number`, then write:

```text
NN-code-review-<2-4-word-kebab-summary>.md
```

Use `references/code_review_template.md`. Set `status: findings` when one or more actionable findings remain, `status: clean` only when the complete pinned scope has no findings, or `status: blocked` when a required review gate could not run. A blocked review is not clean.

Call `rpi_artifact_save` immediately after writing.

## 6. Choose the next phase

- Findings: use `references/code_review_findings_answer.md`. The next command must be `/rpi-fix-code-review @<artifact>`.
- Clean review: use `references/code_review_clean_answer.md`. The next command must be `/rpi-describe-pr`.
- Blocked review: use `references/code_review_blocked_answer.md`. Stop the loop until the missing gate can run.

Respond with the selected template only. End with exactly one fenced `text` command.
