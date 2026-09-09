---
name: rpi-resolve-pr-reviews
description: Run for /rpi-resolve-pr-reviews requests. Address pull request review threads, reply with evidence, and repeat until approved.
---

# Resolve Pull Request Reviews

Inspect the current branch's pull request or merge request, repair actionable feedback, reply to every handled thread, and record whether the change is approved. External replies and resolutions require the user's action-time confirmation.

## 0. Load task context

Call `rpi_task_context` before reading files. Use its task directory, environment, artifact manifest, provider, and model. Locate this skill through the skills tier listing, then read:

- `references/pr_review_template.md`
- `references/pr_review_pending_answer.md`
- `references/pr_review_approved_answer.md`

## 1. Identify the review target

Prefer `ticketing.tool` or `vcs.platform` from `ai-utilities.json` when present, then detect GitHub or GitLab from the repository remote. Use `gh` for GitHub and `glab` for GitLab. Verify the CLI is installed and authenticated.

Find the open pull request for the current branch and record its URL, number, base SHA, and head SHA. Stop if the current branch does not identify exactly one open review target.

## 2. Fetch current review state

Fetch all review submissions, unresolved resolvable threads, requested changes, approvals, and required checks. Do not treat green checks, no comments, or mergeability as an approval. Keep the reviewed head SHA attached to every conclusion.

If there are no unresolved threads and the current head has an approval, save an approved artifact and finish.

## 3. Triage each unresolved thread

Classify every thread as `fix`, `discuss`, `decline`, or `clarify`.

- Verify `fix` items against current code before editing.
- Research repository conventions and authoritative sources before `decline` or `discuss`.
- Default to `fix` when no evidence supports declining.
- Draft a complete reply for every thread. Replies must state the result and evidence without mentioning automated tooling.

Present the numbered triage, proposed edits, and exact replies to the user. Wait for confirmation before changing code or sending external replies.

## 4. Apply the confirmed resolution

After confirmation:

1. Make the smallest root-cause changes for every confirmed fix.
2. Add focused regressions where behavior changed.
3. Run focused checks and all repository-required gates.
4. Commit and push the exact reviewed changes when the user authorized that action.
5. Reply to every handled review thread with the final evidence and commit SHA.
6. Resolve a thread only after its reply was sent and its action is complete.

Never resolve a declined, discussed, or clarified thread without the user's confirmed disposition.

## 5. Re-fetch and save the round

Fetch the pull request state again after the push and replies. Call `rpi_next_artifact_number`, then write:

```text
NN-pr-review-<2-4-word-kebab-summary>.md
```

Use `references/pr_review_template.md`. Record comment ids, dispositions, replies, commit SHA, test results, remaining unresolved threads, checks, and approval state. Call `rpi_artifact_save` immediately after writing.

## 6. Choose the next result

- Current head approved and no unresolved threads: use `references/pr_review_approved_answer.md`.
- Otherwise: use `references/pr_review_pending_answer.md`. The repeated command is a human gate. Do not poll or auto-run while waiting for an external reviewer.

Respond with the selected template only and end with exactly one fenced `text` command.
