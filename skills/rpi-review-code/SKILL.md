---
name: rpi-review-code
description: Run for /rpi-review-code requests. Review the complete task diff and record only concrete findings.
---

After the task-context step, read the [RPI writing guide](../WRITING.md), resolved relative to this installed skill directory. Apply it before drafting or revising artifacts and before replying.

# Code Review

Review the complete code change without editing product code. Output is a durable artifact containing concrete findings or recording a clean review.

## Setup

Call `rpi_task_context`. Read `@file` args fully. Read `references/code_review_template.md`, `code_review_findings_answer.md`, `code_review_clean_answer.md`, `code_review_blocked_answer.md`.

## Pin scope

Determine merge target: existing PR, bb metadata, or repo default. Record base branch, merge-base SHA, HEAD SHA, staged/unstaged changes, untracked task files, commits after merge base. Review committed/working-tree changes against merge base. Exclude `.rpi/tasks/`, unrelated changes. Stop if base unresolved. Empty or incomplete scope is not clean.

## Requirements and tests

Read `task.md`/`ticket.md`, newest artifact (prefer plan, outline, TDD, PRD). Use artifact summaries to avoid opening unrelated documents. Read repo instructions, standards for changed files. Read changed/existing tests before judging. Check claims, boundaries, catches regression/requirement. Inspect commit/PR description; title stands alone, body explains behavior/motivation/decisions/evidence/limits. Record models when known.

## Review

Trace behavior through callers/tests. Evaluate every applicable axis:

1. **Correctness:** requirements, null/boundary cases, failures, test validity, state, races, retries, lifecycle, cleanup, idempotency, persistence, migrations, compatibility.
2. **Readability:** precise names, direct flow, organization, unnecessary abstractions, dead code. Conditionals on unrelated paths/repeated branching = structural concerns.
3. **Architecture:** patterns, ownership, dependencies, duplication, coupling, abstraction, boundaries. Refactors reduce concepts, not relocate.
4. **Security:** untrusted inputs, authorization, secrets, parameterization, encoding, provenance, boundary validation.
5. **Performance:** N+1, unbounded queries/loops, blocking async, unnecessary renders, missing pagination, hot-path allocations.

Interfaces: accessibility, keyboard/pointer, responsive, manual/screenshot evidence.

## Health and severity

Clean: improves health, satisfies task, follows conventions, no Critical/Required. Do not block on preference/perfection/non-blocking.

Classify:
- **Critical:** blocker with reachable security/data-loss/broken-functionality.
- **Required:** concrete defect, missing regression, structural regression from change.
- **Optional:** worthwhile, not required.
- **Nit:** minor preference tooling misses.
- **FYI:** context only.

Critical/Required set `findings`. Optional/Nit/FYI are Advisories, do not prevent `clean`.

Lead with highest-leverage. Prefer proven to weak. Structural: name smallest fix (collapse branches, separate orchestration/policy, move to owner, reuse helper, explicit boundary, delete pass-through, extract module).

Size: ~100 easy, ~300 coherent, ~1000 check split. Signals. Require split when bundled/worsens oversized. Review complete scope.

Dependencies: verify stack insufficient, check lockfile/maintenance/license/security/changelog. One upgrade unless coupled.

Identify newly orphaned code explicitly. Orphaned: task-caused dead = Required. No deletion of uncertain pre-existing without direction.

Report evidence-backed from change. Critical/Required: id, file:line, failure, evidence, fix. Advisories: location, evidence, suggestion. No praise, enforced nits, speculation, pre-existing.

Run read-only checks to confirm/reject. No edits.

Verify tests/build/manual/screenshots. Green checks alone are not sufficient.

## Save

Call `rpi_next_artifact_number`. Write `NN-code-review-<summary>.md` using template. Set `findings` when actionable remain, `clean` when none, `blocked` when gate failed. Blocked is not clean. Call `rpi_artifact_save`.

## Next

- Findings: use `references/code_review_findings_answer.md`, next `/rpi-fix-code-review @<artifact>`.
- Clean: use `code_review_clean_answer.md`, next `/rpi-describe-pr`.
- Blocked: use `code_review_blocked_answer.md`, stop until gate runs.

Use template only. End with one fenced `text` command.
