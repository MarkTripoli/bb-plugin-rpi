---
name: rpi-review-artifact-comments
description: Run for /rpi-review-artifact-comments requests. Review artifact comments and act only with explicit user direction.
---

After the task-context step, read the [RPI writing guide](../WRITING.md), resolved relative to this installed skill directory. Apply it before drafting or revising artifacts and before replying.

# Review Artifact Comments

Inspect and address comments on a task artifact. Move one thread at a time. Read, summarize, ask how to proceed, apply edits, reply, resolve, or delete. State-changing operations require direct user instruction.

## Setup

Call `rpi_task_context`. Use the returned task directory, artifact list, and task slug to resolve artifact names. Tools: `rpi_get_artifact_comments`, `rpi_update_artifact_comments`, `rpi_reply_to_artifact_comment`. If unavailable or not task thread, tell user, ask to move to task session.

## Input

1. Prompt has `<comments>` block: work from it.
2. No block, has artifact name: call `rpi_get_artifact_comments`.
3. Neither: ask, wait.

Blocks: `<comments>` wrapper, artifact name, `<comment>` entries, ids, quotes, author/replies. Read `references/comment_xml_format.md` for shape.

## Workflow

1. **Read artifact.** Read the target artifact from the task directory if you have not already read it. Read fully before deciding.

2. **Fetch.** Use XML when present; else `rpi_get_artifact_comments`. Unresolved by default. Resolved only if user asks or task requires.

3. **Ask unless instructed.** No action given: stop after reading, ask. Keep the choices concise and grounded in the comments you saw.

4. **Follow action.** One thread at a time.
   - Edit: same artifact unless user wants new, preserve frontmatter/structure unless correction needed, call `rpi_artifact_save`.
   - Reply: `rpi_reply_to_artifact_comment`, specific, no hiding decisions.
   - Resolve/delete: `rpi_update_artifact_comments`, only user-told, reverse mistakes when possible.

5. **Note when useful.** Most need no artifact. If user asks or complex: read `references/comments_template.md`, `rpi_next_artifact_number`, write `NN-comment-review-<summary>.md`, `rpi_artifact_save`.

6. **Final.** Read `references/comments_final_answer.md`. Use template. Include directive if saved. End with one fenced `text` block: `/rpi-iterate-implementation`.

## Rules

- Offer resolve/reply/delete only after confirm.
- Ask before state change when ambiguous.
- No batch unrelated threads with different decisions.
- No resolve just from reading.
- No delete as cleanup.
- No unrelated artifacts.
- No new artifact unless helps workflow.
- Keep ids intact.
