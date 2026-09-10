---
name: rpi-create-design-discussion
description: Run for /rpi-create-design-discussion requests. Create a design discussion artifact from task and research context.
---

After the task-context step, read the [RPI writing guide](../WRITING.md), resolved relative to this installed skill directory. Apply it before drafting or revising artifacts and before replying.

# Design Discussion Phase

Convert task request and research into a decision document. Explain current product behavior, desired outcome, proposed design shape, open choices, and codebase patterns. Decides direction, not implementation.

## Work sequence

1. **Read primary inputs fully**: `task.md` or `ticket.md`, newest research artifact (`NN-research-*.md`), user-supplied `@file` paths. Read `references/design_discussion_template.md`, `references/show-me.md`, `references/artifact_template.html`, `references/design_discussion_review_answer.md`, and `references/design_discussion_final_answer.md`.
2. **Other artifacts by summary**: Use `summary` fields from the manifest. Open only when the summary shows relevance, then read by section heading. Exclude research-question artifacts unless auditing research.
3. **Spawn child research when a missing fact would change the design**: Do not start child research until you have read the primary inputs yourself. Use rpi-agent-codebase-locator (finds files and tests), rpi-agent-codebase-analyzer (current behavior), rpi-agent-codebase-pattern-finder (local precedents), and rpi-agent-web-search-researcher (external docs) per session child-thread recipe. Use only findings you have read from `bb thread output`.
4. **Write `NN-design-discussion-<slug>.md`**: Keep frontmatter fields compatible with the template: task, type, repo, branch, and sha. Include request summary, present behavior, intended outcome, excluded scope, proposed architecture, open decisions, settled decisions, and patterns to follow. Use fewest views needed. If a focused HTML visual would make a dense concept clearer, read `references/artifact_template.html`. A diagram, pseudocode block, component tree, file tree, or HTML artifact belongs beside the prose it clarifies.

**Content rules**:
- Product spec: user behavior today and after change. Keep behavior-focused; file and function names belong in patterns or architecture, not in user-facing current-state bullets.
- Architecture: show how behavior fits together (before/after, Mermaid, pseudocode, component tree, file tree, `diff` blocks).
- Design Questions: put unresolved decisions under Design Questions. For each major choice, show options, tradeoffs, and a recommendation grounded in research or local conventions. Include testing approach if research found patterns.
- Question state is binding: initial questions stay open. Do not move a question to Resolved Design Questions because you think the answer is obvious. Questions stay open until user decision, approval, or resolution in a newer artifact. When resolved, record chosen option, rationale, rejected alternatives.
- Patterns: local patterns for implementation. File locations and short snippets only. Do not paste large source blocks.

5. **Final answer**: If any design question remains open, follow `references/design_discussion_review_answer.md`. If all resolved, follow `references/design_discussion_final_answer.md`. Follow the selected template exactly.
