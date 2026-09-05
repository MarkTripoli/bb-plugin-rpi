---
name: rpi-implement-outline
description: Only use when the user explicitly invokes /rpi-implement-outline. Implement from an outline.
---

# Implement Outline

## Steps

0. Call hl_task_context and read its output before any file read. Use the returned task directory, task slug, artifact list, and model hints.
1. Read task.md or ticket.md from the task directory, plus every explicit @-mentioned file in full.
2. If an artifact number is needed, call hl_next_artifact_number and use the returned number in NN-implementation-notes-short-slug.md.
3. Read references/implementation_template.md and draft the artifact in that shape.
4. Write or update the artifact under .humanlayer/tasks/<slug>/.
5. Call hl_artifact_save with the artifact file name immediately after writing. Save the returned ::hl-artifact{...} line for your final answer.
6. Read references/implementation_final_answer.md and answer using that structure exactly. The final answer must end with one fenced text block containing /rpi-ci-commit.

## Rules

- Do not open unrelated task artifacts. Use only task.md, ticket.md, @ files, and comments the user asked you to inspect.
- Run the orchestrator loop: child implementer, child implementation reviewer, then pause for commit and proceed approval. The child prompt is short and points at the plan or outline file.
- For child research, spawn codebase-locator, codebase-analyzer, codebase-pattern-finder, and web-search-researcher as useful. Use:

  bb thread spawn --project $BB_PROJECT_ID --parent-self --environment $BB_ENVIRONMENT_ID --provider <same> --model <cheap research model from hl_task_context prefs> --prompt "/rpi-agent-<role> <short assignment>"
  bb thread wait <id>
  bb thread output <id>

- Spawn all independent child threads first, then wait for each one and summarize only their results.
- Treat tool or CLI errors as blockers, not as permission to write untracked side files.
