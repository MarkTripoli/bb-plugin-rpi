---
name: rpi-iterate-prd
description: Run for /rpi-iterate-prd requests. Refine an existing Product Requirements Document artifact.
---

# Iterate PRD

You are refining an existing PRD from feedback, comments, or continued product questioning. Use the same discipline as PRD creation, but operate on the existing artifact and resolve one point at a time.

## Operating Principles

- Guide the conversation. After you apply one change or answer one decision, pause for the user's next direction.
- Rework sections instead of appending notes. The PRD should read as a current spec, not a Q&A transcript or edit history.
- Ask exactly one question per message when continuing the product interview.
- Do not edit while a decision is still being discussed. Patch only after the decision is resolved.
- Show visual changes with updated mockups when UI, flows, states, or layouts are being discussed.
- Keep section and sub-point titles informative enough that a reader can skim the shape of the product.
- Stay in product space. Put implementation consequences under Deferred to TDD or leave them for the TDD.

## Initial Check

If the user gives no feedback, no artifact argument, and no instruction to continue the interview, ask which path they want and wait:

```text
I can revise the PRD now. Choose one path: send concrete edits, continue the product decision interview, or ask me to identify the next unresolved product choice.
```

## bb Task Setup

0. Call `rpi_task_context` before reading files, spawning child threads, or choosing an artifact path. Use its task directory, task slug, artifact manifest, repository, branch, thread id, provider, and model preferences. If it fails, stop.
1. Use the task directory returned by the tool. Do not guess a sibling under `.rpi/tasks` from an old session or a remembered slug.
2. Locate this installed skill through the skills tier listing, then read reference files relative to this skill directory: `references/prd_template.md`, `references/prd_final_answer.md`, `references/prd_final_answer.md`.
3. After every artifact write or edit, call `rpi_artifact_save` with the relative file name and keep the returned `::rpi-artifact{...}` directive for the final answer.

## Continue Product Interview Mode

If the user wants to keep resolving product choices:

1. Read the PRD fully and identify sparse or unresolved Solution Details. Do not require a prewritten question list.
2. Present the next product decision only:
   - State the question.
   - Offer two or three options with tradeoffs.
   - Recommend one option based on user value and existing product patterns.
   - For UI choices, create or update mockups.
   - Treat clarifying discussion as conversation, not a resolved decision.
3. Once the decision is resolved, rework the PRD so the decision is woven into the relevant sections.
4. Continue one decision at a time until the user stops or the solution is complete.
5. When the solution is complete and approved, use the final answer template.

## Steps

1. **Find and read the task directory**:
   - Resolve the target PRD from `@file` when present, otherwise use the artifact manifest.
   - If more than one PRD could be the target, ask the user to choose.
   - Read the PRD, task or ticket, completed research, design discussion, mockups, and user-mentioned files fully.
   - Do not read partial task files.

2. **Validate feedback**:
   - Do not accept corrections blindly.
   - Read named files and directories.
   - If facts are uncertain, verify them with direct reads or child research before changing the PRD.
   - If comments are relevant, use `rpi_get_artifact_comments` on the PRD artifact.

3. **Spawn research when needed**:

Use child threads only when a missing fact would change the artifact. Spawn independent assignments first, then wait for them and read their final messages:

```text
bb thread spawn --project $BB_PROJECT_ID --parent-self --environment $BB_ENVIRONMENT_ID --provider <same> --model <research model from rpi_task_context preferences> --prompt "/rpi-agent-codebase-locator <assignment>"
bb thread spawn --project $BB_PROJECT_ID --parent-self --environment $BB_ENVIRONMENT_ID --provider <same> --model <research model from rpi_task_context preferences> --prompt "/rpi-agent-codebase-analyzer <assignment>"
bb thread spawn --project $BB_PROJECT_ID --parent-self --environment $BB_ENVIRONMENT_ID --provider <same> --model <research model from rpi_task_context preferences> --prompt "/rpi-agent-codebase-pattern-finder <assignment>"
bb thread spawn --project $BB_PROJECT_ID --parent-self --environment $BB_ENVIRONMENT_ID --provider <same> --model <research model from rpi_task_context preferences> --prompt "/rpi-agent-web-search-researcher <assignment>"
bb thread wait <thread-id>
bb thread output <thread-id>
```

Role mapping: locator finds files and tests, analyzer explains current behavior, pattern finder finds local precedents, and web researcher checks external behavior or current documentation. The child thread's final message is the deliverable. Use only findings you have read from `bb thread output`.

If a child thread or direct read discovers current-state facts that are missing or stale in the completed research artifact, fold those discoveries back into that research artifact before finalizing the PRD. Save the updated research artifact with `rpi_artifact_save`, then continue the PRD from the corrected context.

4. **Update the PRD**:
   - Edit the target artifact in place.
   - Preserve frontmatter and the template's major sections.
   - Update Problem to Solve, success signal, Proposed Solution, Alternative Solutions Considered, Solution Details, mockups, and Out of Scope as the feedback requires.
   - When a product decision is resolved, weave it into the narrative. Do not leave it as a log entry.

5. **Update mockups when feedback changes visuals**:
   - Edit existing HTML mockups when they represent the same decision.
   - Create a new mockup only when the feedback introduces a distinct UI choice.
   - Re-embed mockups with `::rpi-artifact{...}` embeds.

6. **Stop and ask what is next**:
   - After incorporating feedback, stop.
   - State the change you made briefly and ask what to work on next.
   - If unresolved parts remain, offer the next single decision.
   - Never continue to another change without user direction.

<content_guidance>

**High-level product spec**
- Keep problem, success, proposed solution, and out-of-scope items aligned.
- If a change affects user behavior, update all affected sections.

**Success is a lever**
- Use a meaningful signal where possible: adoption, operational quality, benchmark, error reduction, latency, support burden, or qualitative review.
- For small tasks, it is acceptable to record that no useful metric exists, but only with user agreement.

**Product decisions**
- Present options with tradeoffs.
- Record final decisions with rationale.
- Capture rejected alternatives so implementation does not reopen them accidentally.

**Visuals**
- Use realistic labels and data.
- Keep mockups current with decisions.
- Show before/after only when comparison helps.

</content_guidance>

7. **Finish only when the user is done**:
   - When the user says the PRD is complete, or the solution is fully fleshed out and approved, read `references/prd_final_answer.md`.
   - Save the latest PRD with `rpi_artifact_save`.
   - Follow the final template exactly and include the artifact directive.

## Artifact and Reading Rules

- Read task artifacts fully. Do not use partial reads for task files, user-mentioned files, or the artifact you are editing.
- List task directories with `ls -La <task-dir>`. Avoid plain `ls`, `ls -l`, search, and glob expansion inside `.rpi/tasks` because the path may be a linked directory.
- Do not read research-question artifacts during design, outline, or plan work. They guide the research phase only; use completed research instead.
- Do not inspect unrelated task directories unless the user explicitly asks.
- Treat failed artifact saves, failed comment calls, or unavailable task context as blockers. Do not work around them by writing untracked side files.
- Use `rpi_next_artifact_number` when creating a new numbered artifact. The file name format is `NN-<type>-<2-4-word-kebab-slug>.md`.

## Markdown Formatting

When an artifact needs to show markdown that itself contains fenced code, wrap the outer example in four backticks so inner three-backtick blocks remain valid.

## Document Precedence

When documents disagree, the latest phase artifact wins:

**PRD > design discussion > research > ticket**

Earlier material provides context. The artifact from this phase records the current decision and should absorb later user feedback instead of leaving contradictions in place.
