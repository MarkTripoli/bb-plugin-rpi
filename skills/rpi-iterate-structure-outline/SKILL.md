---
name: rpi-iterate-structure-outline
description: Run for /rpi-iterate-structure-outline requests. Revise a phased implementation outline.
---

After the task-context step, read the [RPI writing guide](../WRITING.md), resolved relative to this installed skill directory. Apply it before drafting or revising artifacts and before replying.

# Iterate Structure Outline

You are revising a structure outline from user feedback, comments, or new evidence. Keep the outline phased, vertical, and independently verifiable.

## Input

- If no artifact is named, use `rpi_task_context` and the artifact manifest to find the structure outline.
- If more than one outline could be intended, ask the user to choose.
- A ticket or comment file may contain feedback; read it fully if provided.

## Initial Check

If the user gives no feedback and no artifact target, ask for feedback and wait:

```text
I can revise the structure outline now. Send the phase, scope, validation, or open-question change you want handled first.
```

## bb Task Setup

0. Call `rpi_task_context` before reading files, spawning child threads, or choosing an artifact path. Use its task directory, task slug, artifact manifest, repository, branch, thread id, provider, and model preferences. If it fails, stop.
1. Use the task directory returned by the tool. Do not guess a sibling under `.rpi/tasks` from an old session or a remembered slug.
2. Locate this installed skill through the skills tier listing, then read reference files relative to this skill directory: `references/structure_outline_template.md`, `references/structure_outline_final_answer.md`, `references/structure_outline_final_answer.md`.
3. After every artifact write or edit, call `rpi_artifact_save` with the relative file name and keep the returned `::rpi-artifact{...}` directive for the final answer.

## Steps

1. **Read the primary inputs fully, the rest by summary**:
   - Primary inputs, read fully: the current outline, the feedback, and user-mentioned files.
   - Completed research, design discussion, PRD, TDD, task or ticket: use their `summary` fields from the `rpi_task_context` manifest. Open one only when the feedback touches something its summary covers, and read that section by heading rather than the whole file.
   - Do not read research-question artifacts unless asked.

2. **Check related task content**:
   - List mentioned task paths with `ls -La`.
   - Read the named artifacts and the source files the change depends on fully.

3. **Verify user input**:
   - Do not accept corrections blindly.
   - Use direct reads or child research to confirm file paths, existing patterns, and validation commands.
   - If comments are relevant, call `rpi_get_artifact_comments` for the outline artifact.

4. **Spawn follow-up research if needed**:

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

Do not rely on hidden background work. Wait for each child and read its final output before using it.

5. **Process the feedback**:
   - Reorganize phases when requested or when verification shows the current split is wrong.
   - Update scope and What we're not doing when the user adds or removes work.
   - Remove answered open questions and incorporate the answer into the relevant phase.
   - Keep frontmatter and the template's major sections.

Each phase should remain a vertical slice where possible. Avoid grouping by all schema, all API, all UI, then all tests. A phase should include the layers and checks needed for a verifiable increment. Do not make Phase N depend on Phase N+1 to prove it works.

6. **Update the document**:
   - Edit the same artifact path.
   - Rework the Implementation Overview checkbox list.
   - Update phase overviews, change outlines, test changes, validation steps, and Open Questions.
   - Keep trees small and use proper tree glyphs when a file tree is needed.
   - Use diff notation only when it clarifies additions, removals, or changed ownership.

7. **Update the user**:
   - Check `rpi_task_context.workspace.worktreeTiming`.
   - If `worktreeTiming` is `later`, read `references/structure_outline_setup_answer.md`; otherwise read `references/structure_outline_final_answer.md`.
   - Never suggest worktree setup when `worktreeTiming` is `never` or the current workspace is already the intended worktree.
   - Save with `rpi_artifact_save` and respond with the selected template exactly.

## Artifact and Reading Rules

- Read task artifacts fully. Do not use partial reads for task files, user-mentioned files, or the artifact you are editing.
- List task directories with `ls -La <task-dir>`. Avoid plain `ls`, `ls -l`, search, and glob expansion inside `.rpi/tasks` because the path may be a linked directory.
- Do not read research-question artifacts during design, outline, or plan work. They guide the research phase only; use completed research instead.
- Do not inspect unrelated task directories unless the user explicitly asks.
- Treat failed artifact saves, failed comment calls, or unavailable task context as blockers. Do not work around them by writing untracked side files.
- Use `rpi_next_artifact_number` when creating a new numbered artifact. The file name format is `NN-<type>-<2-4-word-kebab-slug>.md`.

## Phase Validation Design

Use automated verification whenever the repo can check the behavior. Manual verification should be specific and valuable, not filler. If a phase has no useful manual check and no automated check, reconsider whether the slice is independently verifiable.

## Markdown Formatting

When an artifact needs to show markdown that itself contains fenced code, wrap the outer example in four backticks so inner three-backtick blocks remain valid.

## Document Precedence

When documents disagree, the latest phase artifact wins:

**structure outline > TDD > PRD > design discussion > research > ticket**

Earlier material provides context. The artifact from this phase records the current decision and should absorb later user feedback instead of leaving contradictions in place.
