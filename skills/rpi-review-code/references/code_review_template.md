---
type: code-review
date:
branch:
base_branch:
base_sha:
head_sha:
status: findings
summary: "State the reviewed scope, the highest-risk result, and what the next phase must do."
---

# Code Review

## Scope

- merge base:
- reviewed HEAD:
- commits:
- staged and unstaged changes:
- task-owned untracked files:
- excluded changes:

## Requirements and Standards

- task or ticket:
- implementation source:
- repository instructions:

## Change Profile

- intent and expected behavior:
- change description quality:
- implementation model and review model:
- changed-line size and logical cohesion:
- resulting large-file concerns:
- dependency or lockfile changes:

## Tests Reviewed First

- behavior claimed by tests:
- missing or misleading coverage:

## Five-Axis Assessment

### Correctness

- assessment and evidence:

### Readability and Simplicity

- assessment and evidence:

### Architecture

- assessment and evidence:

### Security

- assessment and evidence:

### Performance

- assessment and evidence:

## Verification Story

- command or inspection:
- result:
- manual, screenshot, or before-and-after evidence:

## Critical and Required Findings

### CR-001 [Critical | Required] Short title

- location: `path:line`
- failure mode:
- evidence or reproduction:
- fix direction:

Use `None.` only after the complete pinned scope has been reviewed and every suspected issue has been rejected with evidence.

## Advisories

### ADV-001 [Optional | Nit | FYI] Short title

- location: `path:line`
- evidence:
- suggestion:

Use `None.` when there are no non-blocking notes. Advisories do not trigger a fix round.

## Dead Code and Dependency Review

- newly orphaned code:
- dependency findings:

## Verdict

- decision: approve | request_changes | blocked
- overall code-health change:
- rationale:

## Review Limits

- blocked or unavailable checks:
- residual manual verification:
