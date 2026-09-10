---
name: rpi-iterate-design-discussion
description: Run for /rpi-iterate-design-discussion requests. Revise a design discussion artifact using feedback, comments, or new evidence.
---

After the task-context step, read the [RPI writing guide](../WRITING.md), resolved relative to this installed skill directory. Apply it before drafting or revising artifacts and before replying.

# Iterate Design Discussion

Revise design discussion from feedback. Apply feedback after checking it. Keep open questions separate from resolved decisions. Leave artifact coherent, not a conversation log.

## Initial Check

If no feedback, no comment target, no artifact argument, ask and wait:

```text
I can revise the design discussion now. Send the change, comment, or decision you want reflected first.
```

Do not edit until the user gives a change, names comments, or asks you to continue working through open decisions.

## Steps

1. **Read inputs**: Resolve the target design discussion from the `@file` argument when present. If no artifact is named, use the manifest; ask only if more than one plausible file remains. Read `references/design_discussion_template.md`, `references/design_discussion_review_answer.md`, `references/design_discussion_final_answer.md`. Read target design discussion, feedback, user-mentioned files fully. Other artifacts by `summary` from manifest; open only when feedback touches them, and then read that section by heading rather than the whole file. Call `rpi_get_artifact_comments` if comments drive iteration; fetch unresolved comments by default; include resolved comments only when requested. Exclude research-question artifacts unless asked.
2. **Verify user input**: Do not accept corrections blindly. Read named files. Verify claims with source reads or child research if artifacts do not prove them. Map artifact comments to the sections they affect before editing.
3. **Spawn child research when extra context would change design**: Use rpi-agent-codebase-locator (file discovery), rpi-agent-codebase-analyzer (behavior), rpi-agent-codebase-pattern-finder (local precedents), rpi-agent-web-search-researcher (external refs) per session child-thread recipe. The child final message is the deliverable. Skip child threads for straightforward wording or already-verified decisions.
4. **Update in place**: Keep the original path and frontmatter unless the file is malformed. Rework Current State, Desired End State, Proposed End State Architecture, Patterns when feedback changes them. Move answered questions to Resolved Design Questions with chosen option, rationale, rejected alternatives. Add new open questions when feedback exposes undecided choice. Do not append a change log. Fold the change into the relevant section.

**Content**: Keep request summary, current behavior, target behavior, non-goals current. Update diagrams, pseudocode, trees, HTML artifacts when end state changes. Present options and tradeoffs for new open questions. Record final decisions only when user or newer artifact resolved them. Re-check code examples before keeping them; include only snippets that help implementation follow the intended pattern.

5. **Handle comments**: Use `rpi_reply_to_artifact_comment` when directly answering. Use `rpi_update_artifact_comments` to resolve only when user asked or edit clearly completed the comment and cleanup was requested. Do not delete without explicit instruction.
6. **Final answer**: If unresolved design questions remain, follow `references/design_discussion_review_answer.md`. If all resolved, follow `references/design_discussion_final_answer.md`. Follow the chosen template exactly. Do not add a separate summary.
