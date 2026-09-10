---
name: rpi-fix-code-review
description: Run for /rpi-fix-code-review requests. Validate and fix every actionable finding from a code review artifact.
---

After the task-context step, read the [RPI writing guide](../WRITING.md), resolved relative to this installed skill directory. Apply it before drafting or revising artifacts and before replying.

# Fix Code Review Findings

Repair the reviewed change, verify, and send through another code review before PR creation.

## Setup

Call `rpi_task_context`. Resolve `@file` review artifact from manifest; read fully. No file: use newest with `type: code-review`, `status: findings` or `blocked`. If ambiguous, ask. Read `references/code_review_fixes_template.md`, `code_review_fixes_answer.md`.

## Validate

Compare artifact base/head SHAs with current state. Preserve unrelated changes. If base moved or edits invalidate scope, record drift; re-check findings.

Per Critical/Required finding: reproduce/prove failure, trace callers, mark `fixed`/`declined`/`blocked`. Decline only with concrete evidence.

Optional/Nit/FYI not mandatory. Address when in scope and reduces risk/complexity without displacing required work; else left advisory. Ask before deleting uncertain code.

## Fix

Fix validated findings in shared location owning behavior. Reuse existing code/platform before adding helpers/dependencies. Do not broaden beyond review/requirements. Each non-trivial fix needs smallest regression check. Keep security, validation, accessibility, data-loss protections intact.

## Verify

Run focused tests, then required gates. Record commands/outcomes. Missing gate remains blocked; do not relabel it as clean.

## Save receipt

Call `rpi_next_artifact_number`. Write `NN-code-review-fixes-<summary>.md` using template. Map Critical/Required ids to disposition/evidence. Record advisories separately. Call `rpi_artifact_save`.

## Review again

Read, use `references/code_review_fixes_answer.md` exactly. Final command: `/rpi-review-code`, even when all findings fixed. Only fresh clean review proceeds to PR.
