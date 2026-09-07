---
name: rpi-iterate-design-discussion
description: Run for /rpi-iterate-design-discussion requests. Revise a design discussion artifact using feedback, comments, or new evidence.
---

# Iterate Design Discussion

You are revising a design discussion that already exists. Apply feedback only after checking it, keep open questions separate from resolved decisions, and leave the artifact as a coherent design document rather than a conversation log.

## Initial Check

If the user provides no feedback, no comment target, and no artifact argument, ask for feedback and wait:

```text
I can revise the design discussion now. Send the change, comment, or decision you want reflected first.
```

Do not edit until the user gives a change, names comments, or asks you to continue working through open decisions.

## bb Task Setup

0. Call `rpi_task_context` before any file read. Use its task directory, artifact manifest, current thread, provider, and preferred research model. If it fails, stop.
1. Resolve the target design discussion from the `@file` argument when present. If no artifact is named, use the manifest; ask only if more than one plausible file remains.
2. Locate this skill through the skills tier listing, then read references relative to this skill directory: `references/design_discussion_template.md`, `references/design_discussion_review_answer.md`, and `references/design_discussion_final_answer.md`.
3. If comments are relevant, call `rpi_get_artifact_comments` for the design discussion file. Fetch unresolved comments by default; include resolved comments only when requested.

## Steps

1. **Find and read the task directory**:
   - List the task directory with `ls -La <task-dir>`. Avoid search, glob, plain `ls`, and `ls -l` inside `.rpi/tasks` because task paths may be linked.
   - Primary inputs, read fully: the current design discussion, the feedback, and any explicit user-mentioned file.
   - `task.md` or `ticket.md`, completed research, and earlier design artifacts: use their `summary` fields from the `rpi_task_context` manifest. Open one only when the feedback touches something its summary covers, and read that section by heading rather than the whole file.
   - Do not read research-question artifacts unless asked to review research setup.

2. **Check the user's input before applying it**:
   - Do not accept corrections blindly.
   - Read named files or directories yourself.
   - If a claim depends on code behavior and artifacts do not prove it, verify with source reads or child research.
   - Map artifact comments to the sections they affect before editing.

3. **Optionally spawn child research threads**:
   - Use child threads only when extra codebase context would change the design.
   - Spawn independent work first, then wait and read output:

```text
bb thread spawn --project $BB_PROJECT_ID --parent-self --environment $BB_ENVIRONMENT_ID --provider <same> --model <research model from rpi_task_context preferences> --prompt "/rpi-agent-codebase-analyzer <assignment>"
bb thread wait <thread-id>
bb thread output <thread-id>
```

   - Use locator for file discovery, analyzer for behavior, pattern finder for local precedents, and web researcher for external references.
   - The child final message is the deliverable. Skip child threads for straightforward wording or already-verified decisions.

4. **Update the design discussion in place**:
   - Keep the original path and frontmatter unless the file is malformed.
   - Rework Current State, Desired End State, Proposed End State Architecture, and Patterns to follow when feedback changes them.
   - Move answered questions from `Design Questions` to `Resolved Design Questions` with the chosen option, rationale, and rejected alternatives.
   - Add new open questions when feedback exposes an undecided choice.
   - Do not append a change log. Fold the change into the relevant section.

<content_guidance>

- Keep request summary, current behavior, target behavior, and non-goals current.
- Update diagrams, pseudocode, component trees, file trees, or HTML artifacts when the proposed end state changes.
- Present options and tradeoffs for new open questions.
- Record final decisions only when the user or a newer artifact resolved them.
- Re-check code examples before keeping them; include only snippets that help implementation follow the intended pattern.

</content_guidance>

5. **Handle comments if they drove the iteration**:
   - Use `rpi_reply_to_artifact_comment` when directly answering a comment.
   - Use `rpi_update_artifact_comments` to resolve comments only when the user asked for resolution or the requested edit clearly completed the comment and comment cleanup was requested.
   - Do not delete comments without explicit deletion instruction.

6. **Save and answer**:
   - Call `rpi_artifact_save` for the edited file.
   - If unresolved design questions remain, read `references/design_discussion_review_answer.md`.
   - If all questions are resolved, read `references/design_discussion_final_answer.md`.
   - Follow the chosen template exactly. Do not add a separate summary.

## Artifact and Reading Rules

- Read task artifacts fully. Do not use partial reads for task files, user-mentioned files, or the artifact you are editing.
- Do not inspect unrelated task directories unless the user explicitly asks.
- Treat failed artifact saves, failed comment calls, or unavailable task context as blockers.
- Use `rpi_next_artifact_number` only when creating a new numbered artifact. Normal iteration edits the existing file.

## Document Precedence

When documents disagree, the latest phase artifact wins:

**design discussion > research > ticket**

Earlier material provides context. The design discussion records the current decision and should absorb later user feedback instead of leaving contradictions in place.

## Markdown Formatting

When an artifact needs to show markdown that itself contains fenced code, wrap the outer example in four backticks.
