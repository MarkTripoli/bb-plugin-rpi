---
name: rpi-create-prd
description: Run for /rpi-create-prd requests. Create a guided Product Requirements Document artifact.
---

After the task-context step, read the [RPI writing guide](../WRITING.md), resolved relative to this installed skill directory. Apply it before drafting or revising artifacts and before replying.

# PRD Phase

You create a Product Requirements Document explaining what the product should do and why. Leave implementation architecture, storage, and code for TDD unless a technical constraint changes product behavior.

Run as a guided conversation. Settle foundation (problem, success signal), then walk solution one decision at a time. Document becomes a coherent spec, not a transcript.

## Conversation Rules

- Ask exactly one question per message. Two or three options inside that question are allowed; do not stack independent decisions.
- Do not ask vague review prompts. Ask the next decision unlocking the most progress.
- Treat clarifying questions and pushback as discussion, not permission to edit.
- Patch PRD only when decision is resolved.
- When decision lands, rework section. Replace stale prose, update mockups, move ruled-out choices to alternatives or out of scope.
- Keep readable as product spec. Headers state takeaway, short paragraphs, visuals near explanatory text.
- Stay in product space: user flows, behavior, permissions, states, constraints, success criteria. Defer implementation mechanics to TDD.
- If codebase reality or product behavior is unclear, verify before presenting options.

## References

Read from this skill directory: `references/prd_template.md`, `references/prd_final_answer.md`.

## Step 1: Understand the context

Primary inputs, read fully: task or ticket, design discussion if present (otherwise newest completed research), every user-mentioned file. For other artifacts in manifest: use `summary` field, open only when summary shows it bears on PRD, read by heading. Exclude research-question artifacts. Read `references/prd_template.md` before writing.

PRD can start from detailed ticket, research, design discussion, or short request. Ground claims in source. Reference upstream artifacts; do not copy. If context is thin, ask questions instead of inventing. Capture product implications of technical constraints; leave implementation for TDD.

If work touches UI, mockups look like user's product, not this plugin. Check research for colors, typography, spacing, components, theming. If none documented, use `/rpi-agent-codebase-analyzer` child to identify design system before creating mockups.

## Step 2: Write the skeleton

Write `NN-prd-<slug>.md`. Use `rpi_next_artifact_number`. Keep first skeleton small: frontmatter with `type: design-prd`, task, repo, branch, sha; title; first draft Problem to Solve; empty headers for success signal, Proposed Solution, Alternative Solutions Considered, Solution Details, Out of Scope. Save, stop, open foundation with one question. Quote Problem to Solve so user reacts to exact wording.

## Step 3: Settle the foundation

Build foundation one decision at a time, wait after each. Problem to Solve: iterate until user agrees, then rework. Success signal: propose lever showing whether work helped (metric, adoption, benchmark, error rate, latency, qualitative review; for tiny changes, valid to record no metric if user agrees). Do not open solution until both settled.

## Step 4: Solution interview

Ask one product decision at a time. State decision, present two or three options with tradeoffs and recommendation, use HTML mockup for visual UI choices (display with `::rpi-artifact{...}` embed), discuss until resolved, rework Proposed Solution, Solution Details, Alternative Solutions Considered, Out of Scope, and mockups.

Mockups: write `mockup-<description>.html`, use real labels and realistic data, focus each on current decision, update embedded mockups as decisions change.

## Step 5: Solution review gate

When solution seems complete, stop. Ask user to read Solution Details top to bottom and confirm spec hangs together. Incorporate fixes.

## Step 6: Wrap up

When user approves solution: save, read `references/prd_final_answer.md`, follow template exactly, include artifact directive.

Spawn rpi-agent-codebase-locator (finds files/tests), -analyzer (explains behavior), -pattern-finder (finds precedents), -web-search-researcher (checks external docs) children per the session child-thread recipe when a missing fact would change the artifact. Use only findings you have read from `bb thread output`. If a child or direct read discovers current-state facts missing or stale in completed research, fold those into the research artifact before finalizing the PRD.
