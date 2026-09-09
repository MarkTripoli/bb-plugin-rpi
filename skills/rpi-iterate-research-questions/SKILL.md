---
name: rpi-iterate-research-questions
description: Run for /rpi-iterate-research-questions requests. Update an existing research-questions artifact from feedback.
---

After the task-context step, read the [RPI writing guide](../WRITING.md), resolved relative to this installed skill directory. Apply it before drafting or revising artifacts and before replying.

# Iterate Research Questions

You are revising an existing research-questions document. Preserve its purpose: it is still a neutral query plan for studying the current system, not a plan for the requested implementation.

## Step 0: Load bb task context

Call `rpi_task_context` before reading files. Use the returned task directory and artifact list to resolve the selected document. If the user passed an `@artifact` reference, match it against that artifact list.

If only a task directory or task slug is given, list the task artifact directory with:

```text
ls -La .rpi/tasks/<task slug>
```

Use `-L` and `-a`. Do not use a bare `ls`, `ls -l`, grep, or shell globbing for this lookup because the task directory may be linked.

## Input

The invocation may provide:

- `docPath`: the research-questions file to revise, for example `.rpi/tasks/<slug>/01-research-questions-auth-flow.md`
- an `@...` artifact reference
- a feedback file, ticket comment export, or pasted comments
- plain-language instructions from the user

If more than one research-questions artifact is present and the prompt does not identify one, ask the user which artifact to revise before reading any of them.

## Steps

1. **Read the existing document fully**

   Read the selected research-questions artifact from start to finish with no limit or offset. Understand the current questions, frontmatter, key context pointers, and boundaries before editing.

2. **Read feedback if it was provided**

   If the prompt includes a feedback file, comment block, or explicit `@...` input, read it fully. If the feedback lives in artifact comments and the user asks you to use those comments, call `rpi_get_artifact_comments` for the selected artifact.

   Do not read `task.md`, `ticket.md`, design artifacts, research artifacts, plans, PR descriptions, or unrelated task files unless the user explicitly names them. Iteration is scoped to the research-questions document and feedback.

3. **Apply the feedback to the same artifact**

   Update the selected document in place when changes are needed. Keep the YAML frontmatter fields intact unless the feedback specifically asks for a valid metadata correction.

   Preserve any **Key Context Pointers** section. Keep existing pointers verbatim and add newly provided links, repositories, libraries, dependencies, paths, commands, or issue keys when the feedback surfaces them.

4. **Keep the questions objective**

   The revised questions must describe discovery work only:

   - what exists
   - where behavior or data lives
   - how pieces currently interact
   - what contracts, patterns, dependencies, tests, and edge cases are already present

   Remove or rewrite any wording that asks how to build the feature, where to put new code, whether to refactor, or what approach is preferable.

5. **Save the revised artifact**

   If you changed the document, write it back to the same path. Then call `rpi_artifact_save` with the same artifact file name and retain the returned `::rpi-artifact{...}` directive.

   If no edit is needed, do not create a duplicate file. You may still call `rpi_artifact_save` if the artifact needs to be registered in the task mirror.

6. **Update the user**

   Read:

   ```text
   references/research_questions_final_answer.md
   ```

   Respond using that template only. The final response must end with exactly one fenced `text` block containing `/rpi-create-research`.

## Research Question Guidelines

Questions must stay centered on the codebase and systems as they are now.

Do not:

- include build instructions or solution guesses
- suggest improvements unless the user directly requests improvement analysis
- ask what changes should happen
- reveal the implementation route the ticket probably needs
- turn the artifact into a checklist for coding

Good questions ask for current-state explanation:

- "How does [FEATURE] work end to end, and which systems participate?"
- "What contract connects [COMPONENT1] and [COMPONENT2], and where is it implemented?"
- "How does logic flow from [ENTRY POINT] to [PERSISTENCE OR EXTERNAL SERVICE]?"
- "Where is [DATABASE TABLE, COLUMN, EVENT, API, OR CONFIG] read or written, and what current behavior depends on it?"

Use three to eight questions for most tasks. Use fewer only for narrow work; use more only when the request spans several systems.

<guidance>
If frontend work is plausible, keep or add design-system questions. The research phase needs to identify component libraries, token systems, color values, typography, spacing, borders, shadows, responsive conventions, and theming behavior that exist today.
</guidance>

<guidance>
## bb artifact links

Use the directive returned by `rpi_artifact_save` in the final answer. Do not create manual permalink text.
</guidance>
