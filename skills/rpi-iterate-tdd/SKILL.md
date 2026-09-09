---
name: rpi-iterate-tdd
description: Run for /rpi-iterate-tdd requests. Refine an existing Technical Design Document artifact.
---

After the task-context step, read the [RPI writing guide](../WRITING.md), resolved relative to this installed skill directory. Apply it before drafting or revising artifacts and before replying.

# Revise Technical Design

You are refining an existing Technical Design Document. Use the TDD creation standards, work from feedback, and resolve one change or design question at a time.

## Operating Principles

- Guide the discussion. After each change or answered question, stop for the user's next direction.
- Rework affected sections instead of appending a change log.
- Ask exactly one question per message when continuing the design interview.
- Do not edit while a decision is still open.
- Show system behavior with diagrams, contracts, or schemas. Show program behavior with code-shape views.
- Keep System Design and Program Design separate: cross-component behavior versus in-code structure.
- Use the smallest set of representations that reveals the tradeoff.
- If engineering reality changes product behavior, revise the PRD or mockups when those artifacts exist.

## Initial Check

If the user gives no feedback, no artifact argument, and no request to continue questioning, ask for direction and wait:

```text
I can revise the TDD now. Choose one path: send concrete feedback, continue the technical decision interview, or ask me to identify the next unresolved design choice.
```

## bb Task Setup

0. Call `rpi_task_context` before reading files, spawning child threads, or choosing an artifact path. Use its task directory, task slug, artifact manifest, repository, branch, thread id, provider, and model preferences. If it fails, stop.
1. Use the task directory returned by the tool. Do not guess a sibling under `.rpi/tasks` from an old session or a remembered slug.
2. Locate this installed skill through the skills tier listing, then read reference files relative to this skill directory: `references/tdd_template.md`, `references/artifact_template.html`, `references/tdd_final_answer.md`, `references/tdd_final_answer.md`.
3. After every artifact write or edit, call `rpi_artifact_save` with the relative file name and keep the returned `::rpi-artifact{...}` directive for the final answer.

## Continue Grilling Mode

If the user asks to keep working through technical questions:

1. Read the TDD fully and identify unresolved or thin parts in System Design and Program Design.
2. Present the next decision only.
3. For system decisions, show options with diagrams, high-level signatures, endpoint or message shapes, or data contracts.
4. For program decisions, show concrete code-shape options such as call trees, component trees, file-tree diffs, dependency maps, or method signatures.
5. Use child research when codebase context is needed before presenting options.
6. When a decision resolves, rework the artifact so it reads as a unified design.
7. Continue only after the user answers.

## Steps

1. **Find and read the task directory**:
   - Resolve the target TDD from `@file` when present, otherwise use the artifact manifest.
   - Ask the user to choose only if multiple TDD artifacts are plausible.
   - Primary inputs, read fully: the TDD, the feedback, its mockups, and user-mentioned files.
   - Task or ticket, research, design notes, and PRD: use their `summary` fields from the `rpi_task_context` manifest. Open one only when the feedback touches something its summary covers, and read that section by heading rather than the whole file.
   - Do not read research-question artifacts unless explicitly requested.

2. **Validate feedback**:
   - Do not accept corrections blindly.
   - Read named files and directories.
   - Use direct source reads or child research to verify uncertain claims.
   - If comments are relevant, call `rpi_get_artifact_comments` for the TDD artifact.

3. **Spawn child research when needed**:

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

If a child thread or direct read discovers current-state facts that are missing or stale in the completed research artifact, fold those discoveries back into that research artifact before finalizing the TDD. Save the updated research artifact with `rpi_artifact_save`, then continue the TDD from the corrected context.

4. **Update the TDD in place**:
   - Preserve frontmatter and major template sections.
   - Rework System Design or Program Design depending on the feedback.
   - Express current behavior and target behavior inside System Design rather than adding separate current and desired sections.
   - Update Mermaid diagrams, contracts, file trees, call trees, and Patterns to Follow as needed.
   - Keep the artifact coherent. Do not leave outdated branches or question logs behind.

5. **Update PRD or mockups if technical findings affect product behavior**:
   - If the technical decision changes UX, product scope, availability, states, permissions, or workflow, update the product artifact too when present.
   - Save any changed artifact with `rpi_artifact_save`.

