---
name: rpi-create-design-discussion
description: Run for /rpi-create-design-discussion requests. Create a design discussion artifact from task and research context.
---

# Design Discussion Phase

You are in the design discussion phase. Convert the task request and completed research into a decision document the user can review before the implementation outline. The document should explain the current product behavior, the desired user-facing outcome, the proposed design shape, the open choices, and the codebase patterns that should constrain the work. This phase decides direction; it does not implement code.

## bb Task Setup

0. Call `rpi_task_context` before reading files, spawning child threads, or choosing an artifact path. Use its task directory, task slug, artifact manifest, repository, branch, thread id, provider, and model preferences. If it fails, stop.
1. Use the task directory returned by the tool. Do not guess a sibling under `.rpi/tasks` from an old session or a remembered slug.
2. Locate this installed skill through the skills tier listing, then read reference files relative to this skill directory: `references/design_discussion_template.md`, `references/show-me.md`, `references/artifact_template.html`, `references/design_discussion_final_answer.md`, `references/design_discussion_final_answer.md`.
3. After every artifact write or edit, call `rpi_artifact_save` with the relative file name and keep the returned `::rpi-artifact{...}` directive for the final answer.

## Work sequence after the request arrives

1. **Read the primary inputs**:
   - Primary inputs, read fully: `task.md` or `ticket.md` if present, the newest completed research artifact (`NN-research-*.md`), and every explicit `@file` or path the user supplied.
   - Every other artifact in the `rpi_task_context` manifest: use its `summary` field. Open the file only when the summary shows it bears on this design decision, and then read the relevant section by heading rather than the whole file.
   - Exclude research-question artifacts unless the user specifically asks you to audit the research setup.
   - Do not start child research until you have read the primary inputs yourself.

2. **Check for related task content**:
   - If the user mentions another path inside the task directory, list that directory with `ls -La` and read the named files fully.
   - Use the artifact manifest and its summaries before trying wider discovery.
   - Prior design discussion artifacts count as "every other artifact" above: summary first, full read only when directly relevant.

3. **Run follow-up research only when the design needs more evidence**:

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

4. **Read the templates and visual guide**:
   - Read `references/design_discussion_template.md`.
   - Read `references/show-me.md`.
   - If a focused HTML visual would make a dense concept clearer, read `references/artifact_template.html` and use its minimal visual language.
   - Use the fewest views needed. A diagram, pseudocode block, component tree, file tree, or HTML artifact belongs beside the prose it clarifies.

5. **Write the design discussion**:
   - Call `rpi_next_artifact_number`.
   - Write `NN-design-discussion-<slug>.md` in the task directory.
   - Keep frontmatter fields compatible with the template: task, type, repo, branch, and sha.
   - Include the request summary, present behavior, intended outcome, excluded scope, proposed architecture, open decisions, settled decisions, and patterns to follow.

<content_guidance>

**High-level product spec**
- Describe what the user experiences today and what will be true after the change.
- Keep this section about behavior and user value. File names and function names belong in patterns or architecture, not in user-facing current-state bullets.

**Proposed end state architecture**
- Show how the intended behavior fits together.
- Use a before/after view, Mermaid, pseudocode, a component tree, or a compact file responsibility tree when it improves the decision.
- Prefer `diff` blocks when the important fact is the change from an existing shape.

**Design decisions**
- Put unresolved decisions under Design Questions.
- For each major choice, show options, tradeoffs, and a recommendation grounded in research or local conventions.
- If research found testing patterns, include the testing approach briefly with file references.

**Question state is binding**
- Initial questions stay open.
- Do not move a question to Resolved Design Questions because you think the answer is obvious.
- Only a clear user decision, user approval, or a decision already recorded in a newer artifact can resolve a question.
- When a question is resolved, record the chosen option, the rationale, and why the meaningful alternatives were not selected.

**Patterns to follow**
- Include local patterns that implementation should copy.
- Use file locations and short snippets. Do not paste large source blocks.

</content_guidance>

6. **Choose the final answer template**:
   - If any design question remains open, read `references/design_discussion_review_answer.md`.
   - If every design question is resolved, read `references/design_discussion_final_answer.md`.
   - Follow the selected template exactly and include the saved artifact directive.

## Artifact and Reading Rules

- Read task artifacts fully. Do not use partial reads for task files, user-mentioned files, or the artifact you are editing.
- List task directories with `ls -La <task-dir>`. Avoid plain `ls`, `ls -l`, search, and glob expansion inside `.rpi/tasks` because the path may be a linked directory.
- Do not read research-question artifacts during design, outline, or plan work. They guide the research phase only; use completed research instead.
- Do not inspect unrelated task directories unless the user explicitly asks.
- Treat failed artifact saves, failed comment calls, or unavailable task context as blockers. Do not work around them by writing untracked side files.
- Use `rpi_next_artifact_number` when creating a new numbered artifact. The file name format is `NN-<type>-<2-4-word-kebab-slug>.md`.

## Markdown Formatting

When an artifact needs to show markdown that itself contains fenced code, wrap the outer example in four backticks so inner three-backtick blocks remain valid.

## Document Precedence

When documents disagree, the latest phase artifact wins:

**design discussion > research > ticket**

Earlier material provides context. The artifact from this phase records the current decision and should absorb later user feedback instead of leaving contradictions in place.
