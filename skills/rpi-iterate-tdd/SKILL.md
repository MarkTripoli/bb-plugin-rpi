---
name: rpi-iterate-tdd
description: Only use when the user explicitly invokes /rpi-iterate-tdd. Revise a TDD.
---

# Iterate Tdd

## Steps

0. Call hl_task_context and read its output before any file read. Use the returned task directory, task slug, artifact list, and model hints.
1. Resolve the @<file> argument, read that artifact fully, then fetch comments with hl_get_artifact_comments when comments are relevant.
2. If an artifact number is needed, call hl_next_artifact_number and use the returned number in NN-tdd-short-slug.md.
3. Read references/tdd_template.md and draft the artifact in that shape.
4. Write or update the artifact under .humanlayer/tasks/<slug>/.
5. Call hl_artifact_save with the artifact file name immediately after writing. Save the returned ::hl-artifact{...} line for your final answer.
6. Read references/tdd_final_answer.md and answer using that structure exactly. The final answer must end with one fenced text block containing /rpi-create-structure-outline.

## Rules

- Do not open unrelated task artifacts. Use only task.md, ticket.md, @ files, and comments the user asked you to inspect.
- For child research, spawn codebase-locator, codebase-analyzer, codebase-pattern-finder, and web-search-researcher as useful. Use:

  bb thread spawn --project $BB_PROJECT_ID --parent-self --environment $BB_ENVIRONMENT_ID --provider <same> --model <cheap research model from hl_task_context prefs> --prompt "/rpi-agent-<role> <short assignment>"
  bb thread wait <id>
  bb thread output <id>

- Spawn all independent child threads first, then wait for each one and summarize only their results.
- Treat tool or CLI errors as blockers, not as permission to write untracked side files.
