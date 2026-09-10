---
name: rpi-resolve-pr-reviews
description: Run for /rpi-resolve-pr-reviews requests. Address pull request review threads, reply with evidence, and repeat until approved.
---

After the task-context step, read the [RPI writing guide](../WRITING.md), resolved relative to this installed skill directory. Apply it before drafting or revising artifacts and before replying.

# Resolve Pull Request Reviews

Inspect current branch's PR/MR, repair actionable feedback, reply to every handled thread, record approval state. External replies and resolutions require user's action-time confirmation.

## Setup

Call `rpi_task_context`. Read `references/pr_review_template.md`, `pr_review_pending_answer.md`, `pr_review_approved_answer.md`.

## Identify target

Prefer `ticketing.tool`/`vcs.platform` from `ai-utilities.json`; else detect GitHub/GitLab from remote. Use `gh`/`glab`. Verify CLI installed/authenticated. Find open PR for current branch; record URL, number, base SHA, head SHA. Stop if not exactly one target.

## Fetch state

Fetch submissions, unresolved threads, changes, approvals, checks. Do not treat green checks, no comments, or mergeability as an approval. Keep head SHA on conclusions. No threads + head approved: save approved artifact, finish.

## Triage

Classify threads: `fix`, `discuss`, `decline`, `clarify`. Verify `fix` items against code. Research conventions/sources before `decline`/`discuss`. Default `fix` when no evidence declines. Draft a complete reply per thread: result/evidence, no tooling mentions. Present the numbered triage, proposed edits, and exact replies. Wait for confirmation.

## Apply

After confirmation: smallest root-cause fixes, add regressions, run checks/gates, commit/push when authorized, reply with evidence/SHA, resolve after reply+action complete. Never resolve declined/discussed/clarified without confirmed disposition.

## Save

Fetch state after push/replies. Call `rpi_next_artifact_number`. Write `NN-pr-review-<summary>.md` using template. Record ids, dispositions, replies, SHA, tests, threads, checks, approval. Call `rpi_artifact_save`.

## Next

- Head approved + no threads: use `references/pr_review_approved_answer.md`.
- Else: use `pr_review_pending_answer.md`. Repeated command is human gate; no poll/auto-run.

Use template only. End with one fenced `text` command.
