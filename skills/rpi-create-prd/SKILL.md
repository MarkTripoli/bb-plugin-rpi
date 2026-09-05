---
name: rpi-create-prd
description: Run for /rpi-create-prd requests. Create a guided Product Requirements Document artifact.
---

# PRD Phase

You are creating a Product Requirements Document. The PRD explains what the product should do and why it matters. Leave implementation architecture, data storage, and code shape for the technical design phase unless a technical constraint changes product behavior.

Run this as a guided conversation. Settle the foundation first: the problem and the success signal. Then walk the solution one decision at a time. The document must become a coherent spec as decisions land, not a transcript.

## Conversation Rules

- Ask exactly one question in each message. You may offer two or three options inside that one question, but do not stack independent decisions.
- Do not ask vague review prompts. Ask the next decision that unlocks the most progress.
- Treat clarifying questions and pushback as part of the discussion, not as permission to edit.
- Patch the PRD only when a decision is actually resolved.
- When a decision lands, rework the relevant section. Replace stale prose, update mockups, and move ruled-out choices into alternatives or out of scope.
- Keep the PRD readable as a product spec. Use headers that state the takeaway, short paragraphs, and visuals placed near the text they explain.
- Stay in product space: user flows, behavior, permissions, states, constraints, and success criteria. Defer implementation mechanics to the TDD.
- If codebase reality or product behavior is unclear, verify before presenting options.

## bb Task Setup

0. Call `rpi_task_context` before reading files, spawning child threads, or choosing an artifact path. Use its task directory, task slug, artifact manifest, repository, branch, thread id, provider, and model preferences. If it fails, stop.
1. Use the task directory returned by the tool. Do not guess a sibling under `.rpi/tasks` from an old session or a remembered slug.
2. Locate this installed skill through the skills tier listing, then read reference files relative to this skill directory: `references/prd_template.md`, `references/prd_final_answer.md`, `references/prd_final_answer.md`.
3. After every artifact write or edit, call `rpi_artifact_save` with the relative file name and keep the returned `::rpi-artifact{...}` directive for the final answer.

## Step 1: Understand the context

<instructions>

- List the task directory with `ls -La <task-dir>`.
- Read all relevant task artifacts fully, excluding research-question artifacts.
- Read task or ticket input, completed research, design discussion if present, and every explicit user-mentioned file.
- Read `references/prd_template.md` before writing.

</instructions>

<guidance>

## Working from whatever inputs exist

A PRD can start from a detailed ticket, a research document, a design discussion, or a short request. Use the inputs you have.

- Ground claims in the source you read: ticket, research, design discussion, or user statement.
- Reference upstream artifacts rather than copying them into the PRD.
- If context is thin, ask questions instead of inventing requirements.
- Capture product implications of technical constraints, but leave implementation decisions for the TDD.

## Design system for mockups

If the work touches UI, mockups should look like the user's product rather than this bb plugin. Check research for colors, typography, spacing, components, and theming. If none are documented, use a targeted `/rpi-agent-codebase-analyzer` child thread to identify the product's design system before creating mockups.

</guidance>

## Step 2: Write the skeleton

Write `NN-prd-<slug>.md` in the task directory. Use `rpi_next_artifact_number` for the number and preserve the template frontmatter fields.

Keep the first skeleton intentionally small:

- Frontmatter with `type: design-prd`, task, repo, branch, and sha.
- A title.
- A first draft Problem to Solve section.
- Empty section headers for the success signal, Proposed Solution, Alternative Solutions Considered, Solution Details, and Out of Scope.

After saving the skeleton with `rpi_artifact_save`, stop and open the foundation with one question. Quote the Problem to Solve text so the user can react to exact wording.

## Step 3: Settle the foundation

Build the foundation one decision at a time and wait after each question.

1. Problem to Solve: iterate until the user agrees the problem is correctly stated, then rework that section.
2. Success signal: propose the lever that would tell the team whether this work helped. It might be a product metric, adoption signal, operational benchmark, error rate, latency target, or qualitative review. For tiny changes, it may be valid to record that no meaningful metric exists if the user agrees.
3. Do not open solution design until both the problem and success signal are settled.

## Step 4: Solution interview

Ask one product decision at a time. For each decision:

1. State the decision clearly.
2. Present two or three options with tradeoffs and a recommendation.
3. Use an HTML mockup for visual UI choices and display it with a `::rpi-artifact{...}` embed.
4. Discuss until the decision is resolved.
5. Rework Proposed Solution, Solution Details, Alternative Solutions Considered, Out of Scope, and mockups so the document remains cohesive.

For mockups:

- Write focused HTML files under the task directory as `mockup-<description>.html`.
- Use real labels and realistic data.
- Keep each mockup focused on the current decision.
- Update embedded mockups as decisions change.

## Step 5: Solution review gate

When the solution seems complete, stop. Ask the user to read the Solution Details from top to bottom and confirm the spec hangs together before the workflow continues. Incorporate any fixes they raise.

## Step 6: Wrap up

When the user approves the solution:

- Save the latest PRD with `rpi_artifact_save`.
- Read `references/prd_final_answer.md`.
- Follow the template exactly. It points to the TDD phase.
- Include the artifact directive returned by the save tool.

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

If a child thread or direct read discovers current-state facts that are missing or stale in the completed research artifact, fold those discoveries back into that research artifact before finalizing the PRD. Save the updated research artifact with `rpi_artifact_save`, then continue the PRD from the corrected context.

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

**PRD > design discussion > research > ticket**

Earlier material provides context. The artifact from this phase records the current decision and should absorb later user feedback instead of leaving contradictions in place.
