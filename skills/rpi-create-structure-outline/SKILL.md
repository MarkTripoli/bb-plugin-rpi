---
name: rpi-create-structure-outline
description: Run for /rpi-create-structure-outline requests. Create a phased implementation outline from design artifacts.
---

# Create Structure Outline

You are creating a phased implementation outline from the research and design artifacts. This artifact decides implementation sequencing: thin, independently verifiable phases that can later be expanded into a detailed plan or implemented directly from the outline.

## Input

- If the user supplies only a directory, or supplies no directory, use the task directory returned by `rpi_task_context` and list it with `ls -La`.
- If you cannot identify the task directory or target artifacts from context, ask the user which artifacts should drive the outline.
- Do not use broad search or globbing in the task artifact directory.

## bb Task Setup

0. Call `rpi_task_context` before reading files, spawning child threads, or choosing an artifact path. Use its task directory, task slug, artifact manifest, repository, branch, thread id, provider, and model preferences. If it fails, stop.
1. Use the task directory returned by the tool. Do not guess a sibling under `.rpi/tasks` from an old session or a remembered slug.
2. Locate this installed skill through the skills tier listing, then read reference files relative to this skill directory: `references/structure_outline_template.md`, `references/show-me.md`, `references/structure_outline_final_answer.md`, `references/structure_outline_final_answer.md`.
3. After every artifact write or edit, call `rpi_artifact_save` with the relative file name and keep the returned `::rpi-artifact{...}` directive for the final answer.

## Steps

1. **Read the primary inputs fully, the rest by summary**:
   - Primary inputs, read fully: task or ticket, the newest design artifact (TDD, PRD, or design discussion, in that preference order), and any user-mentioned files that affect the outline.
   - Every other artifact in the `rpi_task_context` manifest, including completed research: use its `summary` field. Open the file only when the summary shows it bears on a phase boundary, and then read the relevant section by heading rather than the whole file.
   - Do not read research-question artifacts.
   - Take current codebase behavior and patterns from the design artifact and research summaries before choosing phases.

2. **Check related task content**:
   - If a task path is mentioned, list that path with `ls -La` and read the named files fully.
   - Read source files mentioned in the artifacts when those details are needed to shape phase boundaries.

3. **Spawn follow-up research if necessary**:

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

Do not let child research run out of sight. Spawn, wait, read output, then use or discard the finding.

4. **Read visual guidance and create the phased outline**:
   - Read `references/show-me.md` before writing.
   - Use the smallest useful set of views for each phase: compact file tree, key data structure, SQL shape, API contract, component tree, call tree, Mermaid diagram, or pseudocode.
   - Tell the story in the order that makes the phase understandable. Sometimes ownership files come first; sometimes a schema, contract, or event shape explains the rest.
   - Treat visuals and subheadings as optional. Choose based on the work, not a rigid checklist.
   - Put short connective prose between views so the phase reads like a plan, not a diagram dump.
   - Use `diff` fences only for before/after deltas. When showing a new target shape, use the project language or a plain `text` fence.
   - Use proper tree glyphs when showing file trees: `├──`, `└──`, and `│`.
   - In diff fences, use `+` for added or retargeted ownership, `-` for removals, and leading spaces for context.
   - Keep trees shallow enough to scan. Group files under shared directories and omit unchanged paths unless they provide context.

Each phase should produce a verifiable increment that crosses the necessary layers. Do not batch the whole schema, then the whole API, then the whole UI, then tests. Prefer increments such as the smallest working flow, one field carried through the stack, then the first validation case. A phase should stand on its own for verification.

5. **For each phase, specify**:
   - Overview of the phase.
   - Change outline with only the files, contracts, data shapes, components, and tests needed to understand that phase.
   - Test changes when research found relevant testing patterns.
   - Validation approach with runnable commands and any real manual checks.

6. **Create the Implementation Overview section**:
   - Add a checkbox line for every phase at the top.
   - Use `- [ ] Phase N: <Title>`.
   - These boxes are updated during implementation.

## Output Document

1. Read `references/structure_outline_template.md`.
2. Call `rpi_next_artifact_number` and write `NN-structure-outline-<slug>.md` under the task directory.
3. Check `rpi_task_context.workspace.worktreeTiming`.

4. If `worktreeTiming` is `later`, read `references/structure_outline_setup_answer.md`; otherwise read `references/structure_outline_final_answer.md`.
5. Never suggest worktree setup when `worktreeTiming` is `never` or the current workspace is already the intended worktree.
6. Save with `rpi_artifact_save` and respond with the chosen template exactly.

## Work with the user to iterate on the design

If the user provides feedback during this phase:

- Treat it as instruction to update the outline, not to begin implementation.
- Verify facts before applying corrections.
- Spawn targeted research only when needed.
- Update phase structure, scope, files, and validation accordingly.

## Artifact and Reading Rules

- Read task artifacts fully. Do not use partial reads for task files, user-mentioned files, or the artifact you are editing.
- List task directories with `ls -La <task-dir>`. Avoid plain `ls`, `ls -l`, search, and glob expansion inside `.rpi/tasks` because the path may be a linked directory.
- Do not read research-question artifacts during design, outline, or plan work. They guide the research phase only; use completed research instead.
- Do not inspect unrelated task directories unless the user explicitly asks.
- Treat failed artifact saves, failed comment calls, or unavailable task context as blockers. Do not work around them by writing untracked side files.
- Use `rpi_next_artifact_number` when creating a new numbered artifact. The file name format is `NN-<type>-<2-4-word-kebab-slug>.md`.

## Phase Changes Should Be Concise But Clear

The outline should be readable. Prefer signatures, trees, and short snippets over long code blocks. Detailed function bodies belong in the plan. Manual checks should exist only when they add value; automated verification is better when the behavior can be checked by a command.

## Markdown Formatting

When an artifact needs to show markdown that itself contains fenced code, wrap the outer example in four backticks so inner three-backtick blocks remain valid.

## Document Precedence

When documents disagree, the latest phase artifact wins:

**structure outline > TDD > PRD > design discussion > research > ticket**

Earlier material provides context. The artifact from this phase records the current decision and should absorb later user feedback instead of leaving contradictions in place.
