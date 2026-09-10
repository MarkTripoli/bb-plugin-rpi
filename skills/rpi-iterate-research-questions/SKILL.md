---
name: rpi-iterate-research-questions
description: Run for /rpi-iterate-research-questions requests. Update an existing research-questions artifact from feedback.
---

After the task-context step, read the [RPI writing guide](../WRITING.md), resolved relative to this installed skill directory. Apply it before drafting or revising artifacts and before replying.

# Iterate Research Questions

Revise an existing research-questions document. Preserve its purpose: neutral query plan for studying the current system, not a plan for the requested implementation.

## Input

The invocation may provide `docPath` (the research-questions file), an `@artifact` reference (resolve against the artifact list from `rpi_task_context`), a feedback file, ticket comment export, pasted comments, or plain-language instructions. If only a task directory or slug is given and the selected set is insufficient, call `rpi_artifacts_list`. Do not list, search, or glob the task mirror directly.

- One research-questions artifact: read it.
- Multiple: ask which one.

Do not read `task.md`, `ticket.md`, design artifacts, research artifacts, plans, PR descriptions, or unrelated task files unless the user explicitly names them. Iteration is scoped to the research-questions document and feedback.

## Steps

1. **Read the artifact fully**. Read references/research_questions_final_answer.md from this skill's directory. Read the selected research-questions artifact completely by following `rpi_artifact_read.nextOffset`. Understand the current questions, frontmatter, key context pointers, boundaries.

2. **Read feedback**. If the prompt includes a feedback file, comment block, or explicit `@...` input, read it fully. If artifact comments and the user asks, call `rpi_get_artifact_comments`.

3. **Update in place**. Keep YAML frontmatter intact unless feedback specifically asks for a valid metadata correction. Preserve **Key Context Pointers**. Keep existing pointers verbatim, add newly provided links, repos, libraries, dependencies, paths, commands, issue keys.

4. **Keep questions objective**. Revised questions describe discovery only: what exists, where behavior/data lives, how pieces interact, what contracts/patterns/dependencies/tests/edge cases are present. Remove or rewrite wording that asks how to build the feature, where to put new code, whether to refactor, or what approach is preferable.

5. **Final answer**. If changed, write back to the same path and retain the returned artifact directive. If no edit is needed, do not create a duplicate file. Read references/research_questions_final_answer.md and respond using that template only. End with exactly one fenced `text` block containing `/rpi-create-research`. Do not create manual permalink text.

## Question guidelines

Questions center on codebase and systems as they are now. Do not include build instructions, solution guesses, suggest improvements (unless user requests improvement analysis), ask what changes should happen, reveal the implementation route, or turn artifact into a checklist. Good questions ask for current-state explanation: "How does [FEATURE] work end to end, and which systems participate?" "What contract connects [COMPONENT1] and [COMPONENT2], and where is it implemented?" "How does logic flow from [ENTRY POINT] to [PERSISTENCE OR EXTERNAL SERVICE]?" "Where is [DATABASE TABLE, COLUMN, EVENT, API, OR CONFIG] read or written, and what current behavior depends on it?" Use three to eight questions for most tasks. Use fewer only for narrow work; use more only when the request spans several systems.

If frontend work is plausible, keep or add design-system questions: component libraries, token systems, color values, typography, spacing, borders, shadows, responsive conventions, theming behavior.
