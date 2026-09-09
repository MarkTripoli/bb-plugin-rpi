---
name: rpi-fix-code-review
description: Run for /rpi-fix-code-review requests. Validate and fix every actionable finding from a code review artifact.
---

After the task-context step, read the [RPI writing guide](../WRITING.md), resolved relative to this installed skill directory. Apply it before drafting or revising artifacts and before replying.

# Fix Code Review Findings

Repair the reviewed change, verify the result, and always send it through another independent code review before pull request creation.

## 0. Load task context

Call `rpi_task_context` before reading files. Resolve the explicit `@file` review artifact from the returned manifest and read it fully. If no file was supplied, use the newest live artifact with `type: code-review` and `status: findings` or `status: blocked`. If the choice is ambiguous, ask the user.

Locate this skill through the skills tier listing, then read:

- `references/code_review_fixes_template.md`
- `references/code_review_fixes_answer.md`

## 1. Validate the review

Compare the artifact's base and head SHAs with the current repository state. Preserve unrelated user changes. If the base moved or later edits invalidate the reviewed scope, record the drift and re-check each finding against current code before editing.

For every Critical or Required finding:

1. Reproduce or prove the failure from current code.
2. Trace all callers of the shared function or contract involved.
3. Mark the finding `fixed`, `declined`, or `blocked`.
4. Decline only with concrete repository or authoritative external evidence.

Optional, Nit, and FYI advisories are not mandatory. Address one only when it is clearly within scope and reduces risk or complexity without displacing required work; otherwise record it as left advisory. Ask before deleting code whose reachability or ownership remains uncertain.

## 2. Apply the smallest root-cause fixes

Fix validated findings in the shared location that owns the behavior. Reuse existing code and platform features before adding helpers or dependencies. Do not broaden the change beyond the review and requirements.

Each non-trivial fix needs the smallest regression check that would fail without it. Keep security, validation, accessibility, and data-loss protections intact.

## 3. Verify

Run focused tests while repairing findings, then run the repository's required completion gates. Record exact commands and outcomes. A missing required gate remains blocked; do not relabel it as clean.

## 4. Save the repair receipt

Call `rpi_next_artifact_number`, then write:

```text
NN-code-review-fixes-<2-4-word-kebab-summary>.md
```

Use `references/code_review_fixes_template.md`. Map every Critical or Required review id to its disposition and evidence, and record any advisory decisions separately. Call `rpi_artifact_save` immediately after writing.

## 5. Review again

Read `references/code_review_fixes_answer.md` and respond with it exactly. The final command must always be `/rpi-review-code`, even when all known findings were fixed. Only a fresh clean review may proceed to the pull request.
