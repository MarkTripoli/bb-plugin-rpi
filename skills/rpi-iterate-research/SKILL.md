---
name: rpi-iterate-research
description: Run for /rpi-iterate-research requests. Update an existing research artifact from feedback or additional questions.
---

# Iterate Research

You are revising an existing research document. Keep the document as current-state technical explanation. Do not turn it into a proposal, diagnosis, or implementation plan unless the user explicitly changes the task.

## Step 0: Load bb task context

Call `hl_task_context` before reading files. Use the returned task directory, artifact list, task slug, and research model preference.

When the user passes `@artifact`, resolve it against the artifact list. If a path is supplied, confirm it is inside the task artifact directory unless the user clearly named an external source file for evidence.

## Initial Setup

When invoked without a specific artifact, inspect the task directory returned by `hl_task_context` for research documents. Look for research artifacts but exclude research-questions artifacts.

Use:

```text
ls -La .humanlayer/tasks/<task slug>
```

Use this form because the task directory may be linked. Do not use bare `ls`, `ls -l`, grep, or shell globs for this selection step.

If exactly one matching research artifact exists, read it fully and proceed.

If several research artifacts exist, ask the user which one to revise before reading any of them.

If no task context or artifact is available, answer with:

```text
I'm ready to revise the research artifact. Send the research document or the area to investigate, and I will update it with current evidence.
```

Then wait for the user.

Important: do not read `task.md`, `ticket.md`, research-questions files, design artifacts, plans, PR descriptions, or unrelated task artifacts unless the user directly names them. Iteration starts from the selected research document and the user's feedback.

## Steps

1. **Read the existing document fully**

   Read the selected research artifact with no limit or offset. Understand its frontmatter, research question, summary, detailed findings, code references, architecture notes, and open questions.

   Do not browse other files in the task artifact directory as background. The existing artifact and feedback define scope.

2. **Process the feedback**

   Classify the user's request:

   - Additional research: gather more evidence and integrate the answer.
   - Correction: revise inaccurate or stale sections.
   - Clarification: make the explanation clearer while preserving the current findings.
   - Comment response: use artifact comments if the user asks for comment-driven iteration.

   If artifact comments are part of the request, call `hl_get_artifact_comments` for the selected artifact. Do not resolve comments from this skill unless the user explicitly asks and the requested action is unambiguous; comment resolution normally belongs to `/rpi-review-artifact-comments`.

3. **Conduct additional research when needed**

   Use bb child threads when the feedback requires new investigation.

   Command pattern:

   ```text
   bb thread spawn --project $BB_PROJECT_ID --parent-self --environment $BB_ENVIRONMENT_ID --provider <same> --model <research model from hl_task_context prefs> --prompt "/rpi-agent-<role> <assignment>"
   bb thread wait <thread-id>
   bb thread output <thread-id>
   ```

   Role mapping:

   - `rpi-agent-codebase-locator`: locate files, directories, tests, docs, config, and entry points.
   - `rpi-agent-codebase-analyzer`: explain current behavior for a focused implementation area.
   - `rpi-agent-codebase-pattern-finder`: gather current examples and conventions.
   - `rpi-agent-web-search-researcher`: collect external docs or links only when the user asks for web research or a dependency needs current documentation.

   Use the roles sparingly but sufficiently:

   - Start with a locator if the relevant code is unknown.
   - Send analyzers to specific files, flows, or components after you have candidate paths.
   - Use pattern-finder for examples already present in the repository.
   - Use web-search only when external sources are relevant, and require links in the output.
   - Spawn independent lanes before waiting for them.

4. **Update the document in place**

   Revise the same artifact path. Do not create a new research document for normal iteration.

   Integrate new findings into the sections where they belong:

   - update the summary when the answer changes
   - rewrite affected findings sections so the narrative still flows
   - add or adjust diagrams, tables, call trees, file trees, component trees, contracts, or pseudocode when they improve clarity
   - update testing-pattern sections with new evidence
   - update code references with exact paths and line ranges
   - remove open questions that are now answered
   - add new open questions only for factual gaps that remain after investigation

   Do not append a running change log. The artifact should read as a single coherent document after revision.

5. **Save the updated artifact**

   Write the revised document to the same path. Call `hl_artifact_save` with the artifact file name and keep the returned `::hl-artifact{...}` directive for the final response.

6. **Update the user**

   Read:

   ```text
   references/research_final_answer.md
   ```

   Respond using that template only. Include the artifact directive. The last lines must be exactly one fenced `text` block copied from the template. For `outline_only`, use `/rpi-create-structure-outline`; for `rpi`, use `/rpi-create-design-discussion`.

## Research Guidelines

The revised artifact must continue to document the existing codebase.

Do:

- explain current behavior
- show where files, components, services, data, tests, and configuration live
- cite concrete evidence
- include links from external sources when used
- keep sections concept-oriented and readable

Do not:

- recommend changes or implementation approaches
- diagnose bugs unless the user asked for diagnosis
- rate code quality
- suggest refactors, optimizations, or best practices
- use the research artifact to argue for a future design

## Document Style and Format

Keep the research document as a technical explainer with a clear through-line. It should be understandable without reading child-thread outputs.

### Headers state the finding

When adding or revising sections, make headings assert the takeaway:

```text
### The daemon records session state before publishing updates
```

Do not use generic headings such as:

```text
### Daemon
### How does state publishing work?
```

If you encounter vague headings while editing, improve them as part of the revision.

### Visual structure

Use high-bandwidth visuals when they clarify current behavior:

- tables for structured choices, fields, or capability matrices
- Mermaid diagrams for object relationships, data flow, and sequence flow
- call trees for runtime execution
- file trees for directory responsibility
- component trees for frontend composition and state
- type, endpoint, schema, or event shapes for contracts
- pseudocode for nontrivial current logic

Do not use diff blocks or change markers in research documents. Those imply proposed edits, and this artifact is not a proposal.

### Testing patterns

For each affected findings section, document the tests that currently cover it. Include file paths, test type, fixtures, mocks, and harnesses when known. If you searched and did not find coverage, say that.

## Important notes

- Read named files fully before spawning child threads.
- Wait for every child thread before editing the artifact.
- Keep the parent session focused on synthesis.
- Keep task-specific edits under `.humanlayer/tasks/<slug>/`.
- Do not write placeholder values.
- Use four backticks for outer markdown fences when a code sample contains triple backticks.

<open-question-note>
If unresolved factual questions remain after the revision, include this sentence in the final answer after the review sentence:

`There are N open questions that need review; you can ask for another research pass, provide the answers, or tell me to remove them as irrelevant.`
</open-question-note>
