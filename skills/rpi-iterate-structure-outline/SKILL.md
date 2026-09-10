---
name: rpi-iterate-structure-outline
description: Run for /rpi-iterate-structure-outline requests. Revise a phased implementation outline.
---

After the task-context step, read the [RPI writing guide](../WRITING.md), resolved relative to this installed skill directory. Apply it before drafting or revising artifacts and before replying.

# Iterate Structure Outline

Revise structure outline from feedback, comments, or new evidence. Keep phased, vertical, independently verifiable.

If no artifact is named, use `rpi_task_context` and the artifact manifest to find the structure outline. If more than one outline could be intended, ask the user to choose. A ticket or comment file may contain feedback; read it fully if provided.

## Initial Check

If no feedback and no artifact target, ask and wait:

```text
I can revise the structure outline now. Send the phase, scope, validation, or open-question change you want handled first.
```

## Steps

1. **Read inputs**: Read `references/structure_outline_template.md`, `references/structure_outline_setup_answer.md`, `references/structure_outline_final_answer.md`. Read current outline, feedback, user-mentioned files fully. Read the named artifacts and the source files the change depends on fully. Other artifacts by `summary` from manifest; open only when feedback touches them, and then read that section by heading rather than the whole file. Call `rpi_get_artifact_comments` if relevant. Exclude research-question artifacts unless asked.
2. **Verify user input**: Do not accept corrections blindly. Use direct reads or child research to confirm file paths, patterns, validation commands.
3. **Spawn child research when a missing fact would change the artifact**: Use rpi-agent-codebase-locator (files and tests), rpi-agent-codebase-analyzer (behavior), rpi-agent-codebase-pattern-finder (local precedents), rpi-agent-web-search-researcher (external docs) per session child-thread recipe. Use only findings you have read from `bb thread output`. Do not rely on hidden background work. Wait for each child and read its final output before using it.
4. **Process feedback**: Reorganize phases when requested or when verification shows split is wrong. Update scope and What we're not doing. Remove answered open questions; incorporate answer into relevant phase. Keep frontmatter and major sections. Each phase should remain vertical slice crossing layers. A phase should include the layers and checks needed for a verifiable increment. Avoid batching by layer. Do not make Phase N depend on Phase N+1.
5. **Update document**: Edit same path. Rework Implementation Overview. Update phase overviews, change outlines, test changes, validation steps, Open Questions. Keep trees small with proper glyphs. Use diff notation only when it clarifies changes.
6. **Final answer**: Check `rpi_task_context.workspace.worktreeTiming`. If `later`, follow `references/structure_outline_setup_answer.md`; otherwise follow `references/structure_outline_final_answer.md`. Never suggest worktree setup when `worktreeTiming` is `never` or workspace is already intended worktree. Respond with the selected template exactly.

## Phase Validation

Use automated verification whenever the repo can check behavior. Manual verification should be specific and valuable, not filler. If a phase has no useful manual check and no automated check, reconsider whether the slice is independently verifiable.
