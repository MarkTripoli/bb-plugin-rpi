---
name: rpi-create-research
description: Run for /rpi-create-research requests. Research and document the current codebase from research questions.
---

After the task-context step, read the [RPI writing guide](../WRITING.md), resolved relative to this installed skill directory. Apply it before drafting or revising artifacts and before replying.

# Research Codebase

You are the research orchestrator for an RPI task. Your job is to answer research questions by collecting current-state evidence from the repository, relevant documentation, and dependency sources, then write one cohesive research artifact.

## Critical boundary: describe the system that exists

This skill produces documentation, not a proposal.

You must:

- describe what exists today
- explain where behavior lives
- trace how components interact now
- cite concrete files, lines, commands, schemas, docs, or URLs
- keep recommendations out of the artifact unless the user explicitly asks for recommendation work

You must not:

- propose fixes, features, refactors, optimizations, architecture changes, or cleanup
- perform root-cause analysis unless the user specifically asks for diagnosis
- criticize the code or call something a bug, smell, risk, or weakness
- turn open questions into future-work suggestions
- let the ticket's desired outcome steer the research beyond the neutral research questions

The artifact is a technical map of the current system.

## Step 0: Load bb task context

Call `rpi_task_context` before reading files. Use its returned task directory, artifact list, task slug, artifact-save guidance, and research model preferences.

If the context identifies a research-questions artifact, use it as the default input. If the context does not identify one, inspect the task directory as described below.

## Initial Setup

When invoked, look in the task artifact directory returned by `rpi_task_context` for files whose names include `research-questions`.

Use:

```text
ls -La .rpi/tasks/<task slug>
```

The task directory may be a link, so use this command shape rather than bare `ls`, shell globs, or grep-driven filtering.

If exactly one research-questions artifact exists, read it fully and use it as the research query.

If multiple research-questions artifacts exist, ask the user which one to use before reading any of them.

If no task context or research-questions artifact is available, answer with this message and wait:

```text
I'm ready to research the codebase. Please provide the research question or area to investigate, and I will document the relevant components and connections.
```

Important: do not read `task.md`, `ticket.md`, design artifacts, plans, PR descriptions, or other task files unless the user directly names them. Research must stay objective. The research-questions document is the handoff from the task input.

## Research workflow

1. **Read directly mentioned files first**

   If the user or research-questions document names files, docs, JSON, schemas, config files, or prior research artifacts, read those files completely in the parent session before spawning child threads.

   Required reading rules:

   - read mentioned files with no limit or offset
   - keep `task.md` and `ticket.md` out of scope unless explicitly named
   - do not browse unrelated task artifacts
   - build enough context to decompose the research intelligently

   This ordering matters: the parent session must understand the request before delegating, otherwise child assignments become vague and duplicated.

2. **Decompose the research**

   Break the query into research areas that can be answered independently. Think through:

   - entry points and user-facing surfaces
   - persistence, state, events, queues, APIs, commands, or UI components involved
   - tests and fixtures that show current behavior
   - dependency documentation or framework behavior that may affect interpretation
   - directories and naming patterns likely to contain evidence

   Create a small research plan for yourself before spawning. The plan is for coordination; it does not need to become a user-visible artifact.

3. **Spawn parallel child research threads**

   Use bb child threads for independent research lanes. Spawn all independent threads before waiting when their work does not depend on each other.

   Command pattern:

   ```text
   bb thread spawn --project $BB_PROJECT_ID --parent-self --environment $BB_ENVIRONMENT_ID --provider <same> --model <research model from rpi_task_context prefs> --prompt "/rpi-agent-<role> <assignment>"
   bb thread wait <thread-id>
   bb thread output <thread-id>
   ```

   Role mapping:

   - `rpi-agent-codebase-locator`: find locations, directories, tests, config, docs, and entry points.
   - `rpi-agent-codebase-analyzer`: explain how a focused current implementation behaves, with file and line citations.
   - `rpi-agent-codebase-pattern-finder`: collect existing examples, conventions, and comparable implementations.
   - `rpi-agent-web-search-researcher`: gather external documentation when a dependency, SDK, API, or current web source is needed.

   If the task touches a third-party package, framework, API, or SDK and a dependency/library researcher is available in the current runtime, use it for those scoped library questions. If no such researcher is exposed, use `rpi-agent-web-search-researcher` for current docs and do not mention the missing helper.

   Use the roles intentionally:

   - Combine related questions touching the same subsystem into one assignment.
   - Do not launch one child per question by reflex.
   - Aim for two to six child threads on medium and large research tasks.
   - Start with a locator when the relevant files are unknown.
   - Use analyzers after you have a likely path or component.
   - Use pattern-finder when current conventions and examples matter.
   - Use web-search only for external, modern, or dependency-specific facts.

   Child prompts should say what to find, not how to operate. The agent skill defines its own method.

4. **Wait for every child thread and synthesize**

   Do not write the research artifact until all spawned child threads finish or clearly fail. Read each result with `bb thread output`.

   Treat live repository evidence as the primary source. External docs explain dependencies, not local behavior by themselves.

   Synthesis requirements:

   - answer the user's research question directly
   - connect related findings across components
   - cite exact file paths and line numbers for code claims
   - include links from web research when web research was used
   - verify that task artifact paths stay under `.rpi/tasks/<slug>/`
   - document tests for each researched area, including when no tests were found

