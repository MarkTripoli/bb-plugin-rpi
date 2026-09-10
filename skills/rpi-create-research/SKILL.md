---
name: rpi-create-research
description: Run for /rpi-create-research requests. Research and document the current codebase from research questions.
---

After the task-context step, read the [RPI writing guide](../WRITING.md), resolved relative to this installed skill directory. Apply it before drafting or revising artifacts and before replying.

# Research Codebase

You orchestrate research for an RPI task. Answer research questions by collecting current-state evidence from the repository, docs, and dependencies. Write one cohesive research artifact.

## Critical boundary: describe the system that exists

Document what exists today. Do not propose fixes, features, refactors, optimizations, architecture changes, cleanup, or root-cause analysis unless the user asks for diagnosis. Do not criticize code or call something a bug, smell, risk, or weakness. Do not let the ticket's desired outcome steer research beyond the neutral research questions.

Cite concrete files, lines, commands, schemas, docs, URLs.

## Input

If `rpi_task_context` identifies a research-questions artifact, use it. Otherwise look for `research-questions` in the task directory with `ls -La .rpi/tasks/<slug>`.

- One research-questions file: read it fully.
- Multiple: ask which one.
- None: reply "I'm ready to research the codebase. Please provide the research question or area to investigate, and I will document the relevant components and connections." and wait.

Do not read `task.md`, `ticket.md`, design artifacts, plans, or PR descriptions unless the user names them. The research-questions document is the handoff.

## Steps

1. **Read named files first**. Read references/research_template.md from this skill's directory. If the user or research-questions doc names files, read them fully with no limit or offset before spawning.

2. **Decompose the research**. Break the query into independent areas. Plan before spawning: entry points, persistence, state, events, APIs, commands, UI, tests, fixtures, dependency docs, directories.

3. **Spawn child threads**. Use `rpi-agent-codebase-locator` (find files, dirs, tests, config, docs), `rpi-agent-codebase-analyzer` (explain current behavior with citations), `rpi-agent-codebase-pattern-finder` (gather examples and conventions), `rpi-agent-web-search-researcher` (external docs for dependencies, SDKs, APIs). Combine related questions. Do not launch one child per question by reflex. Aim for two to six child threads. Start with a locator when relevant files are unknown. Use analyzers after you have a likely path or component. Use pattern-finder when current conventions and examples matter. Use web-search only for external, modern, or dependency-specific facts. Spawn independent lanes before waiting. Say what to find, not how.

4. **Synthesize**. Do not write the research artifact until all spawned child threads finish or clearly fail. Wait for all children. Treat repository evidence as primary. Answer the research question directly. Connect findings across components. Cite exact paths and line numbers. Include web-research links when used. Document tests for each area, including when none found.

5. **Write the document**. Gather metadata: timestamp, git commit, branch, repo name, topic, research-questions artifact name. Call `rpi_next_artifact_number`, use `NN-research-<2-4-word-kebab>.md`. Follow the structure from references/research_template.md. Write a complete document, not notes for later completion.

6. **Optional second pass**. Inspect Open Questions. If one targeted pass could answer remaining factual gaps, spawn children once more (do this at most once). Merge findings into sections. Remove answered questions.

7. **Final answer**. Read references/research_final_answer.md and respond using that template only. Include the artifact directive. The last lines must be one fenced `text` block copied from the template, not an inline command. Never repeat the current command `/rpi-create-research` as the next step. Choose next command from `rpi_task_context.task.workflow`: `rpi` -> `/rpi-create-design-discussion`, `outline_only` -> `/rpi-create-structure-outline`, `prd_tdd` -> `/rpi-create-prd`.

8. **Follow-up**. If the user asks follow-up questions after the artifact exists, update the same document in place.

## Document style

Write a purposeful technical explainer, not a dump or worksheet. Use prose, tables, Mermaid, call trees, file trees, component trees, type signatures, schemas, pseudocode. Keep factual and current-state only. No `diff` blocks.

- Headings state the finding: "Session rows are derived from thread events", not "Sessions".
- State behavior, then cite where it appears. Use file ranges like `src/app.ts:57-80`.
- Prefer concept-first prose over path inventory.
- Code References: comprehensive for the researched area, grouped by subsystem. Say when exhaustive vs representative.
- Testing patterns: include for every major findings section (unit, e2e, harness, paths, mocking, fixtures, or "no tests found").

If open questions remain after the optional second pass, mention the count only in the template's designated place: "There are N open questions that need review; you can ask for another research pass, provide the answers, or tell me to remove them as irrelevant."
