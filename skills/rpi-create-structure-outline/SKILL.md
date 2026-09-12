---
name: rpi-create-structure-outline
description: Run for /rpi-create-structure-outline requests. Create a phased implementation outline from design artifacts.
---

After the task-context step, read the [RPI writing guide](../WRITING.md), resolved relative to this installed skill directory. Apply it before drafting or revising artifacts and before replying.

# Create Structure Outline

Create phased implementation outline from research and design artifacts. Decides sequencing: thin, independently verifiable phases.

If you cannot identify the task directory or target artifacts from context, ask the user which artifacts should drive the outline. Do not use broad search or globbing in the task artifact directory.

## Steps

1. **Read inputs**: Read `references/structure_outline_template.md`, `references/show-me.md`, `references/structure_outline_setup_answer.md`, `references/structure_outline_final_answer.md`. Read task or ticket, newest design artifact (TDD > PRD > design discussion), user-mentioned files fully. Read source files mentioned in the artifacts when those details are needed to shape phase boundaries. Other artifacts by `summary` from manifest; open only when summary shows phase-boundary relevance, and then read the relevant section by heading rather than the whole file. Exclude research-question artifacts. Take behavior and patterns from design and research summaries.
2. **Spawn child research when a missing fact would change the artifact**: Use rpi-agent-codebase-locator (files and tests), rpi-agent-codebase-analyzer (behavior), rpi-agent-codebase-pattern-finder (local precedents), rpi-agent-web-search-researcher (external docs) per session child-thread recipe. Use only findings you have read from `bb thread output`. Do not let child research run out of sight. Spawn, wait, read output, then use or discard the finding.
3. **Create phased outline**: Use smallest useful views per phase (file tree, data structure, SQL shape, API contract, component tree, call tree, Mermaid, pseudocode). Tell the story in understandable order. Treat visuals and subheadings as optional. Short connective prose between views. Use `diff` fences for before/after; in diff fences, use `+` for added or retargeted ownership, `-` for removals, and leading spaces for context. Project language or `text` fences for new shapes. Proper tree glyphs (`├──`, `└──`, `│`). Keep trees shallow; group files, omit unchanged paths. Each phase produces verifiable increment crossing necessary layers. Do not batch the whole schema, then the whole API, then the whole UI, then tests. Avoid batching by layer; prefer smallest working flow. A phase should stand on its own for verification.

4. **Per phase**: Overview, change outline (files, contracts, data shapes, components, tests), test changes when patterns found, validation (runnable commands and real manual checks).
5. **Implementation Overview**: Checkbox per phase (`- [ ] Phase N: <Title>`). These boxes are updated during implementation.

6. **Output**: Write `NN-structure-outline-<slug>.md`. Check `rpi_task_context.workspace.worktreeTiming`. If `later`, follow `references/structure_outline_setup_answer.md`; otherwise follow `references/structure_outline_final_answer.md`. Never suggest worktree setup when `worktreeTiming` is `never` or workspace is already intended worktree.

## User feedback

Treat feedback as instruction to update outline, not begin implementation. Verify facts before applying. Spawn targeted research when needed. Update phase structure, scope, files, validation.

## Conciseness

Prefer signatures, trees, short snippets over long code blocks. Detailed function bodies belong in plan. Prefer automated verification; record human-only evidence as plain bullets with pointers, never as checklist items. Manual checks should exist only when they add value; automated verification is better when the behavior can be checked by a command.