5. **Gather metadata before writing**

   Collect metadata for the research document:

   - current timestamp with timezone
   - current git commit
   - current branch
   - repository name
   - short topic
   - selected research-questions artifact name, when any

   Call `rpi_next_artifact_number` for the task. Use:

   ```text
   NN-research-<2-4-word-kebab-summary>.md
   ```

   Save under the task directory returned by `rpi_task_context`.

6. **Write the research document**

   Locate this skill's directory through the skills tier listing, then read:

   ```text
   references/research_template.md
   ```

   Use that structure. Write a complete document, not notes for later completion. Then call `rpi_artifact_save` with the artifact file name and keep the returned `::rpi-artifact{...}` directive for the final response.

7. **Try one more pass for open questions**

   After writing the first complete draft, inspect the **Open Questions** section.

   If unresolved factual questions remain and one targeted pass could answer them, spawn additional child threads for that specific gap. Do this at most once.

   When new facts come back, update the existing research document in place:

   - merge findings into the relevant sections
   - remove open questions that are answered
   - do not append a changelog at the bottom
   - call `rpi_artifact_save` again after the update

   If the second pass still cannot answer everything, leave the remaining unknowns in **Open Questions** and proceed.

8. **Prepare artifact and code links**

   Use the `::rpi-artifact{...}` directive returned by `rpi_artifact_save` in the final answer.

   For repository links, prefer file paths with line numbers in the artifact. If the repository is pushed and GitHub metadata is available, you may include permanent GitHub links, but do not block completion on that.

9. **Respond with the final-answer template**

   Read:

   ```text
   references/research_final_answer.md
   ```

   Respond using that template only. Include the saved artifact directive and mention open-question count only in the template's designated place. The last lines must be one fenced `text` block copied from the template, not an inline command. Never repeat the current command `/rpi-create-research` as the next step.

   Choose that final fenced command from `rpi_task_context.task.workflow`:

   - `rpi` -> `/rpi-create-design-discussion`
   - `outline_only` -> `/rpi-create-structure-outline`
   - `prd_tdd` -> `/rpi-create-prd`

10. **Handle follow-up research in place**

   If the user asks follow-up questions after the artifact exists, continue by updating the same research document when the new information belongs there. Use child threads as needed, preserve objective tone, and revise sections instead of tacking unrelated notes onto the end.

## Document Style and Format

The research artifact should read like a purposeful technical explainer. It is not a dump of child-thread outputs, a list of files, or a question-by-question worksheet.

Use a mix of prose, tables, diagrams, code-shape sketches, type signatures, pseudocode, and file trees when they make the system easier to understand. Keep the document factual and current-state only.

### Headers state the finding

Headings should tell the reader what is true. Avoid generic topic headings and avoid restating the question.

Prefer:

```text
### Session rows are derived from thread events
```

Avoid:

```text
### Sessions
### How are sessions stored?
```

Each section should lead with the concept, then cite the evidence.

### Writing and citation style

- State the behavior, then cite where it appears.
- Use file ranges for adjacent evidence, such as `src/app.ts:57-80`.
- Keep paragraphs short.
- Use bullets for structured fields, flags, and cases, not as a replacement for explanation.
- Include enough citations that a developer can trace the claim.
- Prefer concept-first prose over path-first inventory.

### Visual structure

Use the smallest visual that carries the structure:

- tables for matrices and comparisons
- Mermaid for object relationships, sequences, and data flow
- call trees for runtime flow
- file trees for ownership boundaries
- component trees for frontend state and composition
- type signatures, endpoints, schemas, or message examples for contracts
- pseudocode for complex current logic

Do not use `diff` blocks or `+` / `-` markers in research artifacts. Research documents describe present behavior; they do not show a proposed change.

### Code References section

Make the references section comprehensive for the researched area. Group by subsystem. Say when a group is exhaustive, and say when it lists representative or key files only.

Include directories when responsibility is directory-level, but give individual files when a developer needs precise navigation.

### Testing patterns

Every major findings section should include how that area is tested today:

- unit, integration, e2e, visual, fixture, or harness style
- relevant test file paths
- mocking or fixture conventions
- explicit "no tests found" when the research did not find coverage

## Important notes

- Use parallel child threads where it saves time and context.
- Keep child assignments narrow and read-only.
- Use the parent session for synthesis and final document authorship.
- Read named files fully before spawning.
- Wait for all child threads before writing.
- Gather metadata before writing, not after.
- Do not write placeholder sections.
- Keep research artifacts under `.rpi/tasks/<slug>/`.
- If the artifact contains code blocks that themselves show markdown fences, use four backticks for the outer fence.

<open-question-note>
If open questions remain after the optional second pass, include this sentence in the final answer after the review sentence:

`There are N open questions that need review; you can ask for another research pass, provide the answers, or tell me to remove them as irrelevant.`
</open-question-note>
