---
name: rpi-review-artifact-comments
description: Run for /rpi-review-artifact-comments requests. Review artifact comments and act only with explicit user direction.
---

# Review Artifact Comments

You are helping the user inspect and address comments on a task artifact. Move carefully, one comment thread at a time.

This skill can read comments, summarize them, ask how to proceed, apply edits, reply, resolve, or delete comments. State-changing comment operations require direct user instruction.

## Step 0: Load bb task context

Call `hl_task_context` before reading files. Use the returned task directory, artifact list, and task slug to resolve artifact names.

The available comment tools are:

- `hl_get_artifact_comments`
- `hl_update_artifact_comments`
- `hl_reply_to_artifact_comment`

If these tools are unavailable or `hl_task_context` says the thread is not attached to a task, tell the user that comment tools are not available in this session and ask them to move to a task session with artifact access.

## Input Format

The user may invoke this skill with different levels of detail:

1. If the prompt contains a `<comments>...</comments>` block, work from that block.
2. If no comment block is present but an artifact file name is supplied or obvious from conversation, call `hl_get_artifact_comments` for that artifact.
3. If neither comments nor an artifact name are provided, ask which artifact to inspect and wait for the answer.

### Comment block format

A comment block normally has:

- a `<comments>` wrapper with an artifact name attribute
- one or more `<comment>` entries
- comment ids
- the quoted artifact block being discussed, when available
- author text and replies

Read:

```text
references/comment_xml_format.md
```

when you need a reminder of the XML shape.

## Workflow

1. **Read the artifact**

   Read the target artifact from the task directory if you have not already read it. Read it fully before deciding how comments apply.

2. **Read or fetch comments**

   Use the provided XML block when present. Otherwise fetch comments with `hl_get_artifact_comments`.

   Include unresolved comments by default. Include resolved comments only if the user asks or the task requires reviewing already handled discussion.

3. **Ask how to proceed unless already instructed**

   If the user has not already given an action such as "apply all comments" or "resolve these comments", stop after reading the artifact and comments and ask what they want.

   Keep the choices concise and grounded in the comments you saw. For example:

   ```text
   I found 4 comments on `design-discussion.md`. Do you want me to:
   1. revise the artifact from each comment
   2. revise it and resolve the handled comments
   3. investigate the questions and reply with findings
   4. take a different path
   ```

4. **Follow the confirmed action**

   Work one root comment or thread at a time.

   If editing the artifact:

   - update the same artifact unless the user asks for a new file
   - preserve frontmatter and section structure unless the edit requires a valid correction
   - call `hl_artifact_save` after writing

   If replying:

   - use `hl_reply_to_artifact_comment`
   - keep replies specific to the comment
   - do not use replies to hide unresolved decisions

   If resolving or deleting:

   - use `hl_update_artifact_comments`
   - resolve only comments the user told you to resolve
   - delete only comments the user told you to delete
   - if you make a mistaken state change, use the same update tool to reverse it when possible

5. **Save a comment-review note only when useful**

   Most runs do not need a new artifact. If the user asks for a record or the review is complex, read:

   ```text
   references/comments_template.md
   ```

   Call `hl_next_artifact_number` and write:

   ```text
   NN-comment-review-<2-4-word-kebab-summary>.md
   ```

   Then call `hl_artifact_save`.

6. **Final response**

   Read:

   ```text
   references/comments_final_answer.md
   ```

   Use the template. Include the artifact directive if one was saved. The final response must end with exactly one fenced `text` block containing `/rpi-iterate-implementation`.

## Important Notes

- You may offer to resolve, reply, or delete comments, but do it only after the user confirms or instructs that action.
- If the user's instruction is ambiguous, ask before changing comment state.
- Do not batch unrelated comment threads together when the decisions differ.
- Do not mark comments resolved merely because you read them.
- Do not delete comments as cleanup.
- Do not read unrelated task artifacts.
- Do not create a new artifact unless it helps the comment-review workflow.
- Keep comment ids intact when reporting what you did.