6. **Stop and ask what is next**:
   - After applying the feedback, stop.
   - Briefly state the change and ask what the user wants to work on next.
   - If unresolved design areas remain, offer the next single decision.
   - Never move to another change without user direction.

<content_guidance>

**System design**
- Capture component boundaries, data flow, control flow, contracts, and cross-system effects.
- Use diagrams and contracts to explain how the system changes from current to target.

**Program design**
- Capture modules, call paths, components, dependency seams, file ownership, and internal APIs.
- Show concrete shapes. Avoid exhaustive implementation detail that belongs in the structure outline or plan.

**Technical decisions**
- Present options and tradeoffs.
- Recommend based on local patterns and risk.
- Record final decisions with rationale and update diagrams or code-shape examples.

**Patterns to follow**
- Include file locations and short snippets from the codebase.
- Remove stale or contradicted patterns.

</content_guidance>

## System Design Iteration Details

When feedback touches System Design, update the cross-component story first. This section owns the behavior between pieces, so verify and revise:

- Which component receives the user action, event, scheduled job, or external callback.
- Which contract changes: route, RPC method, CLI argument, queue event, database schema, provider call, or filesystem layout.
- What happens on success, failure, retry, cancellation, permission denial, or partial completion.
- Which existing behavior remains unchanged and which behavior is replaced.
- How rollout, migration, compatibility, or data repair affects the design.

Use diagrams and contracts to make the delta visible. Do not bury current-vs-target behavior in prose that the user must mentally diff.

If feedback changes only a program detail but also affects a system boundary, update both sections in one pass. The document should not describe one contract in System Design and a different one in Program Design.

## Program Design Iteration Details

When feedback touches Program Design, revise the code shape without turning the TDD into an implementation checklist. Check the affected view type:

- Call trees: make sure the entrypoint, orchestration, error handling, and reporting path still match the chosen design.
- Component trees: update state ownership, props, hooks, loading/error states, and package boundaries.
- File trees: keep ownership accurate and remove files that the new decision no longer needs.
- Dependency maps: update injected capabilities when testability, side effects, or IO boundaries change.
- Signatures: keep names, inputs, outputs, and error surfaces consistent with codebase conventions.
- Pseudocode: update branch conditions, ordering, idempotency, and failure paths.

After a change, save the artifact and ask what to work on next. Do not continue into a second independent edit unless the user explicitly asked for a batch and all items are already clear.

## Representation Guidance

Use Mermaid for system flows, sequence diagrams, entity relationships, or type hierarchy sketches. Use HTML artifacts for concepts that need annotations, comparison, or layout beyond markdown. Read `references/artifact_template.html` before writing HTML and display the file with a `::rpi-artifact{...}` embed.

Use call-stack trees, component trees, file-tree diffs, dependency-injection maps, signatures, and pseudocode for Program Design. Use proper tree glyphs in trees and reserve diff notation for actual before/after changes.

## Referencing a PRD

If a PRD exists, use it for product requirements, user flows, and mockups. Do not duplicate PRD prose inside the TDD. If no PRD exists, rely on the ticket, research, and design discussion and be explicit about product assumptions.

## Comment Handling

If the iteration is driven by artifact comments:

1. Fetch comments with `rpi_get_artifact_comments` for the TDD artifact.
2. Work one comment or one tightly related group at a time.
3. If a comment asks for a factual correction, verify it before editing.
4. If a comment asks for a new technical choice, treat it as an open design decision and ask one question unless the answer is already explicit.
5. Reply with `rpi_reply_to_artifact_comment` only when the reply adds value beyond the document edit.
6. Resolve comments with `rpi_update_artifact_comments` only after the user explicitly confirms resolution.
7. Do not delete comments unless explicitly asked.

Comments are collaboration inputs, not a second source of hidden requirements. Fold their accepted content into the TDD so future sessions can read the artifact without reading the comment thread.

7. **Finish only when the user is done**:
   - When the design is complete and approved, save the TDD with `rpi_artifact_save`.
   - Read `references/tdd_final_answer.md`.
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

**TDD > PRD > design discussion > research > ticket**

Earlier material provides context. The artifact from this phase records the current decision and should absorb later user feedback instead of leaving contradictions in place.
