---
name: rpi-iterate-research
description: Run for /rpi-iterate-research requests. Update an existing research artifact from feedback or additional questions.
---

After the task-context step, read the [RPI writing guide](../WRITING.md), resolved relative to this installed skill directory. Apply it before drafting or revising artifacts and before replying.

# Iterate Research

Revise an existing research document. Keep it as current-state technical explanation. Do not turn it into a proposal, diagnosis, or implementation plan unless the user explicitly changes the task.

## Input

When `@artifact` is passed, resolve it against the artifact list from `rpi_task_context`. If a path is supplied, confirm it is inside the task artifact directory unless the user clearly named an external source file for evidence. Otherwise list the task directory with `ls -La .rpi/tasks/<slug>` and look for research artifacts (exclude research-questions).

- One research artifact: read it fully and proceed.
- Multiple: ask which one.
- None: reply "I'm ready to revise the research artifact. Send the research document or the area to investigate, and I will update it with current evidence." and wait.

Do not read `task.md`, `ticket.md`, research-questions files, design artifacts, plans, or PR descriptions unless the user names them. Iteration starts from the selected research document and the user's feedback.

## Steps

1. **Read the artifact fully**. Read references/research_final_answer.md from this skill's directory. Read the selected research artifact with no limit or offset. Understand the selected research artifact's frontmatter, research question, summary, findings, code references, architecture notes, open questions. Do not browse other files in the task artifact directory as background.

2. **Process feedback**. Classify: additional research (gather evidence), correction (revise stale sections), clarification (improve clarity), comment response (call `rpi_get_artifact_comments` if the user asks; do not resolve comments here unless explicitly asked and unambiguous).

3. **Research when needed**. Read named files fully before spawning child threads. Spawn `rpi-agent-codebase-locator` (find files, dirs, tests, docs, config), `rpi-agent-codebase-analyzer` (explain current behavior), `rpi-agent-codebase-pattern-finder` (gather examples and conventions), `rpi-agent-web-search-researcher` (external docs for dependencies). Use roles sparingly. Start with a locator if the relevant code is unknown. Send analyzers to specific files, flows, or components after you have candidate paths. Use pattern-finder for examples already present in the repository. Use web-search only when external sources are relevant, and require links in the output. Spawn independent lanes before waiting.

4. **Update in place**. Do not create a new research document for normal iteration. Wait for every child thread before editing the artifact. Revise the same artifact path. Write the revised document to the same path. Integrate findings where they belong. Update summary when the answer changes. Rewrite affected sections so narrative flows. Add or adjust diagrams, tables, call/file/component trees, contracts, pseudocode. Update testing patterns and code references with exact paths. Remove answered open questions. Add new open questions only for factual gaps that remain. No change log. If you encounter vague headings while editing, improve them as part of the revision.

5. **Final answer**. Read references/research_final_answer.md and respond using that template only. Include the artifact directive. The last lines must be exactly one fenced `text` block copied from the template. Never repeat the current command `/rpi-iterate-research` as the next step. Choose next command from `rpi_task_context.task.workflow`: `rpi` -> `/rpi-create-design-discussion`, `outline_only` -> `/rpi-create-structure-outline`, `prd_tdd` -> `/rpi-create-prd`.

## Document style

Document the existing codebase. Explain current behavior. Show where files, components, services, data, tests, config live. Cite concrete evidence. Include external links when used. Keep sections concept-oriented and readable. Do not recommend changes, diagnose bugs (unless asked), rate code quality, suggest refactors/optimizations, or argue for a future design.

- Headings assert the takeaway: "The daemon records session state before publishing updates", not "Daemon".
- Use tables, Mermaid, call/file/component trees, type/endpoint/schema shapes, pseudocode. No diff blocks.
- Testing patterns: document for each affected findings section (paths, type, fixtures, mocks, harnesses, or "no coverage found").

If unresolved factual questions remain after revision, add after the review sentence: "There are N open questions that need review; you can ask for another research pass, provide the answers, or tell me to remove them as irrelevant."
