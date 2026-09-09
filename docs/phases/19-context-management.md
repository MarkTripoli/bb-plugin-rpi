# Phase 19: Context management

This phase implements the context-management strategy approved in the originating task against the isolated `feature/context-management` worktree. It keeps the existing artifact and version store, while reducing default task bootstrap context and making fresh-session continuation explicit.

## What shipped

- `rpi_task_context` now selects at most 12 current artifacts by assignment, phase, predecessor output, checkpoint, and workflow input instead of returning 200 alphabetical entries plus the full task body.
- Every selected entry records its exact version, SHA-256, byte size, summary, and selection reason. The response also reports total, selected, remaining, and emitted-byte metrics.
- `rpi_artifacts_list` provides task-scoped metadata discovery in pages of at most 25 entries.
- `rpi_artifact_read` reads one exact text revision in chunks of at most 20,000 characters. It can target a Markdown heading and reports offsets, line bounds, revision identity, and the next page.
- Current command references are validated inside the task. A missing assigned artifact or more than 12 explicitly assigned artifacts fails clearly instead of falling back or silently dropping named inputs.
- Research context withholds `task.md`, `ticket.md`, `handoff.md`, and the predecessor fallback summary. Research-question artifacts and explicitly assigned sources remain available without leaking task intent through bootstrap context.
- Phase and Iterate launches identify predecessor artifacts and checkpoint state. Missing checkpoints expose the previous 600-character session summary only as a non-authoritative fallback outside research.
- Task instructions require one stable, versioned `handoff.md` before phase turnover or unfinished handoff. The checkpoint records objective, next action, selected revisions, repository state, unresolved feedback, and remaining checks.
- Implementation agents read plan or outline headings, shared constraints, the assigned phase, named dependencies, and acceptance checks from exact revisions. They no longer load unrelated phase bodies by default.
- Task skills use the bounded artifact tools for discovery and exact reads instead of listing or searching the hydrated task mirror.

No migration, dependency, vector store, embedding index, automatic summarizer, or historical-artifact deletion was added. Existing version history, hydration, confinement, and compare-and-swap behavior remain unchanged.

## Verification

The final verification run completed in this worktree:

```text
rtk npm test
251 passed, 0 failed

rtk bb plugin types --check
SDK package 0.4.34, host 0.4.34

rtk bb plugin build
dist/server.js, dist/app.js, and metadata emitted successfully

rtk npm run check:pack
npm pack contents accepted; docs and tests excluded

rtk git diff --check
passed with no output
```

Focused coverage exercises phase-aware selection, research intent isolation, explicit-input failures, Markdown heading reads that ignore fenced examples, pagination, exact revision metadata, launch continuation prompts, and the skill tool registry.

## Deviations and open reviewer checks

This work is an extension after the merged plan's numbered delivery rows, so there is no original row-specific reviewer checklist. The implementation follows the later context-management strategy and keeps its proposed token targets as hypotheses rather than hard limits.

- No live plugin install or reload was performed because this phase changes agent tools and instructions without a reviewer check requiring live installation.
- No representative long-task before-and-after benchmark was run. Artifact-read volume, hydration duration, time to first meaningful code action, provider token use, cache behavior, and end-to-end correctness still need controlled live measurement.
- A live reviewer should exercise one research continuation and one partially complete implementation continuation, then verify that selected revisions, withheld research state, checkpoint contents, repository state, and remaining checks survive without replaying unrelated artifacts.
- Concurrent dependency revision changes remain protected by exact revision reporting and existing artifact CAS behavior, but a live reviewer should confirm the agent notices the changed hash and reassesses affected work before a consequential write.
- Full release acceptance still owns install, reload, disable and enable recovery, and cross-provider task walks.
