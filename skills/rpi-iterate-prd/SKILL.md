---
name: rpi-iterate-prd
description: Run for /rpi-iterate-prd requests. Refine an existing Product Requirements Document artifact.
---

After the task-context step, read the [RPI writing guide](../WRITING.md), resolved relative to this installed skill directory. Apply it before drafting or revising artifacts and before replying.

# Iterate PRD

You refine an existing PRD from feedback, comments, or continued questioning. Use creation discipline, operate on existing artifact, resolve one point at a time.

## Operating Principles

- Guide conversation. After applying one change or answering one decision, pause for next direction.
- Rework sections; do not append notes. PRD reads as current spec, not Q&A transcript or edit history.
- Ask exactly one question per message when continuing interview.
- Do not edit while decision is being discussed. Patch only after resolution.
- Show visual changes with updated mockups when UI, flows, states, layouts are discussed.
- Keep section and sub-point titles informative for skimming.
- Stay in product space. Put implementation consequences under Deferred to TDD or leave for TDD.

## Initial Check

If user gives no feedback, no artifact argument, no instruction to continue, ask which path and wait: "I can revise the PRD now. Choose one path: send concrete edits, continue the product decision interview, or ask me to identify the next unresolved product choice."

## References

Read from this skill directory: `references/prd_template.md`, `references/prd_final_answer.md`.

## Continue Product Interview Mode

If user wants to keep resolving choices: read PRD fully, identify sparse or unresolved Solution Details; do not require a prewritten question list. Present next decision only (state question, offer two or three options with tradeoffs, recommend based on user value and patterns, create/update mockups for UI choices, treat clarifying discussion as conversation). Once resolved, rework PRD to weave decision into sections. Continue one at a time until user stops or solution complete. When complete and approved, use final answer template.

## Steps

1. **Find and read**: Resolve target PRD from `@file` or manifest. Ask to choose if multiple plausible. Read fully: PRD, feedback, mockups, user-mentioned files. For ticket, research, design discussion: use `summary` fields, open only when feedback touches coverage, read by heading.

2. **Validate feedback**: Do not accept corrections blindly. Read named files. Verify uncertain facts with direct reads or child research. Use `rpi_get_artifact_comments` if comments are relevant.

3. **Spawn research when needed**: Spawn rpi-agent-codebase-locator (finds files/tests), -analyzer (explains behavior), -pattern-finder (finds precedents), -web-search-researcher (checks external docs) children per the session child-thread recipe when a missing fact would change the artifact. Use only findings you have read from `bb thread output`. If a child or direct read discovers current-state facts missing or stale in completed research, fold those into the research artifact before finalizing the PRD.

4. **Update PRD**: Edit in place. Preserve frontmatter and major sections. Update Problem to Solve, success signal, Proposed Solution, Alternative Solutions Considered, Solution Details, mockups, Out of Scope per feedback. Weave resolved decisions into narrative; do not leave as log entry.

5. **Update mockups when feedback changes visuals**: Edit existing mockups when they represent same decision. Create new only when feedback introduces distinct UI choice. Re-embed with `::rpi-artifact{...}` embeds.

6. **Stop and ask next**: After incorporating feedback, stop. State change briefly, ask what to work on next, offer next decision if unresolved parts remain. Never continue to another change without user direction.



7. **Finish when user is done**: When user says PRD is complete or solution fully fleshed out and approved, read `references/prd_final_answer.md`, save, follow template, include artifact directive.
